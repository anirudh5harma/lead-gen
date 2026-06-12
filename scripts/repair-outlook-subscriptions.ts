#!/usr/bin/env node
/**
 * Operator repair for connected Outlook reply-sync subscriptions.
 *
 * This invokes the existing `email_outlook_subscription_repair` workflow
 * against connected Outlook accounts that are missing or close to expiring
 * Graph subscriptions. It does not send email.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  createOutlookSender,
  createOutlookSubscriptionRepairWorkflow,
  projectOutlookCredentialsRefreshed,
  projectOutlookReauthorizationRequired,
  type OutlookSubscriptionRepairInput,
  type OutlookSubscriptionRepairSummary,
} from "../core/channels/email/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";
import { summarizeOutlookError } from "./verify-outlook-readiness.ts";

interface WorkspaceTarget {
  workspace_id: string;
  account_count: string | number;
}

loadDotenvLocal();

const databaseUrl = process.env.DATABASE_URL?.trim();
const appOrigin = process.env.APP_ORIGIN?.trim();
const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();

if (!databaseUrl) die("DATABASE_URL is required.");
if (!appOrigin?.startsWith("https://")) {
  die("APP_ORIGIN must be an HTTPS origin reachable by Microsoft Graph webhooks.");
}
if (!clientId || !clientSecret) {
  die("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required.");
}

const pool = new Pool({ connectionString: databaseUrl });
const bus = createInMemoryEventBus();
await bus.subscribe("email.outlook.credentials.refreshed", async (event) => {
  await projectOutlookCredentialsRefreshed(pool, event.workspace_id, event.payload);
});
await bus.subscribe("email.outlook.reauthorization.required", async (event) => {
  await projectOutlookReauthorizationRequired(pool, event.workspace_id, event.payload);
});

try {
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createOutlookSubscriptionRepairWorkflow({
      pool,
      accessTokens: createOutlookSender({
        pool,
        bus,
        clientId,
        clientSecret,
      }),
      notificationUrl: `${appOrigin}/api/webhooks/outlook`,
    }),
  );
  const targets = await loadWorkspaceTargets(pool);
  if (targets.length === 0) {
    console.log("Outlook subscription repair: no connected accounts need repair.");
    process.exit(0);
  }

  console.log("Outlook subscription repair");
  let failed = 0;
  for (const target of targets) {
    const run = await runtime.start<
      OutlookSubscriptionRepairInput,
      OutlookSubscriptionRepairSummary
    >({
      workspace_id: target.workspace_id,
      workflow_name: "email_outlook_subscription_repair",
      idempotency_key:
        `operator:outlook-subscription-repair:${target.workspace_id}:${Date.now()}`,
      input: {
        workspace_id: target.workspace_id,
        limit: Number(process.env.OUTLOOK_REPAIR_LIMIT ?? 500),
      },
    });
    const completed = await waitForRun(runtime, run.id);
    if (completed.status !== "completed" || !completed.output) {
      failed += 1;
      console.log(
        `  FAIL workspace=${target.workspace_id} accounts=${target.account_count} status=${completed.status}`,
      );
      continue;
    }
    failed += completed.output.failed;
    const label = completed.output.failed > 0 ? "FAIL" : "OK  ";
    console.log(
      [
        `  ${label} workspace=${target.workspace_id}`,
        `accounts=${completed.output.accounts_checked}`,
        `created=${completed.output.subscriptions_created}`,
        `renewed=${completed.output.subscriptions_renewed}`,
        `migrated=${completed.output.subscriptions_migrated}`,
        `failed=${completed.output.failed}`,
      ].join(" "),
    );
  }

  if (failed > 0) {
    const sample = await loadRepairErrorSample(pool);
    if (sample) console.error(`Last Outlook repair error: ${sample}`);
    console.error("\nOutlook subscription repair finished with failures.");
    process.exit(1);
  }
  console.log("\nOutlook subscription repair completed.");
} finally {
  if ("close" in bus && typeof bus.close === "function") {
    await bus.close();
  }
  await pool.end();
}

async function loadRepairErrorSample(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ last_error: string | null }>(
    `select last_error::text as last_error
       from channel_accounts
      where kind = 'oauth_outlook'
        and status in ('connected', 'needs_reauth')
        and last_error is not null
      order by updated_at desc nulls last
      limit 1`,
  );
  return summarizeOutlookError(rows[0]?.last_error ?? null);
}

async function loadWorkspaceTargets(pool: Pool): Promise<WorkspaceTarget[]> {
  const workspaceId = process.env.OUTLOOK_REPAIR_WORKSPACE_ID?.trim();
  const { rows } = await pool.query<WorkspaceTarget>(
    `select workspace_id::text as workspace_id,
            count(*) as account_count
       from channel_accounts
      where kind = 'oauth_outlook'
        and status = 'connected'
        and ($1::uuid is null or workspace_id = $1)
        and (
          properties -> 'outlook_subscription' is null
          or (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
               <= now() + interval '12 hours'
        )
      group by workspace_id
      order by min(created_at) asc`,
    [workspaceId || null],
  );
  return rows;
}

async function waitForRun(
  runtime: ReturnType<typeof createInProcessWorkflowRuntime>,
  runId: string,
): Promise<{
  status: string;
  output?: OutlookSubscriptionRepairSummary | null;
}> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const current = await runtime.get<
      OutlookSubscriptionRepairInput,
      OutlookSubscriptionRepairSummary
    >(runId);
    if (current?.status === "completed" || current?.status === "failed") {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Outlook repair run ${runId}`);
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadDotenvLocal(): void {
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  const parsed = parseEnvFile(fs.readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx).trim()] = stripQuotes(line.slice(idx + 1).trim());
  }
  return env;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

if (process.argv[1] && import.meta.url !== pathToFileURL(process.argv[1]).href) {
  throw new Error("repair-outlook-subscriptions.ts is a CLI-only script");
}
