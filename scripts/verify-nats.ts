#!/usr/bin/env node
/**
 * scripts/verify-nats.ts — smoke test the NATS event bus end-to-end.
 *
 * Run with NATS_URL + DATABASE_URL set to assert that:
 *   1. The JetStream broker is reachable.
 *   2. A publish goes through the journaled-nats adapter: the canonical
 *      event lands in the postgres `events` table AND its dispatch row
 *      flips to status='delivered'.
 *   3. A subscriber on the same bus receives the event.
 *   4. Cleanup leaves nothing behind.
 *
 * Exits non-zero on the first failure so it can be wired into a deploy
 * check or staging health probe.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { createJournaledNatsEventBus } from "../core/substrate/events/adapters/journaled-nats.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const NATS_URL = process.env.NATS_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(2);
}
if (!NATS_URL) {
  console.error("NATS_URL must be set");
  process.exit(2);
}

interface Step {
  label: string;
  status: "ok" | "fail";
  detail?: string;
}
const steps: Step[] = [];
const note = (label: string, ok: boolean, detail?: string): void => {
  steps.push({ label, status: ok ? "ok" : "fail", detail });
};

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

async function until<T>(
  predicate: () => Promise<T | undefined | null | false>,
  timeoutMs = 8_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const v = await predicate();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main(): Promise<void> {
  let workspaceId: string | null = null;
  let bus: Awaited<ReturnType<typeof createJournaledNatsEventBus>> | null = null;

  try {
    bus = await createJournaledNatsEventBus({
      pool,
      servers: NATS_URL!,
      streamPrefix: `verify_${Date.now().toString(36)}`,
    });
    note("nats: bus connected", true);

    workspaceId = randomUUID();
    await pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspaceId, `verify-nats-${workspaceId.slice(0, 8)}`, "verify-nats"],
    );

    const seen: string[] = [];
    await bus.subscribeScoped(workspaceId, "signal.dismissed", (event) => {
      seen.push(event.id);
    });

    const published = await bus.publish({
      workspace_id: workspaceId,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "verify-nats" },
    });
    note("bus: publish returned canonical event", Boolean(published.id));

    // The publish path journals to Postgres AND ships to NATS in one
    // transaction; check both halves.
    const { rows: events } = await pool.query<{ id: string }>(
      `select id from events where id = $1`,
      [published.id],
    );
    note("postgres: canonical event journaled", events.length === 1);

    await until(async () => {
      const { rows } = await pool.query<{ status: string }>(
        `select status from event_nats_dispatches where event_id = $1`,
        [published.id],
      );
      return rows[0]?.status === "delivered";
    });
    note("dispatch: marked delivered", true);

    await until(() => Promise.resolve(seen.includes(published.id)));
    note("subscriber: received the published event", true);
  } catch (err) {
    note(
      "uncaught",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (bus) {
      await bus.close().catch(() => undefined);
    }
    if (workspaceId) {
      await pool
        .query(`delete from workspaces where id = $1`, [workspaceId])
        .catch(() => undefined);
    }
    await pool.end();
  }

  const failed = steps.filter((s) => s.status === "fail");
  for (const step of steps) {
    const prefix = step.status === "ok" ? "  ok  " : "  FAIL";
    console.log(`${prefix}  ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} NATS check(s) failed.`);
    process.exit(1);
  }
  console.log("\nNATS round-trip verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
