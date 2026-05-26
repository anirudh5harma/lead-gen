import type { Pool } from "pg";
import { tryGetPool } from "../substrate/storage/index.ts";
import { resolveProductSubstrateMode } from "./substrate.ts";

export type ProductReadinessStatus = "ok" | "degraded" | "unconfigured";

export interface ProductReadinessCheck {
  name: string;
  status: ProductReadinessStatus;
  detail?: string;
}

export interface ProductReadiness {
  service: "bombsell-product";
  status: ProductReadinessStatus;
  ready: boolean;
  checked_at: string;
  checks: ProductReadinessCheck[];
}

const REQUIRED_TABLES = [
  "workspaces",
  "workspace_members",
  "events",
  "workflow_runs",
  "workflow_steps",
  "workflow_checkpoints",
  "workflow_approvals",
  "graph_sources",
  "graph_edges",
  "signals",
  "conversations",
  "messages",
  "reps",
  "plays",
  "play_runs",
  "outcomes",
  "channel_accounts",
  "sending_domains",
  "workspace_llm_usage",
];

const REQUIRED_MIGRATIONS = [
  "014_signal_novelty_uniqueness.sql",
  "015_workspace_llm_usage.sql",
  "016_workflow_run_leases.sql",
  "017_event_idempotency_keys.sql",
];

export async function checkProductReadiness(
  pool: Pool | null = tryGetPool(),
): Promise<ProductReadiness> {
  const checks: ProductReadinessCheck[] = [];
  if (!pool) {
    checks.push({
      name: "database",
      status: "unconfigured",
      detail: "DATABASE_URL is not configured",
    });
    return formatReadiness(checks);
  }

  try {
    const substrate = resolveProductSubstrateMode();
    checks.push(
      substrate.status === "ok"
        ? {
            name: "substrate",
            status: "ok",
            detail: substrate.detail,
          }
        : {
            name: "substrate",
            status: "degraded",
            detail: substrate.detail,
          },
    );

    await pool.query("select 1");
    checks.push({ name: "database", status: "ok" });

    const missingTables = await missingRequiredTables(pool);
    checks.push(
      missingTables.length === 0
        ? { name: "schema.tables", status: "ok" }
        : {
            name: "schema.tables",
            status: "degraded",
            detail: `Missing tables: ${missingTables.join(", ")}`,
          },
    );

    const missingMigrations = await missingRequiredMigrations(pool);
    checks.push(
      missingMigrations.length === 0
        ? { name: "schema.migrations", status: "ok" }
        : {
            name: "schema.migrations",
            status: "degraded",
            detail: `Missing migrations: ${missingMigrations.join(", ")}`,
          },
    );
  } catch (err) {
    checks.push({
      name: "readiness",
      status: "degraded",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return formatReadiness(checks);
}

async function missingRequiredTables(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `select required.name
     from unnest($1::text[]) as required(name)
     where not exists (
       select 1
       from information_schema.tables
       where table_schema = current_schema()
         and table_name = required.name
         and table_type = 'BASE TABLE'
     )
     order by required.name`,
    [REQUIRED_TABLES],
  );
  return result.rows.map((row) => row.name);
}

async function missingRequiredMigrations(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ filename: string }>(
    `select required.filename
     from unnest($1::text[]) as required(filename)
     where not exists (
       select 1
       from schema_migrations sm
       where sm.filename = required.filename
     )
     order by required.filename`,
    [REQUIRED_MIGRATIONS],
  );
  return result.rows.map((row) => row.filename);
}

function formatReadiness(checks: ProductReadinessCheck[]): ProductReadiness {
  const status = checks.some((check) => check.status === "degraded")
    ? "degraded"
    : checks.some((check) => check.status === "unconfigured")
      ? "unconfigured"
      : "ok";
  return {
    service: "bombsell-product",
    status,
    ready: status === "ok",
    checked_at: new Date().toISOString(),
    checks,
  };
}
