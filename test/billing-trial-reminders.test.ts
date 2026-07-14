import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, QueryResult } from "pg";
import {
  createTrialWeekReminderWorkflow,
  createTrialReminderProjection,
} from "../core/billing/trial-reminders.ts";
import { createTransactionalSender } from "../core/channels/email/transactional.ts";

function queryResult(
  rows: Record<string, unknown>[] = [],
  overrides: Partial<QueryResult> = {},
): QueryResult {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as QueryResult["rows"],
    ...overrides,
  };
}

function scriptedPool(
  handler: (sql: string, params?: unknown[]) => QueryResult,
): Pool {
  return {
    query: (async (sql: string, params?: unknown[]) =>
      handler(String(sql), params)) as Pool["query"],
  } as Pool;
}

test("trial reminder projection sends the low-credit transactional email once", async () => {
  const workspaceId = randomUUID();
  const sent: Array<{ to: string; subject: string; category: string }> = [];
  const pool = scriptedPool((sql) => {
    if (sql.includes("trial_reminder_low_sent_at is not null")) {
      return queryResult([{ sent: false }]);
    }
    if (
      sql.includes("select trial_credits_remaining, trial_credits_total") &&
      sql.includes("from workspaces")
    ) {
      return queryResult([{
        trial_credits_remaining: 5,
        trial_credits_total: 15,
        subscription_status: "inactive",
        subscription_renews_at: null,
      }]);
    }
    if (sql.includes("set trial_reminder_low_sent_at = $2")) {
      return queryResult([], { command: "UPDATE", rowCount: 1 });
    }
    return queryResult([]);
  });

  const projection = createTrialReminderProjection({
    pool,
    enabled: true,
    sender: {
      async send(input) {
        sent.push({
          to: input.to,
          subject: input.subject,
          category: input.category,
        });
        return { external_id: randomUUID() };
      },
    },
    loadRecipient: async () => ({
      email: "owner@example.com",
      workspace_name: "Acme",
    }),
    now: () => new Date("2026-06-23T00:00:00.000Z"),
  });

  await projection.apply({
    id: randomUUID(),
    workspace_id: workspaceId,
    event_type: "workspace.trial.low",
    source: "system",
    producer_ref: "test",
    occurred_at: "2026-06-23T00:00:00.000Z",
    payload: {
      workspace_id: workspaceId,
      credits_remaining: 5,
      credits_total: 15,
    },
  } as never);

  assert.deepEqual(sent, [{
    to: "owner@example.com",
    subject: "5 trial credits left on Acme",
    category: "trial_low_credits",
  }]);
});

test("trial week reminder workflow is tenant-scoped and uses a replay-safe provider key", async () => {
  const workspaceId = randomUUID();
  const sentKeys: Array<string | undefined> = [];
  const pool = scriptedPool((sql) => {
    if (
      sql.includes("select trial_credits_remaining, trial_credits_total") &&
      sql.includes("from workspaces")
    ) {
      return queryResult([{
        trial_credits_remaining: 0,
        trial_credits_total: 15,
        subscription_status: "inactive",
        subscription_renews_at: null,
      }]);
    }
    if (sql.includes("set trial_reminder_week_sent_at = $2")) {
      return queryResult([], { command: "UPDATE", rowCount: 1 });
    }
    return queryResult([]);
  });
  const workflow = createTrialWeekReminderWorkflow({
    pool,
    enabled: true,
    sender: {
      async send(input) {
        sentKeys.push(input.idempotency_key);
        return { external_id: randomUUID() };
      },
    },
    loadRecipient: async () => ({
      email: "owner@example.com",
      workspace_name: "Acme",
    }),
  });
  const ctx = {
    execution_scope: "workspace",
    workspace_id: workspaceId,
    step: async (_name: string, fn: () => Promise<unknown>) => fn(),
  } as never;

  const result = await workflow.run({ workspace_id: workspaceId }, ctx);

  assert.deepEqual(result, { sent: true });
  assert.deepEqual(sentKeys, [`trial-week:${workspaceId}`]);
  await assert.rejects(
    workflow.run({ workspace_id: randomUUID() }, ctx),
    /input workspace does not match workflow workspace/,
  );
});

test("transactional sender forwards idempotency keys to Resend", async () => {
  const calls: unknown[][] = [];
  const sender = createTransactionalSender({
    from: "Bombsell <no-reply@mail.bombsell.com>",
    client: {
      emails: {
        async send(...args: unknown[]) {
          calls.push(args);
          return { data: { id: "email-1" }, error: null };
        },
      },
    } as never,
  });

  await sender.send({
    to: "owner@example.com",
    subject: "Reminder",
    text: "Body",
    category: "trial_week_frozen",
    idempotency_key: "trial-week:workspace-1",
  });

  assert.deepEqual(calls[0]?.[1], {
    idempotencyKey: "trial-week:workspace-1",
  });
});
