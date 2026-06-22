#!/usr/bin/env node
/**
 * Verify that the pooled platform-scoped X source is configured with a valid
 * provider key and stays within its monthly budget cap.
 *
 * This probe is read-only. It inspects the shared source row plus environment
 * configuration; it does not call the upstream X provider.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  SHARED_X_SOURCE_ADAPTER,
  sharedXMonthlyCostEstimateUsd,
  type SharedXRule,
} from "../core/ingest/shared-x.ts";

export interface SharedXReadinessStep {
  label: string;
  status: "ok" | "fail";
  detail?: string;
}

export interface SharedXReadinessResult {
  ok: boolean;
  steps: SharedXReadinessStep[];
  sourceEnabled: boolean;
  provider: "twitterapi_io" | "socialdata" | "x_official" | null;
  enabledRuleCount: number;
  projectedMonthlyCostUsd: number | null;
  monthlyBudgetUsd: number | null;
}

export interface SharedXReadinessProbeOptions {
  env?: Record<string, string | undefined>;
  pool?: Pick<Pool, "query" | "end">;
}

interface SharedXSourceRow {
  enabled: boolean;
  config: Record<string, unknown> | null;
}

const SHARED_X_PROVIDER_ENV: Record<NonNullable<SharedXReadinessResult["provider"]>, string> = {
  twitterapi_io: "TWITTERAPI_IO_API_KEY",
  socialdata: "SOCIALDATA_API_KEY",
  x_official: "X_API_BEARER_TOKEN",
};

export async function runSharedXReadinessProbe(
  opts: SharedXReadinessProbeOptions = {},
): Promise<SharedXReadinessResult> {
  const env = opts.env ?? process.env;
  const steps: SharedXReadinessStep[] = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl && !opts.pool) {
    steps.push({
      label: "shared-x: database configured",
      status: "fail",
      detail: "DATABASE_URL is required to inspect the pooled X source",
    });
    return result(steps, {
      sourceEnabled: false,
      provider: null,
      enabledRuleCount: 0,
      projectedMonthlyCostUsd: null,
      monthlyBudgetUsd: null,
    });
  }

  const pool = opts.pool ?? new Pool({ connectionString: databaseUrl });
  const shouldClose = !opts.pool;
  try {
    steps.push({ label: "shared-x: database configured", status: "ok" });
    const { rows } = await pool.query<SharedXSourceRow>(
      `select enabled, config
         from platform_signal_sources
        where adapter = $1
        limit 1`,
      [SHARED_X_SOURCE_ADAPTER],
    );
    const source = rows[0] ?? null;
    if (!source) {
      steps.push({
        label: "shared-x: source configured",
        status: "fail",
        detail: "platform_signal_sources is missing the x_search_shared row",
      });
      return result(steps, {
        sourceEnabled: false,
        provider: null,
        enabledRuleCount: 0,
        projectedMonthlyCostUsd: null,
        monthlyBudgetUsd: null,
      });
    }

    steps.push({
      label: "shared-x: source configured",
      status: source.enabled ? "ok" : "fail",
      detail: source.enabled
        ? "x_search_shared exists and is enabled"
        : "x_search_shared exists but is disabled",
    });

    const config = recordValue(source.config) ?? {};
    const provider = normalizeProvider(config.provider);
    if (!provider) {
      steps.push({
        label: "shared-x: provider configured",
        status: "fail",
        detail: "Shared X source provider must be one of twitterapi_io, socialdata, or x_official",
      });
      return result(steps, {
        sourceEnabled: source.enabled,
        provider: null,
        enabledRuleCount: 0,
        projectedMonthlyCostUsd: null,
        monthlyBudgetUsd: null,
      });
    }

    steps.push({
      label: "shared-x: provider configured",
      status: "ok",
      detail: `Provider ${provider} is configured`,
    });

    const providerEnvKey = SHARED_X_PROVIDER_ENV[provider];
    steps.push({
      label: "shared-x: provider key present",
      status: hasEnvValue(env[providerEnvKey]) ? "ok" : "fail",
      detail: hasEnvValue(env[providerEnvKey])
        ? `${providerEnvKey} is configured`
        : `${providerEnvKey} is required for provider ${provider}`,
    });

    const rules = normalizeRules(config.rules);
    const enabledRuleCount = rules.filter((rule) => rule.enabled !== false).length;
    steps.push({
      label: "shared-x: rule pack configured",
      status: enabledRuleCount > 0 ? "ok" : "fail",
      detail: enabledRuleCount > 0
        ? `${enabledRuleCount} enabled pooled X rule(s)`
        : "No enabled pooled X rules found",
    });

    const monthlyBudgetUsd = positiveNumber(config.monthly_budget_usd) ?? 10;
    const projectedMonthlyCostUsd = sharedXMonthlyCostEstimateUsd({
      provider,
      rules,
    });
    steps.push({
      label: "shared-x: monthly budget",
      status: projectedMonthlyCostUsd <= monthlyBudgetUsd ? "ok" : "fail",
      detail: `Projected $${projectedMonthlyCostUsd.toFixed(2)}/mo against cap $${monthlyBudgetUsd.toFixed(2)}/mo`,
    });

    return result(steps, {
      sourceEnabled: source.enabled,
      provider,
      enabledRuleCount,
      projectedMonthlyCostUsd,
      monthlyBudgetUsd,
    });
  } catch (err) {
    steps.push({
      label: "shared-x: readiness query",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return result(steps, {
      sourceEnabled: false,
      provider: null,
      enabledRuleCount: 0,
      projectedMonthlyCostUsd: null,
      monthlyBudgetUsd: null,
    });
  } finally {
    if (shouldClose) await pool.end();
  }
}

function result(
  steps: SharedXReadinessStep[],
  meta: Omit<SharedXReadinessResult, "ok" | "steps">,
): SharedXReadinessResult {
  return {
    ok: steps.every((step) => step.status === "ok"),
    steps,
    ...meta,
  };
}

function normalizeProvider(
  value: unknown,
): SharedXReadinessResult["provider"] {
  if (value === "twitterapi_io" || value === "socialdata" || value === "x_official") {
    return value;
  }
  return null;
}

function normalizeRules(value: unknown): SharedXRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = recordValue(entry);
    const id = cleanString(record?.id);
    const name = cleanString(record?.name);
    const query = cleanString(record?.query);
    const signal_kind = cleanString(record?.signal_kind);
    if (!id || !name || !query || !signal_kind) return [];
    return [{
      id,
      name,
      query,
      signal_kind: signal_kind as SharedXRule["signal_kind"],
      enabled: record?.enabled === false ? false : true,
      limit: positiveNumber(record?.limit) ?? undefined,
      cadence_hours: positiveNumber(record?.cadence_hours) ?? undefined,
    }];
  });
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

async function main(): Promise<void> {
  loadDotenvLocal();
  const readiness = await runSharedXReadinessProbe();
  console.log("Shared X readiness");
  for (const step of readiness.steps) {
    const label = step.status === "ok" ? "OK  " : "FAIL";
    console.log(`  ${label} ${step.label}${step.detail ? ` - ${step.detail}` : ""}`);
  }
  if (!readiness.ok) {
    console.error("\nShared X readiness failed.");
    process.exit(1);
  }
  console.log("\nShared X readiness verified.");
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
