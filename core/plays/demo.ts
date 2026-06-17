import { randomUUID } from "node:crypto";
import { createHeuristicJudge } from "../agents/eval/judge.ts";
import {
  createInMemoryRepMemory,
  wireOutcomeFeedback,
} from "../agents/memory/index.ts";
import {
  createDryRunEmailTransport,
  createOwnedDomainEmailChannel,
} from "../channels/email/index.ts";
import type { GraphCompany, GraphPerson } from "../graph/types.ts";
import type { Rep, Signal } from "../primitives/index.ts";
import { ingestManualSignal } from "../signals/index.ts";
import { createInMemoryEventBus } from "../substrate/events/adapters/in-memory.ts";
import { createInProcessWorkflowRuntime } from "../substrate/workflows/index.ts";
import {
  createSignalToEmailPlayWorkflow,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  type SignalToEmailPlayDeps,
  type SignalToEmailPlayInput,
  type SignalToEmailPlayOutput,
} from "./signal-email-play.ts";
import {
  createInMemoryVerticalSliceStore,
  wireInMemoryVerticalSliceMessageLifecycleProjection,
} from "./vertical-store.ts";
import type { PlayChannelPolicy } from "./autonomy.ts";

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for vertical slice state");
}

export interface FirstVerticalSliceResult {
  output: SignalToEmailPlayOutput;
  sentEmailCount: number;
  eventTypes: string[];
  proceduralScoreAfterOutcome: number;
  state: Awaited<ReturnType<ReturnType<typeof createInMemoryVerticalSliceStore>["snapshot"]>>;
}

export interface RunFirstVerticalSliceOptions {
  emailApproval?: SignalToEmailPlayInput["email_approval"];
  autoApprove?: boolean;
  approvalNote?: string;
  writerLlm?: SignalToEmailPlayDeps["writerLlm"];
  draftGroundingProvider?: SignalToEmailPlayDeps["draftGroundingProvider"];
  emailDailyCap?: number;
  playChannelPolicy?: PlayChannelPolicy;
  workspaceContextMarkdown?: string;
}

export async function runFirstVerticalSlice(
  opts: RunFirstVerticalSliceOptions = {},
): Promise<FirstVerticalSliceResult> {
  const workspace_id = randomUUID();
  const rep_id = randomUUID();
  const company_id = randomUUID();
  const person_id = randomUUID();
  const signal_id = randomUUID();
  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const now = new Date().toISOString();

  const rep: Rep = {
    id: rep_id,
    workspace_id,
    name: "Outbound agent",
    role: "sdr",
    status: "active",
    persona: {
      voice: "Warm, precise, low-hype, founder-to-founder.",
      story: "Acts on fresh buying signals without spraying generic outreach.",
      kpis: ["positive replies", "meetings booked"],
      do_not: ["Do not mention being an AI.", "Do not overpromise."],
      samples: ["Saw the launch. The timing feels worth a quick compare-notes conversation."],
    },
    channels: ["email"],
    autonomy: {
      channels: {
        email: { daily_cap: 25, approval: "none" },
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
    provenance: { seed: "first-vertical-slice" },
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
    linkedin_url: null,
    x_handle: null,
    properties: {},
    provenance: { seed: "first-vertical-slice" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };

  const signalTemplate: Signal = {
    id: signal_id,
    workspace_id,
    source_id: null,
    kind: "funding",
    title: "Acme Payroll announced a Series A",
    content: "Acme Payroll raised a Series A to expand finance workflows for distributed teams.",
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
    provenance: { seed: "first-vertical-slice" },
    ingested_at: now,
  };

  const bus = createInMemoryEventBus();
  const memory = createInMemoryRepMemory();
  const pattern_key = "icp:fintech-founder|signal:funding|stage:cold_open";
  const exemplar = await memory.procedural.add(
    { workspace_id, rep_id },
    {
      pattern_key,
      initial_score: 0.55,
      exemplar: {
        subject: "Congrats on the round",
        body: "Congrats on the raise. Usually this is when pipeline quality starts mattering more than raw volume.",
      },
    },
  );
  await wireOutcomeFeedback({
    bus,
    procedural: memory.procedural,
    async attribution(event) {
      const payload = event.payload as {
        attributed_rep_id?: string | null;
        properties?: Record<string, unknown>;
      };
      const props = payload.properties ?? {};
      const exemplar_ids = Array.isArray(props.exemplar_ids)
        ? props.exemplar_ids.filter((id): id is string => typeof id === "string")
        : [];
      const key = typeof props.pattern_key === "string" ? props.pattern_key : null;
      if (!payload.attributed_rep_id || !key || exemplar_ids.length === 0) return null;
      return {
        scope: { workspace_id: event.workspace_id, rep_id: payload.attributed_rep_id },
        pattern_key: key,
        exemplar_ids,
      };
    },
  });

  const store = createInMemoryVerticalSliceStore({
    reps: [rep],
    signals: [],
    persons: [person],
    companies: [company],
  });
  await wireInMemoryVerticalSliceMessageLifecycleProjection(store, bus);
  const transport = createDryRunEmailTransport();
  const email = createOwnedDomainEmailChannel({
    accounts: [
      {
        id: randomUUID(),
        display_name: "sampark@go.bombsell.example",
        kind: "email_domain",
        status: "connected",
        daily_cap: opts.emailDailyCap ?? 10,
        daily_used: 0,
      },
    ],
    transport,
  });
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createSignalToEmailPlayWorkflow({
      store,
      memory,
      judge: createHeuristicJudge({ threshold: 0.55 }),
      writerLlm: opts.writerLlm,
      email,
      bus,
      workspaceContextProvider: opts.workspaceContextMarkdown
        ? async () => opts.workspaceContextMarkdown
        : undefined,
      draftGroundingProvider: opts.draftGroundingProvider,
    }),
  );
  if (opts.autoApprove) {
    await bus.subscribe("approval.requested", async (event) => {
      await runtime.resolveApproval(event.payload.approval_id, {
        decision: "approved",
        note: opts.approvalNote,
      });
    });
  }

  const signal = await ingestManualSignal({
    id: signal_id,
    workspace_id,
    kind: signalTemplate.kind,
    title: signalTemplate.title,
    content: signalTemplate.content,
    url: signalTemplate.url,
    icp_segment: signalTemplate.audience_hint.icp_segment,
    match_score: signalTemplate.match_score,
    company,
    person,
  }, {
    store,
    bus,
    producer_ref: "demo:first-vertical-slice",
  });
  const signalEvent = bus.published.find(
    (event) => event.event_type === "signal.ingested",
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
    play_id,
    play_run_id,
    input: {
      workspace_id,
      play_id,
      play_run_id,
      rep_id,
      signal_id: signal.id,
      person_id,
      company_id,
      trigger_event_id: signalEvent?.id ?? null,
      email_approval: opts.emailApproval ?? "none",
      play_channel_policy: opts.playChannelPolicy ?? null,
      simulate_outcome_kind: "positive_reply",
    },
    correlation_id: signalEvent?.id,
    causation_id: signalEvent?.id,
    idempotency_key: `signal:${signal_id}:play:${play_id}`,
  });

  await waitFor(async () => {
    const current = await runtime.get<SignalToEmailPlayInput, SignalToEmailPlayOutput>(run.id);
    return current?.status === "completed" || current?.status === "failed";
  });

  const completed = await runtime.get<SignalToEmailPlayInput, SignalToEmailPlayOutput>(run.id);
  if (!completed || completed.status !== "completed" || !completed.output) {
    throw new Error(completed?.error?.message ?? "Vertical slice workflow did not complete");
  }
  const output = completed.output;
  await waitFor(async () => {
    const state = await store.snapshot();
    const message = state.messages.find(
      (candidate) => candidate.id === output.message_id,
    );
    if (!message) return false;
    return output.decision === "sent"
      ? message.status === "sent"
      : message.status === "deferred";
  });
  if (output.outcome_id) {
    await waitFor(async () => {
      const rows = await memory.procedural.topForPattern({ workspace_id, rep_id }, pattern_key);
      return (rows[0]?.win_count ?? 0) > 0;
    });
  }

  const top = await memory.procedural.topForPattern({ workspace_id, rep_id }, pattern_key);
  void exemplar;
  return {
    output,
    sentEmailCount: transport.sent.length,
    eventTypes: bus.published.map((event) => event.event_type),
    proceduralScoreAfterOutcome: top[0]?.score ?? 0,
    state: await store.snapshot(),
  };
}
