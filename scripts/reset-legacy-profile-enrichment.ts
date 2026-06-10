#!/usr/bin/env node
/**
 * Remove legacy Exa profile enrichment from workspace company profiles.
 *
 * Manual company profile saves now clear this automatically. This script fixes
 * existing rows that still render stale Exa summaries/intelligence in the app.
 *
 * Usage:
 *   node --experimental-strip-types scripts/reset-legacy-profile-enrichment.ts --dry-run
 *   node --experimental-strip-types scripts/reset-legacy-profile-enrichment.ts --apply
 *   node --experimental-strip-types scripts/reset-legacy-profile-enrichment.ts --dry-run --reset-descriptions
 *   node --experimental-strip-types scripts/reset-legacy-profile-enrichment.ts --apply --reset-descriptions
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

interface ResetPreviewRow {
  workspace_profiles: string;
  with_exa_profile: string;
  descriptions_to_clear: string;
}

interface ResetResultRow {
  profiles_touched: string;
  exa_profiles_removed: string;
  descriptions_cleared: string;
}

loadDotenvLocal();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    if (args.dryRun) {
      const preview = await previewReset(pool, args.resetDescriptions);
      console.log(JSON.stringify({ ok: true, dry_run: true, ...preview }, null, 2));
      return;
    }

    const result = await applyReset(pool, args.resetDescriptions);
    console.log(JSON.stringify({ ok: true, dry_run: false, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

async function previewReset(pool: Pool, resetDescriptions: boolean) {
  const { rows } = await pool.query<ResetPreviewRow>(
    `with workspace_profiles as (
       select description, properties, provenance
         from graph_companies
        where properties->>'profile_role' = 'workspace_company'
     )
     select
       count(*)::text as workspace_profiles,
       count(*) filter (where properties ? 'exa_profile')::text as with_exa_profile,
       count(*) filter (
         where ${descriptionResetCondition(resetDescriptions)}
       )::text as descriptions_to_clear
      from workspace_profiles`,
  );
  return {
    workspace_profiles: Number(rows[0]?.workspace_profiles ?? 0),
    with_exa_profile: Number(rows[0]?.with_exa_profile ?? 0),
    descriptions_to_clear: Number(rows[0]?.descriptions_to_clear ?? 0),
  };
}

async function applyReset(pool: Pool, resetDescriptions: boolean) {
  const { rows } = await pool.query<ResetResultRow>(
    `with candidates as (
       select id,
              description,
              properties,
              provenance,
              properties ? 'exa_profile' as had_exa_profile,
              ${descriptionResetCondition(resetDescriptions)} as clear_description
         from graph_companies
        where properties->>'profile_role' = 'workspace_company'
          and (
            properties ? 'exa_profile'
            or ${descriptionResetCondition(resetDescriptions)}
          )
     ),
     updated as (
       update graph_companies gc
          set description = case when c.clear_description then null else gc.description end,
              properties = (gc.properties - 'exa_profile') || jsonb_build_object(
                'legacy_exa_profile_reset_at', now(),
                'legacy_exa_profile_reset_reason', 'manual_profile_is_authoritative'
              ),
              provenance = gc.provenance || jsonb_build_object(
                'legacy_exa_profile_reset_at', now(),
                'legacy_exa_profile_reset_reason', 'manual_profile_is_authoritative'
              ),
              updated_at = now()
         from candidates c
        where gc.id = c.id
        returning c.had_exa_profile, c.clear_description
     )
     select
       count(*)::text as profiles_touched,
       count(*) filter (where had_exa_profile)::text as exa_profiles_removed,
       count(*) filter (where clear_description)::text as descriptions_cleared
      from updated`,
  );
  return {
    profiles_touched: Number(rows[0]?.profiles_touched ?? 0),
    exa_profiles_removed: Number(rows[0]?.exa_profiles_removed ?? 0),
    descriptions_cleared: Number(rows[0]?.descriptions_cleared ?? 0),
  };
}

function descriptionResetCondition(resetDescriptions: boolean): string {
  if (resetDescriptions) return DESCRIPTION_PRESENT_CONDITION;
  return `properties ? 'exa_profile' and ${LEGACY_EXA_DESCRIPTION_CONDITION}`;
}

const DESCRIPTION_PRESENT_CONDITION = `
  description is not null
  and btrim(description) <> ''
`;

const LEGACY_EXA_DESCRIPTION_CONDITION = `
  description is not null
  and btrim(description) <> ''
  and (
    lower(coalesce(properties->>'profile_source', '')) in ('exa', 'exa_profile')
    or lower(coalesce(provenance->>'source', '')) in ('exa', 'exa_profile')
    or description = properties #>> '{exa_profile,summary}'
  )
`;

function parseArgs(argv: string[]): { dryRun: boolean; resetDescriptions: boolean } {
  const action = argv.find((arg) => arg === "--dry-run" || arg === "--apply");
  const resetDescriptions = argv.includes("--reset-descriptions");
  const valid =
    Boolean(action) &&
    argv.every((arg) => arg === "--dry-run" || arg === "--apply" || arg === "--reset-descriptions") &&
    argv.filter((arg) => arg === "--dry-run" || arg === "--apply").length === 1;
  if (!valid) {
    throw new Error(
      "Usage: reset-legacy-profile-enrichment.ts --dry-run|--apply [--reset-descriptions]",
    );
  }
  return { dryRun: action === "--dry-run", resetDescriptions };
}

function loadDotenvLocal(): void {
  if (!fs.existsSync(".env.local")) return;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
