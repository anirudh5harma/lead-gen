import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, QueryResult } from "pg";
import {
  createWorkflowApprovalProjection,
  registerWorkflowApprovalProjectors,
  registerWorkflowApprovalResolver,
} from "../core/substrate/workflows/approvals.ts";
import type { PublishedEvent } from "../core/substrate/events/index.ts";

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as QueryResult["rows"],
  };
}

test("workflow approval projector materializes full Restate gate context and decisions", async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("insert into workflow_approvals")) {
        return result([{ id: approvalId }]);
      }
      return result();
    },
  } as unknown as Pool;
  const projection = createWorkflowApprovalProjection(pool);
  const workspaceId = randomUUID();
  const approvalId = randomUUID();
  const messageId = randomUUID();

  await projection.apply({
    id: randomUUID(),
    workspace_id: workspaceId,
    event_type: "approval.requested",
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "system",
    producer_ref: "workflow:test:inv-1",
    idempotency_key: `approval:${approvalId}`,
    occurred_at: "2026-07-14T00:00:00.000Z",
    payload: {
      approval_id: approvalId,
      run_id: "inv_1",
      step_id: null,
      kind: "outbound.email.send",
      reason: "Send judged draft",
      payload: { message_id: messageId, body: "hello" },
      expires_at: "2026-07-15T00:00:00.000Z",
    },
  });
  await projection.apply({
    id: randomUUID(),
    workspace_id: workspaceId,
    event_type: "approval.decided",
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "user",
    producer_ref: randomUUID(),
    idempotency_key: `approval.decided:${approvalId}`,
    occurred_at: "2026-07-14T01:00:00.000Z",
    payload: {
      approval_id: approvalId,
      decision: "approved",
      decided_by: randomUUID(),
      note: "Looks good",
    },
  });

  assert.match(queries[0]!.sql, /insert into workflow_approvals/);
  assert.match(queries[0]!.sql, /on conflict \(id\)/);
  assert.equal(queries[0]!.params?.[1], "inv_1");
  assert.deepEqual(queries[0]!.params?.[6], {
    message_id: messageId,
    body: "hello",
  });
  assert.match(queries[1]!.sql, /set decision = \$2::approval_decision/);
  assert.match(queries[1]!.sql, /decision = 'pending'/);
  assert.equal(queries[1]!.params?.[1], "approved");
  assert.equal(queries[1]!.params?.[3], "Looks good");
});

test("workflow approval projector registers durable request and decision consumers", async () => {
  const subscriptions: Array<{ eventType: string; durableName: string }> = [];
  const pool = { query: async () => result() } as unknown as Pool;

  await registerWorkflowApprovalProjectors(
    { pool },
    {
      async subscribe(eventType, _handler, durableName) {
        subscriptions.push({ eventType, durableName });
        return { unsubscribe: async () => undefined };
      },
    },
  );

  assert.deepEqual(subscriptions, [
    {
      eventType: "approval.requested",
      durableName: "workflow-approval-requested-projector-v1",
    },
    {
      eventType: "approval.decided",
      durableName: "workflow-approval-decided-projector-v1",
    },
  ]);
});

test("workflow approval resolver consumes the durable decision event", async () => {
  let handler: ((event: PublishedEvent) => Promise<void>) | undefined;
  const resolutions: unknown[][] = [];
  const decidedBy = randomUUID();
  const workspaceId = randomUUID();
  await registerWorkflowApprovalResolver(
    {
      pool: {
        async query() {
          return result([{
            local_run_id: null,
            workspace_id: workspaceId,
          }]);
        },
      } as unknown as Pool,
      runtime: {
        async resolveApproval(...args) {
          resolutions.push(args);
        },
      },
    },
    {
      async subscribe(_eventType, next, durableName) {
        assert.equal(durableName, "workflow-approval-runtime-resolver-v1");
        handler = next as (event: PublishedEvent) => Promise<void>;
        return { unsubscribe: async () => undefined };
      },
    },
  );

  await handler!({
    id: randomUUID(),
    workspace_id: workspaceId,
    event_type: "approval.decided",
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "user",
    producer_ref: randomUUID(),
    idempotency_key: "approval.decided:sign_opaque",
    occurred_at: "2026-07-14T01:00:00.000Z",
    payload: {
      approval_id: "sign_opaque",
      decision: "approved",
      decided_by: decidedBy,
      note: "Looks good",
    },
  });

  assert.deepEqual(resolutions[0]?.[0], "sign_opaque");
  assert.deepEqual(resolutions[0]?.[1], {
    decision: "approved",
    decided_by: decidedBy,
    note: "Looks good",
  });
});
