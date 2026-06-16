import type {
  CampaignOptimizerRecommendation,
} from "./campaign-optimizer.ts";

export interface CampaignDispatchCandidate {
  play_id: string;
  play_name?: string | null;
  channel: string | null;
  skill_key: string;
  skill_version?: string | null;
  segment_key: string;
  explicit_target?: boolean;
}

export interface CampaignDispatchAllocation {
  play_id: string;
  variant_key: string;
  skill_key: string;
  skill_version: string | null;
  segment_key: string;
  channel: string | null;
  recommendation_id: string | null;
  strategy_generated_at: string | null;
  recommendation: CampaignOptimizerRecommendation | "unscored";
  allocation_weight: number;
  should_dispatch: boolean;
  reason: string;
  matched_variant_key: string | null;
}

export interface CampaignDispatchPlan<T extends CampaignDispatchCandidate> {
  candidate: T;
  allocation: CampaignDispatchAllocation;
}

export interface CampaignDispatchStrategy {
  recommendation_id?: string | null;
  generated_at?: string | null;
  variants: Array<{
    variant_key: string;
    play_id: string;
    channel: string | null;
    skill_key: string;
    segment_key: string;
    allocation_weight: number;
    recommendation: CampaignOptimizerRecommendation;
    explanation?: string | null;
  }>;
}

export function planCampaignDispatchAllocations<T extends CampaignDispatchCandidate>(
  candidates: T[],
  strategy: CampaignDispatchStrategy | null | undefined,
): Array<CampaignDispatchPlan<T>> {
  const plans = candidates.map((candidate) => {
    const matched = matchStrategyVariant(candidate, strategy);
    const allocated = allocationCandidateForMatchedStrategy(candidate, matched);
    const variant_key = matched?.variant_key ?? campaignDispatchVariantKey(allocated);
    const recommendation: CampaignDispatchAllocation["recommendation"] =
      matched?.recommendation ?? "unscored";
    const allocation_weight = matched?.allocation_weight ?? 0.2;
    const should_dispatch =
      candidate.explicit_target === true ||
      recommendation !== "reduce";
    const reason = should_dispatch
      ? dispatchReason(recommendation, allocation_weight, matched?.explanation)
      : matched?.explanation ?? "Strategy optimizer recommended reducing this variant.";
    return {
      candidate,
      allocation: {
        play_id: allocated.play_id,
        variant_key,
        skill_key: allocated.skill_key,
        skill_version: allocated.skill_version ?? null,
        segment_key: allocated.segment_key,
        channel: allocated.channel,
        recommendation_id: strategy?.recommendation_id ?? null,
        strategy_generated_at: strategy?.generated_at ?? null,
        recommendation,
        allocation_weight,
        should_dispatch,
        reason,
        matched_variant_key: matched?.variant_key ?? null,
      },
    };
  });

  return plans.sort((a, b) => {
    const dispatchRank = Number(b.allocation.should_dispatch) - Number(a.allocation.should_dispatch);
    if (dispatchRank !== 0) return dispatchRank;
    const weightRank = b.allocation.allocation_weight - a.allocation.allocation_weight;
    if (weightRank !== 0) return weightRank;
    return a.candidate.play_id.localeCompare(b.candidate.play_id);
  });
}

export function campaignDispatchVariantKey(candidate: CampaignDispatchCandidate): string {
  return [
    `play:${candidate.play_id}`,
    `skill:${candidate.skill_key}`,
    `channel:${candidate.channel ?? "any"}`,
    `segment:${candidate.segment_key}`,
  ].join("|");
}

function allocationCandidateForMatchedStrategy<T extends CampaignDispatchCandidate>(
  candidate: T,
  matched: CampaignDispatchStrategy["variants"][number] | null,
): CampaignDispatchCandidate {
  if (!matched) return candidate;
  return {
    ...candidate,
    channel: matched.channel ?? candidate.channel,
    skill_key: matched.skill_key,
    skill_version: matched.skill_key === candidate.skill_key
      ? candidate.skill_version ?? null
      : null,
    segment_key: matched.segment_key,
  };
}

function matchStrategyVariant(
  candidate: CampaignDispatchCandidate,
  strategy: CampaignDispatchStrategy | null | undefined,
): CampaignDispatchStrategy["variants"][number] | null {
  if (!strategy?.variants?.length) return null;
  const exact = strategy.variants.find((variant) =>
    variant.play_id === candidate.play_id &&
    sameChannel(variant, candidate) &&
    sameSegment(variant, candidate) &&
    variant.skill_key === candidate.skill_key &&
    variant.segment_key === candidate.segment_key
  );
  if (exact) return exact;
  const skillMatch = strategy.variants.find((variant) =>
    variant.play_id === candidate.play_id &&
    sameChannel(variant, candidate) &&
    segmentCompatible(variant, candidate) &&
    variant.skill_key === candidate.skill_key
  );
  if (skillMatch) return skillMatch;
  const segmentMatch = strategy.variants.find((variant) =>
    variant.play_id === candidate.play_id &&
    sameChannel(variant, candidate) &&
    sameSegment(variant, candidate)
  );
  if (segmentMatch) return segmentMatch;
  return strategy.variants.find((variant) =>
    variant.play_id === candidate.play_id &&
    sameChannel(variant, candidate) &&
    segmentCompatible(variant, candidate)
  ) ?? null;
}

function dispatchReason(
  recommendation: CampaignDispatchAllocation["recommendation"],
  allocationWeight: number,
  explanation?: string | null,
): string {
  if (explanation) return explanation;
  if (recommendation === "double_down") {
    return `Strategy optimizer recommends double-down allocation ${allocationWeight.toFixed(2)}.`;
  }
  if (recommendation === "not_enough_proof") {
    return `Keep exploration small at allocation ${allocationWeight.toFixed(2)}.`;
  }
  if (recommendation === "hold") {
    return `Hold steady at allocation ${allocationWeight.toFixed(2)}.`;
  }
  return "No campaign strategy recommendation yet; allow baseline exploration.";
}

function clean(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameChannel(
  variant: CampaignDispatchStrategy["variants"][number],
  candidate: CampaignDispatchCandidate,
): boolean {
  return clean(variant.channel) === clean(candidate.channel);
}

function sameSegment(
  variant: CampaignDispatchStrategy["variants"][number],
  candidate: CampaignDispatchCandidate,
): boolean {
  return variant.segment_key === candidate.segment_key;
}

function segmentCompatible(
  variant: CampaignDispatchStrategy["variants"][number],
  candidate: CampaignDispatchCandidate,
): boolean {
  return sameSegment(variant, candidate) ||
    variant.segment_key === "all" ||
    candidate.segment_key === "all";
}
