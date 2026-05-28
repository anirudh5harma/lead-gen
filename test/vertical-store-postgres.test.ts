import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg } from "./_pg.ts";
import { createPostgresVerticalSliceStore } from "../core/plays/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { ingestManualSignal } from "../core/signals/index.ts";
import type { GraphCompany, GraphPerson } from "../core/graph/types.ts";
import type { Rep, Signal } from "../core/primitives/index.ts";

test("postgres vertical store persists graph, signal, conversation, message, and outcome rows", async (t) => {
  const fx = await setupPg("vertical_store");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const workspace_id = randomUUID();
    const rep_id = randomUUID();
    const company_id = randomUUID();
    const person_id = randomUUID();
    const now = new Date().toISOString();

    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "Vertical Store"],
    );
    const rep: Rep = {
      id: rep_id,
      workspace_id,
      name: "Maya",
      role: "sdr",
      status: "active",
      persona: { voice: "warm", kpis: [], do_not: [], samples: [] },
      channels: ["email"],
      autonomy: { channels: {}, global: {} },
      created_at: now,
      updated_at: now,
    };
    await fx.pool.query(
      `insert into reps (id, workspace_id, name, role, status, persona, channels, autonomy, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::text[], $8::jsonb, $9, $10)`,
      [
        rep.id,
        rep.workspace_id,
        rep.name,
        rep.role,
        rep.status,
        JSON.stringify(rep.persona),
        rep.channels,
        JSON.stringify(rep.autonomy),
        rep.created_at,
        rep.updated_at,
      ],
    );

    const store = createPostgresVerticalSliceStore(fx.pool);
    const company: GraphCompany = {
      id: company_id,
      workspace_id,
      name: "Acme",
      domain: "acme.example",
      industry: "Fintech",
      size_bucket: "11-50",
      description: "Payroll",
      properties: {},
      provenance: {},
      embedded_at: null,
      created_at: now,
      updated_at: now,
    };
    const person: GraphPerson = {
      id: person_id,
      workspace_id,
      full_name: "Nisha Rao",
      given_name: "Nisha",
      family_name: "Rao",
      title: "Founder",
      company_id,
      emails: ["nisha@acme.example"],
      phones: [],
      linkedin_url: null,
      x_handle: null,
      properties: {},
      provenance: {},
      embedded_at: null,
      created_at: now,
      updated_at: now,
    };
    const signal: Signal = {
      id: randomUUID(),
      workspace_id,
      source_id: null,
      kind: "funding",
      title: "Acme raised",
      content: "Series A",
      url: "https://example.com/acme",
      novelty_key: "acme-raised",
      novelty_score: 0.9,
      freshness_at: now,
      audience_hint: { icp_segment: "fintech-founder" },
      match_score: 0.8,
      match_reason: "match",
      related_company_id: company_id,
      related_person_id: person_id,
      status: "matched",
      properties: {},
      provenance: {},
      ingested_at: now,
    };

    await store.upsertCompany?.(company);
    await store.upsertPerson?.(person);
    const repeatedCompany = await store.upsertCompany?.({
      ...company,
      id: randomUUID(),
      name: "Acme Payroll",
      properties: { refreshed: true },
      updated_at: new Date().toISOString(),
    });
    const repeatedPerson = await store.upsertPerson?.({
      ...person,
      id: randomUUID(),
      full_name: "Nisha Rao",
      title: "CEO",
      company_id: repeatedCompany?.id ?? company_id,
      updated_at: new Date().toISOString(),
    });
    assert.equal(repeatedCompany?.id, company_id);
    assert.equal(repeatedPerson?.id, person_id);
    assert.equal(repeatedPerson?.title, "CEO");
    const ingested = await ingestManualSignal(
      {
        workspace_id,
        kind: "funding",
        title: "Acme raised again",
        match_score: 0.9,
        company: { ...company, id: randomUUID() },
        person: { ...person, id: randomUUID(), company_id: randomUUID() },
      },
      {
        store,
        bus: createInMemoryEventBus(),
      },
    );
    assert.equal(ingested.related_company_id, company_id);
    assert.equal(ingested.related_person_id, person_id);
    await store.upsertSignal?.(signal);
    const conversation = await store.createConversation({
      workspace_id,
      rep_id,
      counterparty_person_id: person_id,
      counterparty_company_id: company_id,
      origin_signal_id: signal.id,
      topic: signal.title,
    });
    const message = await store.createDraftMessage({
      workspace_id,
      conversation_id: conversation.id,
      subject: "hello",
      body: "body",
      provenance: { exemplar_ids: [] },
    });
    await store.markMessageJudged(message.id, 0.9, true, { critique: "ok" });
    await store.markMessageSent(message.id, "email_1");
    const outcome = await store.recordOutcome({
      workspace_id,
      kind: "positive_reply",
      score: 0.8,
      conversation_id: conversation.id,
      attributed_message_id: message.id,
      attributed_signal_id: signal.id,
      attributed_play_id: null,
      attributed_play_run_id: null,
      attributed_rep_id: rep_id,
      properties: { pattern_key: "x" },
    });

    const snapshot = await store.snapshot();
    assert.equal(snapshot.conversations[0].id, conversation.id);
    assert.equal(snapshot.messages[0].external_id, "email_1");
    assert.equal(snapshot.outcomes[0].id, outcome.id);
  } finally {
    await fx.close();
  }
});
