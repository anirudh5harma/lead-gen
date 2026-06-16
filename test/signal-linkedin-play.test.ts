import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import {
  createDryRunLinkedInTransport,
  createNativeLinkedInChannel,
} from "../core/channels/index.ts";
import type { GraphCompany, GraphPerson } from "../core/graph/types.ts";
import type { Rep, Signal } from "../core/primitives/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";
import {
  createInMemoryVerticalSliceStore,
  createSignalToLinkedInPlayWorkflow,
  SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
  wireInMemoryVerticalSliceMessageLifecycleProjection,
  type SignalToLinkedInPlayInput,
  type SignalToLinkedInPlayOutput,
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
  throw new Error("Timed out waiting for LinkedIn Play state");
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
    channels: ["linkedin_dm"],
    autonomy: {
      channels: {
        linkedin_dm: { daily_cap: 10, approval: "none" },
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
    provenance: { seed: "signal-linkedin-play-test" },
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
    emails: [],
    phones: [],
    linkedin_url: "https://www.linkedin.com/in/nisha-rao",
    x_handle: null,
    properties: {},
    provenance: { seed: "signal-linkedin-play-test" },
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
    provenance: { seed: "signal-linkedin-play-test" },
    ingested_at: now,
  };
  return { workspace_id, rep_id, company_id, person_id, signal_id, rep, company, person, signal };
}

test("signal LinkedIn Play runs research, draft, judge, approval policy, and native channel send", async () => {
  const s = seed();
  const bus = createInMemoryEventBus();
  const memory = createInMemoryRepMemory();
  const store = createInMemoryVerticalSliceStore({
    reps: [s.rep],
    signals: [{
      ...s.signal,
      source_id: randomUUID(),
      provenance: {
        adapter: "exa",
        provider: "exa",
        request_id: "req_exa_signal",
        external_id: s.signal.url,
      },
    }],
    persons: [s.person],
    companies: [s.company],
  });
  await wireInMemoryVerticalSliceMessageLifecycleProjection(store, bus);

  const transport = createDryRunLinkedInTransport();
  const linkedin = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [
      {
        id: randomUUID(),
        display_name: "Maya LinkedIn",
        kind: "linkedin_session",
        status: "connected",
        daily_cap: 3,
        daily_used: 0,
      },
    ],
    transport,
  });
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToLinkedInPlayWorkflow({
      store,
      memory,
      judge: createNoopJudge(0.9, 0.6),
      linkedin,
      bus,
      workspaceContextProvider: async () => "Workspace: Acme watches fintech funding signals.",
    }),
  );

  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const run = await runtime.start<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    workspace_id: s.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
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
      action: "linkedin_dm",
      linkedin_approval: "none",
      play_channel_policy: {
        channel: "linkedin_dm",
        daily_cap: 10,
        approval: "none",
      },
      simulate_outcome_kind: "positive_reply",
    },
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });
  const completed = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "sent");
  assert.equal(completed?.output?.channel, "linkedin_dm");

  await waitFor(async () => {
    const snapshot = await store.snapshot();
    return snapshot.messages.some(
      (message) => message.id === completed?.output?.message_id && message.status === "sent",
    );
  });

  const snapshot = await store.snapshot();
  const message = snapshot.messages.find((candidate) => candidate.id === completed?.output?.message_id);
  assert.equal(message?.channel, "linkedin_dm");
  assert.equal(message?.eval_passed, true);
  assert.match(message?.provenance.pattern_key as string, /channel:linkedin_dm/);
  assert.match(message?.provenance.pattern_key as string, /skill:linkedin_signal_dm_probe@v1/);
  assert.equal(message?.provenance.skill_key, "linkedin_signal_dm_probe");
  assert.equal(completed?.output?.skill_key, "linkedin_signal_dm_probe");
  assert.equal((message?.provenance.exa_influence as { provider?: string } | undefined)?.provider, "exa");
  assert.equal(
    (message?.provenance.exa_influence as { request_id?: string } | undefined)?.request_id,
    "req_exa_signal",
  );
  const outcome = bus.published.find((event) => event.event_type === "outcome.recorded");
  assert.equal(
    (outcome?.payload.properties as { exa_influence?: { provider?: string } } | undefined)
      ?.exa_influence?.provider,
    "exa",
  );
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].target_profile_url, s.person.linkedin_url);
  assert.deepEqual(
    bus.published
      .map((event) => event.event_type)
      .filter((type) =>
        [
          "play.run.started",
          "conversation.opened",
          "draft.proposed",
          "draft.judged",
          "message.queued",
          "message.sent",
          "outcome.recorded",
          "play.run.completed",
        ].includes(type),
      ),
    [
      "play.run.started",
      "conversation.opened",
      "draft.proposed",
      "draft.judged",
      "message.queued",
      "message.sent",
      "outcome.recorded",
      "play.run.completed",
    ],
  );
});

test("signal LinkedIn Play grounds weak signals with Exa before writing", async () => {
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
  const transport = createDryRunLinkedInTransport();
  const linkedin = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [{
      id: randomUUID(),
      display_name: "Maya LinkedIn",
      kind: "linkedin_session",
      status: "connected",
      daily_cap: 3,
      daily_used: 0,
    }],
    transport,
  });
  let groundingCalls = 0;
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToLinkedInPlayWorkflow({
      store,
      memory,
      judge: createNoopJudge(0.9, 0.6),
      linkedin,
      bus,
      draftGroundingProvider: async (input) => {
        groundingCalls += 1;
        assert.match(input.query, /Acme Payroll announced a Series A/);
        return {
          request_id: "req_grounding_1",
          evidence_source_ids: ["00000000-0000-4000-8000-000000000001"],
          summary: "1. Acme proof - Fresh public evidence for the draft.",
        };
      },
    }),
  );

  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const run = await runtime.start<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    workspace_id: s.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
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
      action: "linkedin_dm",
      linkedin_approval: "none",
    },
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });
  const completed = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "sent");
  assert.equal(groundingCalls, 1);

  const snapshot = await store.snapshot();
  const message = snapshot.messages.find((candidate) => candidate.id === completed?.output?.message_id);
  const grounding = message?.provenance.exa_grounding as
    | { request_id?: string; evidence_source_ids?: string[]; summary?: string }
    | undefined;
  assert.equal(grounding?.request_id, "req_grounding_1");
  assert.deepEqual(grounding?.evidence_source_ids, ["00000000-0000-4000-8000-000000000001"]);
  assert.match(grounding?.summary ?? "", /Fresh public evidence/);
});

test("signal LinkedIn Play skips failed Exa draft grounding and still sends", async () => {
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
  const transport = createDryRunLinkedInTransport();
  const linkedin = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [{
      id: randomUUID(),
      display_name: "Maya LinkedIn",
      kind: "linkedin_session",
      status: "connected",
      daily_cap: 3,
      daily_used: 0,
    }],
    transport,
  });
  let groundingCalls = 0;
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToLinkedInPlayWorkflow({
      store,
      memory,
      judge: createNoopJudge(0.9, 0.6),
      linkedin,
      bus,
      draftGroundingProvider: async () => {
        groundingCalls += 1;
        throw new Error("Exa daily_query_cap_exhausted exceeded");
      },
    }),
  );

  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const run = await runtime.start<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    workspace_id: s.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
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
      action: "linkedin_dm",
      linkedin_approval: "none",
    },
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });
  const completed = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "sent");
  assert.equal(groundingCalls, 1);

  const snapshot = await store.snapshot();
  const message = snapshot.messages.find((candidate) => candidate.id === completed?.output?.message_id);
  assert.equal(message?.provenance.exa_grounding, undefined);
});

test("signal LinkedIn Play defers safely when the target has no LinkedIn profile", async () => {
  const s = seed();
  const bus = createInMemoryEventBus();
  const memory = createInMemoryRepMemory();
  const store = createInMemoryVerticalSliceStore({
    reps: [s.rep],
    signals: [s.signal],
    persons: [{ ...s.person, linkedin_url: null }],
    companies: [s.company],
  });
  await wireInMemoryVerticalSliceMessageLifecycleProjection(store, bus);
  const transport = createDryRunLinkedInTransport();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToLinkedInPlayWorkflow({
      store,
      memory,
      judge: createNoopJudge(0.9, 0.6),
      linkedin: createNativeLinkedInChannel({
        action: "linkedin_dm",
        accounts: [
          {
            id: randomUUID(),
            display_name: "Maya LinkedIn",
            kind: "linkedin_session",
            status: "connected",
            daily_cap: 3,
            daily_used: 0,
          },
        ],
        transport,
      }),
      bus,
    }),
  );

  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const run = await runtime.start<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    workspace_id: s.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
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
      action: "linkedin_dm",
      linkedin_approval: "none",
    },
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });
  const completed = await runtime.get<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "deferred");
  assert.equal(transport.sent.length, 0);
  assert.ok(
    bus.published.some(
      (event) =>
        event.event_type === "message.deferred" &&
        event.payload.defer_reason === "missing_linkedin_profile",
    ),
  );
});
