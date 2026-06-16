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

export const MEETING_PREP_GRAPH_NAME = "meeting.prep_graph.v1";

export interface MeetingPrepGraphInput {
  workspace_id?: string;
  user_id: string;
  conversation_id: string;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface MeetingPrepToolResult {
  workspace_id: string;
  meeting_prep_id: string;
  conversation_id: string;
  generated_at: string;
  status: "ready" | "blocked";
  next_action: "prepare_meeting" | "ask_for_times" | "wait_for_reply" | "do_not_follow_up";
  summary: string;
  thread_summary: string;
  thread_turns: Array<{
    message_id: string;
    direction: string;
    at: string | null;
    intent_class: string | null;
    excerpt: string;
  }>;
  agenda: string[];
  suggested_questions: string[];
  suggested_times: string[];
  availability_status: "included" | "omitted_no_consent";
  availability_reason: string;
  calendar_provider: string | null;
  calendar_account_id: string | null;
  calendar_account_display_name: string | null;
  profile_context: {
    user: {
      user_id: string | null;
      name: string | null;
      email: string | null;
      role: string | null;
    };
    prospect: {
      person_id: string | null;
      name: string | null;
      title: string | null;
      linkedin_url: string | null;
    };
    company: {
      company_id: string | null;
      name: string | null;
      domain: string | null;
      industry: string | null;
      description: string | null;
    };
    rep: {
      rep_id: string | null;
      name: string | null;
      role: string | null;
    };
  };
  source_refs: Array<{
    type: "conversation" | "message" | "signal" | "outcome" | "person" | "company" | "rep" | "user";
    id: string;
    label: string;
    url?: string | null;
  }>;
}

export interface MeetingPrepDecision {
  meeting_prep_id: string;
  conversation_id: string;
  status: MeetingPrepToolResult["status"];
  next_action: MeetingPrepToolResult["next_action"];
  availability_status: MeetingPrepToolResult["availability_status"];
  availability_reason: string;
  calendar_account_id: string | null;
  source_ref_count: number;
  thread_turn_count: number;
  summary: string;
}

export interface MeetingPrepGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    generateMeetingPrep: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  generateMeetingPrep: "product.meeting.prep.generate",
} as const;

export function createMeetingPrepGraph(opts: MeetingPrepGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: MEETING_PREP_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const conversation_id = conversationIdFromState(state);
          return {
            conversation_id,
            attributes: mergeAttributes(state, {
              conversation_id,
              user_id: String(state.attributes?.user_id ?? ""),
            }),
          };
        },
      }),
    )
    .addNode(
      "generate",
      traceLangGraphNode({
        graph_name: MEETING_PREP_GRAPH_NAME,
        node_name: "generate",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const conversation_id = conversationIdFromState(state);
          const result = await invokeLangGraphTool<MeetingPrepToolResult>(
            tools.generateMeetingPrep,
            { conversation_id },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              meeting_prep_result: result,
            }),
            tool_results: {
              meeting_prep: result,
            },
          };
        },
      }),
    )
    .addNode(
      "summarize",
      traceLangGraphNode({
        graph_name: MEETING_PREP_GRAPH_NAME,
        node_name: "summarize",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<MeetingPrepToolResult>(state, "meeting_prep_result");
          const decision = decisionFromPrep(result);
          return {
            attributes: mergeAttributes(state, {
              meeting_prep: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              meeting_prep_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "generate")
    .addEdge("generate", "summarize")
    .addEdge("summarize", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runMeetingPrepGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: MeetingPrepGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<MeetingPrepGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("meeting prep graph requires a workspace_id");
  }
  const conversation_id = normalizeConversationId(opts.input.conversation_id);
  const graph = createMeetingPrepGraph({
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
    graph_name: MEETING_PREP_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      conversation_id,
      thread_id: opts.input.thread_id ?? `meeting-prep:${workspace_id}:${conversation_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: MEETING_PREP_GRAPH_NAME,
      attributes: {
        conversation_id,
        user_id: opts.input.user_id,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromPrep(result: MeetingPrepToolResult): MeetingPrepDecision {
  return {
    meeting_prep_id: result.meeting_prep_id,
    conversation_id: result.conversation_id,
    status: result.status,
    next_action: result.next_action,
    availability_status: result.availability_status,
    availability_reason: result.availability_reason,
    calendar_account_id: result.calendar_account_id,
    source_ref_count: result.source_refs.length,
    thread_turn_count: result.thread_turns.length,
    summary: result.summary,
  };
}

function conversationIdFromState(state: BombsellLangGraphState): string {
  return normalizeConversationId(state.conversation_id ?? state.attributes?.conversation_id);
}

function normalizeConversationId(value: unknown): string {
  const conversation_id = typeof value === "string" ? value.trim() : "";
  if (!conversation_id) throw new Error("meeting prep graph requires conversation_id");
  return conversation_id;
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
