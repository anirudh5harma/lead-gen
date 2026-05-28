import { createServer } from "node:http";
import * as restate from "@restatedev/restate-sdk";
import type { EventBus } from "../../events/index.ts";
import type { EventInput, PublishedEvent } from "../../events/types.ts";
import type {
  RestateEventSignal,
  RestateEventSignalStore,
} from "./restate-signal-bridge.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  RunContext,
  StepOptions,
  WorkflowDefinition,
} from "../types.ts";

export interface RestateWorkflowRequest<I = unknown> {
  request: I;
  metadata?: {
    execution_scope?: "workspace" | "platform";
    workspace_id?: string | null;
    play_id?: string | null;
    play_run_id?: string | null;
    correlation_id?: string | null;
    causation_id?: string | null;
  };
}

export interface RestateWorkflowHostOptions {
  bus?: EventBus;
  eventSignals?: RestateEventSignalStore;
}

export type RestateWorkflowComponent = ReturnType<typeof restate.workflow>;

/**
 * Convert our WorkflowDefinition contract into a native Restate workflow.
 *
 * This bridge keeps workflow code on our WorkflowDefinition contract while
 * letting Restate own durable execution. ctx.awaitEvent registers an auditable
 * typed-event wait and parks on a workflow-bound durable promise; the external
 * signal bridge resolves that promise through resolveEventWait.
 */
export function createRestateWorkflowComponent<I, O>(
  definition: WorkflowDefinition<I, O>,
  opts: RestateWorkflowHostOptions = {},
): RestateWorkflowComponent {
  return restate.workflow({
    name: definition.name,
    handlers: {
      run: async (
        ctx: restate.WorkflowContext,
        input: RestateWorkflowRequest<I>,
      ): Promise<O> => {
        const runContext = createRunContext(ctx, definition, input, opts);
        return definition.run(input.request, runContext);
      },
      resolveEventWait: async (
        ctx: restate.WorkflowSharedContext,
        signal: RestateEventSignal,
      ): Promise<void> => {
        await ctx.promise<RestateEventSignal>(signal.promise_name).resolve(signal);
      },
    },
  });
}

export async function serveRestateWorkflows(
  opts: RestateWorkflowHostOptions & {
    workflows: WorkflowDefinition[];
    port?: number;
    http1?: boolean;
  },
): Promise<number> {
  const services = opts.workflows.map((workflow) =>
    createRestateWorkflowComponent(workflow, opts),
  );
  if (opts.http1) {
    const server = createServer(
      restate.createEndpointHandler({ services, bidirectional: false }),
    );
    const port = opts.port ?? 9080;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return port;
  }
  return restate.serve({ services, port: opts.port });
}

export function createRunContext<I, O>(
  ctx: restate.WorkflowContext,
  definition: WorkflowDefinition<I, O>,
  input: RestateWorkflowRequest<I>,
  opts: RestateWorkflowHostOptions = {},
): RunContext {
  const run_id = String(ctx.request().id);
  const workflow_key = ctx.request().target.key;
  const execution_scope = input.metadata?.execution_scope ?? "workspace";
  const workspace_id =
    execution_scope === "platform"
      ? null
      : requireMetadata(input, "workspace_id");
  const correlation_id = input.metadata?.correlation_id ?? run_id;
  const publish = opts.bus?.publish as
    | ((input: EventInput) => Promise<PublishedEvent>)
    | undefined;
  let eventWaitPosition = -1;
  let publishedEventPosition = -1;

  return {
    run_id,
    execution_scope,
    workspace_id,
    correlation_id,

    async step<T>(
      name: string,
      fn: () => Promise<T>,
      stepOpts?: StepOptions,
    ): Promise<T> {
      try {
        return await ctx.run(name, fn, toRunOptions(stepOpts));
      } catch (err) {
        if (stepOpts?.on_failure === "skip") {
          return undefined as T;
        }
        throw err;
      }
    },

    sleep(ms: number): Promise<void> {
      return ctx.sleep(ms, "sleep");
    },

    async awaitEvent<P>(
      event_type: string,
      predicate?: (payload: P) => boolean,
    ): Promise<P> {
      const eventWorkspaceId = requireWorkspaceScope(
        execution_scope,
        workspace_id,
        "ctx.awaitEvent",
      );
      if (!opts.eventSignals) {
        throw new restate.TerminalError(
          "ctx.awaitEvent requires a Restate event signal store",
        );
      }
      if (!workflow_key) {
        throw new restate.TerminalError(
          "ctx.awaitEvent requires a keyed Restate workflow request",
        );
      }

      for (;;) {
        eventWaitPosition += 1;
        const promiseName = `event:${event_type}:${eventWaitPosition}`;
        const waitId = `${definition.name}:${workflow_key}:${promiseName}`;
        await ctx.run(`register ${promiseName}`, async () => {
          await opts.eventSignals?.registerWait({
            id: waitId,
            workspace_id: eventWorkspaceId,
            workflow_name: definition.name,
            workflow_key,
            run_id,
            event_type,
            promise_name: promiseName,
          });
        });
        const signal = await ctx.promise<RestateEventSignal>(promiseName).get();
        await ctx.run(`consume ${promiseName}`, async () => {
          await opts.eventSignals?.consumeWait(signal.wait_id);
        });
        const payload = signal.event.payload as P;
        if (!predicate || predicate(payload)) return payload;
      }
    },

    async requestApproval<P>(
      req: ApprovalRequest<P>,
    ): Promise<ApprovalDecision> {
      const eventWorkspaceId = requireWorkspaceScope(
        execution_scope,
        workspace_id,
        "ctx.requestApproval",
      );
      if (!publish) {
        throw new restate.TerminalError(
          "ctx.requestApproval requires an EventBus for approval.requested",
        );
      }
      const awakeable = ctx.awakeable<ApprovalDecision>();
      await publish({
        workspace_id: eventWorkspaceId,
        event_type: "approval.requested",
        source: "system",
        producer_ref: `workflow:${definition.name}:${run_id}`,
        correlation_id,
        causation_id: input.metadata?.causation_id ?? null,
        idempotency_key: `approval:${awakeable.id}`,
        payload: {
          approval_id: awakeable.id,
          run_id,
          step_id: null,
          kind: req.kind,
        },
      });
      return awakeable.promise;
    },

    async publish(event_type: string, payload: unknown): Promise<void> {
      const eventWorkspaceId = requireWorkspaceScope(
        execution_scope,
        workspace_id,
        "ctx.publish",
      );
      if (!publish) {
        throw new restate.TerminalError("ctx.publish requires an EventBus");
      }
      publishedEventPosition += 1;
      const position = publishedEventPosition;
      await ctx.run(`publish:${position}:${event_type}`, async () => {
        await publish({
          workspace_id: eventWorkspaceId,
          event_type,
          source: "system",
          producer_ref: `workflow:${definition.name}:${run_id}`,
          correlation_id,
          causation_id: input.metadata?.causation_id ?? null,
          idempotency_key: `workflow:${run_id}:event:${position}`,
          payload,
        });
      });
    },
  };
}

function requireMetadata<I>(
  input: RestateWorkflowRequest<I>,
  key: "workspace_id",
): string {
  const value = input.metadata?.[key]?.trim();
  if (!value) {
    throw new restate.TerminalError(`Restate workflow request missing metadata.${key}`);
  }
  return value;
}

function requireWorkspaceScope(
  executionScope: "workspace" | "platform",
  workspaceId: string | null,
  operation: string,
): string {
  if (executionScope !== "workspace" || !workspaceId) {
    throw new restate.TerminalError(
      `${operation} requires a workspace-scoped Restate workflow invocation`,
    );
  }
  return workspaceId;
}

function toRunOptions<T>(stepOpts?: StepOptions): restate.RunOptions<T> {
  const retry = stepOpts?.retry;
  if (!retry) return {};
  return {
    maxRetryAttempts: retry.max_attempts,
    initialRetryInterval: retry.base_ms,
    retryIntervalFactor: retry.backoff === "fixed" ? 1 : 2,
  };
}
