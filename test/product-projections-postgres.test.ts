import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  bootstrapWorkspace,
  DEFAULT_PRODUCT_USER_ID,
  draftProductRecommendation,
  getProductRecommendationSurface,
  getProductEngine,
  projectPendingProductEventsOnce,
  recordProductRecommendationOutcome,
  reviewProductRecommendation,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { PROCEDURAL_MEMORY_STATE_PROJECTION } from "../core/agents/memory/index.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import { setupPg } from "./_pg.ts";

test("product projections: stored domain evidence catches up without transient listeners", async (t) => {
  const fx = await setupPg("product_projection_catchup");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const domain = await fx.pool.query<{ id: string; domain: string }>(
      `update sending_domains
          set spf_verified = false,
              dkim_verified = false,
              dmarc_verified = false,
              warmup_state = 'unverified',
              current_daily_cap = 0,
              target_daily_cap = 25
        where channel_account_id = $1
      returning id, domain::text as domain`,
      [boot.channel_account_id],
    );
    const row = domain.rows[0];
    const engine = await getProductEngine();
    await engine.bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "channel.domain.status.received",
      source: "webhook",
      idempotency_key: "test:domain-status",
      payload: {
        sending_domain_id: row.id,
        channel_account_id: boot.channel_account_id,
        domain: row.domain,
        provider: "resend",
        provider_domain_id: "domain_123",
        provider_status: "verified",
        records: [
          { record: "SPF", name: "send.example", type: "MX", value: "smtp", status: "verified" },
          { record: "DKIM", name: "dkim.example", type: "TXT", value: "key", status: "verified" },
        ],
      },
    });
    await engine.bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "channel.domain.dmarc.observed",
      source: "system",
      idempotency_key: "test:dmarc-status",
      payload: {
        sending_domain_id: row.id,
        channel_account_id: boot.channel_account_id,
        domain: row.domain,
        dns_name: `_dmarc.${row.domain}`,
        verified: true,
        policy: "quarantine",
        record: "v=DMARC1; p=quarantine",
      },
    });

    const before = await fx.pool.query<{ warmup_state: string }>(
      `select warmup_state from sending_domains where id = $1`,
      [row.id],
    );
    assert.equal(before.rows[0].warmup_state, "unverified");

    const projected = await projectPendingProductEventsOnce({ leaseOwner: "projector-a" });
    assert.equal(projected.completed, 2);
    const emittedTrust = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from events
        where workspace_id = $1
          and event_type = 'channel.domain.trust.verified'`,
      [boot.workspace_id],
    );
    assert.equal(emittedTrust.rows[0].count, "1");

    const trustProjection = await projectPendingProductEventsOnce({ leaseOwner: "projector-b" });
    assert.equal(trustProjection.completed, 1);
    const after = await fx.pool.query<{
      spf_verified: boolean;
      dkim_verified: boolean;
      dmarc_verified: boolean;
      warmup_state: string;
      current_daily_cap: number;
    }>(
      `select spf_verified, dkim_verified, dmarc_verified, warmup_state, current_daily_cap
         from sending_domains
        where id = $1`,
      [row.id],
    );
    assert.deepEqual(after.rows[0], {
      spf_verified: true,
      dkim_verified: true,
      dmarc_verified: true,
      warmup_state: "warming",
      current_daily_cap: 0,
    });
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product projections: replayed Outcome learning applies to procedural memory once", async (t) => {
  const fx = await setupPg("product_projection_learning");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const exemplar = await fx.pool.query<{
      id: string;
      score: string;
      pattern_key: string;
    }>(
      `select id, score::text as score, pattern_key
         from rep_memory_procedural
        where workspace_id = $1 and rep_id = $2
        limit 1`,
      [boot.workspace_id, boot.rep_id],
    );
    const seed = exemplar.rows[0]!;
    const engine = await getProductEngine();
    const outcomeEvent = await engine.bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "positive_reply",
        score: 1,
        conversation_id: null,
        attributed_play_id: null,
        attributed_rep_id: boot.rep_id,
        properties: {
          pattern_key: seed.pattern_key,
          exemplar_ids: [seed.id],
        },
      },
    });

    const initial = await projectPendingProductEventsOnce({ leaseOwner: "learning-a" });
    assert.equal(initial.failed, 0);
    assert.ok(initial.completed >= 3);
    const applied = await fx.pool.query<{
      score: string;
      win_count: number;
      ledger_count: string;
      update_event_id: string;
    }>(
      `select p.score::text as score,
              p.win_count,
              (select count(*)::text
                 from rep_memory_procedural_applications a
                where a.outcome_event_id = $3) as ledger_count,
              (select id::text
                 from events e
                where e.event_type = 'rep.memory.procedural.updated'
                  and e.causation_id = $3
                limit 1) as update_event_id
         from rep_memory_procedural p
        where p.workspace_id = $1 and p.id = $2`,
      [boot.workspace_id, seed.id, outcomeEvent.id],
    );
    assert.equal(Number(applied.rows[0].score), Number(seed.score) + 0.1);
    assert.equal(applied.rows[0].win_count, 1);
    assert.equal(applied.rows[0].ledger_count, "1");

    await fx.pool.query(
      `update event_projection_jobs
          set status = 'pending',
              next_attempt_at = now(),
              lease_owner = null,
              lease_expires_at = null,
              completed_at = null
        where projection_name = $1
          and event_id = $2`,
      [PROCEDURAL_MEMORY_STATE_PROJECTION, applied.rows[0].update_event_id],
    );
    const replay = await projectPendingProductEventsOnce({ leaseOwner: "learning-b" });
    assert.equal(replay.completed, 1);
    const afterReplay = await fx.pool.query<{
      score: string;
      win_count: number;
      ledger_count: string;
    }>(
      `select p.score::text as score,
              p.win_count,
              (select count(*)::text
                 from rep_memory_procedural_applications a
                where a.outcome_event_id = $3) as ledger_count
         from rep_memory_procedural p
        where p.workspace_id = $1 and p.id = $2`,
      [boot.workspace_id, seed.id, outcomeEvent.id],
    );
    assert.equal(afterReplay.rows[0].score, applied.rows[0].score);
    assert.equal(afterReplay.rows[0].win_count, 1);
    assert.equal(afterReplay.rows[0].ledger_count, "1");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product projections: first Content recommendation Outcome seeds Vaani memory", async (t) => {
  const fx = await setupPg("product_projection_reco_outcome");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const session = {
      workspace_id: boot.workspace_id,
      user_id: DEFAULT_PRODUCT_USER_ID,
    };
    const contentEventId = randomUUID();
    await fx.pool.query(
      `insert into events (
         id, workspace_id, event_type, source, producer_ref, payload, occurred_at
       ) values (
         $1, $2, 'content.opportunity.discovered', 'agent', 'vaani:test',
         $3::jsonb, '2026-06-05T09:00:00Z'
       )`,
      [
        contentEventId,
        boot.workspace_id,
        JSON.stringify({
          request_id: "req_content_outcome_seed",
          query: "pricing objections",
          summary: "Content angle",
          opportunities: [
            {
              title: "Pricing objection angle",
              detail: "Turn the most common pricing objection into a proof post.",
              url: "https://example.com/proof",
              evidence_source_ids: [],
            },
          ],
        }),
      ],
    );

    const surface = await getProductRecommendationSurface(
      fx.pool,
      session,
      "content_opportunity",
    );
    const reviewId = surface.reviews[0]?.review_id;
    assert.ok(reviewId);

    await reviewProductRecommendation(
      {
        review_id: reviewId,
        decision: "accepted",
        note: "Ship this as a post.",
      },
      session,
    );
    const vaani = await fx.pool.query<{ id: string }>(
      `select id::text as id
         from reps
        where workspace_id = $1
          and role = 'content'
          and status = 'active'
        order by created_at asc
        limit 1`,
      [boot.workspace_id],
    );

    const result = await recordProductRecommendationOutcome(
      {
        review_id: reviewId,
        kind: "post_published",
        external_ref: "https://example.com/post",
      },
      session,
    );
    await projectPendingProductEventsOnce({ leaseOwner: "recommendation-outcome-a" });
    await projectPendingProductEventsOnce({ leaseOwner: "recommendation-outcome-b" });

    assert.equal(result.attributed_rep_id, vaani.rows[0]?.id);
    assert.equal(result.pattern_key, "recommendation:content_opportunity|stage:exa_review");
    assert.equal(result.exemplar_ids.length, 1);
    const memory = await fx.pool.query<{
      rep_name: string;
      rep_role: string;
      pattern_key: string;
      exemplar: Record<string, unknown>;
      score: string;
      win_count: number;
    }>(
      `select r.name as rep_name,
              r.role::text as rep_role,
              rpm.pattern_key,
              rpm.exemplar,
              rpm.score::text as score,
              rpm.win_count
         from rep_memory_procedural rpm
         join reps r
           on r.id = rpm.rep_id
          and r.workspace_id = rpm.workspace_id
        where rpm.workspace_id = $1
          and rpm.id = $2`,
      [boot.workspace_id, result.exemplar_ids[0]],
    );

    assert.equal(memory.rows[0]?.rep_name, "Vaani");
    assert.equal(memory.rows[0]?.rep_role, "content");
    assert.equal(
      memory.rows[0]?.pattern_key,
      "recommendation:content_opportunity|stage:exa_review",
    );
    assert.equal(memory.rows[0]?.exemplar.kind, "exa_recommendation_outcome");
    assert.deepEqual(memory.rows[0]?.exemplar.kept_example, {
      title: "Pricing objection angle",
      detail: "Turn the most common pricing objection into a proof post.",
      url: "https://example.com/proof",
      evidence_source_ids: [],
    });
    assert.equal(Number(memory.rows[0]?.score), 0.58);
    assert.equal(memory.rows[0]?.win_count, 1);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product projections: accepted Content recommendation creates a Vaani draft", async (t) => {
  const fx = await setupPg("product_projection_reco_draft");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const session = {
      workspace_id: boot.workspace_id,
      user_id: DEFAULT_PRODUCT_USER_ID,
    };
    const contentEventId = randomUUID();
    await fx.pool.query(
      `insert into events (
         id, workspace_id, event_type, source, producer_ref, payload, occurred_at
       ) values (
         $1, $2, 'content.opportunity.discovered', 'agent', 'vaani:test',
         $3::jsonb, '2026-06-05T09:10:00Z'
       )`,
      [
        contentEventId,
        boot.workspace_id,
        JSON.stringify({
          request_id: "req_content_draft",
          query: "category objections",
          summary: "Content angle",
          opportunities: [
            {
              title: "Category objection angle",
              detail: "Turn the strongest category objection into a short proof post.",
              url: "https://example.com/category-proof",
              evidence_source_ids: [],
            },
          ],
        }),
      ],
    );

    const surface = await getProductRecommendationSurface(
      fx.pool,
      session,
      "content_opportunity",
    );
    const reviewId = surface.reviews[0]?.review_id;
    assert.ok(reviewId);
    await reviewProductRecommendation(
      {
        review_id: reviewId,
        decision: "accepted",
      },
      session,
    );

    const result = await draftProductRecommendation(
      {
        review_id: reviewId,
        channel: "x_post",
      },
      session,
    );
    const draft = await fx.pool.query<{
      channel: string;
      status: string;
      subject: string | null;
      body: string | null;
      rep_name: string;
      person_name: string;
      provenance: Record<string, unknown>;
      properties: Record<string, unknown>;
    }>(
      `select m.channel::text as channel,
              m.status::text as status,
              m.subject,
              m.body,
              r.name as rep_name,
              p.full_name as person_name,
              m.provenance,
              m.properties
         from messages m
         join conversations c
           on c.id = m.conversation_id
          and c.workspace_id = m.workspace_id
         join reps r
           on r.id = c.rep_id
          and r.workspace_id = c.workspace_id
         join graph_persons p
           on p.id = c.counterparty_person_id
          and p.workspace_id = c.workspace_id
        where m.workspace_id = $1
          and m.id = $2`,
      [boot.workspace_id, result.message_id],
    );

    assert.equal(result.channel, "x_post");
    assert.equal(draft.rows[0]?.channel, "x_post");
    assert.equal(draft.rows[0]?.status, "draft");
    assert.equal(draft.rows[0]?.rep_name, "Vaani");
    assert.equal(draft.rows[0]?.person_name, "Editorial Review");
    assert.equal(draft.rows[0]?.subject, "Draft post: Category objection angle");
    assert.match(draft.rows[0]?.body ?? "", /strongest category objection/);
    assert.equal(draft.rows[0]?.provenance.source, "recommendation.draft");
    assert.equal(draft.rows[0]?.provenance.review_id, reviewId);
    assert.equal(
      draft.rows[0]?.provenance.pattern_key,
      "recommendation:content_opportunity|stage:exa_review",
    );
    assert.equal(
      (draft.rows[0]?.properties.recommendation_item as { title?: string } | undefined)?.title,
      "Category objection angle",
    );

    const repeated = await draftProductRecommendation(
      {
        review_id: reviewId,
        channel: "x_post",
      },
      session,
    );
    assert.equal(repeated.message_id, result.message_id);
    const draftCount = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from messages
        where workspace_id = $1
          and provenance->>'review_id' = $2`,
      [boot.workspace_id, reviewId],
    );
    assert.equal(draftCount.rows[0]?.count, "1");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product projections: missing procedural exemplars fail without consuming the Outcome", async (t) => {
  const fx = await setupPg("product_projection_missing_exemplar");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const engine = await getProductEngine();
    const outcomeEvent = await engine.bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "positive_reply",
        score: 1,
        conversation_id: null,
        attributed_play_id: null,
        attributed_rep_id: boot.rep_id,
        properties: {
          pattern_key: "missing:exemplar",
          exemplar_ids: [randomUUID()],
        },
      },
    });

    const projected = await projectPendingProductEventsOnce({ leaseOwner: "learning-missing" });
    assert.ok(projected.completed >= 2);
    assert.equal(projected.failed, 1);
    const ledger = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from rep_memory_procedural_applications
        where outcome_event_id = $1`,
      [outcomeEvent.id],
    );
    assert.equal(ledger.rows[0].count, "0");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});
