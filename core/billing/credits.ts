import type { Pool } from "pg";

/**
 * Trial credit accounting. Trial workspaces get 15 credits (1 credit = 1 sent
 * message, any channel). Pro = unlimited, so the credit gate is trial-only.
 *
 * Concurrency + idempotency: every mutation takes a `FOR UPDATE` lock on the
 * workspace row, so credit operations for a given workspace serialize. The
 * append-only `billing_credit_ledger` (unique consume row per message_id) makes
 * a retried send idempotent — it is never charged twice — and lets balances be
 * reconciled. `workspaces.trial_credits_remaining` is the fast counter kept in
 * sync inside the same transaction.
 */

export const TRIAL_CREDIT_GRANT = 15;
export const TRIAL_LOW_THRESHOLD = 5;

export type BillingTier = "trial" | "pro";

export interface WorkspaceBillingState {
  tier: BillingTier;
  entitled: boolean;
  frozen: boolean;
  credits_remaining: number;
  credits_total: number;
  subscription_status: string;
  renews_at: string | null;
  canceled: boolean;
  source: "trial" | "subscription" | "legacy_override";
  portal_available: boolean;
}

interface EntitlementRow {
  trial_credits_remaining: number;
  trial_credits_total: number;
  subscription_status: string | null;
  subscription_renews_at: Date | null;
  dodo_customer_id?: string | null;
  subscription_external_id?: string | null;
  settings?: unknown;
}

interface BillingOverride {
  tier: BillingTier;
  active: boolean;
}

interface CreditMutationInput {
  workspace_id: string;
  message_id: string;
  channel?: "email" | "linkedin";
}

function outreachEntitled(row: EntitlementRow): boolean {
  return isProEntitled(row) || row.trial_credits_remaining > 0;
}

function normalizeCreditMutationInput(
  workspaceOrInput: string | CreditMutationInput,
  message_id?: string,
  channel?: "email" | "linkedin",
): CreditMutationInput {
  if (typeof workspaceOrInput === "string") {
    if (!message_id) throw new Error("message_id is required");
    return {
      workspace_id: workspaceOrInput,
      message_id,
      channel,
    };
  }
  return workspaceOrInput;
}

/** Pro-entitled = active, or canceled-but-still-within the paid period. */
export function isProEntitled(row: {
  subscription_status: string | null;
  subscription_renews_at: Date | string | null;
}): boolean {
  const status = row.subscription_status;
  if (status === "active") return true;
  if (status === "canceled" && row.subscription_renews_at) {
    const renews = new Date(row.subscription_renews_at).getTime();
    return Number.isFinite(renews) && renews > Date.now();
  }
  return false;
}

export async function isOutreachEntitled(
  pool: Pool,
  workspace_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<EntitlementRow>(
    `select trial_credits_remaining, trial_credits_total,
            subscription_status, subscription_renews_at
       from workspaces
      where id = $1`,
    [workspace_id],
  );
  return rows[0] ? outreachEntitled(rows[0]) : false;
}

export interface ReserveCreditResult {
  ok: boolean;
  /** false when Pro (unlimited) — no ledger row written. */
  metered: boolean;
  remaining: number;
  /** Set when this consume brought the balance to exactly the low threshold. */
  crossedLow: boolean;
  /** Set when this consume brought the balance to exactly zero. */
  crossedZero: boolean;
}

/**
 * Atomically reserve one credit for a send. Pro → always ok (no charge).
 * Trial → charges exactly once per message_id (idempotent on retry), refuses
 * (ok:false) when the balance is zero. Use as the gate immediately before the
 * provider send, mirroring `reserveSend` in core/channels/email/caps.ts.
 */
export async function reserveCredit(
  pool: Pool,
  workspace_id: string,
  message_id: string,
  messageChannel?: "email" | "linkedin",
): Promise<ReserveCreditResult>;
export async function reserveCredit(
  pool: Pool,
  input: CreditMutationInput,
): Promise<ReserveCreditResult>;
export async function reserveCredit(
  pool: Pool,
  workspaceOrInput: string | CreditMutationInput,
  message_id?: string,
  messageChannel?: "email" | "linkedin",
): Promise<ReserveCreditResult> {
  const input = normalizeCreditMutationInput(
    workspaceOrInput,
    message_id,
    messageChannel,
  );
  const channel = input.channel ?? "email";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ws = await client.query<EntitlementRow>(
      `select trial_credits_remaining, trial_credits_total,
              subscription_status, subscription_renews_at
         from workspaces
        where id = $1
        for update`,
      [input.workspace_id],
    );
    const row = ws.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        metered: false,
        remaining: 0,
        crossedLow: false,
        crossedZero: false,
      };
    }

    if (isProEntitled(row)) {
      await client.query("COMMIT");
      return {
        ok: true,
        metered: false,
        remaining: row.trial_credits_remaining,
        crossedLow: false,
        crossedZero: false,
      };
    }

    const existing = await client.query(
      `select 1
         from billing_credit_ledger
        where workspace_id = $1
          and message_id = $2
          and reason = 'consume'`,
      [input.workspace_id, input.message_id],
    );
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("COMMIT");
      return {
        ok: true,
        metered: true,
        remaining: row.trial_credits_remaining,
        crossedLow: false,
        crossedZero: false,
      };
    }

    if (row.trial_credits_remaining <= 0) {
      await client.query("COMMIT");
      return {
        ok: false,
        metered: true,
        remaining: 0,
        crossedLow: false,
        crossedZero: false,
      };
    }

    await client.query(
      `insert into billing_credit_ledger (workspace_id, message_id, channel, delta, reason)
       values ($1, $2, $3, -1, 'consume')`,
      [input.workspace_id, input.message_id, channel],
    );
    const upd = await client.query<{ trial_credits_remaining: number }>(
      `update workspaces
          set trial_credits_remaining = trial_credits_remaining - 1,
              credits_exhausted_at = case
                when trial_credits_remaining - 1 <= 0 and credits_exhausted_at is null
                then now() else credits_exhausted_at end
        where id = $1
        returning trial_credits_remaining`,
      [input.workspace_id],
    );
    await client.query("COMMIT");
    const remaining = upd.rows[0]?.trial_credits_remaining ?? 0;
    return {
      ok: true,
      metered: true,
      remaining,
      crossedLow: remaining === TRIAL_LOW_THRESHOLD,
      crossedZero: remaining === 0,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reverse a consumed credit (provider hard-failed after reserve). Idempotent:
 * a second refund for the same message_id is a no-op. Clears
 * credits_exhausted_at when the balance recovers above zero.
 */
export async function refundCredit(
  pool: Pool,
  workspace_id: string,
  message_id: string,
  messageChannel?: "email" | "linkedin",
): Promise<void>;
export async function refundCredit(
  pool: Pool,
  input: CreditMutationInput,
): Promise<void>;
export async function refundCredit(
  pool: Pool,
  workspaceOrInput: string | CreditMutationInput,
  message_id?: string,
  messageChannel?: "email" | "linkedin",
): Promise<void> {
  const input = normalizeCreditMutationInput(
    workspaceOrInput,
    message_id,
    messageChannel,
  );
  const channel = input.channel ?? "email";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`select 1 from workspaces where id = $1 for update`, [
      input.workspace_id,
    ]);
    const consumed = await client.query(
      `select 1
         from billing_credit_ledger
        where workspace_id = $1
          and message_id = $2
          and reason = 'consume'`,
      [input.workspace_id, input.message_id],
    );
    const refunded = await client.query(
      `select 1
         from billing_credit_ledger
        where workspace_id = $1
          and message_id = $2
          and reason = 'refund'`,
      [input.workspace_id, input.message_id],
    );
    if ((consumed.rowCount ?? 0) === 0 || (refunded.rowCount ?? 0) > 0) {
      await client.query("COMMIT");
      return;
    }
    await client.query(
      `insert into billing_credit_ledger (workspace_id, message_id, channel, delta, reason)
       values ($1, $2, $3, 1, 'refund')`,
      [input.workspace_id, input.message_id, channel],
    );
    await client.query(
      `update workspaces
          set trial_credits_remaining = least(trial_credits_total, trial_credits_remaining + 1),
              credits_exhausted_at = case
                when trial_credits_remaining + 1 > 0 then null else credits_exhausted_at end
        where id = $1`,
      [input.workspace_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Idempotently grant the trial credit allotment to a new workspace. Safe to
 * call repeatedly (e.g. on a replayed workspace.created) — the unique
 * trial_grant ledger row makes the second call a no-op.
 */
export async function grantTrialCredits(
  pool: Pool,
  workspace_id: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `insert into billing_credit_ledger (workspace_id, message_id, channel, delta, reason)
       values ($1, null, 'email', $2, 'trial_grant')
       on conflict do nothing
       returning 1`,
      [workspace_id, TRIAL_CREDIT_GRANT],
    );
    const granted = (ins.rowCount ?? 0) > 0;
    if (granted) {
      await client.query(
        `update workspaces
            set trial_credits_total = $2,
                trial_credits_remaining = $2
          where id = $1`,
        [workspace_id, TRIAL_CREDIT_GRANT],
      );
    }
    await client.query("COMMIT");
    return granted;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Read model for the billing UI (dashboard banner + Profile plan section). */
export async function getWorkspaceBillingState(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceBillingState> {
  const { rows } = await pool.query<EntitlementRow & { subscription_renews_at: Date | null }>(
    `select trial_credits_remaining, trial_credits_total,
            subscription_status, subscription_renews_at,
            dodo_customer_id, subscription_external_id, settings
       from workspaces
      where id = $1`,
    [workspace_id],
  );
  const row = rows[0];
  const override = parseBillingOverride(row?.settings);
  if (override?.active && override.tier === "pro") {
    const remaining = row?.trial_credits_remaining ?? TRIAL_CREDIT_GRANT;
    const total = row?.trial_credits_total ?? TRIAL_CREDIT_GRANT;
    return {
      tier: "pro",
      entitled: true,
      frozen: false,
      credits_remaining: remaining,
      credits_total: total,
      subscription_status: "legacy_override",
      renews_at: null,
      canceled: false,
      source: "legacy_override",
      portal_available: false,
    };
  }
  const status = row?.subscription_status ?? "inactive";
  const renewsAt = row?.subscription_renews_at ?? null;
  const pro = row
    ? isProEntitled({ subscription_status: status, subscription_renews_at: renewsAt })
    : false;
  const remaining = row?.trial_credits_remaining ?? 0;
  const total = row?.trial_credits_total ?? TRIAL_CREDIT_GRANT;
  const entitled = pro || remaining > 0;
  const portalAvailable = Boolean(
    row?.dodo_customer_id?.trim() || row?.subscription_external_id?.trim(),
  );
  return {
    tier: pro ? "pro" : "trial",
    entitled,
    frozen: !entitled,
    credits_remaining: remaining,
    credits_total: total,
    subscription_status: status,
    renews_at: renewsAt ? new Date(renewsAt).toISOString() : null,
    canceled: status === "canceled",
    source: pro ? "subscription" : "trial",
    portal_available: pro && portalAvailable,
  };
}

function parseBillingOverride(settings: unknown): BillingOverride | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }
  const override = (settings as Record<string, unknown>).billing_override;
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return null;
  }
  const tier = (override as Record<string, unknown>).tier;
  if (tier !== "trial" && tier !== "pro") return null;
  const active = (override as Record<string, unknown>).active;
  return {
    tier,
    active: active !== false,
  };
}
