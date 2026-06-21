import type { Pool } from "pg";
import type {
  EventBus,
  EventHandler,
  EventPayload,
  Subscription,
} from "../substrate/events/index.ts";
import { connect } from "../graph/edges/index.ts";
import { upsertCompany } from "../graph/nodes/companies.ts";
import { vectorToPgLiteral } from "./embeddings.ts";
import { projectAccountIntentFromEvent } from "./account-intent.ts";
import { createSignalFeedbackProjection } from "./feedback.ts";

type SignalProjectionType =
  | "signal.discovered"
  | "signal.ingested"
  | "signal.matched"
  | "signal.dismissed"
  | "signal.expired"
  | "signal.company.linked"
  | "signal.classification.completed"
  | "signal.dismissal.requested"
  | "signal.expiry.requested"
  | "outcome.recorded";

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
  const signalFeedbackProjection = createSignalFeedbackProjection(deps.pool, deps.bus);
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
      "signal.company.linked",
      async (event) => {
        await projectSignalCompanyLinked(
          deps.pool,
          event.workspace_id,
          event.payload,
          event.id,
        );
      },
      "signal_company_linked_projector",
    ),
    subscriber.subscribe(
      "signal.company.linked",
      (event) => projectAccountIntentFromEvent(deps.pool, deps.bus, event),
      "account_intent_signal_company_linked_projector",
    ),
    subscriber.subscribe(
      "signal.expiry.requested",
      async (event) => {
        const flipped = await projectSignalExpiry(
          deps.pool,
          event.workspace_id,
          event.payload,
        );
        // The signal was either already 'spent'/'dismissed' or not present
        // in this workspace — either way, no public signal.expired follows.
        if (!flipped) return;
        await deps.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.expired",
          source: "system",
          producer_ref: "projection:signal.expiry.requested",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.expired`,
          payload: {
            signal_id: event.payload.signal_id,
            reason: event.payload.reason,
          },
        });
      },
      "signal_expiry_projector",
    ),
    subscriber.subscribe(
      "signal.expired",
      (event) => projectAccountIntentFromEvent(deps.pool, deps.bus, event),
      "account_intent_signal_expired_projector",
    ),
    subscriber.subscribe(
      "signal.dismissal.requested",
      async (event) => {
        const flipped = await projectSignalDismissal(
          deps.pool,
          event.workspace_id,
          event.payload,
        );
        if (!flipped) return;
        await deps.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.dismissed",
          source: "system",
          producer_ref: "projection:signal.dismissal.requested",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.dismissed`,
          payload: {
            signal_id: event.payload.signal_id,
            reason: event.payload.reason,
          },
        });
      },
      "signal_dismissal_projector",
    ),
    subscriber.subscribe(
      "signal.dismissed",
      (event) => projectAccountIntentFromEvent(deps.pool, deps.bus, event),
      "account_intent_signal_dismissed_projector",
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
    subscriber.subscribe(
      "signal.ingested",
      (event) => projectAccountIntentFromEvent(deps.pool, deps.bus, event),
      "account_intent_signal_ingested_projector",
    ),
    subscriber.subscribe(
      "signal.matched",
      (event) => projectAccountIntentFromEvent(deps.pool, deps.bus, event),
      "account_intent_signal_matched_projector",
    ),
    subscriber.subscribe(
      "outcome.recorded",
      (event) => signalFeedbackProjection.apply(event),
      signalFeedbackProjection.name,
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
  if (result.rowCount !== 1) {
    const existing = await pool.query<{ workspace_id: string }>(
      `select workspace_id from signals where id = $1`,
      [payload.signal_id],
    );
    if (existing.rows[0]?.workspace_id !== workspaceId) {
      throw new Error(`Signal discovery projection rejected signal ${payload.signal_id}`);
    }
  }
  if (payload.source_id) {
    await connect(pool, {
      workspace_id: workspaceId,
      from: { node_type: "source", node_id: payload.source_id },
      to: { node_type: "signal", node_id: payload.signal_id },
      kind: "emitted",
      properties: {
        external_id: payload.provenance.external_id,
        origin_candidate_id: payload.origin_candidate_id,
      },
      provenance: {
        source: "projection:signal.discovered",
      },
    });
  }
  if (payload.related_company_id) {
    await connect(pool, {
      workspace_id: workspaceId,
      from: { node_type: "company", node_id: payload.related_company_id },
      to: { node_type: "signal", node_id: payload.signal_id },
      kind: "mentioned_in",
      properties: {
        external_id: payload.provenance.external_id,
        source_id: payload.source_id,
        origin_candidate_id: payload.origin_candidate_id,
      },
      provenance: {
        source: "projection:signal.discovered",
      },
    });
  }
  if (payload.related_person_id) {
    await connect(pool, {
      workspace_id: workspaceId,
      from: { node_type: "person", node_id: payload.related_person_id },
      to: { node_type: "signal", node_id: payload.signal_id },
      kind: "mentioned_in",
      properties: {
        external_id: payload.provenance.external_id,
        source_id: payload.source_id,
        origin_candidate_id: payload.origin_candidate_id,
      },
      provenance: {
        source: "projection:signal.discovered",
      },
    });
  }
}

export async function projectSignalCompanyLinked(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"signal.company.linked">,
  eventId?: string,
): Promise<void> {
  const company = await upsertCompany(pool, workspaceId, {
    name: payload.company.name,
    domain: payload.company.domain ?? undefined,
    description: payload.company.description ?? undefined,
    properties: {
      signal_link: {
        signal_id: payload.signal_id,
        source_id: payload.source_id,
        adapter: payload.adapter,
        hint_source: payload.hint_source,
        confidence: payload.confidence,
        event_id: eventId ?? null,
      },
    },
    provenance: {
      source: "projection:signal.company.linked",
      signal_id: payload.signal_id,
      source_id: payload.source_id,
      adapter: payload.adapter,
      hint_source: payload.hint_source,
      confidence: payload.confidence,
      event_id: eventId ?? null,
    },
  });

  const { rows } = await pool.query<{ related_company_id: string | null }>(
    `update signals
        set related_company_id = coalesce(related_company_id, $3::uuid),
            properties = coalesce(properties, '{}'::jsonb) ||
              jsonb_build_object(
                'related_company_hint',
                jsonb_build_object(
                  'name', $4::text,
                  'domain', $5::text,
                  'source', $6::text,
                  'confidence', $7::text,
                  'adapter', $8::text,
                  'linked_event_id', $9::text
                )
              )
      where workspace_id = $1
        and id = $2
      returning related_company_id::text as related_company_id`,
    [
      workspaceId,
      payload.signal_id,
      company.id,
      payload.company.name,
      payload.company.domain,
      payload.hint_source,
      payload.confidence,
      payload.adapter,
      eventId ?? null,
    ],
  );
  const linkedCompanyId = rows[0]?.related_company_id ?? null;
  if (!linkedCompanyId) {
    throw new Error(`Signal company link projection rejected signal ${payload.signal_id}`);
  }
  if (linkedCompanyId !== company.id) return;

  await connect(pool, {
    workspace_id: workspaceId,
    from: { node_type: "company", node_id: company.id },
    to: { node_type: "signal", node_id: payload.signal_id },
    kind: "mentioned_in",
    properties: {
      source_id: payload.source_id,
      adapter: payload.adapter,
      hint_source: payload.hint_source,
      confidence: payload.confidence,
      event_id: eventId ?? null,
    },
    provenance: {
      source: "projection:signal.company.linked",
      event_id: eventId ?? null,
    },
  });
}

/**
 * Flip a workspace signal to status='spent' as the materialization of a
 * `signal.expiry.requested` event. Returns true if the row actually
 * transitioned (so the caller knows whether to emit the public
 * signal.expired). Idempotent: a signal already 'spent', 'dismissed', or
 * absent in this workspace returns false.
 */
export async function projectSignalExpiry(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"signal.expiry.requested">,
): Promise<boolean> {
  const result = await pool.query(
    `update signals
        set status        = 'spent',
            audience_hint = coalesce(audience_hint, '{}'::jsonb) ||
                            jsonb_build_object('expiry_reason', $3::text)
      where workspace_id = $1
        and id           = $2
        and status in ('ingested', 'matched', 'in_play')`,
    [workspaceId, payload.signal_id, payload.reason],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Materialize an explicit human/operator decision to remove a Signal from the
 * outreach queue. The public signal.dismissed event is emitted by callers only
 * when this transition returns true.
 */
export async function projectSignalDismissal(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"signal.dismissal.requested">,
): Promise<boolean> {
  const result = await pool.query(
    `update signals
        set status        = 'dismissed',
            match_reason  = coalesce(nullif($3::text, ''), match_reason),
            audience_hint = coalesce(audience_hint, '{}'::jsonb) ||
                            jsonb_build_object('dismissal_reason', $3::text)
      where workspace_id = $1
        and id           = $2
        and status in ('ingested', 'matched', 'in_play')`,
    [workspaceId, payload.signal_id, payload.reason],
  );
  return (result.rowCount ?? 0) > 0;
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
