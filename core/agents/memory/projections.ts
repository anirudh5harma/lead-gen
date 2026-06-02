import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  DurableEventProjection,
  EventBus,
} from "../../substrate/events/index.ts";
import {
  DEFAULT_SCORE_DELTAS,
  resolveOutcomeFeedbackDelta,
  type OutcomeAttributionFetcher,
  type ScoreDeltas,
} from "./bridges.ts";

export const OUTCOME_MEMORY_UPDATE_PROJECTION = "rep.outcome_memory_update.v1";
export const PROCEDURAL_MEMORY_STATE_PROJECTION = "rep.procedural_memory_state.v1";
export const PROCEDURAL_MEMORY_SEED_PROJECTION = "rep.procedural_memory_seed.v1";

export interface OutcomeMemoryProjectionOptions {
  bus: EventBus;
  attribution: OutcomeAttributionFetcher;
  scoreDeltas?: ScoreDeltas;
}

export function createOutcomeMemoryUpdateProjection(
  opts: OutcomeMemoryProjectionOptions,
): DurableEventProjection {
  const deltas = opts.scoreDeltas ?? DEFAULT_SCORE_DELTAS;
  return {
    name: OUTCOME_MEMORY_UPDATE_PROJECTION,
    eventTypes: ["outcome.recorded"],
    async apply(event) {
      const payload = event.payload as { kind?: string };
      const feedback = payload.kind
        ? resolveOutcomeFeedbackDelta(payload.kind, deltas)
        : null;
      if (!feedback) return;

      const attribution = await opts.attribution(event);
      if (!attribution || attribution.exemplar_ids.length === 0) return;
      const exemplar_ids = [...new Set(attribution.exemplar_ids)];

      if (
        feedback.win &&
        attribution.seed?.pattern_key &&
        attribution.seed.pattern_key !== attribution.pattern_key
      ) {
        await opts.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "rep.memory.procedural.seeded",
          source: "system",
          producer_ref: "projector:outcome-memory",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `memory:procedural:seed:${event.id}:${attribution.seed.pattern_key}`,
          payload: {
            outcome_event_id: event.id,
            exemplar_id: randomUUID(),
            rep_id: attribution.scope.rep_id,
            pattern_key: attribution.seed.pattern_key,
            exemplar: attribution.seed.exemplar,
            initial_score: attribution.seed.initial_score ?? Math.min(1, 0.5 + feedback.delta_score),
          },
        });
      }

      await opts.bus.publish({
        workspace_id: event.workspace_id,
        event_type: "rep.memory.procedural.updated",
        source: "system",
        producer_ref: "projector:outcome-memory",
        correlation_id: event.correlation_id ?? event.id,
        causation_id: event.id,
        idempotency_key: `memory:procedural:outcome:${event.id}`,
        payload: {
          outcome_event_id: event.id,
          rep_id: attribution.scope.rep_id,
          pattern_key: attribution.pattern_key,
          exemplar_ids,
          delta_score: feedback.delta_score,
          win: feedback.win,
        },
      });
    },
  };
}

export function createProceduralMemoryStateProjection(
  pool: Pool,
): DurableEventProjection {
  return {
    name: PROCEDURAL_MEMORY_STATE_PROJECTION,
    eventTypes: ["rep.memory.procedural.updated"],
    async apply(event) {
      const payload = event.payload as {
        outcome_event_id?: string;
        rep_id?: string;
        pattern_key?: string;
        exemplar_ids?: string[];
        delta_score?: number;
        win?: boolean;
      };
      if (
        !payload.outcome_event_id ||
        !payload.rep_id ||
        !payload.pattern_key ||
        !Array.isArray(payload.exemplar_ids) ||
        payload.exemplar_ids.length === 0 ||
        typeof payload.delta_score !== "number" ||
        typeof payload.win !== "boolean"
      ) {
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        const marker = await client.query(
          `insert into rep_memory_procedural_applications (
             event_id, outcome_event_id, workspace_id, rep_id, pattern_key,
             exemplar_ids, delta_score, win
           ) values ($1, $2, $3, $4, $5, $6::uuid[], $7, $8)
           on conflict (outcome_event_id) do nothing
           returning event_id`,
          [
            event.id,
            payload.outcome_event_id,
            event.workspace_id,
            payload.rep_id,
            payload.pattern_key,
            payload.exemplar_ids,
            payload.delta_score,
            payload.win,
          ],
        );
        if ((marker.rowCount ?? 0) > 0) {
          const updated = await client.query(
            `update rep_memory_procedural
                set score        = least(1.0, greatest(0.0, score + $4::numeric)),
                    win_count    = win_count  + case when $5 then 1 else 0 end,
                    loss_count   = loss_count + case when $5 then 0 else 1 end,
                    last_used_at = now()
              where workspace_id = $1
                and rep_id = $2
                and pattern_key = $3
                and id = any($6::uuid[])`,
            [
              event.workspace_id,
              payload.rep_id,
              payload.pattern_key,
              payload.delta_score,
              payload.win,
              payload.exemplar_ids,
            ],
          );
          if ((updated.rowCount ?? 0) !== payload.exemplar_ids.length) {
            throw new Error(
              `Procedural outcome references missing exemplars: expected ${payload.exemplar_ids.length}, updated ${updated.rowCount ?? 0}`,
            );
          }
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export function createProceduralMemorySeedProjection(
  pool: Pool,
): DurableEventProjection {
  return {
    name: PROCEDURAL_MEMORY_SEED_PROJECTION,
    eventTypes: ["rep.memory.procedural.seeded"],
    async apply(event) {
      const payload = event.payload as {
        exemplar_id?: string;
        rep_id?: string;
        pattern_key?: string;
        exemplar?: Record<string, unknown>;
        initial_score?: number;
      };
      if (
        !payload.exemplar_id ||
        !payload.rep_id ||
        !payload.pattern_key ||
        !payload.exemplar ||
        typeof payload.initial_score !== "number"
      ) {
        return;
      }

      await pool.query(
        `insert into rep_memory_procedural (
           id, workspace_id, rep_id, pattern_key, exemplar, score
         ) values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict (id) do nothing`,
        [
          payload.exemplar_id,
          event.workspace_id,
          payload.rep_id,
          payload.pattern_key,
          JSON.stringify(payload.exemplar),
          payload.initial_score,
        ],
      );
    },
  };
}
