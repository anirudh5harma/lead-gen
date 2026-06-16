import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import { createDeepSeekJudge } from "../core/agents/eval/index.ts";
import {
  createWorkspaceActivationSetupWorkflow,
  createWorkspaceCampaignStrategyWorkflow,
  createWorkspaceChannelReadinessWorkflow,
  createWorkspaceCompanyBrainBriefWorkflow,
  createWorkspaceCompanyBrainRecallWorkflow,
  createWorkspaceContactWaterfallWorkflow,
  createWorkspaceEvalGateWorkflow,
  createWorkspaceMeetingPrepWorkflow,
  createWorkspaceMessagePersonalizationWorkflow,
  createWorkspaceOutreachSkillSelectionWorkflow,
  createWorkspaceProfileIcpWorkflow,
  createWorkspaceReplyTriageWorkflow,
  createWorkspaceSignalIngestionWorkflow,
  createWorkspaceSkillOptimizerWorkflow,
  createWorkspaceSourceDiscoveryWorkflow,
  createWorkspaceVerticalIntelligenceWorkflow,
  createWorkspaceSignalMatchingWorkflow,
} from "../core/agents/langgraph/index.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresProceduralRepository,
  createPostgresSemanticRepository,
} from "../core/agents/memory/index.ts";
import {
  createDeepSeekIntentClassifier,
  createOutlookSender,
  createOutlookSubscriptionRepairWorkflow,
  createPostgresOwnedDomainEmailChannel,
  createResendEmailTransport,
  createSesSender,
  createWarmupSweepWorkflow,
  registerEmailIngressProjectors,
} from "../core/channels/email/index.ts";
import {
  createHttpLinkedInTransport,
  createPostgresLinkedInChannel,
  createUnconfiguredLinkedInTransport,
  type LinkedInTransport,
} from "../core/channels/linkedin/index.ts";
import {
  createContactResolutionProviders,
  createContactResolutionWorkflow,
} from "../core/contacts/index.ts";
import {
  createExaAeoAuditWorkflow,
  createExaBriefRefreshWorkflow,
  createExaContentOpportunityWorkflow,
  createExaDraftGroundingWorkflow,
  createExaOpenWebSignalWorkflow,
  createExaProfileBootstrapWorkflow,
  createExaRepResearchWorkflow,
} from "../core/exa/workflows.ts";
import {
  createOpenAIEmbeddingClient,
  createCatalogPollWorkflow,
  createExpireWorkflow,
  createWorkspacePollWorkflow,
  registerSignalProjectors,
} from "../core/ingest/index.ts";
import {
  createPostgresVerticalSliceStore,
  createReplyToEmailPlayWorkflow,
  createSeriesAColdOpenPlay,
  createSignalToEmailPlayWorkflow,
  createSignalToLinkedInPlayWorkflow,
  type DraftGroundingProviderInput,
} from "../core/plays/index.ts";
import { getWorkspaceAgentContext } from "../core/product/context.ts";
import { resolveProductEmailTransportMode } from "../core/product/env.ts";
import {
  createSendingDomainProvisioningWorkflow,
  createSendingDomainWarmupWorkflow,
} from "../core/product/domain-provisioning.ts";
import {
  dispatchReplyEmailPlaysOnce,
  dispatchSignalMatchingWorkflowFromIngestedEvent,
  dispatchSignalPlaysOnce,
  dispatchWorkspaceRecommendationResearchOnce,
  registerProductEventDispatchers,
  researchWorkspaceWithExa,
} from "../core/product/app.ts";
import { registerProductTools } from "../core/product/tools.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createPostgresRestateEventSignalStore,
  startRestateEventSignalBridge,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { serveRestateWorkflows } from "../core/substrate/workflows/adapters/restate-host.ts";
import {
  createRestateWorkflowRuntime,
  createRestateRuntimeProbeWorkflow,
  restateBearerFromEnv,
} from "../core/substrate/workflows/index.ts";
import { resolveRestateWorkflowPort } from "./worker-port.ts";

console.log("[production-worker] booting");

process.env.BOMBSELL_SUBSTRATE ??= "nats_restate";

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
registerProductTools();
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
const verticalStore = createPostgresVerticalSliceStore(pool);
const emailChannel = createPostgresOwnedDomainEmailChannel({
  pool,
  transport: createOptionalResendEmailTransport(),
  outlook,
});
const linkedinChannel = createPostgresLinkedInChannel({
  pool,
  transport: createProductLinkedInTransport(),
});

const workflows = [
  createRestateRuntimeProbeWorkflow(),
  createWorkspaceActivationSetupWorkflow({ bus }),
  createWorkspaceProfileIcpWorkflow({ bus }),
  createWorkspaceCampaignStrategyWorkflow({ bus }),
  createWorkspaceChannelReadinessWorkflow({ bus }),
  createWorkspaceCompanyBrainBriefWorkflow({ bus }),
  createWorkspaceCompanyBrainRecallWorkflow({ bus }),
  createWorkspaceContactWaterfallWorkflow({ bus }),
  createWorkspaceEvalGateWorkflow({ bus }),
  createWorkspaceMeetingPrepWorkflow({ bus }),
  createWorkspaceMessagePersonalizationWorkflow({ bus }),
  createWorkspaceOutreachSkillSelectionWorkflow({ bus }),
  createWorkspaceReplyTriageWorkflow({ bus }),
  createWorkspaceSignalIngestionWorkflow({ bus }),
  createWorkspaceSkillOptimizerWorkflow({ bus }),
  createWorkspaceSourceDiscoveryWorkflow({ bus }),
  createWorkspaceVerticalIntelligenceWorkflow({ bus }),
  createWorkspaceSignalMatchingWorkflow({ bus }),
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
  createSignalToEmailPlayWorkflow({
    store: verticalStore,
    memory,
    judge,
    writerLlm: llm,
    email: emailChannel,
    bus,
    workspaceContextProvider: workflowWorkspaceContext,
    draftGroundingProvider: workflowDraftGrounding,
  }),
  createSignalToLinkedInPlayWorkflow({
    store: verticalStore,
    memory,
    judge,
    writerLlm: llm,
    linkedin: linkedinChannel,
    bus,
    workspaceContextProvider: workflowWorkspaceContext,
    draftGroundingProvider: workflowDraftGrounding,
  }),
  createReplyToEmailPlayWorkflow({
    store: verticalStore,
    memory,
    judge,
    writerLlm: llm,
    email: emailChannel,
    bus,
    workspaceContextProvider: workflowWorkspaceContext,
  }),
  createContactResolutionWorkflow({
    pool,
    ...createContactResolutionProviders({ pool }),
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
  createSendingDomainProvisioningWorkflow({ bus }),
  createSendingDomainWarmupWorkflow({ bus }),
  createOutlookSubscriptionRepairWorkflow({
    pool,
    accessTokens: outlook,
    notificationUrl: `${appOrigin}/api/webhooks/outlook`,
  }),
  createExaProfileBootstrapWorkflow(),
  createExaBriefRefreshWorkflow(),
  createExaRepResearchWorkflow(),
  createExaDraftGroundingWorkflow(),
  createExaContentOpportunityWorkflow(),
  createExaAeoAuditWorkflow(),
  createExaOpenWebSignalWorkflow(),
];

const port = resolveRestateWorkflowPort();
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
    memory,
    outlookAccessTokens: outlook,
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
const playDispatchSubscriptions = await registerProductEventDispatchers(
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
  {
    limit: 50,
    dispatchSignalMatching: (event) =>
      dispatchSignalMatchingWorkflowFromIngestedEvent(event, {
        pool,
        workflows: workflowsClient,
      }),
  },
);
console.log("[production-worker] projectors consuming events");

await redriveProductPlayDispatches();
const productRedriveTimer = setInterval(() => {
  void redriveProductPlayDispatches().catch((err) => {
    console.error("[production-worker] product play redrive failed:", err);
  });
}, 60_000);
productRedriveTimer.unref();

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

async function redriveProductPlayDispatches(): Promise<void> {
  const [signalDispatched, replyDispatched, recommendationDispatched] = await Promise.all([
    dispatchSignalPlaysOnce({ limit: 100 }),
    dispatchReplyEmailPlaysOnce({ limit: 100 }),
    dispatchWorkspaceRecommendationResearchOnce({ limit: 25 }),
  ]);
  if (signalDispatched > 0 || replyDispatched > 0 || recommendationDispatched > 0) {
    console.log(
      `[production-worker] product play redrive: ${signalDispatched} signal plays, ${replyDispatched} reply plays, ${recommendationDispatched} recommendation workflows`,
    );
  }
}

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  clearInterval(recoveryTimer);
  clearInterval(productRedriveTimer);
  await Promise.all([
    ...emailSubscriptions.map((subscription) => subscription.unsubscribe()),
    ...signalSubscriptions.map((subscription) => subscription.unsubscribe()),
    ...playDispatchSubscriptions.map((subscription) => subscription.unsubscribe()),
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

function createProductLinkedInTransport(): LinkedInTransport {
  const endpoint = process.env.LINKEDIN_PROVIDER_URL?.trim();
  const apiKey = process.env.LINKEDIN_PROVIDER_API_KEY?.trim();
  if (endpoint && apiKey) return createHttpLinkedInTransport({ endpoint, apiKey });
  return createUnconfiguredLinkedInTransport();
}

function createOptionalResendEmailTransport() {
  if (resolveProductEmailTransportMode() !== "resend") {
    console.warn(
      "[production-worker] optional owned-domain email transport is disabled; set MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1 to enable it",
    );
    return undefined;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[production-worker] RESEND_API_KEY is not set; optional owned-domain email transport cannot start",
    );
    return undefined;
  }
  return createResendEmailTransport({ apiKey });
}

async function workflowWorkspaceContext(input: { workspace_id: string }): Promise<string | null> {
  const userId = await workflowUserId(input.workspace_id);
  if (!userId) return null;
  const context = await getWorkspaceAgentContext(
    { workspace_id: input.workspace_id, user_id: userId },
    pool,
  );
  return context.markdown;
}

async function workflowDraftGrounding(input: DraftGroundingProviderInput) {
  const userId = await workflowUserId(input.workspace_id);
  if (!userId) return null;
  return researchWorkspaceWithExa(
    {
      query: input.query,
      intent: "draft_grounding",
      num_results: 3,
      include_text: true,
      idempotency_nonce: `play:${input.play_run_id}:${input.signal.id}:${input.channel}`,
    },
    { workspace_id: input.workspace_id, user_id: userId },
  );
}

async function workflowUserId(workspace_id: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `select user_id
       from workspace_members
      where workspace_id = $1
        and accepted_at is not null
      order by
        case role when 'owner' then 0 when 'admin' then 1 else 2 end,
        invited_at asc
      limit 1`,
    [workspace_id],
  );
  return rows[0]?.user_id ?? null;
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
