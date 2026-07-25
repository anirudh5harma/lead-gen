import type { Pool } from "pg";

export const RELATIONSHIP_OUTREACH_COOLDOWN_DAYS = 7;

export type RelationshipOutreachSuppressionReason =
  | "recipient_cooldown"
  | "conversation_active"
  | "conversation_blocked";

export interface RelationshipOutreachState {
  conversation_id: string;
  status: string;
  latest_outbound_status: string | null;
  latest_outbound_at: Date | null;
  has_reply: boolean;
  has_blocking_outcome: boolean;
}

export type RelationshipOutreachDecision =
  | { action: "allow"; conversation_id: string | null }
  | {
      action: "suppress";
      conversation_id: string;
      reason: RelationshipOutreachSuppressionReason;
      retry_after: string | null;
    };

export function evaluateRelationshipOutreach(
  state: RelationshipOutreachState | null,
  now = new Date(),
  cooldownDays = RELATIONSHIP_OUTREACH_COOLDOWN_DAYS,
): RelationshipOutreachDecision {
  if (!state) return { action: "allow", conversation_id: null };
  if (state.has_blocking_outcome || state.status === "closed_negative") {
    return {
      action: "suppress",
      conversation_id: state.conversation_id,
      reason: "conversation_blocked",
      retry_after: null,
    };
  }
  if (
    state.has_reply ||
    state.status === "awaiting_us" ||
    state.status === "closed_positive"
  ) {
    return {
      action: "suppress",
      conversation_id: state.conversation_id,
      reason: "conversation_active",
      retry_after: null,
    };
  }
  if (
    state.latest_outbound_status === "draft" ||
    state.latest_outbound_status === "queued" ||
    state.latest_outbound_status === "deferred"
  ) {
    return {
      action: "suppress",
      conversation_id: state.conversation_id,
      reason: "conversation_active",
      retry_after: null,
    };
  }
  if (state.latest_outbound_at) {
    const retryAt = new Date(
      state.latest_outbound_at.getTime() + cooldownDays * 86_400_000,
    );
    if (retryAt.getTime() > now.getTime()) {
      return {
        action: "suppress",
        conversation_id: state.conversation_id,
        reason: "recipient_cooldown",
        retry_after: retryAt.toISOString(),
      };
    }
  }
  return { action: "allow", conversation_id: state.conversation_id };
}

export async function loadRelationshipOutreachState(
  pool: Pool,
  input: {
    workspace_id: string;
    person_id: string;
    company_id: string | null;
  },
): Promise<RelationshipOutreachState | null> {
  const { rows } = await pool.query<RelationshipOutreachState>(
    `select c.id::text as conversation_id,
            c.status::text as status,
            outbound.status::text as latest_outbound_status,
            outbound.activity_at as latest_outbound_at,
            exists (
              select 1
                from messages inbound
               where inbound.workspace_id = c.workspace_id
                 and inbound.conversation_id = c.id
                 and inbound.direction = 'inbound'
            ) as has_reply,
            exists (
              select 1
                from outcomes o
               where o.workspace_id = c.workspace_id
                 and o.conversation_id = c.id
                 and o.kind::text in ('unsubscribe', 'do_not_contact')
            ) as has_blocking_outcome
       from conversations c
       left join lateral (
         select m.status,
                coalesce(m.sent_at, m.created_at) as activity_at
           from messages m
          where m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
            and m.direction = 'outbound'
          order by coalesce(m.sent_at, m.created_at) desc
          limit 1
       ) outbound on true
      where c.workspace_id = $1
        and c.counterparty_person_id = $2
        and c.counterparty_company_id is not distinct from $3::uuid
      order by c.last_activity_at desc
      limit 1`,
    [input.workspace_id, input.person_id, input.company_id],
  );
  return rows[0] ?? null;
}
