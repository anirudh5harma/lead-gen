import { randomUUID } from "node:crypto";
import type { EventBus, PublishedEvent } from "../../events/index.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  RetryPolicy,
  RunContext,
  StartOptions,
  StepOptions,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRuntime,
} from "../types.ts";

/**
 * In-process workflow runtime. Journals to memory; runs the workflow body in
 * the current Node process. Use for dev, tests, and single-process
 * deployments. Production swaps in `./restate.ts`.
 *
 * Replay semantics: ctx.step() consults the in-memory checkpoint for its
 * position. On a hot restart (same process), nothing replays — workflows
 * are in-flight Promises. On a cold start (new process), all in-flight
 * workflows are lost. That's the trade-off of this adapter; it is faithful
 * to the contract for unit tests of step idempotency, not for production
 * durability.
 */

export interface InProcessWorkflowRuntimeOptions {
  /** Optional event bus. Required if any workflow calls ctx.publish or ctx.awaitEvent. */
  bus?: EventBus;
  /** Default retry policy applied when a step has no `retry` of its own. */
  defaultRetry?: RetryPolicy;
}

interface PendingApproval {
  req: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
}

interface PendingEventWait {
  event_type: string;
  predicate?: (payload: unknown) => boolean;
  resolve: (payload: unknown) => void;
}

interface RunRecord<I = unknown, O = unknown> {
  run: WorkflowRun<I, O>;
  checkpoints: Map<number, unknown>;
  pendingApprovals: Map<string, PendingApproval>;
  pendingEventWaits: Set<PendingEventWait>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(policy: RetryPolicy, attempt: number): number {
  const base = policy.base_ms ?? 250;
  return policy.backoff === "exponential" ? base * 2 ** (attempt - 1) : base;
}

export function createInProcessWorkflowRuntime(
  opts: InProcessWorkflowRuntimeOptions = {},
): WorkflowRuntime {
  const workflows = new Map<string, WorkflowDefinition>();
  const runs = new Map<string, RunRecord>();

  // Wake parked workflows when matching events land.
  if (opts.bus) {
    void opts.bus.subscribe("*", async (event: PublishedEvent) => {
      for (const rec of runs.values()) {
        for (const wait of [...rec.pendingEventWaits]) {
          if (wait.event_type !== event.event_type) continue;
          if (wait.predicate && !wait.predicate(event.payload)) continue;
          rec.pendingEventWaits.delete(wait);
          if (rec.pendingEventWaits.size === 0 && rec.pendingApprovals.size === 0) {
            rec.run.status = "running";
          }
          wait.resolve(event.payload);
        }
      }
    });
  }

  function makeContext(rec: RunRecord): RunContext {
    let position = 0;
    const stepIds = new Map<number, string>();
    const stepIdFor = (pos: number) => {
      let id = stepIds.get(pos);
      if (!id) {
        id = randomUUID();
        stepIds.set(pos, id);
      }
      return id;
    };

    return {
      run_id: rec.run.id,
      execution_scope: rec.run.execution_scope,
      workspace_id: rec.run.workspace_id!,
      correlation_id: rec.run.correlation_id ?? rec.run.id,

      async step<O>(
        name: string,
        fn: () => Promise<O>,
        stepOpts?: StepOptions,
      ): Promise<O> {
        const pos = position++;
        if (rec.checkpoints.has(pos)) {
          return rec.checkpoints.get(pos) as O;
        }
        const retry =
          stepOpts?.retry ??
          opts.defaultRetry ?? {
            max_attempts: 3,
            backoff: "exponential",
            base_ms: 250,
          };
        const step_id = stepIdFor(pos);

        let lastError: unknown;
        for (let attempt = 1; attempt <= retry.max_attempts; attempt++) {
          try {
            if (opts.bus) {
              await opts.bus.publish({
                workspace_id: rec.run.workspace_id!,
                event_type: "workflow.step.started",
                source: "system",
                producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
                correlation_id: rec.run.correlation_id ?? rec.run.id,
                payload: { run_id: rec.run.id, step_id, step_name: name, attempt },
              });
            }
            const result = await fn();
            rec.checkpoints.set(pos, result);
            rec.run.last_checkpoint_at = new Date().toISOString();
            if (opts.bus) {
              await opts.bus.publish({
                workspace_id: rec.run.workspace_id!,
                event_type: "workflow.step.completed",
                source: "system",
                producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
                correlation_id: rec.run.correlation_id ?? rec.run.id,
                payload: { run_id: rec.run.id, step_id, step_name: name, attempt },
              });
            }
            return result;
          } catch (err) {
            lastError = err;
            if (opts.bus) {
              await opts.bus.publish({
                workspace_id: rec.run.workspace_id!,
                event_type: "workflow.step.failed",
                source: "system",
                producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
                correlation_id: rec.run.correlation_id ?? rec.run.id,
                payload: {
                  run_id: rec.run.id,
                  step_id,
                  step_name: name,
                  attempt,
                  error: err instanceof Error ? err.message : String(err),
                },
              });
            }
            if (attempt < retry.max_attempts) {
              await delay(backoffMs(retry, attempt));
              continue;
            }
            const policy = stepOpts?.on_failure ?? "fail";
            if (policy === "skip") {
              rec.checkpoints.set(pos, undefined);
              return undefined as O;
            }
            throw err;
          }
        }
        throw lastError;
      },

      sleep(ms: number) {
        return delay(ms);
      },

      awaitEvent<P>(
        event_type: string,
        predicate?: (p: P) => boolean,
      ): Promise<P> {
        if (!opts.bus) {
          throw new Error(
            "ctx.awaitEvent() requires an event bus; pass one to createInProcessWorkflowRuntime()",
          );
        }
        rec.run.status = "awaiting_event";
        return new Promise<P>((resolve) => {
          rec.pendingEventWaits.add({
            event_type,
            predicate: predicate as ((p: unknown) => boolean) | undefined,
            resolve: resolve as (p: unknown) => void,
          });
        });
      },

      async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
        const approval_id = randomUUID();
        rec.run.status = "awaiting_approval";
        const decision = new Promise<ApprovalDecision>((resolve) => {
          rec.pendingApprovals.set(approval_id, { req, resolve });
        });
        if (opts.bus) {
          await opts.bus.publish({
            workspace_id: rec.run.workspace_id!,
            event_type: "approval.requested",
            source: "system",
            producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
            correlation_id: rec.run.correlation_id ?? rec.run.id,
            payload: {
              approval_id,
              run_id: rec.run.id,
              step_id: null,
              kind: req.kind,
            },
          });
        }
        return decision;
      },

      async publish(event_type, payload) {
        if (!opts.bus) {
          throw new Error(
            "ctx.publish() requires an event bus; pass one to createInProcessWorkflowRuntime()",
          );
        }
        return opts.bus.publish({
          workspace_id: rec.run.workspace_id!,
          event_type: event_type as never,
          source: "system",
          producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
          correlation_id: rec.run.correlation_id ?? rec.run.id,
          payload: payload as never,
        });
      },
    };
  }

  return {
    register(workflow) {
      workflows.set(workflow.name, workflow as WorkflowDefinition);
    },

    async start<I, O = unknown>(
      startOpts: StartOptions<I>,
    ): Promise<WorkflowRun<I, O>> {
      if (startOpts.execution_scope === "platform") {
        throw new Error(
          "in-process workflow runtime does not support platform-scoped invocations",
        );
      }
      const def = workflows.get(startOpts.workflow_name);
      if (!def) {
        throw new Error(
          `Workflow not registered: ${startOpts.workflow_name}`,
        );
      }

      const run: WorkflowRun<I, O> = {
        id: randomUUID(),
        execution_scope: "workspace",
        workspace_id: startOpts.workspace_id,
        workflow_name: startOpts.workflow_name,
        workflow_version: def.version,
        status: "running",
        input: startOpts.input,
        play_id: startOpts.play_id ?? null,
        play_run_id: startOpts.play_run_id ?? null,
        correlation_id: startOpts.correlation_id ?? null,
        causation_id: startOpts.causation_id ?? null,
        idempotency_key: startOpts.idempotency_key ?? null,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      const rec: RunRecord<I, O> = {
        run,
        checkpoints: new Map(),
        pendingApprovals: new Map(),
        pendingEventWaits: new Set(),
      };
      runs.set(run.id, rec as RunRecord);

      const ctx = makeContext(rec as RunRecord);

      // Fire-and-track. Callers can poll via `get(run_id)`.
      void (async () => {
        try {
          const output = (await def.run(startOpts.input, ctx)) as O;
          rec.run.output = output;
          rec.run.status = "completed";
          rec.run.ended_at = new Date().toISOString();
        } catch (err) {
          rec.run.status = "failed";
          rec.run.error = {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          };
          rec.run.ended_at = new Date().toISOString();
        }
      })();

      return run;
    },

    async get<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      return (runs.get(run_id)?.run ?? null) as WorkflowRun<I, O> | null;
    },

    async resume<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      return (runs.get(run_id)?.run ?? null) as WorkflowRun<I, O> | null;
    },

    async resolveApproval(approval_id, decision) {
      for (const rec of runs.values()) {
        const pending = rec.pendingApprovals.get(approval_id);
        if (!pending) continue;
        rec.pendingApprovals.delete(approval_id);
        if (
          rec.pendingApprovals.size === 0 &&
          rec.pendingEventWaits.size === 0
        ) {
          rec.run.status = "running";
        }
        if (opts.bus) {
          await opts.bus.publish({
            workspace_id: rec.run.workspace_id!,
            event_type: "approval.decided",
            source: "user",
            producer_ref: decision.decided_by ?? null,
            correlation_id: rec.run.correlation_id ?? rec.run.id,
            payload: {
              approval_id,
              decision: decision.decision,
              decided_by: decision.decided_by ?? null,
            },
          });
        }
        pending.resolve(decision);
        return;
      }
    },
  };
}
