import type { Pool } from "pg";

/**
 * Hot-path enforcement. Before any provider call, the email channel
 * verifies that an `evalGate` pass was recorded for this message_id.
 *
 * Implementation reads the events table directly (append-only, so no
 * race). A draft is allowed to send iff a `draft.judged` event exists for
 * this message_id with `passed: true` AND no later `draft.rejected` event
 * for the same id.
 *
 * This is the only enforcement of ARCHITECTURE.md "Agent Fabric" hard-rule
 * #4 — the channel layer cannot be bypassed by a workflow step that skips
 * the gate.
 */

export type EvalState = "passed" | "rejected" | "not_judged";

export async function readEvalState(
  pool: Pool,
  workspace_id: string,
  message_id: string,
): Promise<EvalState> {
  // We need the latest judgement (judged or rejected). draft.rejected always
  // wins over a prior pass; draft.judged with passed=false also rejects.
  const { rows } = await pool.query<{
    event_type: string;
    payload: { passed?: boolean };
    occurred_at: Date;
  }>(
    `select event_type, payload, occurred_at
       from events
      where workspace_id = $1
        and event_type in ('draft.judged', 'draft.rejected')
        and payload->>'message_id' = $2
      order by occurred_at desc
      limit 1`,
    [workspace_id, message_id],
  );
  const last = rows[0];
  if (!last) return "not_judged";
  if (last.event_type === "draft.rejected") return "rejected";
  return last.payload.passed === true ? "passed" : "rejected";
}
