import {
  registerSignalProjectors,
} from "../core/ingest/index.ts";
import {
  dispatchSignalMatchingWorkflowFromIngestedEvent,
  registerSignalMatchingEventDispatcher,
} from "../core/product/app.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "../core/substrate/workflows/index.ts";

const natsUrl = process.env.NATS_URL?.trim();
if (!natsUrl) {
  throw new Error("NATS_URL is required to run signal projectors");
}

const natsCreds = process.env.NATS_CREDS?.trim();
const restateIngressUrl = process.env.RESTATE_INGRESS_URL?.trim();
if (!restateIngressUrl) {
  throw new Error("RESTATE_INGRESS_URL is required to run signal projectors");
}
const pool = getPool();
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_BYTES, "streamMaxBytes"),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_AGE_MS, "streamMaxAgeMs"),
});
const workflows = createRestateWorkflowRuntime({
  ingressUrl: restateIngressUrl,
  bearer: restateBearerFromEnv(),
});

const projectorSubscriptions = await registerSignalProjectors(
  { pool, bus },
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
);
const signalMatchingSubscription = await registerSignalMatchingEventDispatcher(
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
  {
    dispatchSignalMatching: (event) =>
      dispatchSignalMatchingWorkflowFromIngestedEvent(event, { pool, workflows }),
  },
);

async function redrivePendingDispatches(): Promise<void> {
  const result = await bus.redrivePending();
  if (result.attempted > 0) {
    console.log(
      `[signal-projectors] NATS dispatch redrive: ${result.delivered} delivered, ${result.failed} failed`,
    );
  }
}

await redrivePendingDispatches();
const relayTimer = setInterval(() => {
  void redrivePendingDispatches().catch((err) => {
    console.error("[signal-projectors] NATS dispatch redrive failed:", err);
  });
}, 5_000);
relayTimer.unref();

console.log("[signal-projectors] consuming signal classification lifecycle events");

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  await Promise.all([
    signalMatchingSubscription.unsubscribe(),
    ...projectorSubscriptions.map((subscription) => subscription.unsubscribe()),
  ]);
  await bus.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

function optionalPositiveNumber<K extends string>(
  raw: string | undefined,
  key: K,
): Partial<Record<K, number>> {
  if (!raw?.trim()) return {};
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return { [key]: value } as Partial<Record<K, number>>;
}
