import type { Pool } from "pg";
import { z } from "zod";
import type { EventBus, EventPayload } from "../substrate/events/index.ts";
import { isLLMBudgetExceededError } from "../agents/llm/budget.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import type { SignalKind } from "../primitives/signal.ts";
import { listIcps, type IcpRow } from "./icps.ts";
import { ensureBudgetRow, reserveClassify } from "./budget.ts";
import {
  buildHybridIcpShortlist,
  HYBRID_RANKER_CONFIG,
  type HybridIcpCandidate,
} from "./hybrid-ranker.ts";

/**
 * Stage 2 classifier — the LLM-bearing step that turns an ingested signal
 * into a matched (or dismissed) one. Subscribed to `signal.ingested` by
 * `classify-workflow.ts`; runs ONE signal per call.
 *
 *   1. Load the workspace's enabled ICPs.
 *   2. Reserve a classify slot against the workspace's daily budget.
 *   3. Run hybrid retrieval: must_haves gate + vector + graph + intent
 *      ranking, then keep only the top-N shortlist.
 *   4. Build a prompt with the signal + shortlist, ask DeepSeek for a
 *      JSON object that CONFIRMS the shortlist rather than finding ICPs:
 *        { kind, per_icp: [{ icp_id, score, reason }], dismissal_reason? }
 *   5. Emit `signal.classification.completed`; the Signal projector owns
 *      row mutation and emits `signal.matched`/`signal.dismissed`.
 *
 * Per-segment matching: a single signal can match MULTIPLE ICP segments
 * in a workspace (Team plan workspaces have several segments). Each gets
 * its own `signal.matched` event with `icp_segment` in the payload.
 */

const SIGNAL_KINDS = [
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
] as const satisfies ReadonlyArray<SignalKind>;

const PerIcpScore = z.object({
  icp_id: z.string(),
  score: z.number().min(0).max(1),
  reason: z.string().default(""),
});

const ClassifyOutput = z.object({
  kind: z.enum(SIGNAL_KINDS),
  per_icp: z.array(PerIcpScore).default([]),
  dismissal_reason: z.string().optional(),
});
type ClassifyOutput = z.infer<typeof ClassifyOutput>;

const SYSTEM_PROMPT = `You confirm a deterministic hybrid-ranked shortlist of outbound-GTM ICP matches.

For a given signal (a job posting, a funding round, a leadership change, a press mention, etc.) you do TWO things:

  1. Pick the single best signal kind from this fixed list:
       funding · hiring · leadership_change · product_launch ·
       acquisition · churn_risk · competitor_move · podcast_mention ·
       press_mention · regulation · expansion · layoff · other

  2. Score the signal against EACH ICP segment provided in the shortlist. Score is 0..1.
     - 0.0     unrelated; the ICP doesn't care.
     - 0.5     plausibly relevant; not a clear fit.
     - 0.8+    strong fit; worth reaching out about.
     Provide a one-sentence reason per ICP.

Rules:
  - Only score the shortlist candidates provided.
  - Do not invent, add, or rename ICP ids.
  - Treat the hybrid scores as priors to confirm or down-rank, not as text to copy.

Respond with a single JSON object and nothing else:

{
  "kind": "<one of the kinds>",
  "per_icp": [
    { "icp_id": "<id from input>", "score": 0..1, "reason": "string" }
  ],
  "dismissal_reason": "string (only if every score is below all thresholds)"
}`;

interface SignalRow {
  id: string;
  workspace_id: string;
  kind: SignalKind | null;
  title: string;
  content: string | null;
  url: string | null;
  properties: Record<string, unknown> | null;
  structured: Record<string, unknown> | null;
  freshness_at: Date;
  related_company_id: string | null;
}

export interface ClassifyDeps {
  pool: Pool;
  bus: EventBus;
  llm: LLMClient;
  /** Optional event correlation for workflow-owned classifier calls. */
  correlation_id?: string | null;
  /** Optional causation event id for workflow-owned classifier calls. */
  causation_id?: string | null;
  /** Optional producer reference for the classification event. */
  producer_ref?: string;
  /** Optional override of the model id for classifier batches. */
  model?: string;
  /** Optional override of the temperature. Default 0.1. */
  temperature?: number;
  /** Optional override of the hybrid shortlist bound. Default 5. */
  hybrid_shortlist_limit?: number;
  /** Optional override of the bounded hybrid history window. */
  hybrid_history_signal_limit?: number;
}

export interface ClassifyInput {
  signal_id: string;
}

export type ClassifyOutcome =
  | {
      status: "matched";
      matched_icp_ids: string[];
      kind: SignalKind;
      match_score: number;
      match_reason: string;
      matches: Array<{ icp_segment: string; match_score: number; reason: string }>;
    }
  | { status: "dismissed"; reason: string }
  | { status: "skipped"; reason: "no_icps" | "budget" | "not_found" | "non_json" | "filtered" };

function buildUserPrompt(row: SignalRow, shortlist: HybridIcpCandidate[]): string {
  const quality = signalQualityContext(row);
  const lines: string[] = [
    `Signal:`,
    `  id: ${row.id}`,
    `  kind: ${row.kind ?? "(unknown — classify)"}`,
    `  title: ${row.title}`,
    row.url ? `  url: ${row.url}` : "",
    row.content ? `  content: ${row.content.slice(0, 1500)}` : "",
    `  freshness_at: ${row.freshness_at.toISOString()}`,
    row.structured ? `  structured: ${JSON.stringify(row.structured).slice(0, 600)}` : "",
    quality ? `  quality: ${JSON.stringify(quality).slice(0, 900)}` : "",
    "",
    `Hybrid-ranked ICP shortlist to confirm:`,
  ];
  for (const [index, candidate] of shortlist.entries()) {
    const { icp, scores } = candidate;
    lines.push(`  - rank: ${index + 1}`);
    lines.push(`    icp_id: ${icp.id}`);
    lines.push(`    name: ${icp.name}`);
    lines.push(`    description: ${icp.description.slice(0, 600)}`);
    if (icp.nice_to_haves.length > 0) {
      lines.push(`    nice_to_haves: ${icp.nice_to_haves.slice(0, 10).join(", ")}`);
    }
    lines.push(`    threshold: ${icp.match_threshold}`);
    lines.push(
      `    hybrid_scores: ${JSON.stringify({
        vec_sim: scores.vec_sim,
        graph_prox: scores.graph_prox,
        intent_prior: scores.intent_prior,
        hybrid_score: scores.hybrid_score,
        passed_must_haves: scores.passed_must_haves,
      })}`,
    );
  }
  lines.push("");
  lines.push("Return ONLY the JSON object.");
  return lines.filter(Boolean).join("\n");
}

const RETRY_SYSTEM_PROMPT = `Your previous response was not valid JSON. Return ONLY the JSON object — no prose, no code fences, no explanation. Start with { and end with }.`;

async function callClassifier(
  deps: ClassifyDeps,
  signal: SignalRow,
  shortlist: HybridIcpCandidate[],
): Promise<ClassifyOutput | null> {
  const userPrompt = buildUserPrompt(signal, shortlist);
  const baseRequest = {
    model: deps.model,
    temperature: deps.temperature ?? 0.1,
    max_tokens: 1200,
    response_format: { type: "json_object" as const },
  };
  const firstResponse = await deps.llm.complete({
    ...baseRequest,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const firstParsed = parseClassifierJson(firstResponse.content);
  if (firstParsed) return firstParsed;

  const retryResponse = await deps.llm.complete({
    ...baseRequest,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
      { role: "assistant", content: firstResponse.content },
      { role: "system", content: RETRY_SYSTEM_PROMPT },
    ],
  });
  return parseClassifierJson(retryResponse.content);
}

function parseClassifierJson(content: string): ClassifyOutput | null {
  const extracted = extractJsonObject(content);
  if (!extracted) return null;
  try {
    return ClassifyOutput.parse(JSON.parse(extracted));
  } catch {
    return null;
  }
}

function extractJsonObject(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith("{") && inner.endsWith("}")) return inner;
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return null;
}

export async function classifySignal(
  deps: ClassifyDeps,
  input: ClassifyInput,
): Promise<ClassifyOutcome> {
  const { rows } = await deps.pool.query<SignalRow>(
    `select id, workspace_id, kind::text as kind, title, content, url,
            properties, properties->'structured' as structured, freshness_at,
            related_company_id::text as related_company_id
       from signals where id = $1`,
    [input.signal_id],
  );
  const signal = rows[0];
  if (!signal) {
    return { status: "skipped", reason: "not_found" };
  }

  const icps = await listIcps(deps.pool, signal.workspace_id, { only_enabled: true });
  if (icps.length === 0) {
    // A workspace without ICPs is intentionally not scored against anything.
    await emitClassification(deps, signal, {
      kind: signal.kind,
      disposition: "dismissed",
      match_score: null,
      match_reason: "no_icps",
      audience_hint: { dismissal_reason: "no_icps" },
      matches: [],
    });
    return { status: "skipped", reason: "no_icps" };
  }

  const hybridShortlist = await buildHybridIcpShortlist(deps.pool, {
    signal,
    icps,
    shortlist_limit: deps.hybrid_shortlist_limit ?? HYBRID_RANKER_CONFIG.shortlist_limit,
    history_signal_limit:
      deps.hybrid_history_signal_limit ?? HYBRID_RANKER_CONFIG.history_signal_limit,
  });
  if (hybridShortlist.ranked_candidates.length === 0) {
    await emitClassification(deps, signal, {
      kind: signal.kind,
      disposition: "dismissed",
      match_score: null,
      match_reason: "must_haves_failed",
      audience_hint: { dismissal_reason: "must_haves_failed" },
      matches: [],
    });
    return { status: "skipped", reason: "filtered" };
  }
  const shortlistedCandidates = hybridShortlist.shortlist;
  const shortlistedIcps = shortlistedCandidates.map((candidate) => candidate.icp);

  // Reserve an LLM-bearing call against the daily classify cap.
  await ensureBudgetRow(deps.pool, signal.workspace_id);
  const reserved = await reserveClassify(deps.pool, signal.workspace_id);
  if (!reserved) {
    return { status: "skipped", reason: "budget" };
  }

  let parsed: ClassifyOutput | null;
  try {
    parsed = await callClassifier(deps, signal, shortlistedCandidates);
  } catch (error) {
    // Budget exhaustion is an expected gating decision, not a workflow
    // failure. Returning it lets the durable matching workflow park until the
    // next budget window instead of letting Restate retry a 500 in a hot loop.
    if (isLLMBudgetExceededError(error)) {
      return { status: "skipped", reason: "budget" };
    }
    throw error;
  }
  if (!parsed) {
    await emitClassification(deps, signal, {
      kind: signal.kind,
      disposition: "dismissed",
      match_score: null,
      match_reason: "classifier_non_json",
      audience_hint: { dismissal_reason: "classifier_non_json" },
      matches: [],
    });
    return { status: "skipped", reason: "non_json" };
  }

  // Decide matched ICPs: per-ICP score >= that ICP's threshold.
  const matched: Array<{ icp: IcpRow; score: number; reason: string }> = [];
  const icpById = new Map(shortlistedIcps.map((icp) => [icp.id, icp]));
  for (const entry of parsed.per_icp) {
    const icp = icpById.get(entry.icp_id);
    if (!icp) continue;
    if (entry.score >= icp.match_threshold) {
      matched.push({ icp, score: entry.score, reason: entry.reason });
    }
  }

  if (matched.length === 0) {
    const reason =
      parsed.dismissal_reason ??
      `below_threshold (best=${Math.max(
        0,
        ...parsed.per_icp.map((p) => p.score),
      ).toFixed(2)})`;
    await emitClassification(deps, signal, {
      kind: parsed.kind,
      disposition: "dismissed",
      match_score: null,
      match_reason: reason,
      audience_hint: { dismissal_reason: reason },
      matches: [],
    });
    return { status: "dismissed", reason };
  }

  // Best match wins for the row-level match_score; per-ICP events
  // capture the granular fan-out.
  const best = matched.reduce((a, b) => (b.score > a.score ? b : a));
  const audience_hint = {
    matched_icps: matched.map((m) => ({
      icp_id: m.icp.id,
      name: m.icp.name,
      score: m.score,
      reason: m.reason,
    })),
    classified_kind: parsed.kind,
  };
  await emitClassification(deps, signal, {
    kind: parsed.kind,
    disposition: "matched",
    match_score: best.score,
    match_reason: best.reason,
    audience_hint,
    matches: matched.map((m) => ({
      icp_segment: m.icp.id,
      match_score: m.score,
      reason: m.reason,
    })),
  });

  return {
    status: "matched",
    matched_icp_ids: matched.map((m) => m.icp.id),
    kind: parsed.kind,
    match_score: best.score,
    match_reason: best.reason,
    matches: matched.map((m) => ({
      icp_segment: m.icp.id,
      match_score: m.score,
      reason: m.reason,
    })),
  };
}

function signalQualityContext(row: SignalRow): Record<string, unknown> | null {
  const properties = row.properties ?? {};
  const ctx: Record<string, unknown> = {};
  copyIfPresent(ctx, properties, "source_tier");
  copyIfPresent(ctx, properties, "source_authority");
  copyIfPresent(ctx, properties, "source_confidence");
  copyIfPresent(ctx, properties, "source_credibility");
  copyIfPresent(ctx, properties, "buying_intent");
  copyIfPresent(ctx, properties, "timing");
  copyIfPresent(ctx, properties, "signal_quality");
  return Object.keys(ctx).length > 0 ? ctx : null;
}

function copyIfPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  if (source[key] !== undefined && source[key] !== null) {
    target[key] = source[key];
  }
}

async function emitClassification(
  deps: ClassifyDeps,
  signal: SignalRow,
  payload: Omit<EventPayload<"signal.classification.completed">, "signal_id">,
): Promise<void> {
  await deps.bus.publish({
    workspace_id: signal.workspace_id,
    event_type: "signal.classification.completed",
    source: "system",
    producer_ref: deps.producer_ref ?? "ingest:classify",
    correlation_id: deps.correlation_id ?? undefined,
    causation_id: deps.causation_id ?? undefined,
    idempotency_key: `classification:${signal.id}`,
    payload: {
      signal_id: signal.id,
      ...payload,
    },
  });
}
