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
  execution?: Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(policy: RetryPolicy, attempt: number): number {
  const base = policy.base_ms ?? 250;
  return policy.backoff === "exponential" ? base * 2 ** (attempt - 1) : base;
}

async function recordCheckpoint(
  pool: Pool,
  runId: string,
  workspaceId: string,
  position: number,
  data: unknown,
): Promise<unknown> {
  const result = await pool.query<{ data: unknown }>(
    `insert into workflow_checkpoints (run_id, workspace_id, position, data)
     values ($1, $2, $3, $4::jsonb)
     on conflict (run_id, position)
     do update set data = workflow_checkpoints.data
     returning data`,
    [runId, workspaceId, position, JSON.stringify(data ?? null)],
  );
  return result.rows[0]?.data ?? null;
}

export function createPostgresWorkflowRuntime(
  opts: PostgresWorkflowRuntimeOptions,
): WorkflowRuntime {
  const { pool, bus } = opts;
  const workflows = new Map<string, WorkflowDefinition>();
  const runs = new Map<string, RunRecord>();
  const activeExecutions = new Set<Promise<void>>();

  async function wakeParkedApproval(
    approval_id: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    for (const rec of runs.values()) {
      const parked = rec.parkedApprovals.get(approval_id);
      if (!parked) continue;
      rec.parkedApprovals.delete(approval_id);
      await setRunStatus(pool, rec.run, "running");
      parked.resolve(decision);
      return true;
    }
    return false;
  }

  // Bus subscription that wakes parked event-wait Promises and parked
  // approval-decision Promises across all runs in this process.
  void bus.subscribe("*", async (event: PublishedEvent) => {
    if (event.event_type === "approval.decided") {
      const approval_id = (event.payload as { approval_id?: string }).approval_id;
      if (approval_id) {
        await wakeParkedApproval(approval_id, {
          decision: (event.payload as { decision: ApprovalDecision["decision"] }).decision,
          decided_by:
            (event.payload as { decided_by: string | null }).decided_by ?? undefined,
        });
      }
    }
    for (const rec of runs.values()) {
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

        const prior = await pool.query<{ max_attempt: number | null }>(
          `select max(attempt)::int as max_attempt
             from workflow_steps
            where run_id = $1 and step_position = $2`,
          [rec.run.id, pos],
        );
        const firstAttempt = Math.max(1, (prior.rows[0]?.max_attempt ?? 0) + 1);
        if (firstAttempt > retry.max_attempts) {
          if (stepOpts?.on_failure === "skip") {
            await pool.query(
              `update workflow_steps
                  set status = 'failed',
                      error = $1::jsonb,
                      ended_at = coalesce(ended_at, now())
                where run_id = $2
                  and step_position = $3
                  and status = 'running'`,
              [
                JSON.stringify({
                  message: `Recovered abandoned running step ${name} before skipping`,
                }),
                rec.run.id,
                pos,
              ],
            );
            await recordCheckpoint(
              pool,
              rec.run.id,
              rec.run.workspace_id!,
              pos,
              null,
            );
            return undefined as O;
          }
          throw new Error(
            `Step ${name} exhausted retry attempts for workflow run ${rec.run.id}`,
          );
        }
        let lastError: unknown;
        for (let attempt = firstAttempt; attempt <= retry.max_attempts; attempt++) {
          const attemptStepId = attempt === 1 ? step_id : randomUUID();
          const insertedStep = await pool.query<{ id: string }>(
            `insert into workflow_steps (
               id, run_id, workspace_id, step_name, step_position, attempt,
               status, started_at, created_at
             ) values ($1, $2, $3, $4, $5, $6, 'running', now(), now())
             on conflict (run_id, step_position, attempt)
             do update set step_name = excluded.step_name
             returning id`,
            [attemptStepId, rec.run.id, rec.run.workspace_id, name, pos, attempt],
          );
          const effectiveStepId = insertedStep.rows[0]?.id ?? attemptStepId;
          await bus.publish({
            workspace_id: rec.run.workspace_id!,
            event_type: "workflow.step.started",
            source: "system",
            producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
            correlation_id: rec.run.correlation_id ?? rec.run.id,
            payload: { run_id: rec.run.id, step_id: effectiveStepId, step_name: name, attempt },
          });

          try {
            const result = await fn();
            await pool.query(
              `update workflow_steps
                  set status = 'completed', output = $1::jsonb, ended_at = now()
                where id = $2`,
              [JSON.stringify(result ?? null), effectiveStepId],
            );
            const checkpoint = await recordCheckpoint(
              pool,
              rec.run.id,
              rec.run.workspace_id!,
              pos,
              result,
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
              payload: { run_id: rec.run.id, step_id: effectiveStepId, step_name: name, attempt },
            });
            return checkpoint as O;
          } catch (err) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            await pool.query(
              `update workflow_steps
                  set status = 'failed', error = $1::jsonb, ended_at = now()
                where id = $2`,
              [JSON.stringify({ message }), effectiveStepId],
            );
            await bus.publish({
              workspace_id: rec.run.workspace_id!,
              event_type: "workflow.step.failed",
              source: "system",
              producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
              correlation_id: rec.run.correlation_id ?? rec.run.id,
              payload: { run_id: rec.run.id, step_id: effectiveStepId, step_name: name, attempt, error: message },
            });
            if (attempt < retry.max_attempts) {
              await delay(backoffMs(retry, attempt));
              continue;
            }
            if (stepOpts?.on_failure === "skip") {
              await recordCheckpoint(
                pool,
                rec.run.id,
                rec.run.workspace_id!,
                pos,
                null,
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
        const prior = await pool.query<{
          id: string;
          decision: ApprovalDecision["decision"] | "pending";
          decided_by: string | null;
          decision_note: string | null;
        }>(
          `select id, decision, decided_by, decision_note
             from workflow_approvals
            where run_id = $1
              and kind = $2
              and payload = $3::jsonb
            order by created_at asc
            limit 1`,
          [rec.run.id, req.kind, JSON.stringify(req.payload ?? {})],
        );
        if (prior.rows[0]?.decision && prior.rows[0].decision !== "pending") {
          return {
            decision: prior.rows[0].decision,
            decided_by: prior.rows[0].decided_by ?? undefined,
            note: prior.rows[0].decision_note ?? undefined,
          };
        }
        if (prior.rows[0]?.decision === "pending") {
          await setRunStatus(pool, rec.run, "awaiting_approval");
          return new Promise<ApprovalDecision>((resolve) => {
            rec.parkedApprovals.set(prior.rows[0]!.id, { resolve });
          });
        }

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
        const decision = new Promise<ApprovalDecision>((resolve) => {
          rec.parkedApprovals.set(approval_id, { resolve });
        });
        await bus.publish({
          workspace_id: rec.run.workspace_id!,
          event_type: "approval.requested",
          source: "system",
          producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
          correlation_id: rec.run.correlation_id ?? rec.run.id,
          payload: { approval_id, run_id: rec.run.id, step_id: null, kind: req.kind },
        });
        return decision;
      },

      async publish(event_type, payload) {
        return bus.publish({
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

  function launchWorkflow<I, O>(
    rec: RunRecord,
    def: WorkflowDefinition<I, O>,
  ): void {
    if (rec.execution) return;
    const ctx = makeContext(rec);
    const execution = (async () => {
      try {
        const output = (await def.run(rec.run.input as I, ctx)) as O;
        const endedAt = new Date().toISOString();
        await pool.query(
          `update workflow_runs
              set status = 'completed',
                  output = $1::jsonb,
                  ended_at = now(),
                  lease_owner = null,
                  lease_expires_at = null
            where id = $2`,
          [JSON.stringify(output ?? null), rec.run.id],
        );
        await updatePlayRun(pool, rec.run, "completed", output);
        rec.run.output = output;
        rec.run.status = "completed";
        rec.run.ended_at = endedAt;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        const endedAt = new Date().toISOString();
        await pool.query(
          `update workflow_runs
              set status = 'failed',
                  error = $1::jsonb,
                  ended_at = now(),
                  lease_owner = null,
                  lease_expires_at = null
            where id = $2`,
          [JSON.stringify({ message, stack }), rec.run.id],
        );
        await updatePlayRun(pool, rec.run, "failed", undefined);
        await bus.publish({
          workspace_id: rec.run.workspace_id!,
          event_type: "workflow.run.failed",
          source: "system",
          producer_ref: `workflow:${rec.run.workflow_name}:${rec.run.id}`,
          correlation_id: rec.run.correlation_id ?? rec.run.id,
          payload: {
            run_id: rec.run.id,
            workflow_name: rec.run.workflow_name,
            error: message,
          },
        });
        rec.run.status = "failed";
        rec.run.error = { message, stack };
        rec.run.ended_at = endedAt;
      }
    })();
    rec.execution = execution;
    activeExecutions.add(execution);
    void execution.finally(() => {
      rec.execution = undefined;
      activeExecutions.delete(execution);
    });
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
          const inMemory = runs.get(existing.rows[0].id)?.run;
          if (inMemory) return inMemory as WorkflowRun<I, O>;
          const ws = await loadRun<I, O>(pool, existing.rows[0].id);
          if (ws) return ws;
        }
      }

      const id = randomUUID();
      const play_run_id = startOpts.play_id
        ? startOpts.play_run_id ?? randomUUID()
        : null;
      try {
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
            null,
            JSON.stringify(startOpts.input ?? null),
            startOpts.idempotency_key ?? null,
          ],
        );
      } catch (err) {
        if (startOpts.idempotency_key && isUniqueViolation(err)) {
          const existing = await loadRunByIdempotency<I, O>(
            pool,
            startOpts.workspace_id,
            startOpts.workflow_name,
            startOpts.idempotency_key,
          );
          if (existing) return existing;
        }
        throw err;
      }
      if (startOpts.play_id && play_run_id) {
        const input = startOpts.input as {
          rep_id?: unknown;
          trigger_event_id?: unknown;
        };
        await pool.query(
          `insert into play_runs (
             id, workspace_id, play_id, workflow_run_id, trigger_event_id,
             rep_id, status, input, started_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, 'running', $7::jsonb, now(), now())`,
          [
            play_run_id,
            startOpts.workspace_id,
            startOpts.play_id,
            id,
            typeof input?.trigger_event_id === "string" ? input.trigger_event_id : null,
            typeof input?.rep_id === "string" ? input.rep_id : null,
            JSON.stringify(startOpts.input ?? null),
          ],
        );
        await pool.query(
          `update workflow_runs set play_run_id = $1 where id = $2`,
          [play_run_id, id],
        );
      }

      const run: WorkflowRun<I, O> = {
        id,
        execution_scope: "workspace",
        workspace_id: startOpts.workspace_id,
        workflow_name: startOpts.workflow_name,
        workflow_version: def.version,
        status: "running",
        input: startOpts.input,
        play_id: startOpts.play_id ?? null,
        play_run_id,
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

      launchWorkflow(rec, def as WorkflowDefinition<I, O>);

      return run;
    },

    async resume<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      const active = runs.get(run_id)?.run;
      if (active) return active as WorkflowRun<I, O>;
      const run = await loadRun<I, O>(pool, run_id);
      if (!run) return null;
      if (["completed", "cancelled"].includes(run.status)) return run;
      const def = workflows.get(run.workflow_name);
      if (!def) {
        throw new Error(`Workflow not registered: ${run.workflow_name}`);
      }

      const rec: RunRecord = {
        run: run as WorkflowRun,
        parkedApprovals: new Map(),
        parkedEventWaits: new Set(),
      };
      runs.set(run.id, rec);
      await setRunStatus(pool, rec.run, "running");
      launchWorkflow(rec, def as WorkflowDefinition<I, O>);
      return rec.run as WorkflowRun<I, O>;
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
      const result = await pool.query<{ workspace_id: string; run_id: string }>(
        `update workflow_approvals
            set decision = $1,
                decided_by = $2,
                decided_at = now(),
                decision_note = $3
          where id = $4 and decision = 'pending'
        returning workspace_id, run_id`,
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
      await wakeParkedApproval(approval_id, decision);
    },

    async drain() {
      while (activeExecutions.size > 0) {
        await Promise.allSettled([...activeExecutions]);
      }
    },
  };
}

async function setRunStatus(
  pool: Pool,
  run: WorkflowRun,
  status: WorkflowRun["status"],
): Promise<void> {
  run.status = status;
  if (status === "running") {
    run.error = undefined;
    run.ended_at = undefined;
    await pool.query(
      `update workflow_runs
          set status = $1, error = null, ended_at = null
        where id = $2`,
      [status, run.id],
    );
  } else if (["completed", "failed", "cancelled"].includes(status)) {
    await pool.query(
      `update workflow_runs
          set status = $1,
              lease_owner = null,
              lease_expires_at = null
        where id = $2`,
      [status, run.id],
    );
  } else {
    await pool.query(`update workflow_runs set status = $1 where id = $2`, [
      status,
      run.id,
    ]);
  }
  await updatePlayRun(pool, run, status, run.output);
}

function toPlayRunStatus(status: WorkflowRun["status"]): string {
  if (status === "awaiting_event") return "running";
  return status;
}

async function updatePlayRun(
  pool: Pool,
  run: WorkflowRun,
  status: WorkflowRun["status"],
  output: unknown,
): Promise<void> {
  if (!run.play_run_id) return;
  const playRunStatus = toPlayRunStatus(status);
  await pool.query(
    `update play_runs
        set status = $1,
            output = coalesce($2::jsonb, output),
            ended_at = case when $3::text in ('completed', 'failed', 'cancelled') then now() else ended_at end
      where id = $4`,
    [
      playRunStatus,
      output === undefined ? null : JSON.stringify(output),
      playRunStatus,
      run.play_run_id,
    ],
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

async function loadRunByIdempotency<I, O>(
  pool: Pool,
  workspace_id: string,
  workflow_name: string,
  idempotency_key: string,
): Promise<WorkflowRun<I, O> | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id
       from workflow_runs
      where workspace_id = $1
        and workflow_name = $2
        and idempotency_key = $3
      limit 1`,
    [workspace_id, workflow_name, idempotency_key],
  );
  return rows[0] ? loadRun<I, O>(pool, rows[0].id) : null;
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
