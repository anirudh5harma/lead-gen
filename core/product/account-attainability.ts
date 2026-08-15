export interface AccountAttainabilityInput {
  seller_age_days: number;
  seller_has_proof: boolean;
  target_size_bucket: string | null;
  recent_target_signal_count: number;
  target_scale_evidence: boolean;
  recent_sent_count: number;
  has_reply: boolean;
  has_positive_outcome: boolean;
}

export type AccountAttainabilityReason =
  | "attainable"
  | "positive_relationship_evidence"
  | "unanswered_company_cooldown"
  | "early_seller_prominent_target";

export type AccountAttainabilityDecision =
  | {
      eligible: true;
      reason: Extract<
        AccountAttainabilityReason,
        "attainable" | "positive_relationship_evidence"
      >;
    }
  | {
      eligible: false;
      reason: Extract<
        AccountAttainabilityReason,
        "unanswered_company_cooldown" | "early_seller_prominent_target"
      >;
    };

const EARLY_SELLER_DAYS = 180;
const ENTERPRISE_MIN_EMPLOYEES = 1001;

export function assessAccountAttainability(
  input: AccountAttainabilityInput,
): AccountAttainabilityDecision {
  if (input.has_reply || input.has_positive_outcome) {
    return { eligible: true, reason: "positive_relationship_evidence" };
  }
  if (input.recent_sent_count > 0) {
    return { eligible: false, reason: "unanswered_company_cooldown" };
  }
  const earlySeller = input.seller_age_days <= EARLY_SELLER_DAYS &&
    !input.seller_has_proof;
  const prominentTarget = minimumSize(input.target_size_bucket) >=
      ENTERPRISE_MIN_EMPLOYEES ||
    input.target_scale_evidence;
  if (earlySeller && prominentTarget) {
    return { eligible: false, reason: "early_seller_prominent_target" };
  }
  return { eligible: true, reason: "attainable" };
}

export function hasLargeCompanyScaleEvidence(text: string): boolean {
  if (/\b(?:fortune\s+500|global\s+2000|publicly\s+traded)\b/i.test(text)) {
    return true;
  }
  for (const match of text.matchAll(
    /[$€£]\s*(\d+(?:\.\d+)?)\s*(m|b|million|billion)\b/gi,
  )) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(amount)) continue;
    const dollars = unit === "b" || unit === "billion"
      ? amount * 1_000_000_000
      : amount * 1_000_000;
    if (dollars >= 100_000_000) return true;
  }
  return false;
}

function minimumSize(bucket: string | null): number {
  if (!bucket) return 0;
  const normalized = bucket.trim().toLowerCase();
  if (normalized === "500+" || normalized === "501+") return 501;
  const match = normalized.match(/^(\d[\d,]*)/);
  if (!match?.[1]) return 0;
  return Number(match[1].replaceAll(",", "")) || 0;
}
