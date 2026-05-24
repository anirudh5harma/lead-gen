import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import type { BounceEvent } from "./types.ts";

/**
 * Bounce / complaint event handlers. Called by the Surface-layer webhook
 * route (`app/api/webhooks/ses/route.ts` when it lands) for SES, and by
 * the equivalent Microsoft Graph subscription handler for Outlook.
 *
 * What happens:
 *   1. Look up the message by external_id.
 *   2. Update the message row: status='bounced', record bounce details.
 *   3. For hard bounces / complaints: mark the recipient with a
 *      `do_not_contact` outcome so no Rep tries them again.
 *   4. Emit `message.bounced` event so workflows park or escalate.
 *
 * The deliverability subsystem also subscribes to message.bounced and
 * updates the sending_domain's bounce_rate_24h, which feeds the warmup
 * state machine on the next `tickWarmup()`.
 */

export async function handleBounce(
  pool: Pool,
  bus: EventBus,
  event: BounceEvent,
): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    conversation_id: string;
  }>(
    `update messages
        set status = 'bounced',
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $2::jsonb
      where workspace_id = $1
        and channel = 'email'
        and external_id = $3
      returning id, conversation_id`,
    [
      event.workspace_id,
      JSON.stringify({
        bounce_type: event.bounce_type,
        bounce_recipient: event.recipient,
        bounce_detail: event.detail ?? null,
      }),
      event.external_id,
    ],
  );
  const row = rows[0];
  if (!row) return; // Bounce for a message we don't know — ignore.

  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "message.bounced",
    source: "webhook",
    producer_ref: "channel:email",
    correlation_id: row.conversation_id,
    payload: {
      message_id: row.id,
      channel: "email",
      bounce_type: event.bounce_type,
    },
  });

  if (event.bounce_type === "hard" || event.bounce_type === "complaint") {
    // Record a do_not_contact outcome on the conversation. The outcomes
    // bridge (`core/agents/memory/bridges.ts`) sees this and updates
    // procedural memory accordingly (-0.5 for the contributing exemplars).
    await pool.query(
      `insert into outcomes (
         workspace_id, kind, score,
         conversation_id, attributed_message_id,
         occurred_at, recorded_at
       ) values ($1, 'do_not_contact', -1, $2, $3, now(), now())`,
      [event.workspace_id, row.conversation_id, row.id],
    );
    const outcomeId = await pool.query<{ id: string }>(
      `select id from outcomes
        where attributed_message_id = $1 and kind = 'do_not_contact'
        order by recorded_at desc limit 1`,
      [row.id],
    );
    if (outcomeId.rows[0]) {
      await bus.publish({
        workspace_id: event.workspace_id,
        event_type: "outcome.recorded",
        source: "webhook",
        producer_ref: "channel:email:bounce",
        correlation_id: row.conversation_id,
        payload: {
          outcome_id: outcomeId.rows[0].id,
          kind: "do_not_contact",
          score: -1,
          conversation_id: row.conversation_id,
          attributed_play_id: null,
        },
      });
    }
  }
}
