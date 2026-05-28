import type { WorkflowDefinition } from "./types.ts";

/**
 * Authoring helper. Wraps a workflow definition so call sites get TS
 * inference on input / output without restating the generics.
 *
 *   export const onboard = defineWorkflow({
 *     name: "onboard_workspace",
 *     version: "1",
 *     async run(input: { workspace_id: string }, ctx) {
 *       await ctx.step("seed", () => seed(input.workspace_id));
 *       ctx.publish("workspace.created", { workspace_id: input.workspace_id, created_by: ... });
 *     },
 *   });
 */
export function defineWorkflow<I, O>(
  def: WorkflowDefinition<I, O>,
): WorkflowDefinition<I, O> {
  if (!def.name) throw new Error("Workflow must have a name");
  if (!def.version) throw new Error("Workflow must have a version");
  return def;
}
