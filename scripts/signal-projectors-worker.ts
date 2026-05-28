import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import {
  registerSignalProjectors,
  startClassifyWorkflow,
} from "../core/ingest/index.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";

const natsUrl = process.env.NATS_URL?.trim();
if (!natsUrl) {
  throw new Error("NATS_URL is required to run signal projectors");
}

const natsCreds = process.env.NATS_CREDS?.trim();
const pool = getPool();
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
});
const llm = createDeepSeekClientFromEnv();

const projectorSubscriptions = await registerSignalProjectors(
  { pool, bus },
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
);
const classifier = await startClassifyWorkflow(
  {
    pool,
    bus,
    llm,
    rethrowErrors: true,
  },
  {
    subscribe(handler, durableName) {
      return bus.subscribeScoped("*", "signal.ingested", handler, { durableName });
    },
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
    classifier.subscription.unsubscribe(),
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
