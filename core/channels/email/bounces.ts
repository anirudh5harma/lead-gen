import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import { projectMessageLifecycleEvent } from "../message-lifecycle.ts";
import { projectOutcomeLifecycleEvent } from "../../primitives/outcome-lifecycle.ts";
import type { BounceEvent } from "./types.ts";

export interface BounceProjectionContext {
  ingress_event_id?: string;
}

/**
 * Bounce / complaint projector. Authenticated surface routes emit
 * `email.bounce.received`; the projector consumer invokes this function.
 *
 * What happens:
 *   1. Look up the message by external_id.
 *   2. Emit `message.bounced`; shared lifecycle projection materializes it.
 *   3. For hard bounces / complaints: emit `outcome.recorded`; shared outcome
 *      projection marks the recipient with a `do_not_contact` outcome so no Rep
 *      tries them again.
 *   4. Workflows observing `message.bounced` can park or escalate.
 *
 * The deliverability subsystem also subscribes to message.bounced and
 * updates the sending_domain's bounce_rate_24h, which feeds the warmup
 * state machine on the next `tickWarmup()`.
 */

export async function handleBounce(
  pool: Pool,
  bus: EventBus,
  event: BounceEvent,
  context: BounceProjectionContext = {},
): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    conversation_id: string;
  }>(
    `select id, conversation_id
      from messages
      where workspace_id = $1
        and channel = 'email'
        and external_id = $2
      order by created_at desc
      limit 1`,
    [event.workspace_id, event.external_id],
  );
  const row = rows[0];
  if (!row) return; // Bounce for a message we don't know — ignore.

  const bounced = await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "message.bounced",
    source: "webhook",
    producer_ref: "channel:email",
    correlation_id: row.conversation_id,
    idempotency_key: projectionEventKey(context.ingress_event_id, "message.bounced"),
    payload: {
      message_id: row.id,
      channel: "email",
      bounce_type: event.bounce_type,
      external_id: event.external_id,
      recipient: event.recipient,
      detail: event.detail ?? null,
      reason: event.detail ?? null,
    },
  });
  await projectMessageLifecycleEvent(pool, bounced);

  if (event.bounce_type === "hard" || event.bounce_type === "complaint") {
    const outcomeRecorded = await bus.publish({
      workspace_id: event.workspace_id,
      event_type: "outcome.recorded",
      source: "webhook",
      producer_ref: "channel:email:bounce",
      correlation_id: row.conversation_id,
      causation_id: bounced.id,
      idempotency_key: projectionEventKey(context.ingress_event_id, "outcome.recorded"),
      payload: {
        outcome_id: randomUUID(),
        kind: "do_not_contact",
        score: -1,
        conversation_id: row.conversation_id,
        attributed_message_id: row.id,
        attributed_play_id: null,
        properties: {
          bounce_type: event.bounce_type,
          bounce_recipient: event.recipient,
          bounce_detail: event.detail ?? null,
          delivery_external_id: event.external_id,
        },
        provenance: context.ingress_event_id
          ? { ingress_event_id: context.ingress_event_id }
          : {},
      },
    });
    await projectOutcomeLifecycleEvent(pool, outcomeRecorded);
  }
}

function projectionEventKey(ingressEventId: string | undefined, projected: string) {
  return ingressEventId ? `projection:${ingressEventId}:${projected}` : null;
}
