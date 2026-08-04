import type { Pool } from "pg";
import {
  configureActivationSetup,
  configureDefaultSignalAggregator,
  configureWorkspaceCompanyProfile,
  verifiedProductWorkspaceSession,
} from "./app.ts";

interface WorkspaceBootstrapProfile {
  name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  properties: Record<string, unknown>;
}

interface WorkspaceLeadBootstrapState {
  has_profile: boolean;
  has_icp: boolean;
  has_rep: boolean;
  has_play: boolean;
  has_source: boolean;
}

/**
 * Idempotent per-workspace lead activation repair. If onboarding stopped after
 * creating only part of the activation graph, finish the missing profile,
 * ICP, Rep, Play, and free signal sources through the normal typed event
 * projectors. A verified custom-domain owner email is the only fallback used
 * when the company profile itself is missing; public mailbox domains are
 * deliberately rejected rather than guessed.
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
    const state = await readWorkspaceLeadBootstrapState(pool, workspace_id);
    let profile = await readWorkspaceCompanyProfile(pool, workspace_id);
    const session = verifiedProductWorkspaceSession({
      workspace_id,
      user_id,
    });

    if (!profile) {
      profile = await inferFallbackWorkspaceProfile(pool, workspace_id);
      if (!profile) {
        return { seeded: false, reason: "no_profile", source_count: 0 };
      }
      await configureWorkspaceCompanyProfile(
        {
          company_name: profile.name,
          website_url: profile.website_url!,
          industry: profile.industry,
          description: profile.description,
          profile_source: "fallback",
        },
        session,
      );
    }

    if (!state.has_icp || !state.has_rep || !state.has_play) {
      await configureActivationSetup(
        {
          rep: {
            name: "Outbound agent",
            voice: "Clear, specific, low-hype, and useful.",
            story: `Turns fresh public movement around ${profile.name} into careful founder-led conversations.`,
            daily_cap: 15,
            // Recovery must never silently authorize a send.
            approval: "always",
          },
          icp: {
            name: `${profile.name} timing signals`,
            description: `${profile.description ?? `Public momentum around ${profile.name}.`} Match companies showing fresh public momentum, hiring, launches, funding, or competitive movement relevant to this market.`,
            signal_kind: "press_mention",
            match_threshold: 0.6,
            nice_to_haves: [
              "Fresh enough to justify outreach",
              "Clear buying committee",
            ],
            enabled: true,
          },
          play: {
            name: "Press mention Signal Email",
            daily_cap: 15,
            approval: "always",
          },
        },
        session,
      );
    }

    if (state.has_source) {
      return { seeded: true, reason: "activation_repaired", source_count: 0 };
    }

    const properties = profile.properties;
    const result = await configureDefaultSignalAggregator(
      {
        company_name: profile.name,
        website_url: profile.website_url,
        industry: profile.industry,
        description: profile.description,
        signal_keywords: readString(properties, "signal_keywords"),
        competitor_watchlist: readString(properties, "competitor_watchlist"),
        linkedin_signal_behaviors: readString(
          properties,
          "linkedin_signal_behaviors",
        ),
        signal_kind: "press_mention",
      },
      session,
    );
    return {
      seeded: true,
      reason: "activation_repaired",
      source_count: result.source_count,
    };
  } catch (error) {
    // Never let a self-heal failure surface on the dashboard request.
    console.error("[self-heal] lead activation repair failed", error);
    return { seeded: false, reason: "error", source_count: 0 };
  }
}

async function readWorkspaceLeadBootstrapState(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceLeadBootstrapState> {
  const { rows } = await pool.query<WorkspaceLeadBootstrapState>(
    `select exists (
       select 1 from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
     ) as has_profile,
     exists (
       select 1 from workspace_icps
        where workspace_id = $1 and enabled
     ) as has_icp,
     exists (
       select 1 from reps
        where workspace_id = $1 and status = 'active'
     ) as has_rep,
     exists (
       select 1 from plays
        where workspace_id = $1 and status = 'active'
     ) as has_play,
     exists (
       select 1
         from graph_sources gs
         join workspace_source_configs wsc
           on wsc.workspace_id = gs.workspace_id and wsc.source_id = gs.id
        where gs.workspace_id = $1 and gs.enabled and wsc.enabled
     ) as has_source`,
    [workspace_id],
  );
  return rows[0] ?? {
    has_profile: false,
    has_icp: false,
    has_rep: false,
    has_play: false,
    has_source: false,
  };
}

async function readWorkspaceCompanyProfile(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceBootstrapProfile | null> {
  const { rows } = await pool.query<{
    name: string | null;
    domain: string | null;
    website_url: string | null;
    industry: string | null;
    description: string | null;
    properties: Record<string, unknown> | null;
  }>(
    `select name,
            domain::text as domain,
            properties->>'website_url' as website_url,
            industry,
            description,
            properties
       from graph_companies
      where workspace_id = $1
        and properties->>'profile_role' = 'workspace_company'
      order by updated_at desc, created_at desc
      limit 1`,
    [workspace_id],
  );
  const row = rows[0];
  return row?.name
    ? {
        name: row.name,
        domain: row.domain,
        website_url: row.website_url ?? (row.domain ? `https://${row.domain}` : null),
        industry: row.industry,
        description: row.description,
        properties: row.properties ?? {},
      }
    : null;
}

async function inferFallbackWorkspaceProfile(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceBootstrapProfile | null> {
  const { rows } = await pool.query<{
    owner_email: string | null;
  }>(
    `select lower(u.email) as owner_email
       from workspace_members wm
       join auth.users u on u.id = wm.user_id
      where wm.workspace_id = $1
        and wm.role = 'owner'
        and wm.accepted_at is not null
      order by wm.accepted_at asc
      limit 1`,
    [workspace_id],
  );
  const email = rows[0]?.owner_email ?? "";
  const domain = customEmailDomain(email);
  if (!domain) return null;
  const name = titleizeDomain(domain);
  return {
    name,
    domain,
    website_url: `https://${domain}`,
    industry: null,
    description: `Public website profile for ${name}. Bombsell could not read enough website content automatically, so this setup starts from the domain and should be reviewed before launch.`,
    properties: {},
  };
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

function customEmailDomain(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain) || !domain.includes(".")) {
    return null;
  }
  return domain;
}

function titleizeDomain(domain: string): string {
  const stem = domain.split(".")[0]?.replace(/[-_]+/g, " ") || "Workspace";
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readString(
  properties: Record<string, unknown>,
  key: string,
): string | null {
  const value = properties[key];
  if (typeof value === "string" && value.trim()) return value;
  return null;
}
