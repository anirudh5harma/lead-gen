import type {
  CampaignOptimizerRecommendation,
  CampaignVariantScore,
} from "./campaign-optimizer.ts";

export type SkillOptimizerRecommendation = CampaignOptimizerRecommendation;

export type SkillOptimizerNextAction =
  | "apply_play_gate"
  | "review_reduce"
  | "keep_learning"
  | "no_change";

export interface SkillOptimizerMemoryUpdateInput {
  event_id: string;
  rep_id?: string | null;
  pattern_key: string;
  delta_score: number | string | null;
  win: boolean | string | null;
  occurred_at?: string | Date | null;
}

export interface SkillOptimizerInput {
  workspace_id: string;
  generated_at?: string;
  min_samples?: number;
  variants: CampaignVariantScore[];
  memory_updates?: SkillOptimizerMemoryUpdateInput[];
}

export interface SkillOptimizationRecommendation {
  skill_key: string;
  pattern_key: string;
  channel: string | null;
  segment_key: string;
  rep_id: string | null;
  rep_name: string | null;
  sample_count: number;
  outcome_count: number;
  reply_outcomes: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  reply_rate: number;
  positive_outcome_rate: number;
  meeting_rate: number;
  negative_outcome_rate: number;
  memory_win_count: number;
  memory_loss_count: number;
  memory_delta_score: number;
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: SkillOptimizerRecommendation;
  next_action: SkillOptimizerNextAction;
  explanation: string;
  source_variant_keys: string[];
}

export interface SkillOptimizationPlan {
  workspace_id: string;
  generated_at: string;
  min_samples: number;
  summary: string;
  recommendations: SkillOptimizationRecommendation[];
}

interface SkillGroup {
  skill_key: string;
  pattern_key: string;
  channel: string | null;
  segment_key: string;
  rep_id: string | null;
  rep_name: string | null;
  variants: CampaignVariantScore[];
  memory_updates: SkillOptimizerMemoryUpdateInput[];
}

export function buildSkillOptimizationPlan(
  input: SkillOptimizerInput,
): SkillOptimizationPlan {
  const min_samples = Math.max(1, Math.trunc(input.min_samples ?? 3));
  const groups = new Map<string, SkillGroup>();

  for (const variant of input.variants) {
    const key = groupKey(variant);
    let group = groups.get(key);
    if (!group) {
      group = {
        skill_key: variant.skill_key,
        pattern_key: variant.pattern_key,
        channel: variant.channel,
        segment_key: variant.segment_key,
        rep_id: variant.rep_id,
        rep_name: variant.rep_name,
        variants: [],
        memory_updates: [],
      };
      groups.set(key, group);
    }
    group.variants.push(variant);
  }

  for (const update of input.memory_updates ?? []) {
    if (!clean(update.pattern_key)) continue;
    const matching = [...groups.values()].filter((group) =>
      group.pattern_key === update.pattern_key &&
      (group.rep_id == null || update.rep_id == null || group.rep_id === update.rep_id)
    );
    for (const group of matching) {
      group.memory_updates.push(update);
    }
  }

  const recommendations = [...groups.values()]
    .map((group) => scoreGroup(group, min_samples))
    .sort((a, b) => {
      const rank = recommendationRank(b.recommendation) - recommendationRank(a.recommendation);
      if (rank !== 0) return rank;
      return b.utility_score - a.utility_score;
    });

  return {
    workspace_id: input.workspace_id,
    generated_at: input.generated_at ?? new Date().toISOString(),
    min_samples,
    summary: summarizeRecommendations(recommendations),
    recommendations,
  };
}

function scoreGroup(
  group: SkillGroup,
  minSamples: number,
): SkillOptimizationRecommendation {
  const sample_count = sum(group.variants, (variant) => variant.sample_count);
  const outcome_count = sum(group.variants, (variant) => variant.outcome_count);
  const reply_outcomes = sum(group.variants, (variant) => variant.reply_outcomes);
  const positive_outcomes = sum(group.variants, (variant) => variant.positive_outcomes);
  const negative_outcomes = sum(group.variants, (variant) => variant.negative_outcomes);
  const meeting_outcomes = sum(group.variants, (variant) => variant.meeting_outcomes);
  const reply_rate = outcomeRate(reply_outcomes, sample_count);
  const positive_outcome_rate = outcomeRate(positive_outcomes, sample_count);
  const meeting_rate = outcomeRate(meeting_outcomes, sample_count);
  const negative_outcome_rate = outcomeRate(negative_outcomes, sample_count);
  const source_variant_keys = [...new Set(group.variants.map((variant) => variant.variant_key))];
  const memory_win_count = group.memory_updates.filter((update) => booleanValue(update.win) === true).length;
  const memory_loss_count = group.memory_updates.filter((update) => booleanValue(update.win) === false).length;
  const memory_delta_score = round2(group.memory_updates.reduce(
    (total, update) => total + numericValue(update.delta_score),
    0,
  ));
  const baseUtility = weightedAverage(
    group.variants.map((variant) => ({
      value: variant.utility_score,
      weight: Math.max(variant.sample_count, variant.outcome_count, 1),
    })),
  );
  const utility_score = round2(clamp01(
    baseUtility + clamp(memory_delta_score / Math.max(sample_count, minSamples, 1) / 2, -0.15, 0.15),
  ));
  const confidence = round2(clamp01(Math.min(sample_count, minSamples) / minSamples));
  const recommendation = recommend({
    sample_count,
    minSamples,
    utility_score,
    positive_outcomes,
    negative_outcomes,
    meeting_outcomes,
    memory_win_count,
    memory_loss_count,
    variant_recommendations: group.variants.map((variant) => variant.recommendation),
  });
  const allocation_weight = allocationWeight(group.variants, recommendation);

  return {
    skill_key: group.skill_key,
    pattern_key: group.pattern_key,
    channel: group.channel,
    segment_key: group.segment_key,
    rep_id: group.rep_id,
    rep_name: group.rep_name,
    sample_count,
    outcome_count,
    reply_outcomes,
    positive_outcomes,
    negative_outcomes,
    meeting_outcomes,
    reply_rate,
    positive_outcome_rate,
    meeting_rate,
    negative_outcome_rate,
    memory_win_count,
    memory_loss_count,
    memory_delta_score,
    utility_score,
    confidence,
    allocation_weight,
    recommendation,
    next_action: nextAction(recommendation),
    explanation: explainRecommendation({
      recommendation,
      sample_count,
      minSamples,
      utility_score,
      reply_rate,
      positive_outcome_rate,
      meeting_rate,
      negative_outcome_rate,
      positive_outcomes,
      negative_outcomes,
      meeting_outcomes,
      memory_win_count,
      memory_loss_count,
      memory_delta_score,
    }),
    source_variant_keys,
  };
}

function recommend(input: {
  sample_count: number;
  minSamples: number;
  utility_score: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  memory_win_count: number;
  memory_loss_count: number;
  variant_recommendations: SkillOptimizerRecommendation[];
}): SkillOptimizerRecommendation {
  if (input.variant_recommendations.includes("double_down")) return "double_down";
  if (
    input.variant_recommendations.includes("reduce") &&
    !input.variant_recommendations.includes("hold")
  ) {
    return "reduce";
  }
  if (input.sample_count < input.minSamples) return "not_enough_proof";
  if (
    input.negative_outcomes + input.memory_loss_count >
      input.positive_outcomes + input.memory_win_count &&
    input.utility_score < 0.48
  ) {
    return "reduce";
  }
  if (
    input.utility_score >= 0.62 &&
    (input.meeting_outcomes > 0 ||
      input.positive_outcomes >= 2 ||
      input.memory_win_count >= 2)
  ) {
    return "double_down";
  }
  return "hold";
}

function allocationWeight(
  variants: CampaignVariantScore[],
  recommendation: SkillOptimizerRecommendation,
): number {
  if (recommendation === "reduce") return 0.05;
  if (recommendation === "not_enough_proof") return 0.15;
  const relevant = variants.filter((variant) => variant.recommendation === recommendation);
  const source = relevant.length > 0 ? relevant : variants;
  if (source.length === 0) return recommendation === "double_down" ? 0.4 : 0.25;
  return round2(
    source.reduce((total, variant) => total + variant.allocation_weight, 0) /
      source.length,
  );
}

function explainRecommendation(input: {
  recommendation: SkillOptimizerRecommendation;
  sample_count: number;
  minSamples: number;
  utility_score: number;
  reply_rate: number;
  positive_outcome_rate: number;
  meeting_rate: number;
  negative_outcome_rate: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  memory_win_count: number;
  memory_loss_count: number;
  memory_delta_score: number;
}): string {
  if (input.recommendation === "not_enough_proof") {
    return `Only ${input.sample_count}/${input.minSamples} samples. Keep this skill in exploration until reply and Outcome evidence improves.`;
  }
  if (input.recommendation === "reduce") {
    return `${percent(input.negative_outcome_rate)} negative outcome rate and ${input.memory_loss_count} procedural loss${input.memory_loss_count === 1 ? "" : "es"} pulled utility to ${input.utility_score.toFixed(2)}. Review before reducing volume.`;
  }
  if (input.recommendation === "double_down") {
    return `${percent(input.reply_rate)} reply rate, ${percent(input.positive_outcome_rate)} positive Outcome rate, ${input.meeting_outcomes} meeting/pipeline win${input.meeting_outcomes === 1 ? "" : "s"}, and ${input.memory_win_count} procedural win${input.memory_win_count === 1 ? "" : "s"} support a gated double-down.`;
  }
  return `Reply rate ${percent(input.reply_rate)}, positive Outcome rate ${percent(input.positive_outcome_rate)}, and procedural delta ${input.memory_delta_score.toFixed(2)} are stable but not decisive. Hold allocation.`;
}

function nextAction(
  recommendation: SkillOptimizerRecommendation,
): SkillOptimizerNextAction {
  if (recommendation === "double_down") return "apply_play_gate";
  if (recommendation === "reduce") return "review_reduce";
  if (recommendation === "not_enough_proof") return "keep_learning";
  return "no_change";
}

function summarizeRecommendations(
  recommendations: SkillOptimizationRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No skill variants have enough campaign activity yet.";
  }
  const doubles = recommendations.filter((item) => item.recommendation === "double_down").length;
  const reduces = recommendations.filter((item) => item.recommendation === "reduce").length;
  const exploring = recommendations.filter((item) => item.recommendation === "not_enough_proof").length;
  return `${doubles} skills ready for gated double-down, ${reduces} need reduce review, ${exploring} still need exploration.`;
}

function groupKey(variant: CampaignVariantScore): string {
  return [
    `skill:${variant.skill_key}`,
    `pattern:${variant.pattern_key}`,
    `channel:${variant.channel ?? "any"}`,
    `segment:${variant.segment_key}`,
    `rep:${variant.rep_id ?? "any"}`,
  ].join("|");
}

function recommendationRank(recommendation: SkillOptimizerRecommendation): number {
  switch (recommendation) {
    case "double_down":
      return 4;
    case "hold":
      return 3;
    case "not_enough_proof":
      return 2;
    case "reduce":
      return 1;
  }
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((total, item) => total + item.weight, 0);
  if (totalWeight <= 0) return 0.5;
  return values.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight;
}

function sum(
  variants: CampaignVariantScore[],
  pick: (variant: CampaignVariantScore) => number,
): number {
  return variants.reduce((total, variant) => total + pick(variant), 0);
}

function numericValue(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: boolean | string | null | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function outcomeRate(count: number, sampleCount: number): number {
  return round2(clamp01(count / Math.max(sampleCount, 1)));
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}
