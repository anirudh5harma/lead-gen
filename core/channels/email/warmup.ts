import type { Pool } from "pg";

/**
 * Owned-domain warmup state machine. See db/migrations/011_channel_accounts.sql
 * for the `sending_domains` schema.
 *
 * Standard SES-style warmup curve: roughly doubling per day from a small
 * seed, capping at the workspace's `target_daily_cap` after ~14 days. The
 * curve is intentionally conservative — burning a brand-new domain by
 * blasting day-one traffic is the single most common cause of "the cold
 * email channel stopped working last week."
 *
 * States (from migration 011):
 *   unverified  → DNS records not yet checked
 *   verifying   → at least one DNS check in flight
 *   warming     → all 3 verified; walking up the daily-cap curve
 *   warmed      → at target_daily_cap; healthy
 *   degraded    → bounce/complaint thresholds tripped; throttled
 *   frozen      → severe thresholds tripped; no traffic until manual review
 *
 * This module owns: the curve, the "can I send via this domain?" gate, and
 * the daily tick that advances warmup_day / current_daily_cap and reacts
 * to bounce/complaint rates.
 */

export type WarmupState =
  | "unverified"
  | "verifying"
  | "warming"
  | "warmed"
  | "degraded"
  | "frozen";

export interface SendingDomainRow {
  id: string;
  workspace_id: string;
  domain: string;
  spf_verified: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  warmup_state: WarmupState;
  warmup_day: number;
  current_daily_cap: number;
  target_daily_cap: number;
  bounce_rate_24h: number;
  complaint_rate_24h: number;
}

export interface WarmupThresholds {
  /** Bounce rate above which we degrade. Default 5%. */
  degradeBounceRate: number;
  /** Complaint rate above which we degrade. Default 0.1%. */
  degradeComplaintRate: number;
  /** Bounce rate above which we freeze. Default 10%. */
  freezeBounceRate: number;
  /** Complaint rate above which we freeze. Default 0.5%. */
  freezeComplaintRate: number;
  /** Day at which a healthy domain promotes warming → warmed. Default 14. */
  warmedDay: number;
}

export const DEFAULT_WARMUP_THRESHOLDS: WarmupThresholds = {
  degradeBounceRate: 0.05,
  degradeComplaintRate: 0.001,
  freezeBounceRate: 0.1,
  freezeComplaintRate: 0.005,
  warmedDay: 14,
};

/**
 * Standard SES-style warmup curve: 50, 100, 200, 400, ... doubling until
 * `target_daily_cap`. After `warmedDay`, the domain is "warmed" and the
 * cap equals target.
 */
export function curveDailyCap(day: number, target: number): number {
  if (day < 1) return 0;
  const seed = 50;
  const computed = seed * 2 ** (day - 1);
  return Math.min(target, computed);
}

export async function getSendingDomain(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<SendingDomainRow | null> {
  const { rows } = await pool.query<SendingDomainRow>(
    `select id, workspace_id, domain,
            spf_verified, dkim_verified, dmarc_verified,
            warmup_state, warmup_day,
            current_daily_cap, target_daily_cap,
            bounce_rate_24h::float8 as bounce_rate_24h,
            complaint_rate_24h::float8 as complaint_rate_24h
       from sending_domains
      where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ?? null;
}

/**
 * Can we send one more email via this domain right now? Considers state,
 * verification, and the current daily cap (against today's send counter
 * — which lives on the channel_account, not the domain, since one domain
 * can back multiple accounts in future).
 */
export function canSendVia(
  domain: SendingDomainRow,
  current_today_count = 0,
): { allowed: boolean; reason?: string } {
  if (!domain.spf_verified || !domain.dkim_verified || !domain.dmarc_verified) {
    return { allowed: false, reason: "domain_not_ready" };
  }
  if (domain.warmup_state === "frozen") {
    return { allowed: false, reason: "domain_frozen" };
  }
  if (
    domain.warmup_state === "unverified" ||
    domain.warmup_state === "verifying"
  ) {
    return { allowed: false, reason: "domain_not_ready" };
  }
  const cap =
    domain.warmup_state === "warmed"
      ? domain.target_daily_cap
      : domain.current_daily_cap;
  if (current_today_count >= cap) {
    return { allowed: false, reason: "domain_warmup_too_early" };
  }
  return { allowed: true };
}

/**
 * Daily tick. Walks the warmup state machine for ONE domain.
 * Called from a daily cron (or a Play step) — never called per-send.
 *
 * Transitions implemented:
 *   * unverified|verifying → warming   (all three DNS records verified)
 *   * warming  → warmed                 (warmup_day >= warmedDay AND healthy)
 *   * warming|warmed → degraded         (bounce/complaint above degrade thresholds)
 *   * any non-frozen → frozen           (bounce/complaint above freeze thresholds)
 *   * degraded → warmed                 (rates recovered)
 *
 * Returns the post-tick row for visibility.
 */
export async function tickWarmup(
  pool: Pool,
  workspace_id: string,
  id: string,
  thresholds: WarmupThresholds = DEFAULT_WARMUP_THRESHOLDS,
): Promise<SendingDomainRow | null> {
  const domain = await getSendingDomain(pool, workspace_id, id);
  if (!domain) return null;

  let next: WarmupState = domain.warmup_state;
  let nextDay = domain.warmup_day;
  let nextCap = domain.current_daily_cap;

  const verified =
    domain.spf_verified && domain.dkim_verified && domain.dmarc_verified;

  // Promotion off the launchpad.
  if (verified && (domain.warmup_state === "unverified" || domain.warmup_state === "verifying")) {
    next = "warming";
    nextDay = 1;
    nextCap = curveDailyCap(1, domain.target_daily_cap);
  }

  // Health check overrides everything except frozen.
  if (domain.warmup_state !== "frozen") {
    if (
      domain.bounce_rate_24h >= thresholds.freezeBounceRate ||
      domain.complaint_rate_24h >= thresholds.freezeComplaintRate
    ) {
      next = "frozen";
    } else if (
      domain.bounce_rate_24h >= thresholds.degradeBounceRate ||
      domain.complaint_rate_24h >= thresholds.degradeComplaintRate
    ) {
      next = "degraded";
    } else if (domain.warmup_state === "degraded") {
      // Recovered. Drop back to warmed (target cap honoured).
      next = "warmed";
    } else if (next === "warming") {
      nextDay = domain.warmup_day + 1;
      nextCap = curveDailyCap(nextDay, domain.target_daily_cap);
      if (nextDay >= thresholds.warmedDay) {
        next = "warmed";
        nextCap = domain.target_daily_cap;
      }
    }
  }

  if (
    next === domain.warmup_state &&
    nextDay === domain.warmup_day &&
    nextCap === domain.current_daily_cap
  ) {
    return domain;
  }

  const { rows } = await pool.query<SendingDomainRow>(
    `update sending_domains
        set warmup_state      = $3,
            warmup_day        = $4,
            current_daily_cap = $5,
            updated_at        = now()
      where workspace_id = $1 and id = $2
      returning id, workspace_id, domain,
                spf_verified, dkim_verified, dmarc_verified,
                warmup_state, warmup_day,
                current_daily_cap, target_daily_cap,
                bounce_rate_24h::float8 as bounce_rate_24h,
                complaint_rate_24h::float8 as complaint_rate_24h`,
    [workspace_id, id, next, nextDay, nextCap],
  );
  return rows[0] ?? null;
}
