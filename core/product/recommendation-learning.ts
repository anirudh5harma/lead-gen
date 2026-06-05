import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventBus,
  PublishedEvent,
} from "../substrate/events/index.ts";

type RecommendationKind = "content_opportunity" | "aeo_gap";
type RecommendationDecision = "accepted" | "ignored";

interface RecommendationItem {
  title?: string;
  detail?: string;
  url?: string | null;
  evidence_source_ids?: string[];
}

export interface RecommendationOutcomeLearningExemplarInput {
  review_kind: RecommendationKind;
  review_id: string;
  source_event_id: string;
  outcome_kind: string;
  item: RecommendationItem;
  external_ref?: string | null;
}

export interface RecommendationReviewRow {
  review_id: string;
  decision: RecommendationDecision | string;
  item: RecommendationItem | null;
  occurred_at: Date;
}

interface RecommendationRepRow {
  id: string;
  role: string;
}

export interface RecommendationLearningSummary {
  review_kind: RecommendationKind;
  accepted: number;
  ignored: number;
  acceptance_rate: number;
  accepted_samples: RecommendationReviewRow[];
  ignored_samples: RecommendationReviewRow[];
}

export interface RecommendationLearningProjectionOptions {
  pool: Pool;
  bus: Pick<EventBus, "publish">;
  minAccepted?: number;
  minAcceptanceRate?: number;
}

export const RECOMMENDATION_LEARNING_PROJECTION =
  "recommendation.learning_to_procedural_memory.v1";

export function createRecommendationLearningProjection(
  opts: RecommendationLearningProjectionOptions,
): DurableEventProjection {
  const minAccepted = opts.minAccepted ?? 3;
  const minAcceptanceRate = opts.minAcceptanceRate ?? 0.5;
  return {
    name: RECOMMENDATION_LEARNING_PROJECTION,
    eventTypes: ["recommendation.reviewed"],
    async apply(event) {
      const payload = event.payload as {
        review_kind?: string;
        decision?: string;
      };
      if (payload.decision !== "accepted") return;
      if (payload.review_kind !== "content_opportunity" && payload.review_kind !== "aeo_gap") {
        return;
      }

      const summary = await getRecommendationLearningSummary(
        opts.pool,
        event.workspace_id,
        payload.review_kind,
      );
      if (
        summary.accepted < minAccepted ||
        summary.acceptance_rate < minAcceptanceRate
      ) {
        return;
      }

      const reps = await getActiveRecommendationLearningReps(
        opts.pool,
        event.workspace_id,
        summary.review_kind,
      );
      for (const rep of reps) {
        await publishRecommendationLearningSeed(opts.bus, event, rep.id, summary);
      }
    },
  };
}

async function getRecommendationLearningSummary(
  pool: Pool,
  workspace_id: string,
  review_kind: RecommendationKind,
): Promise<RecommendationLearningSummary> {
  const { rows } = await pool.query<RecommendationReviewRow>(
    `with latest as (
       select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              payload->>'decision' as decision,
              payload->'item' as item,
              occurred_at
         from events
        where workspace_id = $1
          and event_type = 'recommendation.reviewed'
          and payload->>'review_kind' = $2
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc
     )
     select review_id, decision, item, occurred_at
       from latest
      where decision in ('accepted', 'ignored')
      order by occurred_at desc`,
    [workspace_id, review_kind],
  );
  const accepted_samples = rows.filter((row) => row.decision === "accepted").slice(0, 3);
  const ignored_samples = rows.filter((row) => row.decision === "ignored").slice(0, 3);
  const accepted = rows.filter((row) => row.decision === "accepted").length;
  const ignored = rows.filter((row) => row.decision === "ignored").length;
  return {
    review_kind,
    accepted,
    ignored,
    acceptance_rate: rows.length > 0 ? accepted / rows.length : 0,
    accepted_samples,
    ignored_samples,
  };
}

async function getActiveRecommendationLearningReps(
  pool: Pool,
  workspace_id: string,
  review_kind: RecommendationKind,
): Promise<RecommendationRepRow[]> {
  const { rows } = await pool.query<RecommendationRepRow>(
    `select id, role::text as role
       from reps
      where workspace_id = $1
        and status = 'active'
        and role::text = $2
      order by created_at asc
      limit 8`,
    [workspace_id, recommendationLearningRepRole(review_kind)],
  );
  return rows;
}

function recommendationLearningRepRole(review_kind: RecommendationKind): "content" | "researcher" {
  return review_kind === "content_opportunity" ? "content" : "researcher";
}

async function publishRecommendationLearningSeed(
  bus: Pick<EventBus, "publish">,
  event: PublishedEvent,
  rep_id: string,
  summary: RecommendationLearningSummary,
): Promise<void> {
  const exemplar = buildRecommendationLearningExemplar(summary);
  const digest = createHash("sha256")
    .update(JSON.stringify({
      review_kind: summary.review_kind,
      accepted_review_ids: summary.accepted_samples.map((sample) => sample.review_id),
      ignored_review_ids: summary.ignored_samples.map((sample) => sample.review_id),
    }))
    .digest("hex")
    .slice(0, 16);

  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "rep.memory.procedural.seeded",
    source: "system",
    producer_ref: "projection:recommendation.learning",
    correlation_id: event.correlation_id ?? event.id,
    causation_id: event.id,
    idempotency_key:
      `recommendation-learning:${event.workspace_id}:${rep_id}:${summary.review_kind}:${digest}`,
    payload: {
      exemplar_id: randomUUID(),
      rep_id,
      pattern_key: recommendationLearningPatternKey(summary.review_kind),
      exemplar,
      initial_score: recommendationLearningInitialScore(summary.acceptance_rate),
    },
  });
}

export function buildRecommendationLearningExemplar(
  summary: RecommendationLearningSummary,
): Record<string, unknown> {
  return {
    kind: "exa_recommendation_learning",
    review_kind: summary.review_kind,
    accepted: summary.accepted,
    ignored: summary.ignored,
    acceptance_rate: Number(summary.acceptance_rate.toFixed(2)),
    guidance: recommendationLearningGuidance(summary.review_kind),
    kept_examples: summary.accepted_samples.map((sample) => ({
      title: sample.item?.title ?? "Untitled recommendation",
      detail: sample.item?.detail ?? "",
      url: sample.item?.url ?? null,
      evidence_source_ids: sample.item?.evidence_source_ids ?? [],
    })),
    skipped_examples: summary.ignored_samples.map((sample) => ({
      title: sample.item?.title ?? "Untitled recommendation",
      detail: sample.item?.detail ?? "",
      url: sample.item?.url ?? null,
    })),
  };
}

export function buildRecommendationOutcomeLearningExemplar(
  input: RecommendationOutcomeLearningExemplarInput,
): Record<string, unknown> {
  return {
    kind: "exa_recommendation_outcome",
    review_kind: input.review_kind,
    review_id: input.review_id,
    source_event_id: input.source_event_id,
    outcome_kind: input.outcome_kind,
    external_ref: input.external_ref ?? null,
    kept_example: {
      title: input.item.title ?? "Accepted recommendation",
      detail: input.item.detail ?? "",
      url: input.item.url ?? null,
      evidence_source_ids: input.item.evidence_source_ids ?? [],
    },
    guidance:
      input.review_kind === "content_opportunity"
        ? "Use this published Vaani recommendation as a concrete example of content evidence that turned into a real Outcome."
        : "Use this Bodh recommendation as a concrete example of an AEO gap that turned into a real visibility Outcome.",
  };
}

function recommendationLearningPatternKey(review_kind: RecommendationKind): string {
  return `recommendation:${review_kind}|stage:exa_review`;
}

function recommendationLearningGuidance(review_kind: RecommendationKind): string {
  if (review_kind === "content_opportunity") {
    return "Bias future Content research toward evidence patterns operators kept; avoid skipped angles unless fresh proof changes the context.";
  }
  return "Bias future AEO audits toward visibility gaps operators kept; avoid skipped answer gaps unless fresh proof changes the context.";
}

function recommendationLearningInitialScore(acceptance_rate: number): number {
  return Number(Math.min(0.72, 0.52 + acceptance_rate * 0.2).toFixed(2));
}
