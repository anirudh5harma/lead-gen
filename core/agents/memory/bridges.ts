import { randomUUID } from "node:crypto";
import type { EventBus, PublishedEvent } from "../../substrate/events/index.ts";
import type {
  MemoryScope,
  ProceduralOutcomeUpdate,
  ProceduralRepository,
} from "./types.ts";

/**
 * Outcome → procedural memory bridge. Subscribes to `outcome.recorded`;
 * for outcomes that carry exemplar attribution, applies a score delta to
 * the contributing procedural exemplars and emits
 * `rep.memory.procedural.updated`.
 *
 * The attribution model:
 *   The writer (when implemented) records the exemplar ids it used in the
 *   message's `provenance.exemplar_ids: string[]`. When an outcome is
 *   recorded with an `attributed_message_id` AND an `attributed_rep_id`,
 *   the bridge looks up that message's provenance, takes the exemplar ids,
 *   and applies the delta.
 *
 * For the foundation we accept the simpler shape where the outcome event
 * itself carries `exemplar_ids` in its properties — useful for tests and
 * for outcomes produced by code that already knows the exemplars.
 *
 * Score deltas (defaults; override via `scoreDeltas` opt):
 *   positive_reply      +0.10  (win)
 *   meeting_booked      +0.25  (win)
 *   opportunity_created +0.15  (win)
 *   deal_won            +0.40  (win)
 *   bounce              -0.20  (loss)
 *   unsubscribe         -0.30  (loss)
 *   do_not_contact      -0.50  (loss)
 *   * everything else is ignored (no signal for procedural learning).
 */

export interface ScoreDeltas {
  readonly wins: Record<string, number>;
  readonly losses: Record<string, number>;
}

export const DEFAULT_SCORE_DELTAS: ScoreDeltas = {
  wins: {
    positive_reply: 0.1,
    meeting_booked: 0.25,
    opportunity_created: 0.15,
    deal_won: 0.4,
    follower_lift: 0.05,
    engagement_lift: 0.05,
  },
  losses: {
    bounce: -0.2,
    unsubscribe: -0.3,
    do_not_contact: -0.5,
  },
};

export interface OutcomeAttributionFetcher {
  /**
   * Resolve the rep + pattern_key + exemplar_ids for a given outcome.
   * Returns null when the outcome can't be attributed to procedural
   * exemplars (which is the common case; most signals don't traverse the
   * full draft → judge → exemplar pipeline).
   *
   * The default implementation in `attribution.ts` reads the message's
   * provenance.exemplar_ids array — the writer writes it; this reads it.
   */
  (event: PublishedEvent): Promise<null | {
    scope: MemoryScope;
    pattern_key: string;
    exemplar_ids: string[];
    seed?: {
      pattern_key: string;
      exemplar: Record<string, unknown>;
      initial_score?: number;
    } | null;
  }>;
}

export interface WireOutcomeFeedbackOptions {
  bus: EventBus;
  procedural: ProceduralRepository;
  /**
   * Resolves attribution. Tests pass an inline function; production code
   * uses `createDefaultOutcomeAttribution(pool)` from `./attribution.ts`
   * once the writer records exemplar provenance.
   */
  attribution: OutcomeAttributionFetcher;
  scoreDeltas?: ScoreDeltas;
}

export interface WiredOutcomeFeedback {
  unsubscribe(): Promise<void>;
}

export function resolveOutcomeFeedbackDelta(
  kind: string,
  deltas: ScoreDeltas = DEFAULT_SCORE_DELTAS,
): Pick<ProceduralOutcomeUpdate, "delta_score" | "win"> | null {
  if (kind in deltas.wins) {
    return {
      delta_score: deltas.wins[kind]!,
      win: true,
    };
  }
  if (kind in deltas.losses) {
    return {
      delta_score: deltas.losses[kind]!,
      win: false,
    };
  }
  return null;
}

export async function wireOutcomeFeedback(
  opts: WireOutcomeFeedbackOptions,
): Promise<WiredOutcomeFeedback> {
  const deltas = opts.scoreDeltas ?? DEFAULT_SCORE_DELTAS;

  const sub = await opts.bus.subscribe("outcome.recorded", async (event) => {
    const feedback = resolveOutcomeFeedbackDelta(event.payload.kind, deltas);
    if (!feedback) return;

    const attribution = await opts.attribution(event);
    if (!attribution || attribution.exemplar_ids.length === 0) return;

    const update: ProceduralOutcomeUpdate = {
      pattern_key: attribution.pattern_key,
      delta_score: feedback.delta_score,
      win: feedback.win,
    };

    if (
      feedback.win &&
      attribution.seed?.pattern_key &&
      attribution.seed.pattern_key !== attribution.pattern_key
    ) {
      await opts.bus.publish({
        workspace_id: event.workspace_id,
        event_type: "rep.memory.procedural.seeded",
        source: "system",
        producer_ref: "memory:procedural",
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

    await opts.procedural.applyOutcome(
      attribution.scope,
      attribution.exemplar_ids,
      update,
    );

    await opts.bus.publish({
      workspace_id: event.workspace_id,
      event_type: "rep.memory.procedural.updated",
      source: "system",
      producer_ref: "memory:procedural",
      correlation_id: event.correlation_id ?? event.id,
      causation_id: event.id,
      idempotency_key: `memory:procedural:outcome:${event.id}`,
      payload: {
        outcome_event_id: event.id,
        rep_id: attribution.scope.rep_id,
        pattern_key: attribution.pattern_key,
        exemplar_ids: attribution.exemplar_ids,
        delta_score: feedback.delta_score,
        win: feedback.win,
      },
    });
  });

  return { unsubscribe: () => sub.unsubscribe() };
}
