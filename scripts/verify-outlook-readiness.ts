#!/usr/bin/env node
/**
 * Verify that the customer-connected Outlook launch path is usable.
 *
 * This probe is read-only and reports aggregate account/subscription state. It
 * intentionally does not send email; the real send/reply test still requires a
 * controlled mailbox and recipient.
 */

import fs from "node:fs";
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
  needsReauthAccounts: number;
}

export interface OutlookReadinessProbeOptions {
  env?: Record<string, string | undefined>;
  pool?: Pick<Pool, "query" | "end">;
}

interface OutlookAggregateRow {
  connected_outlook: string | number;
  active_subscriptions: string | number;
  needs_reauth_outlook: string | number;
  errored_connected: string | number;
  connected_managed_domains: string | number;
}

interface OutlookErrorSampleRow {
  last_error: string | null;
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
    return result(steps, 0, 0, 0);
  }

  const pool = opts.pool ?? new Pool({ connectionString: databaseUrl });
  const shouldClose = !opts.pool;
  try {
    steps.push({ label: "outlook: database configured", status: "ok" });
    const { rows } = await pool.query<OutlookAggregateRow>(`
      with relevant_accounts as (
        select *,
               coalesce(
                 nullif(lower(properties ->> 'mailbox_email'), ''),
                 nullif(lower(display_name), ''),
                 id::text
               ) as outlook_mailbox_key
          from channel_accounts
         where kind in ('oauth_outlook', 'email_domain')
      ),
      outlook_mailboxes as (
        select outlook_mailbox_key,
               bool_or(status = 'connected') as has_connected,
               bool_or(
                 status = 'connected'
                 and properties -> 'outlook_subscription' is not null
                 and properties -> 'outlook_subscription' ->> 'clientState' is not null
                 and properties -> 'outlook_subscription' ->> 'lifecycleNotificationUrl' is not null
                 and (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
                       > now() + interval '15 minutes'
               ) as has_active_subscription,
               bool_or(status = 'needs_reauth') as has_needs_reauth,
               bool_or(status = 'connected' and last_error is not null) as has_connected_error
          from relevant_accounts
         where kind = 'oauth_outlook'
         group by outlook_mailbox_key
      )
      select
        (select count(*) from outlook_mailboxes where has_connected) as connected_outlook,
        (select count(*) from outlook_mailboxes where has_active_subscription) as active_subscriptions,
        (select count(*) from outlook_mailboxes where has_needs_reauth and not has_connected) as needs_reauth_outlook,
        (select count(*) from outlook_mailboxes where has_connected_error) as errored_connected,
        count(*) filter (
          where kind = 'email_domain'
            and status = 'connected'
        ) as connected_managed_domains
      from relevant_accounts
    `);
    const aggregate = rows[0] ?? {
      connected_outlook: 0,
      active_subscriptions: 0,
      needs_reauth_outlook: 0,
      errored_connected: 0,
      connected_managed_domains: 0,
    };
    const connected = asNumber(aggregate.connected_outlook);
    const activeSubscriptions = asNumber(aggregate.active_subscriptions);
    const needsReauth = asNumber(aggregate.needs_reauth_outlook);
    const errored = asNumber(aggregate.errored_connected);
    const managedDomains = asNumber(aggregate.connected_managed_domains);
    const accountProblems = errored + needsReauth;
    const errorSample = accountProblems > 0
      ? await loadOutlookErrorSample(pool)
      : null;

    steps.push({
      label: "outlook: connected mailbox",
      status: connected > 0 ? "ok" : "fail",
      detail: connected > 0
        ? `${connected} connected Outlook account(s)`
        : needsReauth > 0
          ? `${needsReauth} Outlook account(s) need Microsoft reauthorization before sends can resume`
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
      status: accountProblems === 0 ? "ok" : "fail",
      detail: accountProblems === 0
        ? "No connected Outlook account errors recorded"
        : `${errored} connected Outlook account(s) have last_error set; ${needsReauth} Outlook account(s) need reauthorization${errorSample ? `; sample=${errorSample}` : ""}`,
    });
    steps.push({
      label: "managed-domain fallback",
      status: "ok",
      detail: env.MANAGED_OWNED_DOMAIN_EMAIL_ENABLED?.trim() === "1"
        ? `Enabled intentionally; ${managedDomains} connected managed-domain account(s) exist`
        : `Disabled unless MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1; ${managedDomains} connected legacy managed-domain account(s) ignored by runtime transport selection`,
    });
    return result(steps, connected, activeSubscriptions, needsReauth);
  } catch (err) {
    steps.push({
      label: "outlook: readiness query",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return result(steps, 0, 0, 0);
  } finally {
    if (shouldClose) await pool.end();
  }
}

async function loadOutlookErrorSample(
  pool: Pick<Pool, "query">,
): Promise<string | null> {
  const { rows } = await pool.query<OutlookErrorSampleRow>(`
    select last_error::text as last_error
      from channel_accounts
     where kind = 'oauth_outlook'
       and status in ('connected', 'needs_reauth')
       and last_error is not null
     order by updated_at desc nulls last
     limit 1
  `);
  return summarizeOutlookError(rows[0]?.last_error ?? null);
}

export function summarizeOutlookError(error: string | null): string | null {
  if (!error) return null;
  const text = error.replaceAll(/\s+/g, " ").slice(0, 1_200);
  if (/AADSTS7000215|invalid_client/i.test(text)) {
    return "Microsoft invalid_client/AADSTS7000215: MICROSOFT_CLIENT_SECRET must be the current client secret value, not the secret id";
  }
  const message = extractJsonMessage(text) ?? text;
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function extractJsonMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error_description?: unknown; error?: unknown };
    for (const value of [parsed.message, parsed.error_description, parsed.error]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    // last_error may be plain text or a truncated provider payload.
  }
  const match = text.match(/"error_description"\s*:\s*"([^"]+)/);
  return match?.[1] ? match[1].replaceAll("\\\"", "\"") : null;
}

function result(
  steps: OutlookReadinessStep[],
  connectedAccounts: number,
  activeSubscriptions: number,
  needsReauthAccounts: number,
): OutlookReadinessResult {
  return {
    ok: steps.every((step) => step.status === "ok"),
    steps,
    connectedAccounts,
    activeSubscriptions,
    needsReauthAccounts,
  };
}

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

async function main(): Promise<void> {
  loadDotenvLocal();
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
