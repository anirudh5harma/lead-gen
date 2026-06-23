#!/usr/bin/env node
/**
 * Verify that workspace tenancy is not still relying on the legacy shared
 * `default` workspace migration path.
 *
 * This probe is read-only. It inspects auth identities plus accepted workspace
 * memberships and fails when confirmed users are still co-tenanted only through
 * the shared default workspace.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export interface WorkspaceIsolationStep {
  label: string;
  status: "ok" | "fail" | "warn";
  detail?: string;
}

export interface WorkspaceIsolationSnapshot {
  duplicateEmails: Array<{ email: string; user_count: number }>;
  sharedDefaultWorkspace: {
    accepted_members: number;
    non_owner_members: number;
  };
  legacyUsersNeedingMigration: Array<{
    email: string;
    default_memberships: number;
    non_default_memberships: number;
  }>;
  totalUsers: number;
  distinctEmails: number;
  sharedNonDefaultWorkspaces: number;
}

export interface WorkspaceIsolationResult {
  ok: boolean;
  steps: WorkspaceIsolationStep[];
  snapshot: WorkspaceIsolationSnapshot;
}

export interface WorkspaceIsolationProbeOptions {
  env?: Record<string, string | undefined>;
  pool?: Pick<Pool, "query" | "end">;
}

interface CountRow {
  total_users: string | number;
  distinct_emails: string | number;
}

interface DuplicateEmailRow {
  email: string;
  user_count: string | number;
}

interface SharedDefaultRow {
  accepted_members: string | number;
  non_owner_members: string | number;
}

interface LegacyUserRow {
  email: string;
  default_memberships: string | number;
  non_default_memberships: string | number;
}

interface SharedWorkspaceRow {
  workspace_count: string | number;
}

export function assessWorkspaceIsolation(
  snapshot: WorkspaceIsolationSnapshot,
): WorkspaceIsolationResult {
  const steps: WorkspaceIsolationStep[] = [];
  steps.push({
    label: "workspace isolation: unique auth emails",
    status:
      snapshot.duplicateEmails.length === 0 &&
        snapshot.totalUsers === snapshot.distinctEmails
        ? "ok"
        : "fail",
    detail:
      snapshot.duplicateEmails.length === 0
        ? `${snapshot.totalUsers} auth user(s), ${snapshot.distinctEmails} distinct email(s)`
        : snapshot.duplicateEmails
          .map((row) => `${row.email} (${row.user_count})`)
          .join(", "),
  });

  steps.push({
    label: "workspace isolation: shared default workspace retired",
    status: snapshot.sharedDefaultWorkspace.non_owner_members === 0 ? "ok" : "fail",
    detail:
      snapshot.sharedDefaultWorkspace.non_owner_members === 0
        ? "No accepted non-owner members remain on the legacy default workspace"
        : `${snapshot.sharedDefaultWorkspace.accepted_members} accepted member(s) still sit on default; ${snapshot.sharedDefaultWorkspace.non_owner_members} need migration`,
  });

  steps.push({
    label: "workspace isolation: legacy users migrated",
    status: snapshot.legacyUsersNeedingMigration.length === 0 ? "ok" : "fail",
    detail:
      snapshot.legacyUsersNeedingMigration.length === 0
        ? "Every confirmed user has a non-default accepted workspace"
        : snapshot.legacyUsersNeedingMigration
          .map((row) => row.email)
          .join(", "),
  });

  steps.push({
    label: "workspace isolation: shared non-default workspaces",
    status: snapshot.sharedNonDefaultWorkspaces === 0 ? "ok" : "warn",
    detail:
      snapshot.sharedNonDefaultWorkspaces === 0
        ? "No shared non-default workspaces detected"
        : `${snapshot.sharedNonDefaultWorkspaces} shared non-default workspace(s) detected; review only if single-user isolation is expected`,
  });

  return {
    ok: steps.every((step) => step.status !== "fail"),
    steps,
    snapshot,
  };
}

export async function runWorkspaceIsolationProbe(
  opts: WorkspaceIsolationProbeOptions = {},
): Promise<WorkspaceIsolationResult> {
  const env = opts.env ?? process.env;
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl && !opts.pool) {
    return {
      ok: false,
      steps: [
        {
          label: "workspace isolation: database configured",
          status: "fail",
          detail: "DATABASE_URL is required to inspect auth identities and workspace memberships",
        },
      ],
      snapshot: {
        duplicateEmails: [],
        sharedDefaultWorkspace: {
          accepted_members: 0,
          non_owner_members: 0,
        },
        legacyUsersNeedingMigration: [],
        totalUsers: 0,
        distinctEmails: 0,
        sharedNonDefaultWorkspaces: 0,
      },
    };
  }

  const pool = opts.pool ?? new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  const shouldClose = !opts.pool;
  try {
    const countRows = await pool.query<CountRow>(`
      select
        count(*) as total_users,
        count(distinct lower(email)) as distinct_emails
      from auth.users
    `);
    const duplicateRows = await pool.query<DuplicateEmailRow>(`
      select lower(email) as email, count(*) as user_count
        from auth.users
       group by 1
      having count(*) > 1
       order by 2 desc, 1
    `);
    const sharedDefaultRows = await pool.query<SharedDefaultRow>(`
      select
        count(*) filter (where wm.accepted_at is not null) as accepted_members,
        count(*) filter (
          where wm.accepted_at is not null
            and wm.role <> 'owner'
        ) as non_owner_members
      from workspaces w
      left join workspace_members wm on wm.workspace_id = w.id
      where w.slug = 'default'
    `);
    const legacyUserRows = await pool.query<LegacyUserRow>(`
      select
        lower(u.email) as email,
        count(*) filter (
          where wm.accepted_at is not null
            and w.slug = 'default'
        ) as default_memberships,
        count(*) filter (
          where wm.accepted_at is not null
            and w.slug <> 'default'
        ) as non_default_memberships
      from auth.users u
      left join workspace_members wm on wm.user_id = u.id
      left join workspaces w on w.id = wm.workspace_id
      group by lower(u.email)
      having count(*) filter (
        where wm.accepted_at is not null
          and w.slug = 'default'
      ) > 0
         and count(*) filter (
           where wm.accepted_at is not null
             and w.slug <> 'default'
         ) = 0
      order by lower(u.email)
    `);
    const sharedWorkspaceRows = await pool.query<SharedWorkspaceRow>(`
      select count(*) as workspace_count
        from (
          select w.id
            from workspaces w
            join workspace_members wm on wm.workspace_id = w.id
           where w.slug <> 'default'
             and wm.accepted_at is not null
           group by w.id
          having count(*) > 1
        ) shared
    `);

    return assessWorkspaceIsolation({
      duplicateEmails: duplicateRows.rows.map((row) => ({
        email: row.email,
        user_count: asNumber(row.user_count),
      })),
      sharedDefaultWorkspace: {
        accepted_members: asNumber(sharedDefaultRows.rows[0]?.accepted_members ?? 0),
        non_owner_members: asNumber(sharedDefaultRows.rows[0]?.non_owner_members ?? 0),
      },
      legacyUsersNeedingMigration: legacyUserRows.rows.map((row) => ({
        email: row.email,
        default_memberships: asNumber(row.default_memberships),
        non_default_memberships: asNumber(row.non_default_memberships),
      })),
      totalUsers: asNumber(countRows.rows[0]?.total_users ?? 0),
      distinctEmails: asNumber(countRows.rows[0]?.distinct_emails ?? 0),
      sharedNonDefaultWorkspaces: asNumber(sharedWorkspaceRows.rows[0]?.workspace_count ?? 0),
    });
  } finally {
    if (shouldClose) await pool.end();
  }
}

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function loadDotenvLocal(): void {
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] == null) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotenvLocal();
  const result = await runWorkspaceIsolationProbe();
  console.log("Workspace isolation");
  for (const step of result.steps) {
    const label =
      step.status === "ok" ? "OK  " : step.status === "warn" ? "WARN" : "FAIL";
    console.log(`${label} ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(
      `FAIL verify:workspace-isolation — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
