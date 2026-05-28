import type { EventBus } from "../../substrate/events/index.ts";
import { randomUUID } from "node:crypto";
import type { EvalGateResult, Judge, JudgeInput } from "./types.ts";
import {
  applyBrandVoiceGuardrail,
  type BrandVoiceGuardrailOptions,
} from "./voice.ts";

/**
 * The hot-path eval gate. Wraps a Judge with the bus contract:
 *
 *   1. Caller proposed a draft (already emitted `draft.proposed`).
 *   2. Pass the draft through `evalGate`.
 *   3. The judge runs; the verdict emits `draft.judged`.
 *   4. If the verdict fails, `draft.rejected` is emitted and the gate returns
 *      `{ decision: 'reject' }`. The caller must not send.
 *   5. If it passes, the caller proceeds to channel.send().
 *
 * Hard rule: every generation that targets a channel runs through here.
 * See ARCHITECTURE.md "Agent Fabric" #4 and AGENTS.md.
 */

export interface EvalGateOptions {
  judge: Judge;
  bus: EventBus;
  brandVoice?: BrandVoiceGuardrailOptions;
}

export async function evalGate(
  opts: EvalGateOptions,
  input: JudgeInput & { message_id: string },
): Promise<EvalGateResult> {
  const { judge, bus } = opts;
  const verdict = applyBrandVoiceGuardrail(
    input,
    await judge.evaluate(input),
    opts.brandVoice,
  );

  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "draft.judged",
    source: "agent",
    producer_ref: `judge:${input.rep.id}`,
    correlation_id: randomUUID(),
    payload: {
      message_id: input.message_id,
      eval_score: verdict.score,
      passed: verdict.passed,
      notes: verdict.notes as unknown as Record<string, unknown>,
    },
  });

  if (verdict.passed) return { verdict, decision: "pass" };

  const reason = verdict.notes.critique ?? "sub-threshold";
  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "draft.rejected",
    source: "agent",
    producer_ref: `judge:${input.rep.id}`,
    payload: { message_id: input.message_id, reason },
  });

  return { verdict, decision: "reject", rejection_reason: reason };
}
