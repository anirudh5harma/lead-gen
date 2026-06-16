export type CampaignOptimizerOutcomeKind =
  | "positive_reply"
  | "meeting_booked"
  | "opportunity_created"
  | "deal_won"
  | "engagement_lift"
  | "unsubscribe"
  | "bounce"
  | "do_not_contact";

export type CampaignOptimizerRecommendation =
  | "double_down"
  | "hold"
  | "reduce"
  | "not_enough_proof";

export interface CampaignOptimizerPlayRunInput {
  play_run_id: string;
  play_id: string;
  play_name: string;
  rep_id?: string | null;
  rep_name?: string | null;
  channel?: string | null;
  skill_key?: string | null;
  pattern_key?: string | null;
  segment_key?: string | null;
  created_at?: string | Date | null;
}

export interface CampaignOptimizerOutcomeInput {
  outcome_id: string;
  play_run_id: string | null;
  play_id: string | null;
  kind: CampaignOptimizerOutcomeKind;
  score?: number | string | null;
  occurred_at?: string | Date | null;
}

export interface CampaignOptimizerInput {
  workspace_id: string;
  play_runs: CampaignOptimizerPlayRunInput[];
  outcomes: CampaignOptimizerOutcomeInput[];
  min_samples?: number;
}

export interface CampaignVariantScore {
  variant_key: string;
  play_id: string;
  play_name: string;
  rep_id: string | null;
  rep_name: string | null;
  channel: string | null;
  skill_key: string;
  pattern_key: string;
  segment_key: string;
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
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: CampaignOptimizerRecommendation;
  explanation: string;
}

export interface CampaignStrategyRecommendation {
  workspace_id: string;
  generated_at: string;
  min_samples: number;
  summary: string;
  variants: CampaignVariantScore[];
}

const OUTCOME_WEIGHTS: Record<CampaignOptimizerOutcomeKind, number> = {
  deal_won: 1,
  opportunity_created: 0.9,
  meeting_booked: 0.8,
  positive_reply: 0.55,
  engagement_lift: 0.25,
  unsubscribe: -0.65,
  bounce: -0.75,
  do_not_contact: -1,
};

export function buildCampaignStrategyRecommendation(
  input: CampaignOptimizerInput,
): CampaignStrategyRecommendation {
  const min_samples = Math.max(1, Math.trunc(input.min_samples ?? 3));
  const groups = new Map<string, {
    play_run_ids: Set<string>;
    play_id: string;
    play_name: string;
    rep_id: string | null;
    rep_name: string | null;
    channel: string | null;
    skill_key: string;
    pattern_key: string;
    segment_key: string;
    outcomes: CampaignOptimizerOutcomeInput[];
  }>();
  const runVariant = new Map<string, string>();

  for (const run of input.play_runs) {
    const variant = variantFromRun(run);
    let group = groups.get(variant.variant_key);
    if (!group) {
      group = {
        play_run_ids: new Set(),
        play_id: run.play_id,
        play_name: run.play_name,
        rep_id: run.rep_id ?? null,
        rep_name: run.rep_name ?? null,
        channel: variant.channel,
        skill_key: variant.skill_key,
        pattern_key: variant.pattern_key,
        segment_key: variant.segment_key,
        outcomes: [],
      };
      groups.set(variant.variant_key, group);
    }
    group.play_run_ids.add(run.play_run_id);
    runVariant.set(run.play_run_id, variant.variant_key);
  }

  for (const outcome of input.outcomes) {
    const key = outcome.play_run_id ? runVariant.get(outcome.play_run_id) : null;
    if (key) {
      groups.get(key)?.outcomes.push(outcome);
      continue;
    }
    if (!outcome.play_id) continue;
    const fallback = [...groups.entries()].find(([, group]) => group.play_id === outcome.play_id);
    fallback?.[1].outcomes.push(outcome);
  }

  const variants = [...groups.entries()]
    .map(([variant_key, group]) => scoreVariant(variant_key, group, min_samples))
    .sort((a, b) => {
      const rec = recommendationRank(b.recommendation) - recommendationRank(a.recommendation);
      if (rec !== 0) return rec;
      return b.utility_score - a.utility_score;
    });

  return {
    workspace_id: input.workspace_id,
    generated_at: new Date().toISOString(),
    min_samples,
    summary: summarizeStrategy(variants),
    variants,
  };
}

function scoreVariant(
  variant_key: string,
  group: {
    play_run_ids: Set<string>;
    play_id: string;
    play_name: string;
    rep_id: string | null;
    rep_name: string | null;
    channel: string | null;
    skill_key: string;
    pattern_key: string;
    segment_key: string;
    outcomes: CampaignOptimizerOutcomeInput[];
  },
  minSamples: number,
): CampaignVariantScore {
  const sample_count = group.play_run_ids.size;
  const outcome_count = group.outcomes.length;
  const reply_outcomes = group.outcomes.filter((outcome) => outcome.kind === "positive_reply").length;
  const positive_outcomes = group.outcomes.filter((outcome) => OUTCOME_WEIGHTS[outcome.kind] > 0).length;
  const negative_outcomes = group.outcomes.filter((outcome) => OUTCOME_WEIGHTS[outcome.kind] < 0).length;
  const meeting_outcomes = group.outcomes.filter((outcome) =>
    ["meeting_booked", "opportunity_created", "deal_won"].includes(outcome.kind)
  ).length;
  const reply_rate = outcomeRate(reply_outcomes, sample_count);
  const positive_outcome_rate = outcomeRate(positive_outcomes, sample_count);
  const meeting_rate = outcomeRate(meeting_outcomes, sample_count);
  const negative_outcome_rate = outcomeRate(negative_outcomes, sample_count);
  const weighted = group.outcomes.reduce(
    (sum, outcome) => sum + weightedOutcome(outcome),
    0,
  );
  const denominator = Math.max(sample_count, outcome_count, 1);
  const utility_score = clamp01(0.5 + weighted / denominator / 2);
  const confidence = clamp01(Math.min(sample_count, minSamples) / minSamples);
  const recommendation = recommend({
    sample_count,
    minSamples,
    utility_score,
    positive_outcomes,
    negative_outcomes,
    meeting_outcomes,
  });
  return {
    variant_key,
    play_id: group.play_id,
    play_name: group.play_name,
    rep_id: group.rep_id,
    rep_name: group.rep_name,
    channel: group.channel,
    skill_key: group.skill_key,
    pattern_key: group.pattern_key,
    segment_key: group.segment_key,
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
    utility_score,
    confidence,
    allocation_weight: allocationWeight(recommendation, utility_score, confidence),
    recommendation,
    explanation: explainVariant({
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
    }),
  };
}

function weightedOutcome(outcome: CampaignOptimizerOutcomeInput): number {
  const base = OUTCOME_WEIGHTS[outcome.kind];
  const score = numericOrNull(outcome.score);
  return score == null ? base : base * Math.max(0.25, Math.min(1, score));
}

function recommend(input: {
  sample_count: number;
  minSamples: number;
  utility_score: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
}): CampaignOptimizerRecommendation {
  if (input.sample_count < input.minSamples) return "not_enough_proof";
  if (input.negative_outcomes > 0 && input.utility_score < 0.48) return "reduce";
  if (
    input.utility_score >= 0.62 &&
    (input.meeting_outcomes > 0 || input.positive_outcomes >= 2)
  ) {
    return "double_down";
  }
  return "hold";
}

function allocationWeight(
  recommendation: CampaignOptimizerRecommendation,
  utility: number,
  confidence: number,
): number {
  if (recommendation === "double_down") return round2(Math.min(0.7, 0.4 + utility * confidence * 0.3));
  if (recommendation === "reduce") return 0.05;
  if (recommendation === "not_enough_proof") return 0.15;
  return 0.25;
}

function explainVariant(input: {
  recommendation: CampaignOptimizerRecommendation;
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
}): string {
  if (input.recommendation === "not_enough_proof") {
    return `Only ${input.sample_count}/${input.minSamples} samples. Keep exploration small until reply and outcome rates have enough proof.`;
  }
  if (input.recommendation === "reduce") {
    return `${percent(input.negative_outcome_rate)} negative outcome rate pulled utility to ${input.utility_score.toFixed(2)}. Reduce volume and inspect the skill.`;
  }
  if (input.recommendation === "double_down") {
    return `${percent(input.reply_rate)} reply rate and ${percent(input.positive_outcome_rate)} positive outcome rate with ${input.meeting_outcomes} meeting/pipeline win${input.meeting_outcomes === 1 ? "" : "s"}. Double down cautiously.`;
  }
  return `Reply rate ${percent(input.reply_rate)} and positive outcome rate ${percent(input.positive_outcome_rate)} are stable but not decisive. Hold allocation and keep learning.`;
}

function summarizeStrategy(variants: CampaignVariantScore[]): string {
  const doubles = variants.filter((variant) => variant.recommendation === "double_down").length;
  const reduces = variants.filter((variant) => variant.recommendation === "reduce").length;
  const exploring = variants.filter((variant) => variant.recommendation === "not_enough_proof").length;
  if (variants.length === 0) return "No campaign variants have enough activity yet.";
  return `${doubles} variants ready to double down, ${reduces} should reduce, ${exploring} still need exploration.`;
}

function variantFromRun(run: CampaignOptimizerPlayRunInput): {
  variant_key: string;
  channel: string | null;
  skill_key: string;
  pattern_key: string;
  segment_key: string;
} {
  const channel = clean(run.channel);
  const pattern_key = clean(run.pattern_key) ?? `play:${run.play_id}|stage:campaign_outcome`;
  const skill_key = clean(run.skill_key) ?? pattern_key;
  const segment_key = clean(run.segment_key) ?? "all";
  return {
    variant_key: [
      `play:${run.play_id}`,
      `skill:${skill_key}`,
      `channel:${channel ?? "any"}`,
      `segment:${segment_key}`,
    ].join("|"),
    channel,
    skill_key,
    pattern_key,
    segment_key,
  };
}

function recommendationRank(recommendation: CampaignOptimizerRecommendation): number {
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

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
