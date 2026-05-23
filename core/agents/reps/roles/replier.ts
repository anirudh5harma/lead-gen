import type { RoleAgent } from "../types.ts";

/**
 * Replier role agent — STUB.
 *
 * Responsibility: classify inbound messages on a Conversation (positive /
 * negative / neutral / OOO / unsubscribe), append to the Rep's episodic
 * memory, and either auto-respond (if autonomy permits) or hand off to a
 * human via an approval gate.
 *
 * Triggers an `outcome.recorded` for positive intents that booking
 * agents can use to attribute meetings.
 */

export const replierStub: RoleAgent<unknown, unknown> = {
  kind: "replier",
  name: "replier.stub",
  async invoke() {
    throw new Error(
      "replier role agent is not yet implemented; see core/agents/reps/roles/replier.ts",
    );
  },
};
