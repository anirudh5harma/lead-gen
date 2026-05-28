import type { Pool } from "pg";

/**
 * Per-channel-account daily cap accounting + per-recipient frequency cap.
 *
 * Daily cap: every channel_account carries `daily_cap` (the policy ceiling)
 * and `daily_used` / `daily_window_start` (the running counter). When
 * `daily_window_start` is older than 24h, the counter rolls over.
 *
 * Frequency cap: across ALL Reps in the workspace, the same recipient
 * person should not receive more than N outbound emails per window. This
 * prevents two Reps from accidentally hammering the same prospect.
 * Default: 1 outbound email per recipient per 24h.
 */

export interface DailyCapStatus {
  daily_cap: number;
  daily_used: number;
  window_start: Date | null;
  allowed: boolean;
  remaining: number;
}

/**
 * Check whether `channel_account_id` has budget for one more send today.
 * If the 24h window has elapsed, resets `daily_used` to 0 as a side effect
 * (so a single check + send doesn't have to also roll over the counter).
 *
 * Returns the post-rollover state, NOT a reservation. Call `reserveSend()`
 * to atomically claim a slot.
 */
export async function checkDailyCap(
  pool: Pool,
  channel_account_id: string,
): Promise<DailyCapStatus> {
  const { rows } = await pool.query<{
    daily_cap: number | null;
    daily_used: number;
    daily_window_start: Date | null;
  }>(
    `update channel_accounts
        set daily_used = case
              when daily_window_start is null
                or daily_window_start < now() - interval '24 hours'
              then 0
              else daily_used
            end,
            daily_window_start = case
              when daily_window_start is null
                or daily_window_start < now() - interval '24 hours'
              then now()
              else daily_window_start
            end
      where id = $1
      returning daily_cap, daily_used, daily_window_start`,
    [channel_account_id],
  );
  const row = rows[0];
  if (!row) {
    return {
      daily_cap: 0,
      daily_used: 0,
      window_start: null,
      allowed: false,
      remaining: 0,
    };
  }
  const cap = row.daily_cap ?? Number.POSITIVE_INFINITY;
  const used = row.daily_used;
  return {
    daily_cap: cap === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : cap,
    daily_used: used,
    window_start: row.daily_window_start,
    allowed: used < cap,
    remaining: Math.max(0, cap - used),
  };
}

/**
 * Atomically reserve one send slot. Returns true on success, false when
 * the account is at cap. Use this as the gate immediately before calling
 * the provider's send API.
 */
export async function reserveSend(
  pool: Pool,
  channel_account_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ reserved: boolean }>(
    `update channel_accounts
        set daily_used = daily_used + 1,
            last_used_at = now()
      where id = $1
        and (daily_cap is null or daily_used < daily_cap)
        and status = 'connected'
      returning true as reserved`,
    [channel_account_id],
  );
  return Boolean(rows[0]?.reserved);
}

/**
 * Roll back a reserved slot (e.g. when the provider returns a permanent
 * error before the message goes out). Never goes negative.
 */
export async function refundSend(
  pool: Pool,
  channel_account_id: string,
): Promise<void> {
  await pool.query(
    `update channel_accounts
        set daily_used = greatest(0, daily_used - 1)
      where id = $1`,
    [channel_account_id],
  );
}

export interface FrequencyCapOptions {
  /** Window for the cap, in hours. Default 24. */
  window_hours?: number;
  /** Max outbound messages per recipient in the window. Default 1. */
  max_in_window?: number;
}

/**
 * Across ALL Reps in `workspace_id`, count outbound email messages to
 * the given recipient_person_id within the window. Returns the count so
 * the caller can decide whether to defer.
 *
 * "Recipient" is the conversation.counterparty_person_id. A workspace's
 * Reps share a frequency cap on the same person.
 */
export async function countRecentToRecipient(
  pool: Pool,
  workspace_id: string,
  recipient_person_id: string,
  window_hours = 24,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n
       from messages m
       join conversations c on c.id = m.conversation_id
      where m.workspace_id = $1
        and c.counterparty_person_id = $2
        and m.channel = 'email'
        and m.direction = 'outbound'
        and m.status in ('queued', 'sent', 'delivered')
        and m.sent_at >= now() - make_interval(hours => $3)`,
    [workspace_id, recipient_person_id, window_hours],
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * Convenience: check frequency cap for a draft. Returns whether the cap
 * permits a send and the current count.
 */
export async function checkFrequencyCap(
  pool: Pool,
  workspace_id: string,
  recipient_person_id: string,
  opts: FrequencyCapOptions = {},
): Promise<{ allowed: boolean; count: number; max: number; window_hours: number }> {
  const window_hours = opts.window_hours ?? 24;
  const max = opts.max_in_window ?? 1;
  const count = await countRecentToRecipient(
    pool,
    workspace_id,
    recipient_person_id,
    window_hours,
  );
  return { allowed: count < max, count, max, window_hours };
}
