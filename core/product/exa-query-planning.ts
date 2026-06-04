import type { Pool } from "pg";

type ExaPlanningIntent =
  | "rep_research"
  | "brief_refresh"
  | "draft_grounding"
  | "content_research"
  | "aeo_audit";

type RecommendationPlanningKind = "content_opportunity" | "aeo_gap";

interface ProceduralMemoryRow {
  id: string;
  pattern_key: string;
  exemplar: Record<string, unknown>;
  score: string;
}

export interface ProductExaQueryPlan {
  source: "procedural_memory";
  pattern_key: string;
  exemplar_ids: string[];
  kept_examples: string[];
  skipped_examples: string[];
}

export interface PlannedExaResearchQuery {
  original_query: string;
  query: string;
  query_plan?: ProductExaQueryPlan;
}

export async function planExaResearchQuery(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: ExaPlanningIntent;
    query: string;
  },
): Promise<PlannedExaResearchQuery> {
  const reviewKind = recommendationKindForIntent(input.intent);
  if (!reviewKind) {
    return { original_query: input.query, query: input.query };
  }

  const patternKey = recommendationResearchPatternKey(reviewKind);
  const { rows } = await pool.query<ProceduralMemoryRow>(
    `select rpm.id::text as id,
            rpm.pattern_key,
            rpm.exemplar,
            rpm.score::text as score
       from rep_memory_procedural rpm
       join reps r
         on r.id = rpm.rep_id
        and r.workspace_id = rpm.workspace_id
      where rpm.workspace_id = $1
        and rpm.pattern_key = $2
        and r.status = 'active'
      order by rpm.score desc, rpm.created_at desc
      limit 3`,
    [input.workspace_id, patternKey],
  );
  if (rows.length === 0) {
    return { original_query: input.query, query: input.query };
  }

  const kept = uniqueLines(rows.flatMap((row) => exemplarTitles(row.exemplar.kept_examples)));
  const skipped = uniqueLines(rows.flatMap((row) => exemplarTitles(row.exemplar.skipped_examples)));
  if (kept.length === 0 && skipped.length === 0) {
    return { original_query: input.query, query: input.query };
  }

  return {
    original_query: input.query,
    query: appendRecommendationMemoryToQuery(input.query, kept, skipped),
    query_plan: {
      source: "procedural_memory",
      pattern_key: patternKey,
      exemplar_ids: rows.map((row) => row.id),
      kept_examples: kept.slice(0, 6),
      skipped_examples: skipped.slice(0, 6),
    },
  };
}

export function recommendationResearchPatternKey(
  reviewKind: RecommendationPlanningKind,
): string {
  return `recommendation:${reviewKind}|stage:exa_review`;
}

function recommendationKindForIntent(
  intent: ExaPlanningIntent,
): RecommendationPlanningKind | null {
  if (intent === "content_research") return "content_opportunity";
  if (intent === "aeo_audit") return "aeo_gap";
  return null;
}

function appendRecommendationMemoryToQuery(
  query: string,
  kept: string[],
  skipped: string[],
): string {
  return [
    query,
    kept.length > 0 ? `operator kept evidence patterns: ${kept.slice(0, 4).join("; ")}` : null,
    skipped.length > 0 ? `avoid operator skipped patterns: ${skipped.slice(0, 3).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400);
}

function exemplarTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const title = (item as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? [title.trim()] : [];
  });
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}
