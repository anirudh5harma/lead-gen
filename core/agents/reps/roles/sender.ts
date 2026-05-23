import type { RoleAgent } from "../types.ts";

/**
 * Sender role agent — STUB.
 *
 * Responsibility: take a judged-and-passed draft, resolve the right channel
 * account (per autonomy + deliverability policy), and invoke
 * `channel.<x>.send` via the Tool registry. Records the send onto the
 * Conversation; emits `message.queued` / `message.sent` / `message.deferred`.
 *
 * NEVER calls a channel.send Tool without first confirming the draft passed
 * `evalGate`. Enforced at runtime by the workflow step that wraps it.
 */

export const senderStub: RoleAgent<unknown, unknown> = {
  kind: "sender",
  name: "sender.stub",
  async invoke() {
    throw new Error(
      "sender role agent is not yet implemented; see core/agents/reps/roles/sender.ts",
    );
  },
};
