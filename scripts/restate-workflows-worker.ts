import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import {
  createDeepSeekJudge,
} from "../core/agents/eval/index.ts";
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
  createOutlookSubscriptionRepairWorkflow,
  createWarmupSweepWorkflow,
  createOutlookSender,
  createPostgresOwnedDomainEmailChannel,
  createResendEmailTransport,
  createSesSender,
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
  createSharedXPollWorkflow,
  createWorkspacePollWorkflow,
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
import { researchWorkspaceWithExa } from "../core/product/app.ts";
import { registerProductTools } from "../core/product/tools.ts";
import {
  createSendingDomainProvisioningWorkflow,
  createSendingDomainWarmupWorkflow,
} from "../core/product/domain-provisioning.ts";
import { resolveProductEmailTransportMode } from "../core/product/env.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createPostgresRestateEventSignalStore,
  startRestateEventSignalBridge,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { serveRestateWorkflows } from "../core/substrate/workflows/adapters/restate-host.ts";
import { restateBearerFromEnv } from "../core/substrate/workflows/adapters/restate.ts";
import { createRestateRuntimeProbeWorkflow } from "../core/substrate/workflows/index.ts";
import { resolveRestateWorkflowPort } from "./worker-port.ts";

console.log("[restate-workflows] booting");
const natsUrl = requiredEnv("NATS_URL");
const natsCreds = process.env.NATS_CREDS?.trim();
const pool = getPool();
console.log("[restate-workflows] storage pool ready");
registerProductTools();
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
  createSharedXPollWorkflow({
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

function createProductLinkedInTransport(): LinkedInTransport {
  const endpoint = process.env.LINKEDIN_PROVIDER_URL?.trim();
  const apiKey = process.env.LINKEDIN_PROVIDER_API_KEY?.trim();
  if (endpoint && apiKey) return createHttpLinkedInTransport({ endpoint, apiKey });
  return createUnconfiguredLinkedInTransport();
}

function createOptionalResendEmailTransport() {
  if (resolveProductEmailTransportMode() !== "resend") {
    console.warn(
      "[restate-workflows] optional owned-domain email transport is disabled; set MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1 to enable it",
    );
    return undefined;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[restate-workflows] RESEND_API_KEY is not set; optional owned-domain email transport cannot start",
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
