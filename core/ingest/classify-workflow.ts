import type {
  EventHandler,
  EventPayload,
  Subscription,
} from "../substrate/events/index.ts";
import { classifySignal, type ClassifyDeps } from "./classify.ts";

/**
 * Stage 2 classifier subscription. Listens for `signal.ingested` on the
 * bus and calls `classifySignal` per event. Returns a handle so the
 * caller can unsubscribe (tests, process shutdown).
 *
 * Errors thrown by the classifier are caught + logged via `onError`;
 * the subscription stays alive so one bad signal doesn't take the
 * pipeline down.
 *
 * For batching across multiple signals in one LLM call, see the
 * design doc — that's a cost optimisation for high-volume workspaces
 * and lives outside foundation.
 */

export interface ClassifyWorkflowOptions extends ClassifyDeps {
  onError?: (err: unknown, signal_id: string) => void;
  /** Throw after logging so a durable transport can redeliver the event. */
  rethrowErrors?: boolean;
  /**
   * Optional gate: return false to skip a particular event. Useful for
   * scoping which event sources flow through this classifier instance.
   */
  shouldHandle?: (event: { source: string; producer_ref: string | null }) => boolean;
}

export interface ClassifyWorkflow {
  subscription: Subscription;
}

export interface ClassifySubscriber {
  subscribe(
    handler: EventHandler<EventPayload<"signal.ingested">>,
    durableName: string,
  ): Promise<Subscription>;
}

export async function startClassifyWorkflow(
  opts: ClassifyWorkflowOptions,
  subscriber: ClassifySubscriber = defaultSubscriber(opts),
): Promise<ClassifyWorkflow> {
  const onError =
    opts.onError ??
    ((err, signal_id) => {
      console.error(`[classify] signal ${signal_id} threw:`, err);
    });
  const subscription = await subscriber.subscribe(
    async (event) => {
      if (opts.shouldHandle && !opts.shouldHandle({
        source: event.source,
        producer_ref: event.producer_ref ?? null,
      })) {
        return;
      }
      const signalId = (event.payload as { signal_id: string }).signal_id;
      try {
        await classifySignal(opts, { signal_id: signalId });
      } catch (err) {
        onError(err, signalId);
        if (opts.rethrowErrors) throw err;
      }
    },
    "signal_classifier",
  );
  return { subscription };
}

function defaultSubscriber(opts: ClassifyWorkflowOptions): ClassifySubscriber {
  return {
    subscribe(handler) {
      return opts.bus.subscribe("signal.ingested", handler);
    },
  };
}
