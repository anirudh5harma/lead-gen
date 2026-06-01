import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresProceduralRepository,
  createPostgresSemanticRepository,
} from "../core/agents/memory/index.ts";
import {
  createDeepSeekIntentClassifier,
  registerEmailIngressProjectors,
} from "../core/channels/email/index.ts";
import {
  registerSignalProjectors,
  startClassifyWorkflow,
} from "../core/ingest/index.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "../core/substrate/workflows/index.ts";

const natsUrl = process.env.NATS_URL?.trim();
if (!natsUrl) {
  throw new Error("NATS_URL is required to run projectors");
}

const restateIngressUrl = process.env.RESTATE_INGRESS_URL?.trim();
if (!restateIngressUrl) {
  throw new Error("RESTATE_INGRESS_URL is required to run email ingress projectors");
}

const natsCreds = process.env.NATS_CREDS?.trim();
const pool = getPool();
const memory = {
  episodic: createPostgresEpisodicRepository({ pool }),
  semantic: createPostgresSemanticRepository({ pool }),
  procedural: createPostgresProceduralRepository({ pool }),
};
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_BYTES, "streamMaxBytes"),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_AGE_MS, "streamMaxAgeMs"),
});
const llm = createDeepSeekClientFromEnv();
const workflows = createRestateWorkflowRuntime({
  ingressUrl: restateIngressUrl,
  bearer: restateBearerFromEnv(),
});

const emailSubscriptions = await registerEmailIngressProjectors(
  {
    pool,
    bus,
    classifier: createDeepSeekIntentClassifier({ llm }),
    memory,
    outlookSubscriptionRepair: {
      async start({ workspace_id, channel_account_id }) {
        await workflows.start({
          workspace_id,
          workflow_name: "email_outlook_subscription_repair",
          idempotency_key: `outlook-subscription-bootstrap:${channel_account_id}`,
          input: { workspace_id, channel_account_id },
        });
      },
    },
  },
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
);

const signalSubscriptions = await registerSignalProjectors(
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
      `[projectors] NATS dispatch redrive: ${result.delivered} delivered, ${result.failed} failed`,
    );
  }
}

await redrivePendingDispatches();
const relayTimer = setInterval(() => {
  void redrivePendingDispatches().catch((err) => {
    console.error("[projectors] NATS dispatch redrive failed:", err);
  });
}, 5_000);
relayTimer.unref();

console.log("[projectors] consuming email ingress and signal lifecycle events");

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  await Promise.all([
    classifier.subscription.unsubscribe(),
    ...emailSubscriptions.map((subscription) => subscription.unsubscribe()),
    ...signalSubscriptions.map((subscription) => subscription.unsubscribe()),
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
