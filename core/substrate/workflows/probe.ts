import {
  defineWorkflow,
  type WorkflowDefinition,
} from "./index.ts";

export const RESTATE_RUNTIME_PROBE_WORKFLOW = "system.restate_runtime_probe.v1";

export interface RestateRuntimeProbeInput {
  marker: string;
}

export interface RestateRuntimeProbeOutput {
  marker: string;
  checkpoint: string;
}

export function createRestateRuntimeProbeWorkflow(): WorkflowDefinition<
  RestateRuntimeProbeInput,
  RestateRuntimeProbeOutput
> {
  return defineWorkflow<RestateRuntimeProbeInput, RestateRuntimeProbeOutput>({
    name: RESTATE_RUNTIME_PROBE_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      if (ctx.execution_scope !== "platform") {
        throw new Error("Restate runtime probe must run with platform scope");
      }
      const checkpoint = await ctx.step("checkpoint", async () => "ok");
      return {
        marker: input.marker,
        checkpoint,
      };
    },
  });
}
