import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Test-only fixture for the legacy Series A cold-open workflow tests. Product
 * setup must use typed configuration events/projectors via bootstrapWorkspace.
 */

export interface SeedMayaResult {
  rep_id: string;
  channel_account_id: string;
  sending_domain_id: string;
  sending_domain: string;
}

export interface SeedMayaOptions {
  sending_domain?: string;
  daily_cap?: number;
}

export async function seedMayaForDemo(
  pool: Pool,
  workspace_id: string,
  opts: SeedMayaOptions = {},
): Promise<SeedMayaResult> {
  const sending_domain = opts.sending_domain ?? "go.bombsell.com";
  const daily_cap = opts.daily_cap ?? 50;

  const rep_id = randomUUID();
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona, channels, autonomy)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::text[], $8::jsonb)`,
    [
      rep_id,
      workspace_id,
      "Maya",
      "sdr",
      "active",
      JSON.stringify({
        voice:
          "warm, direct, founder-to-founder. Specific over clever. Short paragraphs. Lowercase subject lines.",
        story: "Outbound SDR for AI infra startups talking to Series A founders.",
        kpis: ["positive replies", "meetings booked"],
        do_not: [
          "use the word synergy",
          'open with "Hope you are well"',
          "use exclamation marks",
          "claim to have read articles you haven't",
        ],
        samples: [],
      }),
      ["email"],
      JSON.stringify({
        channels: {
          email: { daily_cap, approval: "approve_first" },
        },
        global: { max_concurrent_conversations: 50 },
      }),
    ],
  );

  const channel_account_id = randomUUID();
  await pool.query(
    `insert into channel_accounts (
        id, workspace_id, kind, display_name, status, daily_cap
      ) values ($1, $2, 'email_domain', 'maya', 'connected', $3)`,
    [channel_account_id, workspace_id, daily_cap],
  );

  const sending_domain_id = randomUUID();
  await pool.query(
    `insert into sending_domains (
        id, workspace_id, channel_account_id, domain,
        spf_verified, dkim_verified, dmarc_verified,
        warmup_state, warmup_day, current_daily_cap, target_daily_cap
      ) values ($1, $2, $3, $4, true, true, true, 'warmed', 30, $5, $5)`,
    [sending_domain_id, workspace_id, channel_account_id, sending_domain, daily_cap],
  );

  return { rep_id, channel_account_id, sending_domain_id, sending_domain };
}
