import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  buildRecommendationLearningExemplar,
  createRecommendationLearningProjection,
} from "../core/product/recommendation-learning.ts";
import type { PublishedEvent } from "../core/substrate/events/index.ts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const repId = "00000000-0000-4000-8000-000000000002";

test("recommendation learning exemplar captures kept and skipped patterns", () => {
  const exemplar = buildRecommendationLearningExemplar({
    review_kind: "content_opportunity",
    accepted: 3,
    ignored: 1,
    acceptance_rate: 0.75,
    accepted_samples: [
      reviewRow("accepted", "Buyer comparison angle"),
      reviewRow("accepted", "Pricing objection angle"),
    ],
    ignored_samples: [reviewRow("ignored", "Generic launch recap")],
  });

  assert.equal(exemplar.kind, "exa_recommendation_learning");
  assert.equal(exemplar.review_kind, "content_opportunity");
  assert.equal(exemplar.acceptance_rate, 0.75);
  assert.match(String(exemplar.guidance), /future Content research/);
  assert.deepEqual(
    (exemplar.kept_examples as Array<{ title: string }>).map((item) => item.title),
    ["Buyer comparison angle", "Pricing objection angle"],
  );
  assert.deepEqual(
    (exemplar.skipped_examples as Array<{ title: string }>).map((item) => item.title),
    ["Generic launch recap"],
  );
});

test("recommendation learning projection waits for repeated accepted feedback", async () => {
  const published: unknown[] = [];
  const projection = createRecommendationLearningProjection({
    pool: fakePool({
      reviews: [
        reviewRow("accepted", "One kept angle"),
        reviewRow("ignored", "One skipped angle"),
      ],
      reps: [{ id: repId }],
    }),
    bus: {
      async publish(event) {
        published.push(event);
        return event as never;
      },
    },
  });

  await projection.apply(reviewedEvent());

  assert.equal(published.length, 0);
});

test("recommendation learning projection emits procedural seed after threshold", async () => {
  const published: Array<{
    event_type: string;
    idempotency_key?: string | null;
    payload: {
      rep_id: string;
      pattern_key: string;
      initial_score: number;
      exemplar: Record<string, unknown>;
    };
  }> = [];
  const projection = createRecommendationLearningProjection({
    pool: fakePool({
      reviews: [
        reviewRow("accepted", "Buyer comparison angle"),
        reviewRow("accepted", "Pricing objection angle"),
        reviewRow("accepted", "Competitor narrative angle"),
        reviewRow("ignored", "Generic launch recap"),
      ],
      reps: [{ id: repId }],
    }),
    bus: {
      async publish(event) {
        published.push(event as never);
        return event as never;
      },
    },
  });

  await projection.apply(reviewedEvent());

  assert.equal(published.length, 1);
  assert.equal(published[0]!.event_type, "rep.memory.procedural.seeded");
  assert.equal(published[0]!.payload.rep_id, repId);
  assert.equal(
    published[0]!.payload.pattern_key,
    "recommendation:content_opportunity|stage:exa_review",
  );
  assert.equal(published[0]!.payload.initial_score, 0.67);
  assert.match(published[0]!.idempotency_key ?? "", /recommendation-learning/);
  assert.equal(published[0]!.payload.exemplar.accepted, 3);
});

function reviewedEvent(): PublishedEvent {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    workspace_id: workspaceId,
    event_type: "recommendation.reviewed",
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "user",
    producer_ref: "user:test",
    idempotency_key: null,
    occurred_at: new Date("2026-06-04T10:00:00.000Z").toISOString(),
    payload: {
      review_id:
        "content_opportunity:00000000-0000-4000-8000-000000000020:abc123",
      review_kind: "content_opportunity",
      source_event_id: "00000000-0000-4000-8000-000000000020",
      decision: "accepted",
      item: {
        title: "Buyer comparison angle",
        detail: "Operators kept this.",
        evidence_source_ids: [],
      },
    },
  };
}

function reviewRow(decision: "accepted" | "ignored", title: string) {
  return {
    review_id: `${decision}:${title.toLowerCase().replace(/\W+/g, "-")}`,
    decision,
    item: {
      title,
      detail: `${title} detail`,
      url: "https://example.com",
      evidence_source_ids: ["00000000-0000-4000-8000-000000000030"],
    },
    occurred_at: new Date("2026-06-04T10:00:00.000Z"),
  };
}

function fakePool(input: {
  reviews: ReturnType<typeof reviewRow>[];
  reps: Array<{ id: string }>;
}): Pool {
  return {
    async query(sql: string) {
      if (sql.includes("from events")) return { rows: input.reviews };
      if (sql.includes("from reps")) return { rows: input.reps };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
}
