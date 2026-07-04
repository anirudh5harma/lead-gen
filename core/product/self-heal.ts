import type { Pool } from "pg";
import { hasEnabledSignalSource } from "../ingest/sources.ts";
import {
  configureDefaultSignalAggregator,
  verifiedProductWorkspaceSession,
} from "./app.ts";

/**
 * Idempotent per-workspace default-source seeding. If the workspace has zero
 * enabled signal sources (e.g. onboarding activation died mid-run before the
 * source projector ran), derive company inputs from the workspace_company row
 * and call `configureDefaultSignalAggregator`.
 *
 * Safe to call on every dashboard load — the underlying configure path is
 * upsert-based via typed events. Fire-and-forget from the layout; do not
 * await its result on the request path.
 */
export async function ensureDefaultSignalSourcesForWorkspace(
  pool: Pool,
  workspace_id: string,
  user_id: string,
): Promise<{ seeded: boolean; reason: string; source_count: number }> {
  try {
    if (await hasEnabledSignalSource(pool, workspace_id)) {
      return { seeded: false, reason: "already_present", source_count: 0 };
    }
    const { rows } = await pool.query<{
      name: string | null;
      domain: string | null;
      industry: string | null;
      description: string | null;
      properties: Record<string, unknown> | null;
    }>(
      `select name, domain::text as domain, industry, description, properties
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc, created_at desc
        limit 1`,
      [workspace_id],
    );
    const row = rows[0];
    if (!row?.name) {
      return { seeded: false, reason: "no_profile", source_count: 0 };
    }
    const properties = row.properties ?? {};
    const session = verifiedProductWorkspaceSession({
      workspace_id,
      user_id,
    });
    const result = await configureDefaultSignalAggregator(
      {
        company_name: row.name,
        website_url: row.domain ? `https://${row.domain}` : null,
        industry: row.industry ?? null,
        description: row.description ?? null,
        signal_keywords: readString(properties, "signal_keywords"),
        competitor_watchlist: readString(properties, "competitor_watchlist"),
        linkedin_signal_behaviors: readString(
          properties,
          "linkedin_signal_behaviors",
        ),
      },
      session,
    );
    return {
      seeded: true,
      reason: "seeded",
      source_count: result.source_count,
    };
  } catch (error) {
    // Never let a self-heal failure surface on the dashboard request.
    console.error("[self-heal] default source seed failed", error);
    return { seeded: false, reason: "error", source_count: 0 };
  }
}

function readString(
  properties: Record<string, unknown>,
  key: string,
): string | null {
  const value = properties[key];
  if (typeof value === "string" && value.trim()) return value;
  return null;
}
