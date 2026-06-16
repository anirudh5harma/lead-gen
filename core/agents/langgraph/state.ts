import { Annotation } from "@langchain/langgraph";

export interface LangGraphPrimitiveRefs {
  rep_id?: string | null;
  signal_id?: string | null;
  play_id?: string | null;
  play_run_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
}

export interface BombsellLangGraphState extends LangGraphPrimitiveRefs {
  workspace_id: string;
  thread_id: string;
  run_id: string;
  correlation_id: string;
  causation_event_id?: string | null;
  graph_name?: string | null;
  node_name?: string | null;
  attributes?: Record<string, unknown>;
  tool_results?: Record<string, unknown>;
  approvals?: Record<string, unknown>;
}

export const BombsellGraphStateAnnotation = Annotation.Root({
  workspace_id: Annotation<string>(),
  rep_id: Annotation<string | null>(),
  signal_id: Annotation<string | null>(),
  play_id: Annotation<string | null>(),
  play_run_id: Annotation<string | null>(),
  conversation_id: Annotation<string | null>(),
  message_id: Annotation<string | null>(),
  outcome_id: Annotation<string | null>(),
  company_id: Annotation<string | null>(),
  person_id: Annotation<string | null>(),
  thread_id: Annotation<string>(),
  run_id: Annotation<string>(),
  correlation_id: Annotation<string>(),
  causation_event_id: Annotation<string | null>(),
  graph_name: Annotation<string | null>(),
  node_name: Annotation<string | null>(),
  attributes: Annotation<Record<string, unknown>>({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  tool_results: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  approvals: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

export function primitiveRefsFromState(
  state: Partial<BombsellLangGraphState>,
): LangGraphPrimitiveRefs {
  return {
    rep_id: state.rep_id ?? null,
    signal_id: state.signal_id ?? null,
    play_id: state.play_id ?? null,
    play_run_id: state.play_run_id ?? null,
    conversation_id: state.conversation_id ?? null,
    message_id: state.message_id ?? null,
    outcome_id: state.outcome_id ?? null,
    company_id: state.company_id ?? null,
    person_id: state.person_id ?? null,
  };
}
