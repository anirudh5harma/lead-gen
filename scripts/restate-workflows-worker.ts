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
import { createRuntimeEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createPostgresRestateEventSignalStore,
  startRestateEventSignalBridge,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { serveRestateWorkflows } from "../core/substrate/workflows/adapters/restate-host.ts";
import { restateBearerFromEnv } from "../core/substrate/workflows/adapters/restate.ts";

const pool = getPool();
const bus = await createRuntimeEventBus({ pool });
const llm = createDeepSeekClientFromEnv();
const judge = createDeepSeekJudge({ llm });
const memory = {
  episodic: createPostgresEpisodicRepository({ pool }),
  semantic: createPostgresSemanticRepository({ pool }),
  procedural: createPostgresProceduralRepository({ pool }),
};

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
const bound = await serveRestateWorkflows({ workflows, bus, eventSignals, port });
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
