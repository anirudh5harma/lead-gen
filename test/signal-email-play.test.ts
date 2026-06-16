import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import {
  createDryRunEmailTransport,
  createOwnedDomainEmailChannel,
} from "../core/channels/email/index.ts";
import type { GraphCompany, GraphPerson } from "../core/graph/types.ts";
import type { Rep, Signal } from "../core/primitives/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";
import {
  createInMemoryVerticalSliceStore,
  createSignalToEmailPlayWorkflow,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  wireInMemoryVerticalSliceMessageLifecycleProjection,
  type SignalToEmailPlayInput,
  type SignalToEmailPlayOutput,
} from "../core/plays/index.ts";

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for email Play state");
}

function seed() {
  const workspace_id = randomUUID();
  const rep_id = randomUUID();
  const company_id = randomUUID();
  const person_id = randomUUID();
  const signal_id = randomUUID();
  const now = new Date().toISOString();
  const rep: Rep = {
    id: rep_id,
    workspace_id,
    name: "Maya",
    role: "sdr",
    status: "active",
    persona: {
      voice: "Warm, precise, low-hype, founder-to-founder.",
      story: "Turns fresh market movement into useful conversations.",
      kpis: ["positive replies", "meetings booked"],
      do_not: ["Do not mention being an AI."],
      samples: [],
    },
    channels: ["email"],
    autonomy: {
      channels: {
        email: { daily_cap: 10, approval: "none" },
      },
      global: {},
    },
    created_at: now,
    updated_at: now,
  };
  const company: GraphCompany = {
    id: company_id,
    workspace_id,
    name: "Acme Payroll",
    domain: "acmepayroll.example",
    industry: "Fintech",
    size_bucket: "51-200",
    description: "Payroll infrastructure for globally distributed teams.",
    properties: {},
    provenance: { seed: "signal-email-play-test" },
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
    emails: ["nisha@acmepayroll.example"],
    phones: [],
    linkedin_url: "https://www.linkedin.com/in/nisha-rao",
    x_handle: null,
    properties: {},
    provenance: { seed: "signal-email-play-test" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const signal: Signal = {
    id: signal_id,
    workspace_id,
    source_id: null,
    kind: "funding",
    title: "Acme Payroll announced a Series A",
    content: "Acme Payroll raised a Series A to expand finance workflows.",
    url: "https://example.com/acme-series-a",
    novelty_key: "acme-series-a",
    novelty_score: 0.92,
    freshness_at: now,
    audience_hint: {
      icp_segment: "fintech-founder",
      confidence: 0.87,
      rationale: "Fresh funding creates urgency around pipeline and hiring.",
    },
    match_score: 0.88,
    match_reason: "Fintech founder with fresh funding.",
    related_company_id: company_id,
    related_person_id: person_id,
    status: "matched",
    properties: {},
    provenance: { seed: "signal-email-play-test" },
    ingested_at: now,
  };
  return { workspace_id, rep_id, company_id, person_id, signal_id, rep, company, person, signal };
}

test("signal email Play honors campaign-selected outreach skill", async () => {
  const s = seed();
  const bus = createInMemoryEventBus();
  const memory = createInMemoryRepMemory();
  const store = createInMemoryVerticalSliceStore({
    reps: [s.rep],
    signals: [s.signal],
    persons: [s.person],
    companies: [s.company],
  });
  await wireInMemoryVerticalSliceMessageLifecycleProjection(store, bus);

  const transport = createDryRunEmailTransport();
  const email = createOwnedDomainEmailChannel({
    accounts: [{
      id: randomUUID(),
      display_name: "maya@acmepayroll.example",
      kind: "owned_domain",
      status: "connected",
      daily_cap: 3,
      daily_used: 0,
    }],
    transport,
  });
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToEmailPlayWorkflow({
      store,
      memory,
      judge: createNoopJudge(0.9, 0.6),
      email,
      bus,
      workspaceContextProvider: async () =>
        "Workspace proof: concise peer-pattern openers have earned replies with funded fintech founders.",
    }),
  );

  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const run = await runtime.start<SignalToEmailPlayInput, SignalToEmailPlayOutput>({
    workspace_id: s.workspace_id,
    workflow_name: SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
    play_id,
    play_run_id,
    input: {
      workspace_id: s.workspace_id,
      play_id,
      play_run_id,
      rep_id: s.rep_id,
      signal_id: s.signal_id,
      person_id: s.person_id,
      company_id: s.company_id,
      email_approval: "none",
      play_channel_policy: {
        channel: "email",
        daily_cap: 10,
        approval: "none",
      },
      skill_key: "peer_proof_micro_case",
      skill_version: "v1",
      campaign_strategy: {
        recommendation_id: randomUUID(),
        variant_key: `play:${play_id}|skill:peer_proof_micro_case|channel:email|segment:fintech-founder`,
        matched_variant_key: `play:${play_id}|skill:peer_proof_micro_case|channel:email|segment:fintech-founder`,
        recommendation: "double_down",
        allocation_weight: 0.63,
        reason: "Positive replies justify a gated double-down.",
      },
      simulate_outcome_kind: "positive_reply",
    },
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToEmailPlayInput, SignalToEmailPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });
  const completed = await runtime.get<SignalToEmailPlayInput, SignalToEmailPlayOutput>(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "sent");
  assert.equal(completed?.output?.skill_key, "peer_proof_micro_case");
  assert.equal(completed?.output?.skill_version, "v1");

  const snapshot = await store.snapshot();
  const message = snapshot.messages.find((candidate) =>
    candidate.id === completed?.output?.message_id
  );
  assert.equal(message?.channel, "email");
  assert.equal(message?.status, "sent");
  assert.equal(message?.provenance.skill_key, "peer_proof_micro_case");
  assert.match(message?.provenance.pattern_key as string, /skill:peer_proof_micro_case@v1/);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0]?.to, "nisha@acmepayroll.example");
});
