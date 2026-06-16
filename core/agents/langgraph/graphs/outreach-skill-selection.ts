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

export const OUTREACH_SKILL_SELECTION_GRAPH_NAME = "outreach.skill_selection_graph.v1";

export interface OutreachSkillSelectionGraphInput {
  workspace_id?: string;
  user_id: string;
  channel: string;
  stage: "cold_open" | "reply";
  signal_kind?: string | null;
  intent?: string | null;
  action?: string | null;
  person_title?: string | null;
  base_pattern_key?: string | null;
  slot_values?: Record<string, unknown> | null;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface OutreachSkillSelectionToolResult {
  workspace_id: string;
  skill: {
    skill_key: string;
    version: string;
    channel: string;
    stage: string;
    name: string;
    description: string;
    pattern_key: string;
    framework: string[];
    slot_values: Record<string, string>;
    constraints: string[];
    judge_focus: string[];
  };
}

export interface OutreachSkillSelectionDecision {
  skill_key: string;
  version: string;
  channel: string;
  stage: string;
  pattern_key: string;
  next_action: "compose_email" | "compose_linkedin" | "compose_reply";
}

export interface OutreachSkillSelectionGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    selectOutreachSkill: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  selectOutreachSkill: "product.play.skills.select",
} as const;

export function createOutreachSkillSelectionGraph(
  opts: OutreachSkillSelectionGraphOptions = {},
) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: OUTREACH_SKILL_SELECTION_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => ({
          attributes: mergeAttributes(state, {
            user_id: String(state.attributes?.user_id ?? ""),
            channel: stringAttribute(state, "channel"),
            stage: stringAttribute(state, "stage"),
            signal_kind: nullableStringAttribute(state, "signal_kind"),
            intent: nullableStringAttribute(state, "intent"),
            action: nullableStringAttribute(state, "action"),
            person_title: nullableStringAttribute(state, "person_title"),
            base_pattern_key: nullableStringAttribute(state, "base_pattern_key"),
            slot_values: recordAttribute(state, "slot_values"),
          }),
        }),
      }),
    )
    .addNode(
      "select_skill",
      traceLangGraphNode({
        graph_name: OUTREACH_SKILL_SELECTION_GRAPH_NAME,
        node_name: "select_skill",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const result = await invokeLangGraphTool<OutreachSkillSelectionToolResult>(
            tools.selectOutreachSkill,
            {
              channel: stringAttribute(state, "channel"),
              stage: stringAttribute(state, "stage"),
              signal_kind: nullableStringAttribute(state, "signal_kind") ?? undefined,
              intent: nullableStringAttribute(state, "intent") ?? undefined,
              action: nullableStringAttribute(state, "action") ?? undefined,
              person_title: nullableStringAttribute(state, "person_title"),
              base_pattern_key: nullableStringAttribute(state, "base_pattern_key") ?? undefined,
              slot_values: recordAttribute(state, "slot_values") ?? undefined,
            },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              outreach_skill_result: result,
            }),
            tool_results: {
              outreach_skill_selection: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: OUTREACH_SKILL_SELECTION_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<OutreachSkillSelectionToolResult>(
            state,
            "outreach_skill_result",
          );
          const decision = decisionFromSkill(result);
          return {
            attributes: mergeAttributes(state, {
              outreach_skill: result.skill,
              outreach_skill_decision: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              outreach_skill_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "select_skill")
    .addEdge("select_skill", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runOutreachSkillSelectionGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: OutreachSkillSelectionGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<OutreachSkillSelectionGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("outreach skill selection graph requires a workspace_id");
  }
  const graph = createOutreachSkillSelectionGraph({
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
    graph_name: OUTREACH_SKILL_SELECTION_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `outreach-skill:${workspace_id}:${opts.input.channel}:${opts.input.stage}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: OUTREACH_SKILL_SELECTION_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        channel: opts.input.channel,
        stage: opts.input.stage,
        signal_kind: opts.input.signal_kind,
        intent: opts.input.intent,
        action: opts.input.action,
        person_title: opts.input.person_title,
        base_pattern_key: opts.input.base_pattern_key,
        slot_values: opts.input.slot_values,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromSkill(
  result: OutreachSkillSelectionToolResult,
): OutreachSkillSelectionDecision {
  return {
    skill_key: result.skill.skill_key,
    version: result.skill.version,
    channel: result.skill.channel,
    stage: result.skill.stage,
    pattern_key: result.skill.pattern_key,
    next_action: nextAction(result.skill.channel, result.skill.stage),
  };
}

function nextAction(
  channel: string,
  stage: string,
): OutreachSkillSelectionDecision["next_action"] {
  if (stage === "reply") return "compose_reply";
  if (channel.startsWith("linkedin_")) return "compose_linkedin";
  return "compose_email";
}

function stringAttribute(state: BombsellLangGraphState, key: string): string {
  const value = state.attributes?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`outreach skill selection graph requires ${key}`);
  }
  return value.trim();
}

function nullableStringAttribute(
  state: BombsellLangGraphState,
  key: string,
): string | null {
  const value = state.attributes?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordAttribute(
  state: BombsellLangGraphState,
  key: string,
): Record<string, unknown> | null {
  const value = state.attributes?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
