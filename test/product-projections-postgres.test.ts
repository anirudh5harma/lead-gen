import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  bootstrapWorkspace,
  getProductEngine,
  projectPendingProductEventsOnce,
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
