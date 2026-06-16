import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runMeetingPrepGraphInWorkflowStep,
  type MeetingPrepGraphInput,
} from "../graphs/calendar-prep.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_MEETING_PREP_WORKFLOW = "workspace.meeting.prep";

export function createWorkspaceMeetingPrepWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<MeetingPrepGraphInput, BombsellLangGraphState> {
  return defineWorkflow<MeetingPrepGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_MEETING_PREP_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runMeetingPrepGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
