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
          attributed_play_id?: string | null;
        }
      | undefined;
    const outcomeId = payload?.outcome_id;
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
