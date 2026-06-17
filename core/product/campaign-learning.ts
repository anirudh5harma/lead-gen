export interface CampaignLearningExemplarInput {
  play_id: string;
  play_run_id: string;
  play_name: string;
  rep_name?: string | null;
  outcome_kind: string;
  output?: Record<string, unknown> | null;
  note?: string | null;
}

const EXEMPLAR_OUTPUT_KEYS = [
  "title",
  "summary",
  "decision",
  "lift",
  "angle",
  "audience",
  "channel",
  "cta",
  "subject",
  "body",
  "steps",
] as const;

export function campaignOutcomePatternKey(play_id: string): string {
  return `play:${play_id}|stage:campaign_outcome`;
}

export function buildCampaignOutcomeLearningExemplar(
  input: CampaignLearningExemplarInput,
): Record<string, unknown> {
  return {
    play_id: input.play_id,
    play_run_id: input.play_run_id,
    play_name: input.play_name,
    rep_name: input.rep_name ?? null,
    outcome_kind: input.outcome_kind,
    note: input.note?.trim() || null,
    output: compactCampaignOutput(input.output),
    guidance:
      "Use this Play run as a campaign-agent exemplar when a similar Play needs a sharper next bet.",
  };
}

function compactCampaignOutput(
  output: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!output) return null;
  const compact: Record<string, unknown> = {};
  for (const key of EXEMPLAR_OUTPUT_KEYS) {
    const value = output[key];
    if (typeof value === "string" && value.trim()) {
      compact[key] = value.trim();
    } else if (typeof value === "number" && Number.isFinite(value)) {
      compact[key] = value;
    } else if (typeof value === "boolean") {
      compact[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      compact[key] = value.slice(0, 6);
    }
  }
  return Object.keys(compact).length > 0 ? compact : null;
}
