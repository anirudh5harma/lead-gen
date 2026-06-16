import { END, START, StateGraph } from "@langchain/langgraph";
import type { EventBus } from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import {
  createLangGraphMemoryCheckpoint,
} from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
} from "../state.ts";
import {
  invokeLangGraphTool,
  type LangGraphToolOptions,
} from "../tools.ts";
import {
  runLangGraphInWorkflowStep,
  traceLangGraphNode,
} from "../runtime.ts";

export const MESSAGE_PERSONALIZATION_GRAPH_NAME = "message.personalization_graph.v1";

export type MessagePersonalizationChannel =
  | "email"
  | "linkedin_connection"
  | "linkedin_dm"
  | "linkedin_inmail"
  | "linkedin_comment"
  | "x_dm";

export type MessagePersonalizationStage = "cold_open" | "reply";

export interface MessagePersonalizationGraphInput {
  workspace_id?: string;
  user_id: string;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id?: string | null;
  channel?: MessagePersonalizationChannel;
  stage?: MessagePersonalizationStage;
  play_id?: string | null;
  play_run_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  use_llm?: boolean;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface MessagePersonalizationToolResult {
  workspace_id: string;
  conversation_id: string | null;
  message_id: string;
  channel: MessagePersonalizationChannel;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id: string | null;
  subject: string | null;
  body: string;
  pattern_key: string;
  seed_pattern_key: string | null;
  skill_key: string;
  skill_version: string;
  exemplar_ids: string[];
  procedural_exemplar_count: number;
  personalization_context_markdown: string;
  provenance: Record<string, unknown>;
  llm_used: boolean;
  next_action: "run_eval_gate";
}

export interface MessagePersonalizationDecision {
  workspace_id: string;
  conversation_id: string | null;
  message_id: string;
  channel: MessagePersonalizationChannel;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id: string | null;
  skill_key: string;
  skill_version: string;
  pattern_key: string;
  exemplar_count: number;
  llm_used: boolean;
  next_action: "run_eval_gate";
}

export interface MessagePersonalizationGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    personalizeMessage: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  personalizeMessage: "product.message.personalize",
} as const;

export function createMessagePersonalizationGraph(
  opts: MessagePersonalizationGraphOptions = {},
) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: MESSAGE_PERSONALIZATION_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = messagePersonalizationInputFromState(state);
          return {
            rep_id: input.rep_id,
            signal_id: input.signal_id,
            person_id: input.person_id,
            company_id: input.company_id ?? null,
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              rep_id: input.rep_id,
              signal_id: input.signal_id,
              person_id: input.person_id,
              company_id: input.company_id ?? null,
              channel: input.channel ?? "email",
              stage: input.stage ?? "cold_open",
              play_id: input.play_id ?? null,
              play_run_id: input.play_run_id ?? null,
              conversation_id: input.conversation_id ?? null,
              message_id: input.message_id ?? null,
              use_llm: input.use_llm,
            }),
          };
        },
      }),
    )
    .addNode(
      "personalize",
      traceLangGraphNode({
        graph_name: MESSAGE_PERSONALIZATION_GRAPH_NAME,
        node_name: "personalize",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = messagePersonalizationInputFromState(state);
          const result = await invokeLangGraphTool<MessagePersonalizationToolResult>(
            tools.personalizeMessage,
            {
              rep_id: input.rep_id,
              signal_id: input.signal_id,
              person_id: input.person_id,
              company_id: input.company_id ?? undefined,
              channel: input.channel ?? "email",
              stage: input.stage ?? "cold_open",
              play_id: input.play_id ?? undefined,
              play_run_id: input.play_run_id ?? undefined,
              conversation_id: input.conversation_id ?? undefined,
              message_id: input.message_id ?? undefined,
              use_llm: input.use_llm,
            },
            state,
            toolOptions,
          );
          return {
            rep_id: result.rep_id,
            signal_id: result.signal_id,
            person_id: result.person_id,
            company_id: result.company_id,
            attributes: mergeAttributes(state, {
              message_personalization_result: result,
              message_id: result.message_id,
              channel: result.channel,
              pattern_key: result.pattern_key,
              skill_key: result.skill_key,
              skill_version: result.skill_version,
            }),
            tool_results: {
              message_personalization: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: MESSAGE_PERSONALIZATION_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<MessagePersonalizationToolResult>(
            state,
            "message_personalization_result",
          );
          const decision = decisionFromPersonalizedMessage(result);
          return {
            attributes: mergeAttributes(state, {
              message_personalization: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              message_personalization_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "personalize")
    .addEdge("personalize", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runMessagePersonalizationGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: MessagePersonalizationGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<MessagePersonalizationGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("message personalization graph requires a workspace_id");
  }
  const graph = createMessagePersonalizationGraph({
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
    graph_name: MESSAGE_PERSONALIZATION_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      rep_id: opts.input.rep_id,
      signal_id: opts.input.signal_id,
      person_id: opts.input.person_id,
      company_id: opts.input.company_id ?? null,
      thread_id: opts.input.thread_id ??
        `message-personalization:${workspace_id}:${opts.input.signal_id}:${opts.input.person_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: MESSAGE_PERSONALIZATION_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        rep_id: opts.input.rep_id,
        signal_id: opts.input.signal_id,
        person_id: opts.input.person_id,
        company_id: opts.input.company_id ?? null,
        channel: opts.input.channel ?? "email",
        stage: opts.input.stage ?? "cold_open",
        play_id: opts.input.play_id ?? null,
        play_run_id: opts.input.play_run_id ?? null,
        conversation_id: opts.input.conversation_id ?? null,
        message_id: opts.input.message_id ?? null,
        use_llm: opts.input.use_llm,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromPersonalizedMessage(
  result: MessagePersonalizationToolResult,
): MessagePersonalizationDecision {
  return {
    workspace_id: result.workspace_id,
    conversation_id: result.conversation_id,
    message_id: result.message_id,
    channel: result.channel,
    rep_id: result.rep_id,
    signal_id: result.signal_id,
    person_id: result.person_id,
    company_id: result.company_id,
    skill_key: result.skill_key,
    skill_version: result.skill_version,
    pattern_key: result.pattern_key,
    exemplar_count: result.exemplar_ids.length,
    llm_used: result.llm_used,
    next_action: "run_eval_gate",
  };
}

function messagePersonalizationInputFromState(
  state: BombsellLangGraphState,
): MessagePersonalizationGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: requiredString(state.attributes?.user_id, "user_id"),
    rep_id: requiredString(state.attributes?.rep_id ?? state.rep_id, "rep_id"),
    signal_id: requiredString(state.attributes?.signal_id ?? state.signal_id, "signal_id"),
    person_id: requiredString(state.attributes?.person_id ?? state.person_id, "person_id"),
    company_id: optionalString(state.attributes?.company_id ?? state.company_id),
    channel: channelOrUndefined(state.attributes?.channel),
    stage: stageOrUndefined(state.attributes?.stage),
    play_id: optionalString(state.attributes?.play_id),
    play_run_id: optionalString(state.attributes?.play_run_id),
    conversation_id: optionalString(state.attributes?.conversation_id),
    message_id: optionalString(state.attributes?.message_id),
    use_llm: typeof state.attributes?.use_llm === "boolean"
      ? state.attributes.use_llm
      : undefined,
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
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

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`message personalization graph requires ${field}`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function channelOrUndefined(value: unknown): MessagePersonalizationChannel | undefined {
  return typeof value === "string" && [
    "email",
    "linkedin_connection",
    "linkedin_dm",
    "linkedin_inmail",
    "linkedin_comment",
    "x_dm",
  ].includes(value) ? value as MessagePersonalizationChannel : undefined;
}

function stageOrUndefined(value: unknown): MessagePersonalizationStage | undefined {
  return value === "cold_open" || value === "reply"
    ? value
    : undefined;
}
