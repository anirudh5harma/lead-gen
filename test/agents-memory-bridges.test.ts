import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import {
  createPostgresProceduralRepository,
  resolveOutcomeFeedbackDelta,
  wireOutcomeFeedback,
} from "../core/agents/memory/index.ts";
import type { MemoryScope } from "../core/agents/memory/types.ts";

async function seedRep(pool: Pool): Promise<MemoryScope> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  const rep_id = randomUUID();
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [rep_id, workspace_id, `Rep-${rep_id.slice(0, 6)}`, "sdr", "active", JSON.stringify({ voice: "warm" })],
  );
  return { workspace_id, rep_id };
}

test("outcome → procedural: post_published is a light Content learning win", () => {
  assert.deepEqual(resolveOutcomeFeedbackDelta("post_published"), {
    delta_score: 0.03,
    win: true,
  });
});

test("outcome → procedural: positive_reply bumps score and emits update event", async (t) => {
  const fx = await setupPg("br_pos");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "icp:test|stage:open";
    const ex = await repo.add(scope, {
      pattern_key,
      exemplar: { subject: "hi" },
      initial_score: 0.5,
    });

    const wired = await wireOutcomeFeedback({
      bus,
      procedural: repo,
      async attribution() {
        return { scope, pattern_key, exemplar_ids: [ex.id] };
      },
    });

    await bus.publish({
      workspace_id: scope.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "positive_reply",
        score: 1,
        conversation_id: null,
        attributed_play_id: null,
      },
    });

    await until(async () => {
      const top = await repo.topForPattern(scope, pattern_key);
      return top[0]?.win_count === 1;
    });

    const top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].win_count, 1);
    assert.equal(top[0].loss_count, 0);
    assert.equal(top[0].score, 0.6); // 0.5 + 0.1

    const updateEvents = bus.published.filter(
      (e) => e.event_type === "rep.memory.procedural.updated",
    );
    assert.equal(updateEvents.length, 1);
    assert.equal(
      (updateEvents[0].payload as { pattern_key: string }).pattern_key,
      pattern_key,
    );
    await wired.unsubscribe();
  } finally {
    await fx.close();
  }
});

test("outcome → procedural: winning broad outcomes emit a specific seed event", async (t) => {
  const fx = await setupPg("br_seed_specific");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "conversation:email|intent:neutral|company:acme|stage:reply";
    const seedPatternKey = `${pattern_key}|objection:review|next:send-details|seniority:founder`;
    const ex = await repo.add(scope, {
      pattern_key,
      exemplar: { body: "Happy to send context first." },
      initial_score: 0.5,
    });

    const wired = await wireOutcomeFeedback({
      bus,
      procedural: repo,
      async attribution() {
        return {
          scope,
          pattern_key,
          exemplar_ids: [ex.id],
          seed: {
            pattern_key: seedPatternKey,
            exemplar: {
              subject: "Re: Security review",
              body: "Happy to send the security notes first.",
            },
          },
        };
      },
    });

    await bus.publish({
      workspace_id: scope.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "positive_reply",
        score: 1,
        conversation_id: null,
        attributed_play_id: null,
      },
    });

    await until(async () =>
      bus.published.some((event) => event.event_type === "rep.memory.procedural.seeded"),
    );

    const seedEvents = bus.published.filter(
      (event) => event.event_type === "rep.memory.procedural.seeded",
    );
    assert.equal(seedEvents.length, 1);
    assert.equal(seedEvents[0]?.payload.pattern_key, seedPatternKey);
    assert.equal(seedEvents[0]?.payload.rep_id, scope.rep_id);
    assert.deepEqual(seedEvents[0]?.payload.exemplar, {
      subject: "Re: Security review",
      body: "Happy to send the security notes first.",
    });
    await wired.unsubscribe();
  } finally {
    await fx.close();
  }
});

test("outcome → procedural: unsubscribe lowers score, increments loss_count", async (t) => {
  const fx = await setupPg("br_unsub");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "icp:test|stage:open";
    const ex = await repo.add(scope, {
      pattern_key,
      exemplar: { subject: "y" },
      initial_score: 0.6,
    });

    const wired = await wireOutcomeFeedback({
      bus,
      procedural: repo,
      async attribution() {
        return { scope, pattern_key, exemplar_ids: [ex.id] };
      },
    });

    await bus.publish({
      workspace_id: scope.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "unsubscribe",
        score: -1,
        conversation_id: null,
        attributed_play_id: null,
      },
    });

    await until(async () => {
      const top = await repo.topForPattern(scope, pattern_key);
      return top[0]?.loss_count === 1;
    });
    const top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].loss_count, 1);
    // 0.6 - 0.3 = 0.3
    assert.equal(top[0].score, 0.3);
    await wired.unsubscribe();
  } finally {
    await fx.close();
  }
});

test("outcome → procedural: ignores outcome kinds with no procedural signal", async (t) => {
  const fx = await setupPg("br_ignore");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "x";
    const ex = await repo.add(scope, {
      pattern_key,
      exemplar: { z: 1 },
      initial_score: 0.5,
    });

    let calls = 0;
    const wired = await wireOutcomeFeedback({
      bus,
      procedural: repo,
      async attribution() {
        calls++;
        return { scope, pattern_key, exemplar_ids: [ex.id] };
      },
    });

    await bus.publish({
      workspace_id: scope.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "unclassified_signal",
        score: 0,
        conversation_id: null,
        attributed_play_id: null,
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 0);
    const top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].score, 0.5);
    await wired.unsubscribe();
  } finally {
    await fx.close();
  }
});

test("outcome → procedural: skips when attribution returns null", async (t) => {
  const fx = await setupPg("br_noattr");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const scope = await seedRep(fx.pool);
    const repo = createPostgresProceduralRepository({ pool: fx.pool });
    const pattern_key = "x";
    const ex = await repo.add(scope, {
      pattern_key,
      exemplar: { z: 1 },
      initial_score: 0.5,
    });

    const wired = await wireOutcomeFeedback({
      bus,
      procedural: repo,
      async attribution() {
        return null;
      },
    });

    await bus.publish({
      workspace_id: scope.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      payload: {
        outcome_id: randomUUID(),
        kind: "positive_reply",
        score: 1,
        conversation_id: null,
        attributed_play_id: null,
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const top = await repo.topForPattern(scope, pattern_key);
    assert.equal(top[0].score, 0.5);
    assert.equal(top[0].win_count, 0);
    void ex;
    await wired.unsubscribe();
  } finally {
    await fx.close();
  }
});
