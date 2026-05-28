#!/usr/bin/env node
/**
 * scripts/verify-ses.ts — smoke test the SES bounce → message → outcome
 * pipeline without requiring a real AWS account.
 *
 * Drives the actual handleBounce projector with a fabricated BounceEvent
 * and asserts that:
 *   1. The targeted message row flips to status='bounced'.
 *   2. A `do_not_contact` outcome row is recorded for the conversation.
 *   3. `message.bounced` AND `outcome.recorded` are emitted on the bus.
 *
 * Uses the in-memory event bus so we don't need NATS available — for the
 * NATS round-trip use scripts/verify-nats.ts.
 *
 * Exits non-zero on the first failure. Run after a deploy or against any
 * environment to confirm the deliverability response path is wired.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { handleBounce } from "../core/channels/email/bounces.ts";

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
  const workspaceId = randomUUID();
  const personId = randomUUID();
  const repId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const externalId = `ses-verify-${randomUUID()}`;

  try {
    await pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspaceId, `verify-ses-${workspaceId.slice(0, 8)}`, "verify-ses"],
    );
    await pool.query(
      `insert into graph_persons (id, workspace_id, full_name, emails)
       values ($1, $2, 'Bounce Target', array['bounce@example.test']::citext[])`,
      [personId, workspaceId],
    );
    await pool.query(
      `insert into reps (id, workspace_id, name, role, status, persona, channels, autonomy)
       values ($1, $2, 'Verify Rep', 'sdr', 'active', '{}'::jsonb,
               array['email']::text[], '{}'::jsonb)`,
      [repId, workspaceId],
    );
    await pool.query(
      `insert into conversations (id, workspace_id, rep_id, counterparty_person_id, status, topic)
       values ($1, $2, $3, $4, 'awaiting_them', 'smoke test')`,
      [conversationId, workspaceId, repId, personId],
    );
    await pool.query(
      `insert into messages (
         id, workspace_id, conversation_id, channel, direction,
         status, subject, body, external_id, sent_at, created_at
       ) values (
         $1, $2, $3, 'email', 'outbound',
         'sent', 'test', 'test',
         $4, now(), now()
       )`,
      [messageId, workspaceId, conversationId, externalId],
    );

    const bus = createInMemoryEventBus();
    await handleBounce(
      pool,
      bus,
      {
        workspace_id: workspaceId,
        external_id: externalId,
        bounce_type: "hard",
        recipient: "bounce@example.test",
        detail: "smoketest@hard-bounce",
      },
      { ingress_event_id: randomUUID() },
    );

    const { rows: msgs } = await pool.query<{ status: string }>(
      `select status from messages where id = $1`,
      [messageId],
    );
    note("message: flipped to status='bounced'", msgs[0]?.status === "bounced");

    const { rows: out } = await pool.query<{ kind: string; score: string }>(
      `select kind, score::text as score from outcomes
        where workspace_id = $1 and conversation_id = $2`,
      [workspaceId, conversationId],
    );
    note(
      "outcome: do_not_contact recorded",
      out[0]?.kind === "do_not_contact" && Number(out[0].score) === -1,
    );

    const eventTypes = bus.published.map((e) => e.event_type);
    note(
      "bus: message.bounced emitted",
      eventTypes.includes("message.bounced"),
    );
    note(
      "bus: outcome.recorded emitted",
      eventTypes.includes("outcome.recorded"),
    );
  } catch (err) {
    note(
      "uncaught",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await pool
      .query(`delete from workspaces where id = $1`, [workspaceId])
      .catch(() => undefined);
    await pool.end();
  }

  const failed = steps.filter((s) => s.status === "fail");
  for (const step of steps) {
    const prefix = step.status === "ok" ? "  ok  " : "  FAIL";
    console.log(`${prefix}  ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} SES bounce-path check(s) failed.`);
    process.exit(1);
  }
  console.log("\nSES bounce pipeline verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
