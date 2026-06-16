import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  EventBus,
  EventPayload,
  EventType,
} from "../../../substrate/events/index.ts";
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

export const COMPANY_BRAIN_RECALL_GRAPH_NAME = "company_brain.recall_graph.v1";
export const COMPANY_BRAIN_BRIEF_GRAPH_NAME = "company_brain.brief_graph.v1";

export type CompanyBrainBriefType =
  | "workspace"
  | "icp"
  | "account"
  | "campaign"
  | "decision_log"
  | "customer_ask_log"
  | "objection_bank"
  | "proof_bank"
  | "vertical_playbook";

export interface CompanyBrainSourceRef {
  type: string;
  id: string;
  label: string;
  url?: string | null;
}

export interface CompanyBrainPrimitiveRefs {
  rep_id?: string | null;
  signal_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
}

export interface CompanyBrainCard {
  id: string;
  kind: "profile" | "signal" | "outcome" | "playbook" | "semantic_fact" | "meeting_prep";
  title: string;
  summary: string;
  confidence: number | null;
  freshness_at: string | null;
  tags: string[];
  primitive_refs: CompanyBrainPrimitiveRefs;
  source_refs: CompanyBrainSourceRef[];
}

export interface CompanyBrainConnector {
  memory_store: {
    enabled: boolean;
    status: "disabled" | "configured";
    detail: string;
  };
}

export interface CompanyBrainBrief {
  workspace_id: string;
  generated_at: string;
  connector: CompanyBrainConnector;
  cards: CompanyBrainCard[];
}

export interface CompanyBrainGraphInput {
  workspace_id?: string;
  user_id: string;
  task?: string;
  brief_type?: CompanyBrainBriefType;
  rep_id?: string | null;
  signal_id?: string | null;
  play_id?: string | null;
  play_run_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface CompanyBrainCardRef {
  id: string;
  kind: CompanyBrainCard["kind"];
  title: string;
  confidence: number | null;
  freshness_at: string | null;
  tags: string[];
  primitive_refs: CompanyBrainCard["primitive_refs"];
  source_ref_count: number;
}

export interface CompanyBrainRecallDecision {
  workspace_id: string;
  task: string;
  brief_type: CompanyBrainBriefType;
  card_count: number;
  source_ref_count: number;
  connector: CompanyBrainBrief["connector"];
  cards: CompanyBrainCardRef[];
  redaction_status: "source_refs_only";
  next_action: "use_context" | "collect_memory";
}

export interface CompanyBrainBriefDecision extends CompanyBrainRecallDecision {
  brief_id: string;
  markdown: string;
}

export interface CompanyBrainGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    companyBrainRecall: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  companyBrainRecall: "product.company_brain.recall",
} as const;

export function createCompanyBrainRecallGraph(opts: CompanyBrainGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_RECALL_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = companyBrainInputFromState(state);
          return {
            attributes: mergeAttributes(state, {
              task: normalizedTask(input.task),
              brief_type: normalizedBriefType(input.brief_type),
              user_id: input.user_id,
            }),
          };
        },
      }),
    )
    .addNode(
      "recall",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_RECALL_GRAPH_NAME,
        node_name: "recall",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const started = new Date();
          const brain = await invokeLangGraphTool<CompanyBrainBrief>(
            tools.companyBrainRecall,
            {},
            state,
            toolOptions,
          );
          await recordMemorySpan(opts.bus, state, "memory.read", "company_brain.recall", started, {
            card_count: brain.cards.length,
            source_ref_count: sourceRefCount(brain),
            memory_store_status: brain.connector.memory_store.status,
          });
          return {
            attributes: mergeAttributes(state, {
              company_brain: brain,
            }),
            tool_results: {
              company_brain_recall: brain,
            },
          };
        },
      }),
    )
    .addNode(
      "summarize",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_RECALL_GRAPH_NAME,
        node_name: "summarize",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const brain = getAttribute<CompanyBrainBrief>(state, "company_brain");
          const decision = recallDecisionFromBrief(state, brain);
          await publishCompanyBrainEvent(opts.bus, state, "company.memory.recalled", {
            recalled_at: new Date().toISOString(),
            task: decision.task,
            brief_type: decision.brief_type,
            graph_name: COMPANY_BRAIN_RECALL_GRAPH_NAME,
            run_id: state.run_id,
            card_count: decision.card_count,
            source_ref_count: decision.source_ref_count,
            connector: decision.connector,
            primitive_refs: primitiveRefsFromState(state),
            card_refs: decision.cards,
            redaction_status: decision.redaction_status,
          }, "company-memory-recalled");
          return {
            attributes: mergeAttributes(state, {
              company_brain_recall: decision,
            }),
            tool_results: {
              company_brain_recall_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "recall")
    .addEdge("recall", "summarize")
    .addEdge("summarize", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export function createCompanyBrainBriefGraph(opts: CompanyBrainGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_BRIEF_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = companyBrainInputFromState(state);
          return {
            attributes: mergeAttributes(state, {
              task: normalizedTask(input.task),
              brief_type: normalizedBriefType(input.brief_type),
              user_id: input.user_id,
            }),
          };
        },
      }),
    )
    .addNode(
      "recall",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_BRIEF_GRAPH_NAME,
        node_name: "recall",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const started = new Date();
          const brain = await invokeLangGraphTool<CompanyBrainBrief>(
            tools.companyBrainRecall,
            {},
            state,
            toolOptions,
          );
          await recordMemorySpan(opts.bus, state, "memory.read", "company_brain.recall", started, {
            card_count: brain.cards.length,
            source_ref_count: sourceRefCount(brain),
            memory_store_status: brain.connector.memory_store.status,
          });
          return {
            attributes: mergeAttributes(state, {
              company_brain: brain,
            }),
            tool_results: {
              company_brain_recall: brain,
            },
          };
        },
      }),
    )
    .addNode(
      "brief",
      traceLangGraphNode({
        graph_name: COMPANY_BRAIN_BRIEF_GRAPH_NAME,
        node_name: "brief",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const brain = getAttribute<CompanyBrainBrief>(state, "company_brain");
          const started = new Date();
          const decision = briefDecisionFromBrief(state, brain);
          await recordMemorySpan(opts.bus, state, "memory.write", "company_brain.brief", started, {
            brief_id: decision.brief_id,
            brief_type: decision.brief_type,
            card_count: decision.card_count,
            source_ref_count: decision.source_ref_count,
          });
          await publishCompanyBrainEvent(opts.bus, state, "company.brief.updated", {
            brief_id: decision.brief_id,
            brief_type: decision.brief_type,
            updated_at: new Date().toISOString(),
            task: decision.task,
            graph_name: COMPANY_BRAIN_BRIEF_GRAPH_NAME,
            run_id: state.run_id,
            markdown: decision.markdown,
            card_count: decision.card_count,
            source_ref_count: decision.source_ref_count,
            connector: decision.connector,
            primitive_refs: primitiveRefsFromState(state),
            card_refs: decision.cards,
            redaction_status: decision.redaction_status,
          }, "company-brief-updated");
          return {
            attributes: mergeAttributes(state, {
              company_brain_brief: decision,
            }),
            tool_results: {
              company_brain_brief_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "recall")
    .addEdge("recall", "brief")
    .addEdge("brief", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runCompanyBrainRecallGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: CompanyBrainGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<CompanyBrainGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("company brain recall graph requires a workspace_id");
  }
  const graph = createCompanyBrainRecallGraph({
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
    graph_name: COMPANY_BRAIN_RECALL_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: initialCompanyBrainState(
      COMPANY_BRAIN_RECALL_GRAPH_NAME,
      workspace_id,
      opts.input,
      opts.ctx,
    ),
  });
}

export async function runCompanyBrainBriefGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: CompanyBrainGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<CompanyBrainGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("company brain brief graph requires a workspace_id");
  }
  const graph = createCompanyBrainBriefGraph({
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
    graph_name: COMPANY_BRAIN_BRIEF_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: initialCompanyBrainState(
      COMPANY_BRAIN_BRIEF_GRAPH_NAME,
      workspace_id,
      opts.input,
      opts.ctx,
    ),
  });
}

function initialCompanyBrainState(
  graph_name: string,
  workspace_id: string,
  input: CompanyBrainGraphInput,
  ctx: RunContext,
): BombsellLangGraphState {
  const brief_type = normalizedBriefType(input.brief_type);
  const task = normalizedTask(input.task);
  return {
    workspace_id,
    rep_id: input.rep_id ?? null,
    signal_id: input.signal_id ?? null,
    play_id: input.play_id ?? null,
    play_run_id: input.play_run_id ?? null,
    conversation_id: input.conversation_id ?? null,
    message_id: input.message_id ?? null,
    outcome_id: input.outcome_id ?? null,
    company_id: input.company_id ?? null,
    person_id: input.person_id ?? null,
    thread_id: input.thread_id ?? `company-brain:${workspace_id}:${brief_type}`,
    run_id: input.run_id ?? ctx.run_id,
    correlation_id: input.correlation_id ?? ctx.correlation_id,
    causation_event_id: input.causation_event_id ?? null,
    graph_name,
    attributes: {
      user_id: input.user_id,
      task,
      brief_type,
    },
    tool_results: {},
    approvals: {},
  };
}

function companyBrainInputFromState(state: BombsellLangGraphState): CompanyBrainGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: String(state.attributes?.user_id ?? ""),
    task: stringOrUndefined(state.attributes?.task),
    brief_type: briefTypeOrUndefined(state.attributes?.brief_type),
    rep_id: state.rep_id ?? null,
    signal_id: state.signal_id ?? null,
    play_id: state.play_id ?? null,
    play_run_id: state.play_run_id ?? null,
    conversation_id: state.conversation_id ?? null,
    message_id: state.message_id ?? null,
    outcome_id: state.outcome_id ?? null,
    company_id: state.company_id ?? null,
    person_id: state.person_id ?? null,
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
}

function recallDecisionFromBrief(
  state: BombsellLangGraphState,
  brain: CompanyBrainBrief,
): CompanyBrainRecallDecision {
  const cards = brain.cards.map(cardRef);
  return {
    workspace_id: brain.workspace_id,
    task: normalizedTask(state.attributes?.task),
    brief_type: normalizedBriefType(state.attributes?.brief_type),
    card_count: brain.cards.length,
    source_ref_count: sourceRefCount(brain),
    connector: brain.connector,
    cards,
    redaction_status: "source_refs_only",
    next_action: brain.cards.length > 0 ? "use_context" : "collect_memory",
  };
}

function briefDecisionFromBrief(
  state: BombsellLangGraphState,
  brain: CompanyBrainBrief,
): CompanyBrainBriefDecision {
  const recall = recallDecisionFromBrief(state, brain);
  return {
    ...recall,
    brief_id: `${recall.brief_type}:${brain.workspace_id}:${state.run_id}`,
    markdown: formatCompanyBrainMarkdownLocal(brain),
  };
}

function cardRef(card: CompanyBrainCard): CompanyBrainCardRef {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    confidence: card.confidence,
    freshness_at: card.freshness_at,
    tags: card.tags,
    primitive_refs: card.primitive_refs,
    source_ref_count: card.source_refs.length,
  };
}

async function recordMemorySpan(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  kind: "memory.read" | "memory.write",
  name: string,
  started_at: Date,
  attributes: Record<string, unknown>,
): Promise<void> {
  if (!bus) return;
  await recordAgentTraceSpan(bus, {
    workspace_id: state.workspace_id,
    kind,
    name,
    status: "ok",
    started_at,
    ended_at: new Date(),
    graph_name: state.graph_name ?? null,
    node_name: state.node_name ?? null,
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: {
      ...attributes,
      runtime: "langgraph",
      memory_layer: "company_brain",
    },
  });
}

async function publishCompanyBrainEvent<T extends EventType>(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: T,
  payload: EventPayload<T>,
  idempotencySuffix: string,
): Promise<void> {
  if (!bus) return;
  await bus.publish({
    workspace_id: state.workspace_id,
    event_type,
    source: "agent",
    producer_ref: `langgraph:${state.graph_name}`,
    correlation_id: state.correlation_id,
    causation_id: state.causation_event_id ?? null,
    idempotency_key: `${state.run_id}:${idempotencySuffix}`,
    payload,
  });
}

function sourceRefCount(brief: CompanyBrainBrief): number {
  return brief.cards.reduce((sum, card) => sum + card.source_refs.length, 0);
}

function formatCompanyBrainMarkdownLocal(brief: CompanyBrainBrief): string {
  const connector = brief.connector.memory_store.enabled
    ? "Memory Store connector configured"
    : "Memory Store connector disabled; using Bombsell native brain";
  const lines = [
    `- ${connector}`,
    ...brief.cards.slice(0, 12).map((card) => {
      const confidence = card.confidence == null ? "-" : card.confidence.toFixed(2);
      const tags = card.tags.length > 0 ? ` tags=${card.tags.join(",")}` : "";
      return `- [${card.kind}] ${line(card.title)} confidence=${confidence} fresh=${card.freshness_at ?? "-"} refs=${card.source_refs.length}${tags}: ${line(card.summary)}`;
    }),
  ];
  return lines.length > 1 ? lines.join("\n") : "- none";
}

function normalizedTask(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "Recall source-backed workspace context for the current GTM task.";
}

function normalizedBriefType(value: unknown): CompanyBrainBriefType {
  return briefTypeOrUndefined(value) ?? "workspace";
}

function briefTypeOrUndefined(value: unknown): CompanyBrainBriefType | undefined {
  if (typeof value !== "string") return undefined;
  return [
    "workspace",
    "icp",
    "account",
    "campaign",
    "decision_log",
    "customer_ask_log",
    "objection_bank",
    "proof_bank",
    "vertical_playbook",
  ].includes(value) ? value as CompanyBrainBriefType : undefined;
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function line(value: unknown): string {
  if (typeof value !== "string") return "-";
  return value.replace(/\s+/g, " ").trim() || "-";
}
