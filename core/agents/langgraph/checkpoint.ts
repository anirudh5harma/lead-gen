import { MemorySaver } from "@langchain/langgraph";
import type { BombsellLangGraphState } from "./state.ts";

export interface LangGraphRunnableConfig {
  configurable: {
    thread_id: string;
    checkpoint_ns?: string;
  };
  metadata: {
    workspace_id: string;
    run_id: string;
    graph_name?: string | null;
    correlation_id: string;
    causation_event_id?: string | null;
  };
}

export function createLangGraphMemoryCheckpoint(): MemorySaver {
  return new MemorySaver();
}

export function createLangGraphRunnableConfig(
  state: Pick<
    BombsellLangGraphState,
    "workspace_id" | "thread_id" | "run_id" | "correlation_id"
  > & Partial<Pick<BombsellLangGraphState, "graph_name" | "causation_event_id">>,
): LangGraphRunnableConfig {
  return {
    configurable: {
      thread_id: state.thread_id,
      checkpoint_ns: state.graph_name ?? undefined,
    },
    metadata: {
      workspace_id: state.workspace_id,
      run_id: state.run_id,
      graph_name: state.graph_name ?? null,
      correlation_id: state.correlation_id,
      causation_event_id: state.causation_event_id ?? null,
    },
  };
}
