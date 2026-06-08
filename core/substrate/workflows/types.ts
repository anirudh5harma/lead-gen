/**
 * Durable workflow runtime types. The runtime is the only orchestration
 * primitive in pivot-v2 — no Vercel crons for sequencing.
 *
 * Concepts:
 *   - A Workflow is a function (input, ctx) => output.
 *   - Inside a workflow, ctx.step(name, fn) wraps a side-effect so it can be
 *     replayed deterministically on crash/deploy. Completed steps return
 *     their journaled result instead of re-executing.
 *   - ctx.sleep, ctx.awaitEvent, ctx.requestApproval all park the workflow.
 *   - ctx.publish emits a typed event onto the bus, with the workflow's
 *     correlation_id and causation chain auto-populated.
 *
 * Adapters:
 *   - in-process : journals to memory. Dev / tests.
 *   - restate    : production ingress client; handler host still required.
 */

import type {
  EventPayload,
  EventType,
  PublishedEvent,
} from "../events/index.ts";

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_event"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "compensated";

export type WorkflowExecutionScope = "workspace" | "platform";

export interface RetryPolicy {
  max_attempts: number;
  backoff: "fixed" | "exponential";
  /** Base delay in milliseconds. For exponential, attempt N waits base*2^(N-1). */
  base_ms?: number;
}

export interface StepOptions {
  retry?: RetryPolicy;
  on_failure?: "fail" | "skip" | "compensate" | "retry";
}

export interface ApprovalRequest<P = unknown> {
  kind: string;
  reason?: string;
  payload: P;
  expires_at?: string;
}

export interface ApprovalDecision {
  decision: "approved" | "rejected" | "expired";
  decided_by?: string;
  note?: string;
}

export interface WorkflowRun<I = unknown, O = unknown> {
  id: string;
  execution_scope: WorkflowExecutionScope;
  workspace_id: string | null;
  workflow_name: string;
  workflow_version: string;
  status: WorkflowRunStatus;
  input: I;
  output?: O;
  error?: { message: string; stack?: string };
  play_id?: string | null;
  play_run_id?: string | null;
  correlation_id?: string | null;
  causation_id?: string | null;
  idempotency_key?: string | null;
  started_at?: string;
  ended_at?: string;
  last_checkpoint_at?: string;
  created_at: string;
}

export interface StepRecord {
  id: string;
  run_id: string;
  step_name: string;
  step_position: number;
  attempt: number;
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  error?: { message: string; stack?: string };
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

/**
 * Context passed to a workflow's `run` function. The only handle a workflow
 * has on the outside world: any side-effect MUST go through one of these
 * methods so it can be journaled / gated / replayed.
 */
export interface RunContext {
  readonly run_id: string;
  readonly execution_scope: WorkflowExecutionScope;
  readonly workspace_id: string | null;
  readonly correlation_id: string;

  /**
   * Wrap a side-effecting operation in a durable step. On replay (after a
   * crash or deploy), if the step at this position already completed, the
   * journaled result is returned without re-executing `fn`.
   *
   * Step names are unique per position within a workflow.
   */
  step<O>(name: string, fn: () => Promise<O>, opts?: StepOptions): Promise<O>;

  /**
   * Sleep for `ms` milliseconds. Survives process restarts.
   */
  sleep(ms: number): Promise<void>;

  /**
   * Park the workflow waiting for a typed event of `event_type` matching the
   * optional `predicate`. Wakes when the bus delivers a matching event.
   */
  awaitEvent<P = unknown>(
    event_type: string,
    predicate?: (payload: P) => boolean,
  ): Promise<P>;

  /**
   * Request human approval. Parks the workflow until decided via
   * `WorkflowRuntime.resolveApproval(approval_id, decision)`.
   */
  requestApproval<P = unknown>(req: ApprovalRequest<P>): Promise<ApprovalDecision>;

  /**
   * Publish a typed event onto the bus. correlation_id and causation_id are
   * auto-populated from the running workflow.
   */
  publish<T extends EventType>(
    event_type: T,
    payload: EventPayload<T>,
  ): Promise<PublishedEvent<EventPayload<T>>>;
}

export interface WorkflowDefinition<I = unknown, O = unknown> {
  name: string;
  version: string;
  run: (input: I, ctx: RunContext) => Promise<O>;
}

interface CommonStartOptions<I> {
  workflow_name: string;
  input: I;
  idempotency_key?: string;
  correlation_id?: string;
  causation_id?: string;
  play_id?: string;
  play_run_id?: string;
}

export type StartOptions<I = unknown> = CommonStartOptions<I> & (
  | { execution_scope?: "workspace"; workspace_id: string }
  | { execution_scope: "platform"; workspace_id: null }
);

/**
 * Public runtime interface. Adapters implement this contract.
 */
export interface WorkflowRuntime {
  register<I, O>(workflow: WorkflowDefinition<I, O>): void;

  start<I, O = unknown>(opts: StartOptions<I>): Promise<WorkflowRun<I, O>>;

  /**
   * Resume a persisted, non-terminal workflow run from its journal.
   * Adapters without durable storage may return the in-memory run.
   */
  resume<I = unknown, O = unknown>(
    run_id: string,
  ): Promise<WorkflowRun<I, O> | null>;

  get<I = unknown, O = unknown>(
    run_id: string,
  ): Promise<WorkflowRun<I, O> | null>;

  /**
   * Resolve a pending approval. Wakes any workflow parked on it.
   */
  resolveApproval(
    approval_id: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  /**
   * Wait for workflows launched in this process to finish their final
   * bookkeeping. Durable adapters may no-op; tests and operator scripts use
   * this before tearing down shared resources.
   */
  drain?(): Promise<void>;
}
