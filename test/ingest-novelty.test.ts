import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import {
  computeNoveltyKey,
  dedupCheck,
  probeExactDuplicate,
  probeFuzzyDuplicate,
  recordCollision,
} from "../core/ingest/novelty.ts";

async function seedSource(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "ws"],
  );
  const id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name)
     values ($1, $2, 'job_board', 'test')`,
    [id, ws],
  );
  return id;
}

async function insertCandidate(
  pool: Pool,
  sourceId: string,
  opts: { external_id?: string; novelty_key?: string; embedding?: number[]; kind?: string; freshness_at?: Date } = {},
): Promise<string> {
  const literal = opts.embedding ? `[${opts.embedding.join(",")}]` : null;
  const { rows } = await pool.query<{ id: string }>(
    `insert into signal_candidates (
       source_id, external_id, title, novelty_key, embedding, kind, freshness_at
     ) values ($1, $2, 'x', $3, $4::vector, $5, $6)
     returning id`,
    [
      sourceId,
      opts.external_id ?? `ext-${randomUUID()}`,
      opts.novelty_key ?? null,
      literal,
      opts.kind ?? null,
      opts.freshness_at ?? new Date(),
    ],
  );
  return rows[0].id;
}

// ─── computeNoveltyKey ─────────────────────────────────────────────────────

test("novelty key: deterministic for the same inputs", () => {
  const a = computeNoveltyKey({
    domain: "acme.com",
    kind: "funding",
    freshness_at: "2026-05-25T12:00:00Z",
  });
  const b = computeNoveltyKey({
    domain: "acme.com",
    kind: "funding",
    freshness_at: "2026-05-25T15:00:00Z", // same week, different time
  });
  assert.equal(a, b, "same week + same domain + same kind → same key");
});

test("novelty key: different week → different key", () => {
  const a = computeNoveltyKey({
    domain: "acme.com",
    kind: "funding",
    freshness_at: "2026-05-25T00:00:00Z",
  });
  const b = computeNoveltyKey({
    domain: "acme.com",
    kind: "funding",
    freshness_at: "2026-06-01T00:00:00Z",
  });
  assert.notEqual(a, b);
});

test("novelty key: domain is case-insensitive", () => {
  const a = computeNoveltyKey({
    domain: "Acme.COM",
    kind: "hiring",
    freshness_at: "2026-05-25T00:00:00Z",
  });
  const b = computeNoveltyKey({
    domain: "acme.com",
    kind: "hiring",
    freshness_at: "2026-05-25T00:00:00Z",
  });
  assert.equal(a, b);
});

test("novelty key: empty domain still produces a key", () => {
  const key = computeNoveltyKey({
    domain: "",
    kind: "unknown",
    freshness_at: "2026-05-25T00:00:00Z",
  });
  assert.equal(typeof key, "string");
  assert.ok(key.length === 64);
});

// ─── probeExactDuplicate ───────────────────────────────────────────────────

test("exact probe: returns null when no collision", async (t) => {
  const fx = await setupPg("nov_exact_miss");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const result = await probeExactDuplicate(fx.pool, "ffffff");
    assert.equal(result.matched_id, null);
  } finally {
    await fx.close();
  }
});

test("exact probe: finds active candidate with matching novelty_key", async (t) => {
  const fx = await setupPg("nov_exact_hit");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const id = await insertCandidate(fx.pool, sourceId, {
      novelty_key: "deadbeef",
    });
    const result = await probeExactDuplicate(fx.pool, "deadbeef");
    assert.equal(result.matched_id, id);
  } finally {
    await fx.close();
  }
});

test("exact probe: ignores expired candidates", async (t) => {
  const fx = await setupPg("nov_exact_expired");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const id = await insertCandidate(fx.pool, sourceId, {
      novelty_key: "expired-key",
    });
    await fx.pool.query(
      `update signal_candidates set status = 'expired', expired_at = now() where id = $1`,
      [id],
    );
    const result = await probeExactDuplicate(fx.pool, "expired-key");
    assert.equal(result.matched_id, null);
  } finally {
    await fx.close();
  }
});

// ─── probeFuzzyDuplicate ───────────────────────────────────────────────────

test("fuzzy probe: returns null when no candidate within window", async (t) => {
  const fx = await setupPg("nov_fuzzy_empty");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["alpha"]);
    const result = await probeFuzzyDuplicate(fx.pool, v);
    assert.equal(result.matched_id, null);
  } finally {
    await fx.close();
  }
});

test("fuzzy probe: identical vectors collide above threshold", async (t) => {
  const fx = await setupPg("nov_fuzzy_hit");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["acme raises 20m"]);
    const existing = await insertCandidate(fx.pool, sourceId, { embedding: v });

    // Same exact embedding → cosine sim = 1 → collide above threshold.
    const result = await probeFuzzyDuplicate(fx.pool, v, { threshold: 0.85 });
    assert.equal(result.matched_id, existing);
    assert.ok((result.similarity ?? 0) > 0.99);
  } finally {
    await fx.close();
  }
});

test("fuzzy probe: distant vectors do not collide", async (t) => {
  const fx = await setupPg("nov_fuzzy_miss");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const embedder = createMockEmbeddingClient();
    const [v1] = await embedder.embed(["acme raises 20m"]);
    const [v2] = await embedder.embed(["uber food delivery launches new region"]);
    await insertCandidate(fx.pool, sourceId, { embedding: v1 });

    const result = await probeFuzzyDuplicate(fx.pool, v2, { threshold: 0.85 });
    assert.equal(result.matched_id, null);
  } finally {
    await fx.close();
  }
});

test("fuzzy probe: respects window_days filter", async (t) => {
  const fx = await setupPg("nov_fuzzy_window");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["acme series a"]);
    const existing = await insertCandidate(fx.pool, sourceId, { embedding: v });
    // Backdate the candidate's ingested_at.
    await fx.pool.query(
      `update signal_candidates set ingested_at = now() - interval '30 days' where id = $1`,
      [existing],
    );

    // 7-day window → miss.
    const tight = await probeFuzzyDuplicate(fx.pool, v, { window_days: 7 });
    assert.equal(tight.matched_id, null);

    // 60-day window → hit.
    const wide = await probeFuzzyDuplicate(fx.pool, v, { window_days: 60 });
    assert.equal(wide.matched_id, existing);
  } finally {
    await fx.close();
  }
});

// ─── recordCollision ───────────────────────────────────────────────────────

test("recordCollision: bumps novelty_count", async (t) => {
  const fx = await setupPg("nov_coll");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const id = await insertCandidate(fx.pool, sourceId);

    await recordCollision(fx.pool, id);
    await recordCollision(fx.pool, id);
    await recordCollision(fx.pool, id);

    const { rows } = await fx.pool.query<{ novelty_count: number }>(
      `select novelty_count from signal_candidates where id = $1`,
      [id],
    );
    assert.equal(rows[0].novelty_count, 4); // started at 1, +3
  } finally {
    await fx.close();
  }
});

// ─── dedupCheck (combined) ────────────────────────────────────────────────

test("dedupCheck: exact wins when both match", async (t) => {
  const fx = await setupPg("nov_dedup_exact");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["x"]);
    const id = await insertCandidate(fx.pool, sourceId, {
      novelty_key: "key-1",
      embedding: v,
    });
    const result = await dedupCheck(fx.pool, {
      novelty_key: "key-1",
      embedding: v,
    });
    assert.equal(result.duplicate, true);
    assert.equal(result.matched_id, id);
    assert.equal(result.via, "exact");
  } finally {
    await fx.close();
  }
});

test("dedupCheck: falls back to fuzzy when novelty_key misses", async (t) => {
  const fx = await setupPg("nov_dedup_fuzzy");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const sourceId = await seedSource(fx.pool);
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["x"]);
    const id = await insertCandidate(fx.pool, sourceId, {
      novelty_key: "original",
      embedding: v,
    });
    const result = await dedupCheck(fx.pool, {
      novelty_key: "different",
      embedding: v,
    });
    assert.equal(result.duplicate, true);
    assert.equal(result.matched_id, id);
    assert.equal(result.via, "fuzzy");
  } finally {
    await fx.close();
  }
});

test("dedupCheck: miss returns duplicate=false", async (t) => {
  const fx = await setupPg("nov_dedup_miss");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const embedder = createMockEmbeddingClient();
    const [v] = await embedder.embed(["fresh"]);
    const result = await dedupCheck(fx.pool, {
      novelty_key: "fresh-key",
      embedding: v,
    });
    assert.equal(result.duplicate, false);
    assert.equal(result.matched_id, null);
    assert.equal(result.via, null);
  } finally {
    await fx.close();
  }
});
