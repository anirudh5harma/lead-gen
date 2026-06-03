import type { GraphCompany, GraphPerson } from "../graph/types.ts";
import type { Signal } from "../primitives/index.ts";
import type { ResearchResult } from "../agents/reps/roles/researcher.ts";
import type { ExaSignalInfluence } from "./exa-influence.ts";

export interface DraftGroundingProviderInput {
  workspace_id: string;
  play_id: string;
  play_run_id: string;
  rep_id: string;
  signal: Signal;
  person: GraphPerson;
  company?: GraphCompany | null;
  channel: "email" | "linkedin";
  query: string;
}

export interface DraftGroundingResult {
  request_id: string | null;
  evidence_source_ids: string[];
  summary: string;
}

export type DraftGroundingProvider = (
  input: DraftGroundingProviderInput,
) => Promise<DraftGroundingResult | null | undefined>;

const STALE_EVIDENCE_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldGroundDraftWithExa(
  signal: Signal,
  influence: ExaSignalInfluence | null,
): boolean {
  if (!influence || influence.evidence_urls.length === 0) return true;
  const freshness = Date.parse(signal.freshness_at);
  if (!Number.isFinite(freshness)) return true;
  return Date.now() - freshness > STALE_EVIDENCE_MS;
}

export function buildDraftGroundingQuery(input: Omit<DraftGroundingProviderInput, "query">): string {
  return [
    input.company?.name,
    input.company?.domain,
    input.person.full_name,
    input.person.title,
    input.signal.title,
    input.signal.content,
    input.signal.url,
    "fresh public web evidence for factual outreach grounding",
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function applyDraftGrounding(
  research: ResearchResult,
  grounding: DraftGroundingResult | null | undefined,
): ResearchResult {
  if (!grounding?.summary.trim()) return research;
  return {
    ...research,
    signal_summary: [
      research.signal_summary,
      "Fresh Exa grounding:",
      grounding.summary,
    ].join("\n"),
  };
}

export function draftGroundingProvenance(
  grounding: DraftGroundingResult | null | undefined,
): Record<string, unknown> | null {
  if (!grounding) return null;
  return {
    request_id: grounding.request_id,
    evidence_source_ids: grounding.evidence_source_ids,
    summary: grounding.summary,
  };
}
