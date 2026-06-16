import { END, START, StateGraph } from "@langchain/langgraph";
import type { EventBus } from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import { recordAgentTraceSpan } from "../../../observability/index.ts";
import {
  createLangGraphMemoryCheckpoint,
} from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
  primitiveRefsFromState,
} from "../state.ts";
import {
  invokeLangGraphTool,
  type LangGraphToolOptions,
} from "../tools.ts";
import {
  runLangGraphInWorkflowStep,
  traceLangGraphNode,
} from "../runtime.ts";

export const CONTACT_WATERFALL_GRAPH_NAME = "contact.waterfall_graph.v1";

export type ContactWaterfallChannel = "email" | "linkedin";

export interface ContactWaterfallGraphInput {
  workspace_id?: string;
  user_id: string;
  signal_id: string;
  company_id: string;
  play_id: string;
  rep_id: string;
  channel: ContactWaterfallChannel;
  limit?: number;
  repair_key?: string | null;
  wait?: boolean;
  timeout_ms?: number;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface ContactWaterfallCandidate {
  person_id: string;
  full_name: string;
  title: string | null;
  company_id: string | null;
  emails: string[];
  linkedin_url: string | null;
  score: number;
  reasons: string[];
  verification: {
    email_status?: string | null;
    email_verified?: boolean;
    linkedin_ready?: boolean;
  };
  provenance: Record<string, unknown>;
}

export interface ContactWaterfallToolResult {
  workspace_id: string;
  workflow_name: "contact.resolve_for_signal.v1";
  workflow_run_id: string;
  workflow_status:
    | "pending"
    | "running"
    | "awaiting_approval"
    | "awaiting_event"
    | "completed"
    | "failed"
    | "cancelled";
  decision: "started" | "resolved" | "deferred";
  contact_resolution_id: string | null;
  candidates: ContactWaterfallCandidate[];
  selected_person_id: string | null;
  defer_reason: string | null;
}

export interface ContactWaterfallDecision {
  workspace_id: string;
  signal_id: string;
  company_id: string;
  play_id: string;
  rep_id: string;
  channel: ContactWaterfallChannel;
  workflow_run_id: string;
  workflow_status: ContactWaterfallToolResult["workflow_status"];
  decision: ContactWaterfallToolResult["decision"];
  contact_resolution_id: string | null;
  selected_person_id: string | null;
  candidate_count: number;
  top_candidate: ContactWaterfallCandidate | null;
  defer_reason: string | null;
  next_action: "continue_to_play" | "await_contact_resolution" | "review_contact_gap";
}

export interface ContactWaterfallGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    contactWaterfallResolve: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  contactWaterfallResolve: "product.contact.waterfall.resolve",
} as const;

export function createContactWaterfallGraph(opts: ContactWaterfallGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: CONTACT_WATERFALL_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = contactWaterfallInputFromState(state);
          return {
            signal_id: input.signal_id,
            company_id: input.company_id,
            play_id: input.play_id,
            rep_id: input.rep_id,
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              channel: input.channel,
              limit: normalizedLimit(input.limit),
              repair_key: input.repair_key ?? null,
              wait: input.wait ?? true,
              timeout_ms: input.timeout_ms ?? 30_000,
            }),
          };
        },
      }),
    )
    .addNode(
      "resolve",
      traceLangGraphNode({
        graph_name: CONTACT_WATERFALL_GRAPH_NAME,
        node_name: "resolve",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = contactWaterfallInputFromState(state);
          const started = new Date();
          const result = await invokeLangGraphTool<ContactWaterfallToolResult>(
            tools.contactWaterfallResolve,
            {
              signal_id: input.signal_id,
              company_id: input.company_id,
              play_id: input.play_id,
              rep_id: input.rep_id,
              channel: input.channel,
              limit: normalizedLimit(input.limit),
              repair_key: input.repair_key ?? null,
              wait: input.wait ?? true,
              timeout_ms: input.timeout_ms ?? 30_000,
            },
            state,
            toolOptions,
          );
          await recordContactWaterfallSpan(opts.bus, state, result, started);
          return {
            attributes: mergeAttributes(state, {
              contact_waterfall_result: result,
            }),
            tool_results: {
              contact_waterfall: result,
            },
          };
        },
      }),
    )
    .addNode(
      "summarize",
      traceLangGraphNode({
        graph_name: CONTACT_WATERFALL_GRAPH_NAME,
        node_name: "summarize",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<ContactWaterfallToolResult>(
            state,
            "contact_waterfall_result",
          );
          const decision = decisionFromResult(state, result);
          return {
            attributes: mergeAttributes(state, {
              contact_waterfall: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              contact_waterfall_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "resolve")
    .addEdge("resolve", "summarize")
    .addEdge("summarize", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runContactWaterfallGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: ContactWaterfallGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<ContactWaterfallGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("contact waterfall graph requires a workspace_id");
  }
  const graph = createContactWaterfallGraph({
    ...opts.graphOptions,
    bus: opts.bus,
    toolOptions: {
      ...opts.graphOptions?.toolOptions,
      defaultContext: {
        ...opts.graphOptions?.toolOptions?.defaultContext,
        workspace_id,
        user_id: opts.input.user_id,
      },
    },
  });
  return runLangGraphInWorkflowStep({
    graph_name: CONTACT_WATERFALL_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      signal_id: normalizeRequiredId(opts.input.signal_id, "signal_id"),
      company_id: normalizeRequiredId(opts.input.company_id, "company_id"),
      play_id: normalizeRequiredId(opts.input.play_id, "play_id"),
      rep_id: normalizeRequiredId(opts.input.rep_id, "rep_id"),
      thread_id: opts.input.thread_id ??
        `contact-waterfall:${workspace_id}:${opts.input.signal_id}:${opts.input.channel}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: CONTACT_WATERFALL_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        channel: normalizeChannel(opts.input.channel),
        limit: normalizedLimit(opts.input.limit),
        repair_key: opts.input.repair_key ?? null,
        wait: opts.input.wait ?? true,
        timeout_ms: opts.input.timeout_ms ?? 30_000,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromResult(
  state: BombsellLangGraphState,
  result: ContactWaterfallToolResult,
): ContactWaterfallDecision {
  return {
    workspace_id: result.workspace_id,
    signal_id: normalizeRequiredId(state.signal_id, "signal_id"),
    company_id: normalizeRequiredId(state.company_id, "company_id"),
    play_id: normalizeRequiredId(state.play_id, "play_id"),
    rep_id: normalizeRequiredId(state.rep_id, "rep_id"),
    channel: channelFromState(state),
    workflow_run_id: result.workflow_run_id,
    workflow_status: result.workflow_status,
    decision: result.decision,
    contact_resolution_id: result.contact_resolution_id,
    selected_person_id: result.selected_person_id,
    candidate_count: result.candidates.length,
    top_candidate: result.candidates[0] ?? null,
    defer_reason: result.defer_reason,
    next_action: nextAction(result),
  };
}

function nextAction(
  result: ContactWaterfallToolResult,
): ContactWaterfallDecision["next_action"] {
  if (result.decision === "resolved" && result.selected_person_id) return "continue_to_play";
  if (result.decision === "started") return "await_contact_resolution";
  return "review_contact_gap";
}

async function recordContactWaterfallSpan(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  result: ContactWaterfallToolResult,
  started_at: Date,
): Promise<void> {
  if (!bus) return;
  await recordAgentTraceSpan(bus, {
    workspace_id: state.workspace_id,
    kind: "contact.waterfall.step",
    name: "contact.resolve_for_signal.v1",
    status: result.decision === "deferred" ? "deferred" : "ok",
    started_at,
    ended_at: new Date(),
    graph_name: state.graph_name ?? CONTACT_WATERFALL_GRAPH_NAME,
    node_name: state.node_name ?? "resolve",
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: {
      workflow_name: result.workflow_name,
      workflow_run_id: result.workflow_run_id,
      workflow_status: result.workflow_status,
      decision: result.decision,
      channel: channelFromState(state),
      candidate_count: result.candidates.length,
      selected_person_id: result.selected_person_id,
      defer_reason: result.defer_reason,
      runtime: "langgraph",
    },
  });
}

function contactWaterfallInputFromState(
  state: BombsellLangGraphState,
): ContactWaterfallGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: String(state.attributes?.user_id ?? ""),
    signal_id: normalizeRequiredId(state.signal_id ?? state.attributes?.signal_id, "signal_id"),
    company_id: normalizeRequiredId(state.company_id ?? state.attributes?.company_id, "company_id"),
    play_id: normalizeRequiredId(state.play_id ?? state.attributes?.play_id, "play_id"),
    rep_id: normalizeRequiredId(state.rep_id ?? state.attributes?.rep_id, "rep_id"),
    channel: channelFromState(state),
    limit: normalizedLimit(state.attributes?.limit),
    repair_key: stringOrNull(state.attributes?.repair_key),
    wait: state.attributes?.wait === false ? false : true,
    timeout_ms: positiveIntOrUndefined(state.attributes?.timeout_ms),
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
}

function channelFromState(state: BombsellLangGraphState): ContactWaterfallChannel {
  return normalizeChannel(state.attributes?.channel);
}

function normalizeChannel(value: unknown): ContactWaterfallChannel {
  if (value === "linkedin") return "linkedin";
  return "email";
}

function normalizedLimit(value: unknown): number {
  const numeric = Number(value ?? 3);
  if (!Number.isFinite(numeric)) return 3;
  return Math.max(1, Math.min(3, Math.trunc(numeric)));
}

function normalizeRequiredId(value: unknown, name: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new Error(`contact waterfall graph requires ${name}`);
  return id;
}

function positiveIntOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.trunc(numeric);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAttribute<T>(state: BombsellLangGraphState, key: string): T {
  const value = state.attributes?.[key];
  if (value == null) throw new Error(`missing graph attribute: ${key}`);
  return value as T;
}

function mergeAttributes(
  state: BombsellLangGraphState,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(state.attributes ?? {}), ...next };
}
