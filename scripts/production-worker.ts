import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import { createDeepSeekJudge } from "../core/agents/eval/index.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresProceduralRepository,
  createPostgresSemanticRepository,
} from "../core/agents/memory/index.ts";
import {
  createDeepSeekIntentClassifier,
  createOutlookSender,
  createOutlookSubscriptionRepairWorkflow,
  createSesSender,
  createWarmupSweepWorkflow,
  registerEmailIngressProjectors,
} from "../core/channels/email/index.ts";
import {
  createOpenAIEmbeddingClient,
  createCatalogPollWorkflow,
  createExpireWorkflow,
  createWorkspacePollWorkflow,
  registerSignalProjectors,
  startClassifyWorkflow,
} from "../core/ingest/index.ts";
import { createSeriesAColdOpenPlay } from "../core/plays/index.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createPostgresRestateEventSignalStore,
  startRestateEventSignalBridge,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { serveRestateWorkflows } from "../core/substrate/workflows/adapters/restate-host.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "../core/substrate/workflows/index.ts";

console.log("[production-worker] booting");

const natsUrl = requiredEnv("NATS_URL");
const natsCreds = process.env.NATS_CREDS?.trim();
const restateIngressUrl = requiredEnv("RESTATE_INGRESS_URL");
const openAiKey = requiredEnv("OPENAI_API_KEY");
const appOrigin = requiredEnv("APP_ORIGIN").replace(/\/$/, "");
const microsoftClientId = requiredEnv("MICROSOFT_CLIENT_ID");
const microsoftClientSecret = requiredEnv("MICROSOFT_CLIENT_SECRET");
const sesConfigurationSet = process.env.SES_CONFIGURATION_SET?.trim()
  || "bombsell-outbound";
const restateBearer = restateBearerFromEnv();

const pool = getPool();
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_BYTES, "streamMaxBytes"),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_AGE_MS, "streamMaxAgeMs"),
});
console.log("[production-worker] event bus ready");

const llm = createDeepSeekClientFromEnv();
const judge = createDeepSeekJudge({ llm });
const memory = {
  episodic: createPostgresEpisodicRepository({ pool }),
  semantic: createPostgresSemanticRepository({ pool }),
  procedural: createPostgresProceduralRepository({ pool }),
};
const eventSignals = createPostgresRestateEventSignalStore(pool);
const workflowsClient = createRestateWorkflowRuntime({
  ingressUrl: restateIngressUrl,
  bearer: restateBearer,
});
const outlook = createOutlookSender({
  pool,
  bus,
  clientId: microsoftClientId,
  clientSecret: microsoftClientSecret,
});

const workflows = [
  createSeriesAColdOpenPlay({
    pool,
    bus,
    llm,
    judge,
    memory,
    emailChannelDeps: {
      ses: createSesSender(),
      outlook,
      sesConfigurationSet,
    },
  }),
  createCatalogPollWorkflow({
    pool,
    bus,
    embedder: createOpenAIEmbeddingClient({ apiKey: openAiKey }),
  }),
  createWorkspacePollWorkflow({
    pool,
    bus,
    embedder: createOpenAIEmbeddingClient({ apiKey: openAiKey }),
  }),
  createExpireWorkflow({ pool, bus }),
  createWarmupSweepWorkflow({ pool }),
  createOutlookSubscriptionRepairWorkflow({
    pool,
    accessTokens: outlook,
    notificationUrl: `${appOrigin}/api/webhooks/outlook`,
  }),
];

const port = Number(process.env.RESTATE_WORKFLOW_PORT ?? 9080);
const bound = await serveRestateWorkflows({
  workflows,
  bus,
  eventSignals,
  port,
  http1: process.env.RESTATE_WORKFLOW_HTTP1 === "1",
});
console.log(`[production-worker] Restate handlers listening on ${bound}`);

const emailSubscriptions = await registerEmailIngressProjectors(
  {
    pool,
    bus,
    classifier: createDeepSeekIntentClassifier({ llm }),
    outlookSubscriptionRepair: {
      async start({ workspace_id, channel_account_id }) {
        await workflowsClient.start({
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
console.log("[production-worker] projectors consuming events");

await redrivePendingDispatches();
const relayTimer = setInterval(() => {
  void redrivePendingDispatches().catch((err) => {
    console.error("[production-worker] NATS dispatch redrive failed:", err);
  });
}, 5_000);
relayTimer.unref();

await startRestateEventSignalBridge({
  pool,
  bus,
  ingressUrl: restateIngressUrl,
  bearer: restateBearer,
});
const recoveryTimer = setInterval(() => {
  void eventSignals.recoverStaleDeliveries().catch((err) => {
    console.error("[production-worker] failed to recover stale event waits", err);
  });
}, 30_000);
recoveryTimer.unref();

async function redrivePendingDispatches(): Promise<void> {
  const result = await bus.redrivePending();
  if (result.attempted > 0) {
    console.log(
      `[production-worker] NATS dispatch redrive: ${result.delivered} delivered, ${result.failed} failed`,
    );
  }
}

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  clearInterval(recoveryTimer);
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

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the production worker`);
  return value;
}

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
