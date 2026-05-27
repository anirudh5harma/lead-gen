import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import {
  expireOnce,
  DEFAULT_KIND_TTL_DAYS,
  ttlDaysForKind,
} from "../core/ingest/expire.ts";
import { ensurePlatformSource } from "../core/ingest/sources.ts";
import { upsertTrackedCompany } from "../core/ingest/catalog.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedWorkspace(pool: Pool): Promise<string> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  return workspace_id;
}

async function insertCandidate(
  pool: Pool,
  source_id: string,
  args: {
    company_id?: string | null;
    kind: string | null;
    external_id: string;
    title?: string;
    freshness_at: Date;
    status?: "active" | "expired";
  },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into signal_candidates (
        id, source_id, external_id, kind, company_id,
        title, freshness_at, status, ingested_at
      ) values (
        $1, $2, $3, $4::signal_kind, $5,
        $6, $7, $8, now()
      )`,
    [
      id,
      source_id,
      args.external_id,
      args.kind,
      args.company_id ?? null,
      args.title ?? `cand-${args.external_id}`,
      args.freshness_at,
      args.status ?? "active",
    ],
  );
  return id;
}

async function insertSignal(
  pool: Pool,
  workspace_id: string,
  args: {
    kind: string | null;
    title?: string;
    freshness_at: Date;
    status?: "ingested" | "matched" | "in_play" | "spent" | "dismissed";
    origin_candidate_id?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into signals (
        id, workspace_id, kind, title, freshness_at,
        status, origin_candidate_id, ingested_at
      ) values (
        $1, $2, $3::signal_kind, $4, $5,
        $6::signal_status, $7, now()
      )`,
    [
      id,
      workspace_id,
      args.kind,
      args.title ?? `sig-${id.slice(0, 6)}`,
      args.freshness_at,
      args.status ?? "ingested",
      args.origin_candidate_id ?? null,
    ],
  );
  return id;
}

test("ttlDaysForKind: returns documented per-kind TTL, with override + null-kind fallback", () => {
  assert.equal(ttlDaysForKind("hiring"), 45);
  assert.equal(ttlDaysForKind("funding"), 90);
  assert.equal(ttlDaysForKind("leadership_change"), 120);
  assert.equal(ttlDaysForKind(null), 60);
  assert.equal(
    ttlDaysForKind("hiring", { ttlDaysByKind: { hiring: 30 } }),
    30,
  );
});

test("expireOnce: flips stale candidates to 'expired' and leaves fresh ones alone", async (t) => {
  const fx = await setupPg("expire_candidates");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "acme.test",
      greenhouse_id: "acme",
    });
    const src = await ensurePlatformSource(fx.pool, "greenhouse", "Greenhouse");
    const now = new Date("2026-06-01T00:00:00Z");

    // Hiring TTL is 45 days; 46 days old → stale, 30 days → fresh.
    const stale = await insertCandidate(fx.pool, src.id, {
      company_id: co.id,
      kind: "hiring",
      external_id: "1",
      freshness_at: new Date(now.getTime() - 46 * DAY_MS),
    });
    const fresh = await insertCandidate(fx.pool, src.id, {
      company_id: co.id,
      kind: "hiring",
      external_id: "2",
      freshness_at: new Date(now.getTime() - 30 * DAY_MS),
    });

    const summary = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      {},
    );
    assert.equal(summary.candidates_expired, 1);

    const { rows } = await fx.pool.query<{ id: string; status: string }>(
      `select id, status from signal_candidates where source_id = $1 order by external_id`,
      [src.id],
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(stale), "expired");
    assert.equal(byId.get(fresh), "active");
  } finally {
    await fx.close();
  }
});

test("expireOnce: cascades to workspace-scoped signals via origin_candidate_id and emits signal.expired", async (t) => {
  const fx = await setupPg("expire_cascade");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  const expiredEvents: Array<{ workspace_id: string; payload: unknown }> = [];
  await bus.subscribe("signal.expired", async (ev) => {
    expiredEvents.push({
      workspace_id: ev.workspace_id,
      payload: ev.payload,
    });
  });
  try {
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "acme.test",
      greenhouse_id: "acme",
    });
    const src = await ensurePlatformSource(fx.pool, "greenhouse", "Greenhouse");
    const ws = await seedWorkspace(fx.pool);
    const now = new Date("2026-06-01T00:00:00Z");
    const oldAt = new Date(now.getTime() - 60 * DAY_MS);

    const candidate = await insertCandidate(fx.pool, src.id, {
      company_id: co.id,
      kind: "hiring",
      external_id: "1",
      freshness_at: oldAt,
    });
    const sigMatched = await insertSignal(fx.pool, ws, {
      kind: "hiring",
      freshness_at: oldAt,
      status: "matched",
      origin_candidate_id: candidate,
    });
    // A signal already spent should not be touched.
    const sigSpent = await insertSignal(fx.pool, ws, {
      kind: "hiring",
      freshness_at: oldAt,
      status: "spent",
      origin_candidate_id: candidate,
    });

    const summary = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      {},
    );
    assert.equal(summary.candidates_expired, 1);
    assert.equal(summary.signals_cascaded, 1);

    const { rows } = await fx.pool.query<{ id: string; status: string }>(
      `select id, status from signals where workspace_id = $1`,
      [ws],
    );
    const statuses = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(statuses.get(sigMatched), "spent");
    assert.equal(statuses.get(sigSpent), "spent"); // unchanged

    assert.equal(expiredEvents.length, 1);
    assert.equal(expiredEvents[0].workspace_id, ws);
    assert.deepEqual(expiredEvents[0].payload, {
      signal_id: sigMatched,
      reason: "ttl_exceeded",
    });
  } finally {
    await fx.close();
  }
});

test("expireOnce: sweeps workspace-poll signals (origin_candidate_id null) past TTL", async (t) => {
  const fx = await setupPg("expire_workspace_signals");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  const events: Array<{ workspace_id: string; payload: unknown }> = [];
  await bus.subscribe("signal.expired", async (ev) => {
    events.push({ workspace_id: ev.workspace_id, payload: ev.payload });
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const now = new Date("2026-06-01T00:00:00Z");

    // funding TTL = 90 days; 100 days old → stale.
    const stale = await insertSignal(fx.pool, ws, {
      kind: "funding",
      freshness_at: new Date(now.getTime() - 100 * DAY_MS),
      status: "ingested",
      origin_candidate_id: null,
    });
    // Same kind but recent → not stale.
    const fresh = await insertSignal(fx.pool, ws, {
      kind: "funding",
      freshness_at: new Date(now.getTime() - 30 * DAY_MS),
      status: "ingested",
      origin_candidate_id: null,
    });
    // Null kind defaults to 60 days; 70 days old → stale.
    const nullStale = await insertSignal(fx.pool, ws, {
      kind: null,
      freshness_at: new Date(now.getTime() - 70 * DAY_MS),
      status: "ingested",
      origin_candidate_id: null,
    });

    const summary = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      {},
    );
    assert.equal(summary.workspace_signals_expired, 2);

    const { rows } = await fx.pool.query<{ id: string; status: string }>(
      `select id, status from signals where workspace_id = $1`,
      [ws],
    );
    const statuses = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(statuses.get(stale), "spent");
    assert.equal(statuses.get(nullStale), "spent");
    assert.equal(statuses.get(fresh), "ingested");

    assert.equal(events.length, 2);
  } finally {
    await fx.close();
  }
});

test("expireOnce: dryRun reports counts without mutating", async (t) => {
  const fx = await setupPg("expire_dryrun");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "acme.test",
      greenhouse_id: "acme",
    });
    const src = await ensurePlatformSource(fx.pool, "greenhouse", "Greenhouse");
    const ws = await seedWorkspace(fx.pool);
    const now = new Date("2026-06-01T00:00:00Z");
    const oldAt = new Date(now.getTime() - 100 * DAY_MS);

    await insertCandidate(fx.pool, src.id, {
      company_id: co.id,
      kind: "hiring",
      external_id: "1",
      freshness_at: oldAt,
    });
    await insertSignal(fx.pool, ws, {
      kind: "hiring",
      freshness_at: oldAt,
      status: "ingested",
      origin_candidate_id: null,
    });

    const summary = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      { dryRun: true },
    );
    assert.equal(summary.candidates_expired, 1);
    assert.equal(summary.signals_cascaded, 1);

    // Nothing was actually mutated.
    const { rows: cs } = await fx.pool.query<{ status: string }>(
      `select status from signal_candidates where source_id = $1`,
      [src.id],
    );
    assert.equal(cs[0].status, "active");
    const { rows: ss } = await fx.pool.query<{ status: string }>(
      `select status from signals where workspace_id = $1`,
      [ws],
    );
    assert.equal(ss[0].status, "ingested");
  } finally {
    await fx.close();
  }
});

test("expireOnce: idempotent — second run finds nothing new", async (t) => {
  const fx = await setupPg("expire_idempotent");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "acme.test",
      greenhouse_id: "acme",
    });
    const src = await ensurePlatformSource(fx.pool, "greenhouse", "Greenhouse");
    const now = new Date("2026-06-01T00:00:00Z");

    await insertCandidate(fx.pool, src.id, {
      company_id: co.id,
      kind: "hiring",
      external_id: "1",
      freshness_at: new Date(now.getTime() - 100 * DAY_MS),
    });

    const first = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      {},
    );
    assert.equal(first.candidates_expired, 1);

    const second = await expireOnce(
      { pool: fx.pool, bus, now: () => now },
      {},
    );
    assert.equal(second.candidates_expired, 0);
    assert.equal(second.signals_cascaded, 0);
    assert.equal(second.workspace_signals_expired, 0);
  } finally {
    await fx.close();
  }
});

test("DEFAULT_KIND_TTL_DAYS covers every signal_kind enum value", async (t) => {
  const fx = await setupPg("expire_kinds");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { rows } = await fx.pool.query<{ enumlabel: string }>(
      `select enumlabel from pg_enum
         where enumtypid = (
           select t.oid from pg_type t
             join pg_namespace n on n.oid = t.typnamespace
            where t.typname = 'signal_kind'
              and n.nspname = current_schema()
         )`,
    );
    const kinds = rows.map((r) => r.enumlabel);
    for (const k of kinds) {
      assert.ok(
        DEFAULT_KIND_TTL_DAYS[k] !== undefined,
        `missing TTL for kind '${k}'`,
      );
    }
  } finally {
    await fx.close();
  }
});
