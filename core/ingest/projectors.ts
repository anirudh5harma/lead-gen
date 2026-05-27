import type { Pool } from "pg";
import type {
  EventBus,
  EventHandler,
  EventPayload,
  Subscription,
} from "../substrate/events/index.ts";
import { vectorToPgLiteral } from "./embeddings.ts";

type SignalProjectionType =
  | "signal.discovered"
  | "signal.classification.completed";

export interface SignalProjectorDeps {
  pool: Pool;
  bus: EventBus;
}

export interface SignalProjectorSubscriber {
  subscribe<T extends SignalProjectionType>(
    eventType: T,
    handler: EventHandler<EventPayload<T>>,
    durableName: string,
  ): Promise<Subscription>;
}

/**
 * Materializes classifier outcomes. Classification publishes its decision;
 * only this consumer changes the Signal projection and emits the derived
 * matched/dismissed lifecycle events that wake Plays.
 */
export async function registerSignalProjectors(
  deps: SignalProjectorDeps,
  subscriber: SignalProjectorSubscriber = defaultSubscriber(deps.bus),
): Promise<Subscription[]> {
  return Promise.all([
    subscriber.subscribe(
      "signal.discovered",
      async (event) => {
        await projectSignalDiscovered(deps.pool, event.workspace_id, event.payload);
        await deps.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.ingested",
          source: "system",
          producer_ref: "projection:signal.discovered",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.ingested`,
          payload: {
            signal_id: event.payload.signal_id,
            source_id: event.payload.source_id,
            kind: event.payload.kind,
            novelty_score: null,
          },
        });
      },
      "signal_discovered_projector",
    ),
    subscriber.subscribe(
      "signal.classification.completed",
      async (event) => {
        await projectSignalClassification(deps.pool, event.workspace_id, event.payload);
        if (event.payload.disposition === "dismissed") {
          await deps.bus.publish({
            workspace_id: event.workspace_id,
            event_type: "signal.dismissed",
            source: "system",
            producer_ref: "projection:signal.classification.completed",
            correlation_id: event.correlation_id ?? event.id,
            causation_id: event.id,
            idempotency_key: `projection:${event.id}:signal.dismissed`,
            payload: {
              signal_id: event.payload.signal_id,
              reason: event.payload.match_reason,
            },
          });
          return;
        }
        for (const match of event.payload.matches) {
          await deps.bus.publish({
            workspace_id: event.workspace_id,
            event_type: "signal.matched",
            source: "system",
            producer_ref: "projection:signal.classification.completed",
            correlation_id: event.correlation_id ?? event.id,
            causation_id: event.id,
            idempotency_key:
              `projection:${event.id}:signal.matched:${match.icp_segment}`,
            payload: {
              signal_id: event.payload.signal_id,
              match_score: match.match_score,
              icp_segment: match.icp_segment,
            },
          });
        }
      },
      "signal_classification_projector",
    ),
  ]);
}

export async function projectSignalDiscovered(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"signal.discovered">,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `insert into signals (
       id, workspace_id, source_id,
       kind, title, content, url,
       freshness_at, related_company_id, related_person_id,
       status, properties, provenance, origin_candidate_id,
       embedding, ingested_at
     ) values (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10,
       'ingested', $11::jsonb, $12::jsonb, $13,
       $14::vector, now()
     )
     on conflict (id) do nothing
     returning id`,
    [
      payload.signal_id,
      workspaceId,
      payload.source_id,
      payload.kind,
      payload.title,
      payload.content,
      payload.url,
      payload.freshness_at,
      payload.related_company_id,
      payload.related_person_id,
      JSON.stringify(payload.properties),
      JSON.stringify(payload.provenance),
      payload.origin_candidate_id,
      vectorToPgLiteral(payload.embedding),
    ],
  );
  if (result.rowCount === 1) return;
  const existing = await pool.query<{ workspace_id: string }>(
    `select workspace_id from signals where id = $1`,
    [payload.signal_id],
  );
  if (existing.rows[0]?.workspace_id !== workspaceId) {
    throw new Error(`Signal discovery projection rejected signal ${payload.signal_id}`);
  }
}

export async function projectSignalClassification(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"signal.classification.completed">,
): Promise<void> {
  const result = await pool.query(
    `update signals
        set kind          = coalesce($3::signal_kind, kind),
            match_score   = $4,
            match_reason  = $5,
            audience_hint = coalesce(audience_hint, '{}'::jsonb) || $6::jsonb,
            status        = $7::signal_status
      where workspace_id = $1 and id = $2`,
    [
      workspaceId,
      payload.signal_id,
      payload.kind,
      payload.match_score,
      payload.match_reason,
      JSON.stringify(payload.audience_hint),
      payload.disposition,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Signal classification projection rejected signal ${payload.signal_id}`,
    );
  }
}

function defaultSubscriber(bus: EventBus): SignalProjectorSubscriber {
  return {
    subscribe<T extends SignalProjectionType>(
      eventType: T,
      handler: EventHandler<EventPayload<T>>,
    ) {
      return bus.subscribe(eventType, handler);
    },
  };
}
