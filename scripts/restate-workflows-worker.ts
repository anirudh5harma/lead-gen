import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import {
  createDeepSeekJudge,
} from "../core/agents/eval/index.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresProceduralRepository,
  createPostgresSemanticRepository,
} from "../core/agents/memory/index.ts";
import {
  createOutlookSubscriptionRepairWorkflow,
  createWarmupSweepWorkflow,
  createOutlookSender,
  createSesSender,
} from "../core/channels/email/index.ts";
import {
  createOpenAIEmbeddingClient,
  createCatalogPollWorkflow,
  createExpireWorkflow,
  createWorkspacePollWorkflow,
} from "../core/ingest/index.ts";
import { createSeriesAColdOpenPlay } from "../core/plays/index.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createPostgresRestateEventSignalStore,
  startRestateEventSignalBridge,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { serveRestateWorkflows } from "../core/substrate/workflows/adapters/restate-host.ts";
import { restateBearerFromEnv } from "../core/substrate/workflows/adapters/restate.ts";

console.log("[restate-workflows] booting");
const natsUrl = requiredEnv("NATS_URL");
const natsCreds = process.env.NATS_CREDS?.trim();
const pool = getPool();
console.log("[restate-workflows] storage pool ready");
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_BYTES, "streamMaxBytes"),
  ...optionalPositiveNumber(process.env.NATS_STREAM_MAX_AGE_MS, "streamMaxAgeMs"),
});
console.log("[restate-workflows] event bus ready");
const llm = createDeepSeekClientFromEnv();
const judge = createDeepSeekJudge({ llm });
const memory = {
  episodic: createPostgresEpisodicRepository({ pool }),
  semantic: createPostgresSemanticRepository({ pool }),
  procedural: createPostgresProceduralRepository({ pool }),
};
console.log("[restate-workflows] agent dependencies ready");

const openAiKey = requiredEnv("OPENAI_API_KEY");
const restateIngressUrl = requiredEnv("RESTATE_INGRESS_URL");
const appOrigin = requiredEnv("APP_ORIGIN").replace(/\/$/, "");
const microsoftClientId = requiredEnv("MICROSOFT_CLIENT_ID");
const microsoftClientSecret = requiredEnv("MICROSOFT_CLIENT_SECRET");
const sesConfigurationSet = process.env.SES_CONFIGURATION_SET?.trim() || "bombsell-outbound";
const eventSignals = createPostgresRestateEventSignalStore(pool);
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
console.log(`[restate-workflows] handler listening on ${bound}`);
await startRestateEventSignalBridge({
  pool,
  bus,
  ingressUrl: restateIngressUrl,
  bearer: restateBearerFromEnv(),
});
setInterval(() => {
  void eventSignals.recoverStaleDeliveries().catch((err) => {
    console.error("[restate-workflows] failed to recover stale event waits", err);
  });
}, 30_000).unref();
console.log(`[restate-workflows] serving ${workflows.length} workflows on ${bound}`);

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the Restate workflow worker`);
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
