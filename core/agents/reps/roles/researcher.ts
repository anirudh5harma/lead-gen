import type { RoleAgent } from "../types.ts";

/**
 * Researcher role agent — STUB.
 *
 * Responsibility: given a Signal or a target Person, gather context the
 * Writer will need: company background, recent activity, mutual ground.
 * Reads from the knowledge graph and external sources via Tools. Writes
 * findings into the Rep's semantic memory.
 *
 * Implementation lands when the storage layer + concrete graph queries land.
 * Keep this file in shape (export a RoleAgent) once implemented.
 */

export const researcherStub: RoleAgent<unknown, unknown> = {
  kind: "researcher",
  name: "researcher.stub",
  async invoke() {
    throw new Error(
      "researcher role agent is not yet implemented; see core/agents/reps/roles/researcher.ts",
    );
  },
};
