import type { RoleAgent } from "../types.ts";

/**
 * Writer role agent — STUB.
 *
 * Responsibility: given a brief (channel, counterparty, signal, retrieved
 * procedural exemplars), produce a draft message in the Rep's voice.
 * Output is consumed by `evalGate` before any channel.send.
 *
 * Implementation lands when the LLM client + procedural memory queries land.
 */

export const writerStub: RoleAgent<unknown, unknown> = {
  kind: "writer",
  name: "writer.stub",
  async invoke() {
    throw new Error(
      "writer role agent is not yet implemented; see core/agents/reps/roles/writer.ts",
    );
  },
};
