#!/usr/bin/env node
/**
 * Safely retire the legacy shared `default` workspace.
 *
 * Strategy:
 *   1. Verify the shared default workspace has exactly one owner.
 *   2. Verify only that owner shows ownership signals inside the workspace.
 *   3. Rename the existing default workspace to the owner's real company/workspace.
 *   4. Remove accepted non-owner memberships from that workspace.
 *   5. Create fresh isolated workspaces for those legacy members.
 *
 * This script defaults to dry-run. Use `--apply` to execute after reviewing the
 * printed plan and preconditions.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  settings: Record<string, unknown>;
}

interface LegacyMemberRow {
  accepted_at: string;
  email: string;
  role: "owner" | "admin" | "member";
  user_id: string;
  has_channel_account: boolean;
  has_event_activity: boolean;
  has_tracked_company: boolean;
  has_decision_activity: boolean;
}

interface OwnerProfileRow {
  company_name: string | null;
  company_domain: string | null;
  website_url: string | null;
}

interface WorkspaceCreation {
  email: string;
  name: string;
  settings: Record<string, unknown>;
  slug: string;
  user_id: string;
}

interface RepairSnapshot {
  defaultWorkspace: WorkspaceRow | null;
  existingSlugs: string[];
  legacyMembers: LegacyMemberRow[];
  ownerProfile: OwnerProfileRow | null;
  ownerNonDefaultWorkspaceCount: number;
}

interface RepairActionPlan {
  ok: boolean;
  blockers: string[];
  summary: {
    defaultWorkspaceId: string;
    legacyMemberCount: number;
    ownerEmail: string;
    ownerTargetName: string;
    ownerTargetSlug: string;
  } | null;
  dryRunSql: string[];
  workspaceCreations: WorkspaceCreation[];
}

async function loadSnapshot(client: Client): Promise<RepairSnapshot> {
  const defaultWorkspace = (
    await client.query<WorkspaceRow>(`
      select id, slug::text as slug, name, plan, settings
        from workspaces
       where slug = 'default'
       limit 1
    `)
  ).rows[0] ?? null;

  const existingSlugs = (
    await client.query<{ slug: string }>(`
      select slug::text as slug
        from workspaces
    `)
  ).rows.map((row) => row.slug);

  if (!defaultWorkspace) {
    return {
      defaultWorkspace: null,
      existingSlugs,
      legacyMembers: [],
      ownerProfile: null,
      ownerNonDefaultWorkspaceCount: 0,
    };
  }

  const legacyMembers = (
    await client.query<LegacyMemberRow>(`
      with default_members as (
        select
          wm.user_id::text as user_id,
          lower(u.email) as email,
          wm.role::text as role,
          wm.accepted_at
        from workspace_members wm
        join auth.users u on u.id = wm.user_id
        where wm.workspace_id = $1
          and wm.accepted_at is not null
      ),
      account_users as (
        select distinct user_id::text as user_id
          from channel_accounts
         where workspace_id = $1
           and user_id is not null
      ),
      event_users as (
        select distinct producer_ref as user_id
          from events
         where workspace_id = $1
           and producer_ref ~* '^[0-9a-f-]{36}$'
      ),
      tracked_users as (
        select distinct added_by::text as user_id
          from workspace_tracked_companies
         where workspace_id = $1
      ),
      decision_users as (
        select distinct decided_by::text as user_id
          from workflow_approvals
         where workspace_id = $1
           and decided_by is not null
      )
      select
        dm.user_id,
        dm.email,
        dm.role::text as role,
        dm.accepted_at::text as accepted_at,
        (au.user_id is not null) as has_channel_account,
        (eu.user_id is not null) as has_event_activity,
        (tu.user_id is not null) as has_tracked_company,
        (du.user_id is not null) as has_decision_activity
      from default_members dm
      left join account_users au on au.user_id = dm.user_id
      left join event_users eu on eu.user_id = dm.user_id
      left join tracked_users tu on tu.user_id = dm.user_id
      left join decision_users du on du.user_id = dm.user_id
      order by dm.email
    `, [defaultWorkspace.id])
  ).rows;

  const owner = legacyMembers.find((member) => member.role === "owner");
  const ownerProfile = owner
    ? (
      await client.query<OwnerProfileRow>(`
        select
          name as company_name,
          domain::text as company_domain,
          properties->>'website_url' as website_url
        from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc, created_at desc
        limit 1
      `, [defaultWorkspace.id])
    ).rows[0] ?? null
    : null;

  const ownerNonDefaultWorkspaceCount = owner
    ? Number((
      await client.query<{ count: string }>(`
        select count(*)::text as count
          from workspace_members wm
          join workspaces w on w.id = wm.workspace_id
         where wm.user_id = $1::uuid
           and wm.accepted_at is not null
           and w.id <> $2::uuid
           and w.archived_at is null
      `, [owner.user_id, defaultWorkspace.id])
    ).rows[0]?.count ?? "0")
    : 0;

  return {
    defaultWorkspace,
    existingSlugs,
    legacyMembers,
    ownerProfile,
    ownerNonDefaultWorkspaceCount,
  };
}

export function buildRepairPlan(snapshot: RepairSnapshot): RepairActionPlan {
  const blockers: string[] = [];
  if (!snapshot.defaultWorkspace) {
    return {
      ok: false,
      blockers: ["Legacy shared default workspace does not exist."],
      summary: null,
      dryRunSql: [],
      workspaceCreations: [],
    };
  }

  const owners = snapshot.legacyMembers.filter((member) => member.role === "owner");
  if (owners.length !== 1) {
    blockers.push(`Expected exactly one default-workspace owner, found ${owners.length}.`);
  }
  const owner = owners[0] ?? null;
  if (!owner) {
    return {
      ok: false,
      blockers,
      summary: null,
      dryRunSql: [],
      workspaceCreations: [],
    };
  }

  if (snapshot.ownerNonDefaultWorkspaceCount > 0) {
    blockers.push(
      `Owner ${owner.email} already has ${snapshot.ownerNonDefaultWorkspaceCount} non-default accepted workspace(s); auto-rename is unsafe.`,
    );
  }

  const nonOwnerActivity = snapshot.legacyMembers.filter((member) =>
    member.role !== "owner" && (
      member.has_channel_account ||
      member.has_event_activity ||
      member.has_tracked_company ||
      member.has_decision_activity
    )
  );
  if (nonOwnerActivity.length > 0) {
    blockers.push(
      `Non-owner legacy members still show ownership signals: ${nonOwnerActivity.map((member) => member.email).join(", ")}`,
    );
  }

  const targetIdentity = ownerTargetIdentity(
    owner.email,
    snapshot.ownerProfile,
    snapshot.existingSlugs,
    snapshot.defaultWorkspace.slug,
  );

  const copiedBillingOverride = deepClone(
    readObject(snapshot.defaultWorkspace.settings.billing_override) ?? null,
  );

  const workspaceCreations = snapshot.legacyMembers
    .filter((member) => member.role !== "owner")
    .map((member) => {
      const identity = memberTargetIdentity(
        member.email,
        snapshot.existingSlugs,
        targetIdentity.slug,
      );
      return {
        email: member.email,
        user_id: member.user_id,
        name: identity.name,
        slug: identity.slug,
        settings: {
          mode: "product-activation",
          activated_from: "legacy-default-migration",
          legacy_default_migration: {
            source_workspace_id: snapshot.defaultWorkspace!.id,
            migrated_at: "NOW()",
          },
          ...(copiedBillingOverride ? { billing_override: copiedBillingOverride } : {}),
        },
      };
    });

  const dryRunSql = [
    `-- Rename shared default workspace in-place for owner ${owner.email}`,
    `update workspaces set slug = '${targetIdentity.slug}', name = '${sqlString(targetIdentity.name)}' where id = '${snapshot.defaultWorkspace.id}';`,
    `-- Remove accepted non-owner memberships from the renamed owner workspace`,
    `delete from workspace_members where workspace_id = '${snapshot.defaultWorkspace.id}' and accepted_at is not null and role <> 'owner';`,
    ...workspaceCreations.flatMap((workspace) => [
      `-- Create isolated workspace for ${workspace.email}`,
      `insert into workspaces (id, slug, name, plan, settings) values ('<generated-uuid>', '${workspace.slug}', '${sqlString(workspace.name)}', '${snapshot.defaultWorkspace!.plan}', '<settings-json>');`,
      `insert into workspace_members (workspace_id, user_id, role, invited_at, accepted_at) values ('<generated-uuid>', '${workspace.user_id}', 'owner', now(), now());`,
    ]),
  ];

  return {
    ok: blockers.length === 0,
    blockers,
    summary: {
      defaultWorkspaceId: snapshot.defaultWorkspace.id,
      legacyMemberCount: snapshot.legacyMembers.length,
      ownerEmail: owner.email,
      ownerTargetName: targetIdentity.name,
      ownerTargetSlug: targetIdentity.slug,
    },
    dryRunSql,
    workspaceCreations,
  };
}

async function applyRepairPlan(
  client: Client,
  snapshot: RepairSnapshot,
  plan: RepairActionPlan,
): Promise<void> {
  if (!plan.ok || !snapshot.defaultWorkspace || !plan.summary) {
    throw new Error("Cannot apply an invalid repair plan.");
  }
  const owner = snapshot.legacyMembers.find((member) => member.role === "owner");
  if (!owner) throw new Error("Owner missing during apply.");

  const migratedAt = new Date().toISOString();
  await client.query("begin");
  try {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      "repair-legacy-default-workspace",
    ]);

    const liveSnapshot = await loadSnapshot(client);
    const livePlan = buildRepairPlan(liveSnapshot);
    if (!livePlan.ok) {
      throw new Error(`Live preconditions changed: ${livePlan.blockers.join(" | ")}`);
    }
    if (repairPlanSignature(livePlan) !== repairPlanSignature(plan)) {
      throw new Error("Live repair plan drifted from the reviewed dry-run.");
    }

    const mergedOwnerSettings = {
      ...snapshot.defaultWorkspace.settings,
      legacy_default_migration: {
        source_slug: "default",
        retired_shared_members_at: migratedAt,
        retired_shared_member_count: plan.workspaceCreations.length,
      },
    };

    await client.query(
      `update workspaces
          set slug = $2,
              name = $3,
              settings = $4::jsonb
        where id = $1`,
      [
        snapshot.defaultWorkspace.id,
        plan.summary.ownerTargetSlug,
        plan.summary.ownerTargetName,
        JSON.stringify(mergedOwnerSettings),
      ],
    );

    await client.query(
      `delete from workspace_members
        where workspace_id = $1
          and accepted_at is not null
          and role <> 'owner'`,
      [snapshot.defaultWorkspace.id],
    );

    for (const workspace of plan.workspaceCreations) {
      const workspaceId = randomUUID();
      await client.query(
        `insert into workspaces (id, slug, name, plan, settings)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          workspaceId,
          workspace.slug,
          workspace.name,
          snapshot.defaultWorkspace.plan,
          JSON.stringify({
            ...workspace.settings,
            legacy_default_migration: {
              source_workspace_id: snapshot.defaultWorkspace.id,
              migrated_at: migratedAt,
              seeded_for_user_id: workspace.user_id,
              seeded_for_email: workspace.email,
            },
          }),
        ],
      );
      await client.query(
        `insert into workspace_members (workspace_id, user_id, role, invited_at, accepted_at)
         values ($1, $2::uuid, 'owner', now(), now())`,
        [workspaceId, workspace.user_id],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function ownerTargetIdentity(
  ownerEmail: string,
  profile: OwnerProfileRow | null,
  existingSlugs: string[],
  currentSlug: string,
): { name: string; slug: string } {
  const profileName = clean(profile?.company_name);
  const profileDomain = clean(profile?.company_domain) ?? domainFromUrl(profile?.website_url);
  const name = profileName ?? titleCase(ownerEmail.split("@")[0] ?? "Workspace");
  const baseSlug =
    slugify(profileName ?? domainStem(profileDomain) ?? ownerEmail.split("@")[0] ?? "workspace") ||
    "workspace";
  return {
    name: profileName ? `${profileName} GTM` : `${name} Workspace`,
    slug: uniqueSlug(existingSlugs, baseSlug === currentSlug ? `${baseSlug}-gtm` : baseSlug, currentSlug),
  };
}

function memberTargetIdentity(
  email: string,
  existingSlugs: string[],
  reservedSlug: string,
): { name: string; slug: string } {
  const local = email.split("@")[0] ?? "workspace";
  const baseName = titleCase(local.replace(/[._-]+/g, " "));
  const baseSlug = slugify(`${local}-workspace`) || "workspace";
  return {
    name: `${baseName} Workspace`,
    slug: uniqueSlug(existingSlugs, baseSlug, reservedSlug),
  };
}

function uniqueSlug(existing: string[], preferred: string, currentSlug?: string): string {
  const used = new Set(existing.filter((slug) => slug !== currentSlug));
  if (!used.has(preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${preferred}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a unique slug for ${preferred}`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function domainFromUrl(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainStem(value: string | null | undefined): string | null {
  const domain = clean(value)?.replace(/^www\./, "").toLowerCase();
  if (!domain) return null;
  const [firstLabel] = domain.split(".");
  return clean(firstLabel);
}

function deepClone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function repairPlanSignature(plan: RepairActionPlan): string {
  return JSON.stringify({
    ok: plan.ok,
    blockers: plan.blockers,
    summary: plan.summary,
    workspaceCreations: plan.workspaceCreations.map((workspace) => ({
      email: workspace.email,
      user_id: workspace.user_id,
      name: workspace.name,
      slug: workspace.slug,
    })),
  });
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
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const snapshot = await loadSnapshot(client);
    const plan = buildRepairPlan(snapshot);

    console.log("Legacy default workspace repair");
    if (!snapshot.defaultWorkspace) {
      console.log("FAIL No shared default workspace exists.");
      process.exitCode = 1;
      return;
    }

    if (plan.summary) {
      console.log(`Workspace: ${snapshot.defaultWorkspace.id} (${snapshot.defaultWorkspace.slug} / ${snapshot.defaultWorkspace.name})`);
      console.log(`Owner target: ${plan.summary.ownerEmail} -> ${plan.summary.ownerTargetSlug} / ${plan.summary.ownerTargetName}`);
      console.log(`Legacy members: ${plan.summary.legacyMemberCount}`);
      console.log(`New isolated workspaces: ${plan.workspaceCreations.length}`);
    }

    if (!plan.ok) {
      console.log("Blockers:");
      for (const blocker of plan.blockers) console.log(`- ${blocker}`);
      process.exitCode = 1;
      return;
    }

    console.log("Dry-run actions:");
    for (const statement of plan.dryRunSql) console.log(statement);

    if (!apply) {
      console.log("\nDry run only. Re-run with --apply to execute.");
      return;
    }

    await applyRepairPlan(client, snapshot, plan);
    console.log("\nApply complete.");
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(
      `FAIL repair-legacy-default-workspace — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
