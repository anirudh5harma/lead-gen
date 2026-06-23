/**
 * Shared client-side billing types. Mirrors the server selector
 * `getWorkspaceBillingState` in core/billing — kept structurally identical so
 * server components can pass its result straight into the billing UI.
 */
export interface WorkspaceBillingState {
  tier: "trial" | "pro";
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

/** Show the low-credit nudge at or below this trial balance (but not frozen). */
export const TRIAL_LOW_THRESHOLD = 5;
