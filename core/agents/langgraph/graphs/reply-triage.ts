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

export const REPLY_TRIAGE_GRAPH_NAME = "reply.triage_graph.v1";

export type ReplyTriageIntent =
  | "positive"
  | "meeting_intent"
  | "negative"
  | "neutral"
  | "ooo"
  | "unsubscribe"
  | "do_not_contact"
  | "spam";

export interface ReplyTriageGraphInput {
  workspace_id?: string;
  user_id: string;
  channel?: "email";
  external_id: string;
  external_thread_id?: string | null;
  in_reply_to?: string | null;
  references?: string[];
  from_email: string;
  from_name?: string | null;
  subject: string;
  body_text: string;
  body_html?: string | null;
  received_at: string;
  channel_account_id?: string | null;
  ingress_event_id?: string | null;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface ReplyTriageToolResult {
  workspace_id: string;
  channel: "email";
  matched_conversation_id: string | null;
  inbound_message_id: string | null;
  intent: ReplyTriageIntent | null;
  intent_confidence: number | null;
  outcome_id: string | null;
  next_action:
    | "generate_meeting_prep"
    | "draft_reply"
    | "block_contact"
    | "stop"
    | "review_unmatched";
}

export interface ReplyTriageDecision extends ReplyTriageToolResult {
  should_record_meeting_prep: boolean;
  should_draft_reply: boolean;
}

export interface ReplyTriageGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    triageReply: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  triageReply: "product.reply.triage",
} as const;

export function createReplyTriageGraph(opts: ReplyTriageGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: REPLY_TRIAGE_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = replyTriageInputFromState(state);
          return {
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              channel: "email",
              external_id: input.external_id,
              external_thread_id: input.external_thread_id ?? null,
              in_reply_to: input.in_reply_to ?? null,
              references: input.references ?? [],
              from_email: input.from_email,
              from_name: input.from_name ?? null,
              subject: input.subject,
              body_text: input.body_text,
              body_html: input.body_html ?? null,
              received_at: input.received_at,
              channel_account_id: input.channel_account_id ?? null,
              ingress_event_id: input.ingress_event_id ?? null,
            }),
          };
        },
      }),
    )
    .addNode(
      "triage",
      traceLangGraphNode({
        graph_name: REPLY_TRIAGE_GRAPH_NAME,
        node_name: "triage",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = replyTriageInputFromState(state);
          const result = await invokeLangGraphTool<ReplyTriageToolResult>(
            tools.triageReply,
            {
              channel: "email",
              external_id: input.external_id,
              external_thread_id: input.external_thread_id ?? undefined,
              in_reply_to: input.in_reply_to ?? undefined,
              references: input.references ?? [],
              from_email: input.from_email,
              from_name: input.from_name ?? undefined,
              subject: input.subject,
              body_text: input.body_text,
              body_html: input.body_html ?? undefined,
              received_at: input.received_at,
              channel_account_id: input.channel_account_id ?? undefined,
              ingress_event_id: input.ingress_event_id ?? undefined,
            },
            state,
            toolOptions,
          );
          return {
            conversation_id: result.matched_conversation_id,
            message_id: result.inbound_message_id,
            outcome_id: result.outcome_id,
            attributes: mergeAttributes(state, {
              reply_triage_result: result,
              conversation_id: result.matched_conversation_id,
              message_id: result.inbound_message_id,
              outcome_id: result.outcome_id,
              reply_intent: result.intent,
              next_action: result.next_action,
            }),
            tool_results: {
              reply_triage: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: REPLY_TRIAGE_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<ReplyTriageToolResult>(
            state,
            "reply_triage_result",
          );
          const decision = decisionFromReplyTriage(result);
          return {
            attributes: mergeAttributes(state, {
              reply_triage: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              reply_triage_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "triage")
    .addEdge("triage", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runReplyTriageGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: ReplyTriageGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<ReplyTriageGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("reply triage graph requires a workspace_id");
  }
  const graph = createReplyTriageGraph({
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
    graph_name: REPLY_TRIAGE_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ??
        `reply-triage:${workspace_id}:${opts.input.external_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: REPLY_TRIAGE_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        channel: "email",
        external_id: opts.input.external_id,
        external_thread_id: opts.input.external_thread_id ?? null,
        in_reply_to: opts.input.in_reply_to ?? null,
        references: opts.input.references ?? [],
        from_email: opts.input.from_email,
        from_name: opts.input.from_name ?? null,
        subject: opts.input.subject,
        body_text: opts.input.body_text,
        body_html: opts.input.body_html ?? null,
        received_at: opts.input.received_at,
        channel_account_id: opts.input.channel_account_id ?? null,
        ingress_event_id: opts.input.ingress_event_id ?? null,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromReplyTriage(result: ReplyTriageToolResult): ReplyTriageDecision {
  return {
    ...result,
    should_record_meeting_prep: result.next_action === "generate_meeting_prep",
    should_draft_reply: result.next_action === "draft_reply" ||
      result.next_action === "generate_meeting_prep",
  };
}

function replyTriageInputFromState(state: BombsellLangGraphState): ReplyTriageGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: requiredString(state.attributes?.user_id, "user_id"),
    channel: "email",
    external_id: requiredString(state.attributes?.external_id, "external_id"),
    external_thread_id: optionalString(state.attributes?.external_thread_id),
    in_reply_to: optionalString(state.attributes?.in_reply_to),
    references: arrayStringAttribute(state.attributes?.references),
    from_email: requiredString(state.attributes?.from_email, "from_email"),
    from_name: optionalString(state.attributes?.from_name),
    subject: requiredString(state.attributes?.subject, "subject"),
    body_text: requiredString(state.attributes?.body_text, "body_text"),
    body_html: optionalString(state.attributes?.body_html),
    received_at: requiredString(state.attributes?.received_at, "received_at"),
    channel_account_id: optionalString(state.attributes?.channel_account_id),
    ingress_event_id: optionalString(state.attributes?.ingress_event_id),
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
  throw new Error(`reply triage graph requires ${field}`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayStringAttribute(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
