import { runFirstVerticalSlice } from "../core/plays/index.ts";

const result = await runFirstVerticalSlice();

console.log(
  JSON.stringify(
    {
      decision: result.output.decision,
      conversation_id: result.output.conversation_id,
      message_id: result.output.message_id,
      outcome_id: result.output.outcome_id,
      eval_score: result.output.eval_score,
      sent_email_count: result.sentEmailCount,
      procedural_score_after_outcome: result.proceduralScoreAfterOutcome,
      events: result.eventTypes,
    },
    null,
    2,
  ),
);
