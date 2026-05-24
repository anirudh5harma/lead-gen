import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresSemanticRepository,
  createPostgresProceduralRepository,
} from "../core/agents/memory/adapters/index.ts";
import type { MemoryScope } from "../core/agents/memory/types.ts";

async function seedRep(pool: Pool): Promise<MemoryScope> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "test ws"],
  );
  const rep_id = randomUUID();
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      rep_id,
      workspace_id,
      `Rep-${rep_id.slice(0, 6)}`,
      "sdr",
      "active",
      JSON.stringify({ voice: "warm" }),
    ],
  );
  return { workspace_id, rep_id };
}

// ─── Episodic ─────────────────────────────────────────────────────────────

test("episodic memory: append + recent in time order", async (t) => {
  const fx = await setupPg("mem_ep");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresEpisodicRepository({ pool: fx.pool });

    await repo.append(scope, { kind: "decision", content: "first" });
    await repo.append(scope, { kind: "message_sent", content: "second" });
    await repo.append(scope, { kind: "decision", content: "third" });

    const all = await repo.recent(scope);
    assert.equal(all.length, 3);
    assert.equal(all[0].content, "third");

    const onlyDecisions = await repo.recent(scope, { kinds: ["decision"] });
    assert.equal(onlyDecisions.length, 2);
    assert.deepEqual(
      onlyDecisions.map((e) => e.content),
      ["third", "first"],
    );
  } finally {
    await fx.close();
  }
});

test("episodic memory: search by substring match", async (t) => {
  const fx = await setupPg("mem_ep_search");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresEpisodicRepository({ pool: fx.pool });
    await repo.append(scope, { kind: "decision", content: "draft for Series A founder" });
    await repo.append(scope, { kind: "decision", content: "draft for Seed-stage cofounder" });
    await repo.append(scope, { kind: "decision", content: "outreach to PE buyer" });

    const hits = await repo.search(scope, "founder");
    assert.equal(hits.length, 2);
  } finally {
    await fx.close();
  }
});

// ─── Semantic ─────────────────────────────────────────────────────────────

test("semantic memory: upsert merges facts; get returns latest", async (t) => {
  const fx = await setupPg("mem_se");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresSemanticRepository({ pool: fx.pool });
    const person = randomUUID();

    await repo.upsert(scope, {
      subject_type: "person",
      subject_id: person,
      facts: { title: "CEO", in_market: false },
      confidence: 0.7,
    });
    const merged = await repo.upsert(scope, {
      subject_type: "person",
      subject_id: person,
      facts: { in_market: true, champion_for: "ProductX" },
      confidence: 0.9,
    });
    assert.equal(merged.confidence, 0.9);
    assert.deepEqual(merged.facts, {
      title: "CEO",
      in_market: true,
      champion_for: "ProductX",
    });

    const got = await repo.get(scope, "person", person);
    assert.equal(got?.id, merged.id);
  } finally {
    await fx.close();
  }
});

test("semantic memory: forSubjects fans out across (type, id) tuples", async (t) => {
  const fx = await setupPg("mem_se_fan");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresSemanticRepository({ pool: fx.pool });
    const personA = randomUUID();
    const personB = randomUUID();
    const company = randomUUID();
    await repo.upsert(scope, { subject_type: "person", subject_id: personA, facts: { a: 1 } });
    await repo.upsert(scope, { subject_type: "person", subject_id: personB, facts: { b: 2 } });
    await repo.upsert(scope, { subject_type: "company", subject_id: company, facts: { c: 3 } });

    const got = await repo.forSubjects(scope, [
      { type: "person", id: personA },
      { type: "company", id: company },
    ]);
    assert.equal(got.length, 2);
  } finally {
    await fx.close();
  }
});

// ─── Procedural ───────────────────────────────────────────────────────────

test("procedural memory: add + topForPattern (score desc)", async (t) => {
  const fx = await setupPg("mem_pr");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "icp:fintech-founder|signal:series_a|stage:cold_open";

    const low = await repo.add(scope, {
      pattern_key,
      exemplar: { subject: "Congrats on the round", body: "..." },
      initial_score: 0.4,
    });
    const high = await repo.add(scope, {
      pattern_key,
      exemplar: { subject: "Saw your TC piece", body: "..." },
      initial_score: 0.8,
    });
    await repo.add(scope, {
      pattern_key: "different_key",
      exemplar: { subject: "x" },
      initial_score: 0.99,
    });

    const top = await repo.topForPattern(scope, pattern_key, 3);
    assert.equal(top.length, 2);
    assert.equal(top[0].id, high.id);
    assert.equal(top[1].id, low.id);
  } finally {
    await fx.close();
  }
});

test("procedural memory: applyOutcome updates score + counts and clamps to [0,1]", async (t) => {
  const fx = await setupPg("mem_pr_outcome");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "icp:test|stage:cold_open";
    const x = await repo.add(scope, {
      pattern_key,
      exemplar: { subject: "x" },
      initial_score: 0.7,
    });

    // Win: +0.2 → 0.9
    await repo.applyOutcome(scope, [x.id], {
      pattern_key,
      delta_score: 0.2,
      win: true,
    });
    let top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].score, 0.9);
    assert.equal(top[0].win_count, 1);
    assert.equal(top[0].loss_count, 0);

    // Win: +0.5 → clamped to 1.0
    await repo.applyOutcome(scope, [x.id], {
      pattern_key,
      delta_score: 0.5,
      win: true,
    });
    top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].score, 1.0);

    // Loss: -1.5 → clamped to 0.0
    await repo.applyOutcome(scope, [x.id], {
      pattern_key,
      delta_score: -1.5,
      win: false,
    });
    top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].score, 0.0);
    assert.equal(top[0].loss_count, 1);
  } finally {
    await fx.close();
  }
});
