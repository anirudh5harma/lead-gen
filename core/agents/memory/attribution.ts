import type { Pool } from "pg";
import type { OutcomeAttributionFetcher } from "./bridges.ts";

/**
 * Default Postgres-backed outcome attribution. Reads `provenance.exemplar_ids`
 * + `provenance.pattern_key` from the message that the outcome is attributed
 * to (the writer records both at draft time — see
 * core/agents/reps/roles/writer.ts and core/plays/series_a_cold_open.ts).
 *
 * Returns null when:
 *   - the outcome event has no attributed_message_id (e.g. follower lift on a
 *     post that doesn't trace to a single exemplar)
 *   - the message doesn't carry provenance.exemplar_ids
 *   - the conversation behind the message has no rep_id
 *
 * In those cases procedural memory is not updated for this outcome — silent
 * and intentional. We only learn from outcomes we can attribute.
 */

interface MessageProvenance {
  exemplar_ids?: string[];
  pattern_key?: string;
}

export interface PostgresAttributionOptions {
  pool: Pool;
}

export function createPostgresOutcomeAttribution(
  opts: PostgresAttributionOptions,
): OutcomeAttributionFetcher {
  return async (event) => {
    const payload = event.payload as
      | {
          outcome_id?: string;
          attributed_message_id?: string | null;
          attributed_rep_id?: string | null;
          attributed_play_id?: string | null;
          properties?: Record<string, unknown>;
        }
      | undefined;
    const outcomeId = payload?.outcome_id;
    const direct = attributionFromProperties(
      event.workspace_id,
      payload?.attributed_rep_id ?? null,
      payload?.properties,
    );
    if (direct) return direct;

    if (payload?.attributed_message_id) {
      const fromMessage = await attributionFromMessage(
        opts.pool,
        event.workspace_id,
        payload.attributed_message_id,
        payload.attributed_rep_id ?? null,
      );
      if (fromMessage) return fromMessage;
    }

    if (!outcomeId) return null;

    const { rows } = await opts.pool.query<{
      attributed_message_id: string | null;
      provenance: MessageProvenance | null;
      rep_id: string | null;
    }>(
      `select o.attributed_message_id,
              m.provenance,
              c.rep_id
         from outcomes o
         left join messages m on m.id = o.attributed_message_id
         left join conversations c on c.id = m.conversation_id
        where o.id = $1 and o.workspace_id = $2
        limit 1`,
      [outcomeId, event.workspace_id],
    );
    const row = rows[0];
    if (!row || !row.rep_id || !row.provenance) return null;

    const exemplar_ids = Array.isArray(row.provenance.exemplar_ids)
      ? row.provenance.exemplar_ids
      : [];
    const pattern_key = row.provenance.pattern_key;
    if (!pattern_key || exemplar_ids.length === 0) return null;

    return {
      scope: { workspace_id: event.workspace_id, rep_id: row.rep_id },
      pattern_key,
      exemplar_ids,
    };
  };
}

function attributionFromProperties(
  workspace_id: string,
  rep_id: string | null,
  properties: Record<string, unknown> | undefined,
): Awaited<ReturnType<OutcomeAttributionFetcher>> | null {
  if (!rep_id || !properties) return null;
  const pattern_key =
    typeof properties.pattern_key === "string" ? properties.pattern_key : null;
  const exemplar_ids = Array.isArray(properties.exemplar_ids)
    ? properties.exemplar_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!pattern_key || exemplar_ids.length === 0) return null;
  return {
    scope: { workspace_id, rep_id },
    pattern_key,
    exemplar_ids,
  };
}

async function attributionFromMessage(
  pool: Pool,
  workspace_id: string,
  message_id: string,
  eventRepId: string | null,
): Promise<Awaited<ReturnType<OutcomeAttributionFetcher>> | null> {
  const { rows } = await pool.query<{
    provenance: MessageProvenance | null;
    rep_id: string | null;
  }>(
    `select m.provenance,
            c.rep_id
       from messages m
       left join conversations c
         on c.id = m.conversation_id
        and c.workspace_id = m.workspace_id
      where m.id = $1 and m.workspace_id = $2
      limit 1`,
    [message_id, workspace_id],
  );
  const row = rows[0];
  const rep_id = eventRepId ?? row?.rep_id ?? null;
  if (!row?.provenance || !rep_id) return null;
  const exemplar_ids = Array.isArray(row.provenance.exemplar_ids)
    ? row.provenance.exemplar_ids
    : [];
  const pattern_key = row.provenance.pattern_key;
  if (!pattern_key || exemplar_ids.length === 0) return null;
  return {
    scope: { workspace_id, rep_id },
    pattern_key,
    exemplar_ids,
  };
}
