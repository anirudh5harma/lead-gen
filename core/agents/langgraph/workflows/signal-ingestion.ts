import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runSignalIngestionGraphInWorkflowStep,
  type SignalIngestionGraphInput,
} from "../graphs/signal-ingestion.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_SIGNAL_INGESTION_WORKFLOW = "workspace.signal.ingestion";

export function createWorkspaceSignalIngestionWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<SignalIngestionGraphInput, BombsellLangGraphState> {
  return defineWorkflow<SignalIngestionGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runSignalIngestionGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
