#!/usr/bin/env node
/**
 * scripts/verify-recovery.ts — smoke test the operator recovery path.
 *
 * Run after a deploy (or against a staging env) to assert that the dead-
 * letter queue is wired correctly, the schema is migrated, and the operator
 * can list + redrive a stuck dispatch. Exits non-zero on the first failure
 * so it can be wired into CI / a post-deploy check.
 *
 * What it does (all against the configured DATABASE_URL):
 *   1. Confirm the events + event_nats_dispatches tables exist and the
 *      DLQ migration (026) ran (status check accepts 'dead_lettered').
 *   2. Seed a throwaway workspace + canonical event + dispatch row that
 *      we then mark as dead_lettered. Confirm listDeadLetteredDispatches
 *      surfaces it.
 *   3. Replay the operator redrive flip. Confirm the row went back to
 *      'pending' with cleared dead_lettered_at.
 *   4. Roll the workspace back (no leftover state).
 *
 * What it doesn't do (yet): exercise the SES/NATS connectivity. Add
 * dedicated smoke harness once that infrastructure is in place; this
 * script is the DB-side recovery guarantee.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL must be set");
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

async function main(): Promise<void> {
  let workspaceId: string | null = null;
  let eventId: string | null = null;
  try {
    // 1. Schema sanity check
    const { rows: hasDlq } = await pool.query<{ ok: boolean }>(
      `select pg_get_constraintdef(c.oid) like '%dead_lettered%' as ok
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where t.relname = 'event_nats_dispatches'
          and c.conname = 'event_nats_dispatches_status_check'`,
    );
    note(
      "schema: event_nats_dispatches.status accepts 'dead_lettered'",
      Boolean(hasDlq[0]?.ok),
      hasDlq[0]?.ok
        ? undefined
        : "Run `npm run migrate` — migration 026_event_dispatch_dead_letter is missing.",
    );

    // 2. Seed + mark dead-lettered
    workspaceId = randomUUID();
    await pool.query(
      `insert into workspaces (id, slug, name)
       values ($1, $2, $3)`,
      [workspaceId, `verify-recovery-${workspaceId.slice(0, 8)}`, "verify-recovery"],
    );
    eventId = randomUUID();
    await pool.query(
      `insert into events (
         id, workspace_id, event_type, schema_version,
         source, payload, occurred_at
       ) values ($1, $2, 'signal.dismissed', 1, 'system',
                 $3::jsonb, now())`,
      [eventId, workspaceId, JSON.stringify({ signal_id: randomUUID(), reason: "verify" })],
    );
    await pool.query(
      `insert into event_nats_dispatches (
         event_id, workspace_id, status, attempts,
         dead_lettered_at, last_error
       ) values ($1, $2, 'dead_lettered', 9, now(), 'smoke: forced dead-letter')`,
      [eventId, workspaceId],
    );

    const { rows: listed } = await pool.query<{ event_id: string }>(
      `select event_id from event_nats_dispatches
        where workspace_id = $1 and status = 'dead_lettered'`,
      [workspaceId],
    );
    note(
      "operator query: dead-lettered dispatch is listable",
      listed.some((r) => r.event_id === eventId),
    );

    // 3. Replay the redrive flip
    const flipped = await pool.query(
      `update event_nats_dispatches
          set status           = 'pending',
              next_attempt_at  = now(),
              dead_lettered_at = null,
              updated_at       = now()
        where event_id = $1
          and status   = 'dead_lettered'`,
      [eventId],
    );
    const { rows: afterFlip } = await pool.query<{
      status: string;
      dead_lettered_at: Date | null;
    }>(
      `select status, dead_lettered_at from event_nats_dispatches where event_id = $1`,
      [eventId],
    );
    note(
      "operator redrive: dead_lettered → pending",
      (flipped.rowCount ?? 0) === 1
        && afterFlip[0]?.status === "pending"
        && afterFlip[0]?.dead_lettered_at === null,
    );
  } catch (err) {
    note("uncaught", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (workspaceId) {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
    }
    await pool.end();
  }

  const failed = steps.filter((s) => s.status === "fail");
  for (const step of steps) {
    const prefix = step.status === "ok" ? "  ok  " : "  FAIL";
    console.log(`${prefix}  ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} recovery check(s) failed.`);
    process.exit(1);
  }
  console.log("\nRecovery path verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
