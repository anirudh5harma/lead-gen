#!/usr/bin/env node
/**
 * Verify that the customer-connected Outlook launch path is usable.
 *
 * This probe is read-only and reports aggregate account/subscription state. It
 * intentionally does not send email; the real send/reply test still requires a
 * controlled mailbox and recipient.
 */

import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export interface OutlookReadinessStep {
  label: string;
  status: "ok" | "fail";
  detail?: string;
}

export interface OutlookReadinessResult {
  ok: boolean;
  steps: OutlookReadinessStep[];
  connectedAccounts: number;
  activeSubscriptions: number;
}

export interface OutlookReadinessProbeOptions {
  env?: Record<string, string | undefined>;
  pool?: Pick<Pool, "query" | "end">;
}

interface OutlookAggregateRow {
  total_outlook: string | number;
  connected_outlook: string | number;
  active_subscriptions: string | number;
  errored_connected: string | number;
  connected_managed_domains: string | number;
}

export async function runOutlookReadinessProbe(
  opts: OutlookReadinessProbeOptions = {},
): Promise<OutlookReadinessResult> {
  const env = opts.env ?? process.env;
  const steps: OutlookReadinessStep[] = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl && !opts.pool) {
    steps.push({
      label: "outlook: database configured",
      status: "fail",
      detail: "DATABASE_URL is required to inspect production Outlook channel accounts",
    });
    return result(steps, 0, 0);
  }

  const pool = opts.pool ?? new Pool({ connectionString: databaseUrl });
  const shouldClose = !opts.pool;
  try {
    steps.push({ label: "outlook: database configured", status: "ok" });
    const { rows } = await pool.query<OutlookAggregateRow>(`
      select
        count(*) filter (where kind = 'oauth_outlook') as total_outlook,
        count(*) filter (
          where kind = 'oauth_outlook'
            and status = 'connected'
        ) as connected_outlook,
        count(*) filter (
          where kind = 'oauth_outlook'
            and status = 'connected'
            and properties -> 'outlook_subscription' is not null
            and properties -> 'outlook_subscription' ->> 'clientState' is not null
            and properties -> 'outlook_subscription' ->> 'lifecycleNotificationUrl' is not null
            and (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
                  > now() + interval '15 minutes'
        ) as active_subscriptions,
        count(*) filter (
          where kind = 'oauth_outlook'
            and status = 'connected'
            and last_error is not null
        ) as errored_connected,
        count(*) filter (
          where kind = 'email_domain'
            and status = 'connected'
        ) as connected_managed_domains
      from channel_accounts
      where kind in ('oauth_outlook', 'email_domain')
    `);
    const aggregate = rows[0] ?? {
      total_outlook: 0,
      connected_outlook: 0,
      active_subscriptions: 0,
      errored_connected: 0,
      connected_managed_domains: 0,
    };
    const connected = asNumber(aggregate.connected_outlook);
    const activeSubscriptions = asNumber(aggregate.active_subscriptions);
    const errored = asNumber(aggregate.errored_connected);
    const managedDomains = asNumber(aggregate.connected_managed_domains);

    steps.push({
      label: "outlook: connected mailbox",
      status: connected > 0 ? "ok" : "fail",
      detail: connected > 0
        ? `${connected} connected Outlook account(s)`
        : "No connected Outlook accounts; customer-connected Outlook is the launch outbound path",
    });
    steps.push({
      label: "outlook: reply sync subscription",
      status: connected === 0 || activeSubscriptions > 0 ? "ok" : "fail",
      detail: connected === 0
        ? "Skipped until an Outlook account is connected"
        : `${activeSubscriptions}/${connected} connected Outlook account(s) have active Graph subscriptions`,
    });
    steps.push({
      label: "outlook: account errors",
      status: errored === 0 ? "ok" : "fail",
      detail: errored === 0
        ? "No connected Outlook account errors recorded"
        : `${errored} connected Outlook account(s) have last_error set`,
    });
    steps.push({
      label: "managed-domain fallback",
      status: "ok",
      detail: env.MANAGED_OWNED_DOMAIN_EMAIL_ENABLED?.trim() === "1"
        ? `Enabled intentionally; ${managedDomains} connected managed-domain account(s) exist`
        : `Disabled unless MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1; ${managedDomains} connected legacy managed-domain account(s) ignored by runtime transport selection`,
    });
    return result(steps, connected, activeSubscriptions);
  } catch (err) {
    steps.push({
      label: "outlook: readiness query",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return result(steps, 0, 0);
  } finally {
    if (shouldClose) await pool.end();
  }
}

function result(
  steps: OutlookReadinessStep[],
  connectedAccounts: number,
  activeSubscriptions: number,
): OutlookReadinessResult {
  return {
    ok: steps.every((step) => step.status === "ok"),
    steps,
    connectedAccounts,
    activeSubscriptions,
  };
}

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

async function main(): Promise<void> {
  const readiness = await runOutlookReadinessProbe();
  console.log("Outlook readiness");
  for (const step of readiness.steps) {
    const label = step.status === "ok" ? "OK  " : "FAIL";
    console.log(`  ${label} ${step.label}${step.detail ? ` - ${step.detail}` : ""}`);
  }
  if (!readiness.ok) {
    console.error("\nOutlook readiness failed.");
    process.exit(1);
  }
  console.log("\nOutlook readiness verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
