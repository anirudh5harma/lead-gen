import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, QueryResult } from "pg";
import {
  createTrialReminderProjection,
  sendDueTrialWeekReminders,
} from "../core/billing/trial-reminders.ts";

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

test("sendDueTrialWeekReminders skips Pro and counts sent reminders", async () => {
  const sent: string[] = [];
  const dueWorkspaceId = randomUUID();
  const proWorkspaceId = randomUUID();
  const pool = scriptedPool((sql, params) => {
    if (sql.includes("select id as workspace_id")) {
      return queryResult([
        { workspace_id: dueWorkspaceId },
        { workspace_id: proWorkspaceId },
      ]);
    }
    if (
      sql.includes("select trial_credits_remaining, trial_credits_total") &&
      sql.includes("from workspaces")
    ) {
      const workspaceId = params?.[0];
      if (workspaceId === dueWorkspaceId) {
        return queryResult([{
          trial_credits_remaining: 0,
          trial_credits_total: 15,
          subscription_status: "inactive",
          subscription_renews_at: null,
        }]);
      }
      return queryResult([{
        trial_credits_remaining: 0,
        trial_credits_total: 15,
        subscription_status: "active",
        subscription_renews_at: null,
      }]);
    }
    if (sql.includes("set trial_reminder_week_sent_at = $2")) {
      return queryResult([], { command: "UPDATE", rowCount: 1 });
    }
    return queryResult([]);
  });

  const count = await sendDueTrialWeekReminders({
    pool,
    enabled: true,
    sender: {
      async send(input) {
        sent.push(input.to);
        return { external_id: randomUUID() };
      },
    },
    loadRecipient: async (_pool, workspaceId) => ({
      email: `${workspaceId}@example.com`,
      workspace_name: "Acme",
    }),
    now: () => new Date("2026-06-23T00:00:00.000Z"),
  });

  assert.equal(count, 1);
  assert.deepEqual(sent, [`${dueWorkspaceId}@example.com`]);
});
