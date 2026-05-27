import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
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
 * Postgres-journaled workflow runtime. State persists to
 *   workflow_runs / workflow_steps / workflow_checkpoints / workflow_approvals
 * so the UI, ops dashboards, and forensic replay all see real data.
 *
 * Execution model: in-process. The Promise that drives a workflow lives in
 * the Node process that called start(). On process crash, parked workflows
 * are LOST — their journaled state remains visible but no one resumes
 * them. The Restate adapter is the production answer to cross-process
 * resume; this adapter is the bridge: journaled enough to observe in real
 * time, simple enough to run on a single box.
 *
 * Approval gates: requestApproval persists to workflow_approvals and parks
 * the workflow on `approval.decided`. resolveApproval updates the row and
 * publishes `approval.decided` — the bus wakes the parked Promise.
 */

export interface PostgresWorkflowRuntimeOptions {
  pool: Pool;
  bus: EventBus;
  defaultRetry?: RetryPolicy;
}

interface ParkedApproval {
  resolve: (d: ApprovalDecision) => void;
}

interface RunRecord {
  run: WorkflowRun;
  parkedApprovals: Map<string, ParkedApproval>;
  parkedEventWaits: Set<{
    event_type: string;
    predicate?: (p: unknown) => boolean;
    resolve: (p: unknown) => void;
  }>;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(policy: RetryPolicy, attempt: number): number {
  const base = policy.base_ms ?? 250;
  return policy.backoff === "exponential" ? base * 2 ** (attempt - 1) : base;
}

export function createPostgresWorkflowRuntime(
  opts: PostgresWorkflowRuntimeOptions,
): WorkflowRuntime {
  const { pool, bus } = opts;
  const workflows = new Map<string, WorkflowDefinition>();
  const runs = new Map<string, RunRecord>();

  // Bus subscription that wakes parked event-wait Promises and parked
  // approval-decision Promises across all runs in this process.
  void bus.subscribe("*", async (event: PublishedEvent) => {
    for (const rec of runs.values()) {
      // approval.decided routes by approval_id
      if (event.event_type === "approval.decided") {
        const ap = (event.payload as { approval_id?: string }).approval_id;
        if (ap) {
          const parked = rec.parkedApprovals.get(ap);
          if (parked) {
            rec.parkedApprovals.delete(ap);
            await setRunStatus(pool, rec.run, "running");
            parked.resolve({
              decision: (event.payload as { decision: ApprovalDecision["decision"] })
                .decision,
              decided_by: (event.payload as { decided_by: string | null })
                .decided_by ?? undefined,
            });
            continue;
          }
        }
      }
      // Generic event waits
      for (const wait of [...rec.parkedEventWaits]) {
        if (wait.event_type !== event.event_type) continue;
        if (wait.predicate && !wait.predicate(event.payload)) continue;
        rec.parkedEventWaits.delete(wait);
        if (
          rec.parkedEventWaits.size === 0 &&
          rec.parkedApprovals.size === 0
        ) {
          await setRunStatus(pool, rec.run, "running");
        }
        wait.resolve(event.payload);
      }
    }
  });

  function makeContext(rec: RunRecord): RunContext {
    let position = -1;
    const stepIds = new Map<number, string>();

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
        position += 1;
        const pos = position;

        // Replay: if a checkpoint exists at this position, return its data.
        const replay = await pool.query<{ data: unknown }>(
          `select data from workflow_checkpoints
            where run_id = $1 and position = $2`,
          [rec.run.id, pos],
        );
        if (replay.rows[0]) return replay.rows[0].data as O;

        const retry: RetryPolicy =
          stepOpts?.retry ??
          opts.defaultRetry ?? {
            max_attempts: 3,
            backoff: "exponential",
            base_ms: 250,
          };

        let step_id = stepIds.get(pos);
        if (!step_id) {
          step_id = randomUUID();
          stepIds.set(pos, step_id);
        }

        let lastError: unknown;
        for (let attempt = 1; attempt <= retry.max_attempts; attempt++) {
          const attemptStepId = attempt === 1 ? step_id : randomUUID();
          await pool.query(
            `insert into workflow_steps (
               id, run_id, workspace_id, step_name, step_position, attempt,
               status, started_at, created_at
             ) values ($1, $2, $3, $4, $5, $6, 'running', now(), now())`,
            [attemptStepId, rec.run.id, rec.run.workspace_id, name, pos, attempt],
          );
          await bus.publish({
            workspace_id: rec.run.workspace_id!,
            event_type: "workflow.step.started",
            source: "system",
            producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
            correlation_id: rec.run.correlation_id ?? rec.run.id,
            payload: { run_id: rec.run.id, step_id: attemptStepId, step_name: name, attempt },
          });

          try {
            const result = await fn();
            await pool.query(
              `update workflow_steps
                  set status = 'completed', output = $1::jsonb, ended_at = now()
                where id = $2`,
              [JSON.stringify(result ?? null), attemptStepId],
            );
            await pool.query(
              `insert into workflow_checkpoints (run_id, workspace_id, position, data)
               values ($1, $2, $3, $4::jsonb)`,
              [rec.run.id, rec.run.workspace_id, pos, JSON.stringify(result ?? null)],
            );
            await pool.query(
              `update workflow_runs set last_checkpoint_at = now() where id = $1`,
              [rec.run.id],
            );
            rec.run.last_checkpoint_at = new Date().toISOString();
            await bus.publish({
              workspace_id: rec.run.workspace_id!,
              event_type: "workflow.step.completed",
              source: "system",
              producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
              correlation_id: rec.run.correlation_id ?? rec.run.id,
              payload: { run_id: rec.run.id, step_id: attemptStepId, step_name: name, attempt },
            });
            return result;
          } catch (err) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            await pool.query(
              `update workflow_steps
                  set status = 'failed', error = $1::jsonb, ended_at = now()
                where id = $2`,
              [JSON.stringify({ message }), attemptStepId],
            );
            await bus.publish({
              workspace_id: rec.run.workspace_id!,
              event_type: "workflow.step.failed",
              source: "system",
              producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
              correlation_id: rec.run.correlation_id ?? rec.run.id,
              payload: { run_id: rec.run.id, step_id: attemptStepId, step_name: name, attempt, error: message },
            });
            if (attempt < retry.max_attempts) {
              await delay(backoffMs(retry, attempt));
              continue;
            }
            if (stepOpts?.on_failure === "skip") {
              await pool.query(
                `insert into workflow_checkpoints (run_id, workspace_id, position, data)
                 values ($1, $2, $3, $4::jsonb)`,
                [rec.run.id, rec.run.workspace_id, pos, JSON.stringify(null)],
              );
              return undefined as O;
            }
            throw err;
          }
        }
        throw lastError;
      },

      sleep(ms) {
        return delay(ms);
      },

      awaitEvent<P>(
        event_type: string,
        predicate?: (p: P) => boolean,
      ): Promise<P> {
        return new Promise<P>((resolve) => {
          void setRunStatus(pool, rec.run, "awaiting_event").then(() => {
            rec.parkedEventWaits.add({
              event_type,
              predicate: predicate as ((p: unknown) => boolean) | undefined,
              resolve: resolve as (p: unknown) => void,
            });
          });
        });
      },

      async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
        const approval_id = randomUUID();
        await pool.query(
          `insert into workflow_approvals (
             id, run_id, workspace_id, kind, reason, payload, expires_at, created_at
           ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())`,
          [
            approval_id,
            rec.run.id,
            rec.run.workspace_id,
            req.kind,
            req.reason ?? null,
            JSON.stringify(req.payload ?? {}),
            req.expires_at ?? null,
          ],
        );
        await setRunStatus(pool, rec.run, "awaiting_approval");
        await bus.publish({
          workspace_id: rec.run.workspace_id!,
          event_type: "approval.requested",
          source: "system",
          producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
          correlation_id: rec.run.correlation_id ?? rec.run.id,
          payload: { approval_id, run_id: rec.run.id, step_id: null, kind: req.kind },
        });
        return new Promise<ApprovalDecision>((resolve) => {
          rec.parkedApprovals.set(approval_id, { resolve });
        });
      },

      async publish(event_type, payload) {
        await bus.publish({
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
          "Postgres development workflow runtime does not support platform-scoped invocations",
        );
      }
      const def = workflows.get(startOpts.workflow_name);
      if (!def) {
        throw new Error(
          `Workflow not registered: ${startOpts.workflow_name}`,
        );
      }

      // Idempotency: if a run with this key already exists for the workflow,
      // return it instead of starting a duplicate.
      if (startOpts.idempotency_key) {
        const existing = await pool.query<{ id: string }>(
          `select id from workflow_runs
            where workspace_id = $1 and workflow_name = $2 and idempotency_key = $3`,
          [
            startOpts.workspace_id,
            startOpts.workflow_name,
            startOpts.idempotency_key,
          ],
        );
        if (existing.rows[0]) {
          const ws = await loadRun<I, O>(pool, existing.rows[0].id);
          if (ws) return ws;
        }
      }

      const id = randomUUID();
      await pool.query(
        `insert into workflow_runs (
           id, workspace_id, workflow_name, workflow_version,
           play_id, play_run_id, status, input, idempotency_key,
           started_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, 'running', $7::jsonb, $8, now(), now())`,
        [
          id,
          startOpts.workspace_id,
          startOpts.workflow_name,
          def.version,
          startOpts.play_id ?? null,
          startOpts.play_run_id ?? null,
          JSON.stringify(startOpts.input ?? null),
          startOpts.idempotency_key ?? null,
        ],
      );

      const run: WorkflowRun<I, O> = {
        id,
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
      const rec: RunRecord = {
        run: run as WorkflowRun,
        parkedApprovals: new Map(),
        parkedEventWaits: new Set(),
      };
      runs.set(id, rec);

      const ctx = makeContext(rec);
      void (async () => {
        try {
          const output = (await def.run(startOpts.input, ctx)) as O;
          rec.run.output = output;
          rec.run.status = "completed";
          rec.run.ended_at = new Date().toISOString();
          await pool.query(
            `update workflow_runs
                set status = 'completed', output = $1::jsonb, ended_at = now()
              where id = $2`,
            [JSON.stringify(output ?? null), id],
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          rec.run.status = "failed";
          rec.run.error = { message, stack };
          rec.run.ended_at = new Date().toISOString();
          await pool.query(
            `update workflow_runs
                set status = 'failed', error = $1::jsonb, ended_at = now()
              where id = $2`,
            [JSON.stringify({ message, stack }), id],
          );
        }
      })();

      return run;
    },

    async get<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      // Prefer the in-memory copy (fresher) over a DB hit.
      const inMem = runs.get(run_id)?.run;
      if (inMem) return inMem as WorkflowRun<I, O>;
      return loadRun<I, O>(pool, run_id);
    },

    async resolveApproval(approval_id, decision) {
      // Persist the decision; the bus then wakes the parked workflow via
      // approval.decided.
      const result = await pool.query<{ workspace_id: string }>(
        `update workflow_approvals
            set decision = $1,
                decided_by = $2,
                decided_at = now(),
                decision_note = $3
          where id = $4 and decision = 'pending'
        returning workspace_id`,
        [decision.decision, decision.decided_by ?? null, decision.note ?? null, approval_id],
      );
      const row = result.rows[0];
      if (!row) {
        // Either unknown id or already decided. Either way: nothing to wake.
        return;
      }
      await bus.publish({
        workspace_id: row.workspace_id,
        event_type: "approval.decided",
        source: "user",
        producer_ref: decision.decided_by ?? null,
        payload: {
          approval_id,
          decision: decision.decision,
          decided_by: decision.decided_by ?? null,
        },
      });
    },
  };
}

async function setRunStatus(
  pool: Pool,
  run: WorkflowRun,
  status: WorkflowRun["status"],
): Promise<void> {
  run.status = status;
  await pool.query(`update workflow_runs set status = $1 where id = $2`, [
    status,
    run.id,
  ]);
}

async function loadRun<I, O>(
  pool: Pool,
  run_id: string,
): Promise<WorkflowRun<I, O> | null> {
  const { rows } = await pool.query<{
    id: string;
    workspace_id: string;
    workflow_name: string;
    workflow_version: string;
    status: WorkflowRun["status"];
    input: unknown;
    output: unknown | null;
    error: { message: string; stack?: string } | null;
    play_id: string | null;
    play_run_id: string | null;
    idempotency_key: string | null;
    started_at: Date | null;
    ended_at: Date | null;
    last_checkpoint_at: Date | null;
    created_at: Date;
  }>(
    `select id, workspace_id, workflow_name, workflow_version, status,
            input, output, error, play_id, play_run_id, idempotency_key,
            started_at, ended_at, last_checkpoint_at, created_at
       from workflow_runs where id = $1`,
    [run_id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    execution_scope: "workspace",
    workspace_id: row.workspace_id,
    workflow_name: row.workflow_name,
    workflow_version: row.workflow_version,
    status: row.status,
    input: row.input as I,
    output: (row.output ?? undefined) as O | undefined,
    error: row.error ?? undefined,
    play_id: row.play_id,
    play_run_id: row.play_run_id,
    idempotency_key: row.idempotency_key,
    started_at: row.started_at?.toISOString(),
    ended_at: row.ended_at?.toISOString(),
    last_checkpoint_at: row.last_checkpoint_at?.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}
