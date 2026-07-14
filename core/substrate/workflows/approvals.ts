import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventHandler,
  EventPayload,
  PublishedEvent,
  Subscription,
} from "../events/index.ts";
import type { WorkflowRuntime } from "./types.ts";

type WorkflowApprovalEventType = "approval.requested" | "approval.decided";

export interface WorkflowApprovalSubscriber {
  subscribe<T extends WorkflowApprovalEventType>(
    eventType: T,
    handler: EventHandler<EventPayload<T>>,
    durableName: string,
  ): Promise<Subscription>;
}

export function normalizeApprovalPayload(
  payload: unknown,
): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : { value: payload };
}

export function createWorkflowApprovalProjection(
  pool: Pool,
): DurableEventProjection {
  return {
    name: "workflow.approvals.v1",
    eventTypes: ["approval.requested", "approval.decided"],
    async apply(event) {
      if (event.event_type === "approval.requested") {
        await projectApprovalRequested(pool, event);
        return;
      }
      if (event.event_type === "approval.decided") {
        await projectWorkflowApprovalDecision(pool, event);
      }
    },
  };
}

export async function registerWorkflowApprovalProjectors(
  deps: { pool: Pool },
  subscriber: WorkflowApprovalSubscriber,
): Promise<Subscription[]> {
  const projection = createWorkflowApprovalProjection(deps.pool);
  return Promise.all([
    subscriber.subscribe(
      "approval.requested",
      (event) => projection.apply(event),
      "workflow-approval-requested-projector-v1",
    ),
    subscriber.subscribe(
      "approval.decided",
      (event) => projection.apply(event),
      "workflow-approval-decided-projector-v1",
    ),
  ]);
}

export async function registerWorkflowApprovalResolver(
  deps: { pool: Pool; runtime: Pick<WorkflowRuntime, "resolveApproval"> },
  subscriber: WorkflowApprovalSubscriber,
): Promise<Subscription> {
  return subscriber.subscribe(
    "approval.decided",
    async (event) => {
      const payload = event.payload as EventPayload<"approval.decided">;
      const materialized = await deps.pool.query<{
        local_run_id: string | null;
        workspace_id: string;
      }>(
        `select local_run_id, workspace_id
           from workflow_approvals
          where id = $1`,
        [payload.approval_id],
      );
      const approval = materialized.rows[0];
      if (!approval) {
        throw new Error(`Approval not materialized: ${payload.approval_id}`);
      }
      if (approval.workspace_id !== event.workspace_id) {
        throw new Error(`Approval workspace mismatch: ${payload.approval_id}`);
      }
      if (approval.local_run_id) return;
      try {
        await deps.runtime.resolveApproval(payload.approval_id, {
          decision: payload.decision,
          decided_by: payload.decided_by ?? undefined,
          note: payload.note ?? undefined,
        });
      } catch (error) {
        if (isStaleRestateApprovalResolutionError(error)) return;
        throw error;
      }
    },
    "workflow-approval-runtime-resolver-v1",
  );
}

export function isStaleRestateApprovalResolutionError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (status !== 400 && status !== 404 && status !== 410) return false;
  const body =
    typeof error === "object" && error !== null && "body" in error
      ? String((error as { body?: unknown }).body ?? "")
      : "";
  return /bad awakeable id|awakeable.*not found|not.*awakeable|unknown awakeable/i.test(
    body,
  );
}

async function projectApprovalRequested(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as EventPayload<"approval.requested">;
  const result = await pool.query(
    `insert into workflow_approvals (
       id, run_id, local_run_id, step_id, workspace_id, kind, reason, payload, expires_at, created_at
     ) values (
       $1, $2,
       case when $2 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then $2::uuid else null end,
       $3, $4, $5, $6, $7::jsonb, $8, $9
     )
     on conflict (id) do update
       set run_id = excluded.run_id,
           local_run_id = excluded.local_run_id,
           step_id = excluded.step_id,
           kind = excluded.kind,
           reason = excluded.reason,
           payload = excluded.payload,
           expires_at = excluded.expires_at
     where workflow_approvals.decision = 'pending'
       and workflow_approvals.workspace_id = excluded.workspace_id
     returning id`,
    [
      payload.approval_id,
      payload.run_id,
      payload.step_id,
      event.workspace_id,
      payload.kind,
      payload.reason ?? null,
      payload.payload ?? {},
      payload.expires_at ?? null,
      event.occurred_at,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    const existing = await pool.query<{ workspace_id: string }>(
      `select workspace_id from workflow_approvals where id = $1`,
      [payload.approval_id],
    );
    if (existing.rows[0]?.workspace_id === event.workspace_id) return;
    throw new Error(
      `Approval id collision across workspaces: ${payload.approval_id}`,
    );
  }
}

export async function projectWorkflowApprovalDecision(
  pool: Pool,
  event: PublishedEvent,
): Promise<boolean> {
  const payload = event.payload as EventPayload<"approval.decided">;
  const result = await pool.query(
    `update workflow_approvals
        set decision = $2::approval_decision,
            decided_by = $3,
            decision_note = $4,
            decided_at = $5
      where id = $1
        and workspace_id = $6
        and decision = 'pending'`,
    [
      payload.approval_id,
      payload.decision,
      payload.decided_by,
      payload.note ?? null,
      event.occurred_at,
      event.workspace_id,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}
