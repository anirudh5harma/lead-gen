import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GraphCompany, GraphPerson, SourceKind } from "../graph/types.ts";
import {
  addCompanyExplicit,
  upsertTrackedCompany,
  type TrackedCompany,
} from "../ingest/catalog.ts";
import {
  createIcp,
  updateIcp,
  type IcpPredicateRule,
  type IcpRow,
} from "../ingest/icps.ts";
import { RepRole, type RepRole as RepRoleValue } from "../primitives/rep.ts";
import {
  SignalKind,
  type SignalKind as SignalKindValue,
} from "../primitives/signal.ts";
import {
  createFallbackJudge,
  createHeuristicJudge,
} from "../agents/eval/index.ts";
import {
  createPostgresEpisodicRepository,
  createOutcomeMemoryUpdateProjection,
  createProceduralMemorySeedProjection,
  createPostgresProceduralRepository,
  createProceduralMemoryStateProjection,
  createPostgresSemanticRepository,
  type RepMemory,
} from "../agents/memory/index.ts";
import {
  createDryRunEmailTransport,
  createOutlookSender,
  createPostgresOwnedDomainEmailChannel,
  createResendEmailTransport,
  type EmailTransport,
  type EmailChannel,
  type OutlookSender,
} from "../channels/email/index.ts";
import { createChannelAccountLifecycleProjection } from "../channels/account-lifecycle.ts";
import {
  createDryRunLinkedInTransport,
  createHttpLinkedInTransport,
  createLinkedInProviderAuthorizationProjection,
  createNativeLinkedInChannel,
  resolveLinkedInProviderAuthUrl,
  createUnconfiguredLinkedInTransport,
  type LinkedInChannel,
  type LinkedInChannelName,
  type LinkedInSessionAccount,
  type LinkedInTransport,
} from "../channels/linkedin/index.ts";
import { createMessageLifecycleProjection } from "../channels/message-lifecycle.ts";
import { createReplyLifecycleProjection } from "../channels/reply-lifecycle.ts";
import {
  createRssSignalIngestionWorkflow,
  ingestManualSignal,
  RSS_SIGNAL_INGESTION_WORKFLOW,
} from "../signals/index.ts";
import {
  classifySignal,
  createMockEmbeddingClient,
  createOpenAIEmbeddingClient,
  createWorkspacePollWorkflow,
  discoverWorkspaceSignalOnce,
  projectSignalClassification,
  projectSignalDiscovered,
  projectSignalExpiry,
  type WorkspaceSignalDiscoveryResult,
  WORKSPACE_POLL_WORKFLOW,
  type EmbeddingClient,
} from "../ingest/index.ts";
import {
  createSignalToEmailPlayWorkflow,
  createSignalToLinkedInPlayWorkflow,
  createReplyToEmailPlayWorkflow,
  createPostgresVerticalSliceStore,
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
  type ReplyToEmailPlayInput,
  type ReplyToEmailPlayOutput,
  type SignalToEmailPlayInput,
  type SignalToEmailPlayOutput,
  type SignalToLinkedInPlayInput,
  type SignalToLinkedInPlayOutput,
  type DraftGroundingProviderInput,
} from "../plays/index.ts";
import {
  parseApprovalPolicy,
  resolvePlayChannelPolicy,
  type PlayChannelPolicy,
} from "../plays/autonomy.ts";
import {
  createBudgetedLLMClient,
  createDeepSeekClientFromEnv,
  isLLMBudgetExceededError,
  type LLMClient,
} from "../agents/llm/index.ts";
import { createDeepSeekJudge } from "../agents/eval/adapters/deepseek-judge.ts";
import type { WorkflowRuntime } from "../substrate/workflows/index.ts";
import {
  createEmailDeliveryFeedbackProjection,
} from "./email-feedback.ts";
import {
  createSendingDomainProvisioningWorkflow,
  createSendingDomainProjection,
  createSendingDomainWarmupWorkflow,
  SENDING_DOMAIN_PROVISIONING_WORKFLOW,
  SENDING_DOMAIN_WARMUP_WORKFLOW,
  type SendingDomainOperation,
} from "./domain-provisioning.ts";
import {
  getEventTraceForCorrelation,
  getLatestEventTraceForWorkspace,
  type EventTrace,
} from "./forensics.ts";
import {
  createProductSubstrate,
  type ProductSubstrateMode,
} from "./substrate.ts";
import {
  buildCampaignOutcomeLearningExemplar,
  campaignOutcomePatternKey,
} from "./campaign-learning.ts";
import {
  planExaResearchQuery,
  recommendationResearchPatternKey,
} from "./exa-query-planning.ts";
import {
  buildRecommendationOutcomeLearningExemplar,
  createRecommendationLearningProjection,
} from "./recommendation-learning.ts";
import {
  createExaClientFromEnv,
  projectExaEvidence,
  searchExaWithWorkspaceCache,
  summarizeExaEvidence,
  type ExaResult,
} from "../exa/index.ts";
import { createConversationLifecycleProjection } from "../primitives/conversation-lifecycle.ts";
import { createOutcomeLifecycleProjection } from "../primitives/outcome-lifecycle.ts";
import {
  isProductionProductRuntime,
  ProductEnvironmentError,
  resolveProductEmailTransportMode,
  resolveProductLinkedInTransportMode,
} from "./env.ts";
import {
  listDeadLetteredDispatches,
  runDurableEventProjectionsOnce,
  redriveDeadLetteredDispatch,
  type DeadLetteredDispatch,
  type EventBus,
  type DurableEventProjection,
  type DurableProjectionTick,
  type PublishedEvent,
  type Subscription,
} from "../substrate/events/index.ts";
import {
  getPool,
  tryGetPool,
  withWorkspace,
} from "../substrate/storage/index.ts";

const DEFAULT_WORKSPACE_SLUG = "demo";
export const DEFAULT_PRODUCT_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_PRODUCT_WORKSPACE_SLUG = DEFAULT_WORKSPACE_SLUG;
const DEFAULT_WORKFLOW_LEASE_MS = 2 * 60 * 1000;
const EMAIL_ACCOUNT_CONFIGURATION_PROJECTION = "channel.email_account_configuration.v1";
const RUNNABLE_WORKFLOW_NAMES = [
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  RSS_SIGNAL_INGESTION_WORKFLOW,
  WORKSPACE_POLL_WORKFLOW,
  SENDING_DOMAIN_PROVISIONING_WORKFLOW,
  SENDING_DOMAIN_WARMUP_WORKFLOW,
] as const;
type WorkspaceRoleValue = "owner" | "admin" | "member";
type ProductEmailTransport = "resend" | "dry-run" | "unconfigured";

interface DefaultRepProfile {
  key: string;
  name: string;
  role: RepRoleValue;
  channels: string[];
  persona: {
    voice: string;
    story: string;
    kpis: string[];
    do_not: string[];
    samples: string[];
  };
  autonomy: {
    channels: Record<string, { daily_cap: number; approval: string }>;
    global: Record<string, unknown>;
  };
}

const DEFAULT_REP_TEAM: readonly DefaultRepProfile[] = [
  {
    key: "sampark",
    name: "Sampark",
    role: "sdr",
    channels: ["email"],
    persona: {
      voice: "Warm, precise, low-hype, founder-to-founder.",
      story: "Owns outreach from fresh market signals to useful conversations.",
      kpis: ["positive replies", "meetings booked"],
      do_not: ["Do not mention being an AI.", "Do not overpromise."],
      samples: ["Saw the launch. The timing feels worth a quick compare-notes conversation."],
    },
    autonomy: {
      channels: { email: { daily_cap: 25, approval: "approve_first" } },
      global: {},
    },
  },
  {
    key: "vaani",
    name: "Vaani",
    role: "content",
    channels: ["content"],
    persona: {
      voice: "Clear, observant, evidence-led, and useful without sounding like a brand deck.",
      story: "Turns market movement, buyer questions, and proof into content worth publishing.",
      kpis: ["post_published", "engagement_lift"],
      do_not: ["Do not manufacture authority.", "Do not use generic AI phrasing."],
      samples: [
        "The useful angle is not that teams need more pipeline. It is that timing signals change what is worth saying.",
      ],
    },
    autonomy: {
      channels: { content: { daily_cap: 3, approval: "approve_first" } },
      global: {},
    },
  },
  {
    key: "prayog",
    name: "Prayog",
    role: "campaign",
    channels: ["email", "content"],
    persona: {
      voice: "Structured, experimental, and calm about tradeoffs.",
      story: "Turns proven plays into small campaigns with clear review gates and measurable Outcomes.",
      kpis: ["positive replies", "meeting_booked", "engagement_lift"],
      do_not: ["Do not scale a weak signal.", "Do not bypass channel caps."],
      samples: [
        "Run the smallest version first, keep the signal clean, then expand only where the Outcome improves.",
      ],
    },
    autonomy: {
      channels: {
        email: { daily_cap: 15, approval: "approve_first" },
        content: { daily_cap: 2, approval: "approve_first" },
      },
      global: {},
    },
  },
  {
    key: "bodh",
    name: "Bodh",
    role: "researcher",
    channels: ["aeo", "web"],
    persona: {
      voice: "Precise, diagnostic, and grounded in cited evidence.",
      story: "Finds answer gaps, category narratives, and visibility opportunities before buyers ask.",
      kpis: ["engagement_lift", "follower_lift"],
      do_not: [
        "Do not treat search visibility as a vanity metric.",
        "Do not recommend pages without proof.",
      ],
      samples: [
        "The gap is not a missing keyword. It is a missing answer buyers expect before they trust the category.",
      ],
    },
    autonomy: {
      channels: { aeo: { daily_cap: 3, approval: "approve_first" } },
      global: {},
    },
  },
];

interface EmailDomainAccount {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  properties: Record<string, unknown> | null;
}

function configurationEventKey(
  eventType: string,
  workspace_id: string,
  entity_id: string,
  payload: unknown,
): string {
  const digest = createHash("sha256")
    .update(stableJson(payload))
    .digest("hex")
    .slice(0, 20);
  return `${eventType}:${workspace_id}:${entity_id}:${digest}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export type WorkspaceSignalSourceAdapter =
  | "rss"
  | "google_news"
  | "hn_front"
  | "hn_whos_hiring"
  | "product_hunt"
  | "reddit"
  | "exa"
  | "x_search"
  | "webhook";

export interface ProductWorkspaceSession {
  workspace_id: string;
  user_id: string;
}

export interface BootstrapResult {
  workspace_id: string;
  rep_id: string;
  play_id: string;
  channel_account_id: string;
  source_id?: string;
}

export interface SubmitSignalInput {
  company_name: string;
  company_domain?: string;
  person_name: string;
  person_email: string;
  signal_title: string;
  signal_content: string;
  signal_url?: string;
  signal_kind?: string;
  icp_segment?: string;
  match_score?: number;
  simulate_outcome_kind?: SignalToEmailPlayInput["simulate_outcome_kind"];
  approval: SignalToEmailPlayInput["email_approval"];
}

export interface ConfigureEmailInput {
  display_name: string;
  daily_cap: number;
}

export interface ProductWorkspace {
  id: string;
  slug: string;
  name: string;
}

export interface ConfigureRepInput {
  name: string;
  role?: RepRoleValue;
  voice: string;
  story?: string;
  daily_cap?: number;
  approval?: SignalToEmailPlayInput["email_approval"];
  do_not?: string[];
  samples?: string[];
}

export interface ConfigureIcpInput {
  name: string;
  description: string;
  signal_kind?: string;
  match_threshold?: number;
  nice_to_haves?: string[];
  enabled?: boolean;
}

export interface TrackCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  size_bucket?: string;
  greenhouse_id?: string;
  lever_id?: string;
  ashby_id?: string;
  workable_id?: string;
  career_rss_url?: string;
  reason?: string;
}

export interface ConfigureSignalEmailPlayInput {
  rep_id: string;
  name?: string;
  description?: string;
  signal_kind?: string;
  icp_name?: string;
  daily_cap?: number;
  approval?: SignalToEmailPlayInput["email_approval"];
}

export interface ConfigureSignalLinkedInPlayInput {
  rep_id: string;
  name?: string;
  description?: string;
  signal_kind?: string;
  icp_name?: string;
  action?: LinkedInChannelName;
  daily_cap?: number;
  approval?: SignalToLinkedInPlayInput["linkedin_approval"];
}

export interface LinkedInAccountConnectIntent {
  workspace_id: string;
  connect_url: string;
  provider_configured: boolean;
}

export interface OutlookAccountConnectIntent {
  workspace_id: string;
  connect_url: string;
  provider_configured: boolean;
}

export interface ConfigureActivationInput {
  rep: ConfigureRepInput;
  icp: ConfigureIcpInput;
  play?: Partial<Omit<ConfigureSignalEmailPlayInput, "rep_id">>;
  email?: ConfigureEmailInput;
  company?: TrackCompanyInput;
  source?: ConfigureRssSourceInput;
}

export interface ActivationSetupResult {
  workspace_id: string;
  rep_id: string;
  icp_id: string;
  play_id: string;
  channel_account_id?: string;
  tracked_company_id?: string;
  source_id?: string;
}

export interface ConfigureRssSourceInput {
  name: string;
  url: string;
  signal_kind?: string;
  poll_interval_minutes?: number;
}

export interface ConfigureWorkspaceSignalSourceInput {
  adapter: WorkspaceSignalSourceAdapter;
  name: string;
  provider?: string;
  signal_kind?: string;
  url?: string;
  query?: string;
  subreddit?: string;
  limit?: number;
  max_daily_items?: number;
  max_daily_calls?: number;
  monthly_spend_cap_usd?: number;
  poll_interval_minutes?: number;
  enabled?: boolean;
}

export interface DiscoverWorkspaceSignalInput {
  source_id: string;
  external_id: string;
  title: string;
  content?: string | null;
  url?: string | null;
  signal_kind?: string;
  freshness_at?: string;
  structured?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface DiscoveredSignalResult {
  workspace_id: string;
  outcome: WorkspaceSignalDiscoveryResult["outcome"];
  signal_id?: string;
  event_id?: string;
}

export interface DiscoverSignalWebhookOptions {
  producerRef?: string;
}

export interface ConfigureWorkspaceProfileInput {
  company_name: string;
  website_url: string;
  industry?: string | null;
  description?: string | null;
}

export interface ProductExaProfileInput {
  company_id?: string;
  company_name: string;
  website_url?: string;
  industry?: string | null;
  description?: string | null;
  max_results?: number;
}

export interface ProductExaResearchInput {
  query: string;
  intent?:
    | "rep_research"
    | "brief_refresh"
    | "draft_grounding"
    | "content_research"
    | "aeo_audit";
  num_results?: number;
  include_text?: boolean;
  idempotency_nonce?: string;
}

export interface ProductExaResearchResult {
  workspace_id: string;
  request_id: string | null;
  evidence_source_ids: string[];
  summary: string;
  review_items?: ProductBriefItem[];
  opportunities?: ProductBriefItem[];
  gaps?: ProductBriefItem[];
}

export interface ProductExaBriefRefreshInput {
  query?: string;
  num_results?: number;
  include_text?: boolean;
  idempotency_nonce?: string;
}

export interface ProductBriefItem {
  title: string;
  detail: string;
  url?: string | null;
  evidence_source_ids?: string[];
  review_id?: string;
  review_kind?: ProductRecommendationKind;
  source_event_id?: string;
  decision?: ProductRecommendationDecision;
  reviewed_at?: string;
  review_note?: string | null;
  outcome_id?: string;
  outcome_kind?: ProductRecommendationOutcomeKind;
  outcome_recorded_at?: string;
  outcome_external_ref?: string | null;
}

export type ProductRecommendationKind = "content_opportunity" | "aeo_gap";
export type ProductRecommendationDecision = "accepted" | "ignored";

export interface ProductRecommendationReviewInput {
  review_id: string;
  decision: ProductRecommendationDecision;
  note?: string | null;
}

export interface ProductRecommendationReviewResult {
  workspace_id: string;
  review_id: string;
  decision: ProductRecommendationDecision;
}

export interface ProductRecommendationUpdateInput {
  review_id: string;
  title: string;
  detail: string;
  url?: string | null;
  note?: string | null;
}

export interface ProductRecommendationUpdateResult {
  workspace_id: string;
  review_id: string;
}

export interface ProductRecommendationDeleteInput {
  review_id: string;
  reason?: string | null;
}

export interface ProductRecommendationDeleteResult {
  workspace_id: string;
  review_id: string;
  deleted: true;
}

export type ProductRecommendationOutcomeKind =
  | "post_published"
  | "follower_lift"
  | "engagement_lift";

export interface ProductRecommendationOutcomeInput {
  review_id: string;
  kind: ProductRecommendationOutcomeKind;
  score?: number;
  occurred_at?: string;
  external_ref?: string | null;
  properties?: Record<string, unknown>;
}

export interface ProductRecommendationOutcomeResult {
  workspace_id: string;
  review_id: string;
  outcome_id: string;
  kind: ProductRecommendationOutcomeKind;
  attributed_rep_id: string | null;
  pattern_key: string;
  exemplar_ids: string[];
}

export type ProductCampaignOutcomeKind =
  | "positive_reply"
  | "meeting_booked"
  | "opportunity_created"
  | "deal_won"
  | "engagement_lift"
  | "unsubscribe"
  | "bounce"
  | "do_not_contact";

export interface ProductCampaignOutcomeInput {
  play_run_id: string;
  kind: ProductCampaignOutcomeKind;
  score?: number;
  occurred_at?: string;
  external_ref?: string | null;
  note?: string | null;
  properties?: Record<string, unknown>;
}

export interface ProductCampaignOutcomeResult {
  workspace_id: string;
  play_run_id: string;
  outcome_id: string;
  kind: ProductCampaignOutcomeKind;
  attributed_rep_id: string | null;
  pattern_key: string;
  exemplar_ids: string[];
}

export interface ProductRecommendationQualityBucket {
  total_reviewed: number;
  accepted: number;
  ignored: number;
  acceptance_rate: number | null;
  last_reviewed_at: string | null;
}

export interface ProductRecommendationQuality extends ProductRecommendationQualityBucket {
  content_opportunity: ProductRecommendationQualityBucket;
  aeo_gap: ProductRecommendationQualityBucket;
}

export interface ProductExaBriefRefreshResult extends ProductExaResearchResult {
  notes: ProductBriefItem[];
  review_items: ProductBriefItem[];
  recent_changes: ProductBriefItem[];
  quiet_exceptions: ProductBriefItem[];
}

export interface ProductExaSignalDiscoveryInput {
  query: string;
  source_name?: string;
  signal_kind?: string;
  limit?: number;
  max_daily_items?: number;
  max_daily_calls?: number;
  monthly_spend_cap_usd?: number;
  enabled?: boolean;
}

export interface SubmittedSignalResult {
  signal_id: string;
  workspace_id: string;
}

export interface DispatchOptions {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}

export interface WorkflowLeaseOptions {
  workflowNames?: readonly string[];
  limit?: number;
  leaseMs?: number;
  leaseOwner: string;
}

export interface ProductCompanyProfile {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  exa_summary: string | null;
  exa_source_domains: string[];
  exa_market_terms: string[];
  exa_positioning_notes: string[];
  exa_competitor_mentions: string[];
  exa_audience_terms: string[];
  exa_proof_points: string[];
  exa_evidence_cards: Array<{
    title: string;
    url: string;
    source_domain: string | null;
    snippet: string | null;
    published_at: string | null;
  }>;
  exa_evidence_source_ids: string[];
  exa_result_count: number;
  exa_enriched_at: string | null;
}

export interface AppState {
  configured: boolean;
  bootstrap?: BootstrapResult;
  profile: ProductCompanyProfile | null;
  approvals: Array<{
    id: string;
    run_id: string;
    kind: string;
    reason: string | null;
    payload: Record<string, unknown>;
    decision: string;
    created_at: string;
  }>;
  runs: Array<{
    id: string;
    status: string;
    workflow_name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    created_at: string;
    ended_at: string | null;
  }>;
  recoveryQueue: Array<{
    id: string;
    workflow_name: string;
    status: string;
    input: Record<string, unknown>;
    error: string | null;
    failed_step_name: string | null;
    failed_step_attempt: number | null;
    created_at: string;
    ended_at: string | null;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
  }>;
  eventTrace: EventTrace;
  sendTraces: Array<{
    message_id: string;
    status: string;
    subject: string | null;
    rep_name: string | null;
    person_name: string | null;
    company_name: string | null;
    signal_title: string | null;
    signal_kind: string | null;
    signal_url: string | null;
    eval_score: number | null;
    eval_passed: boolean | null;
    eval_notes: Record<string, unknown> | null;
    defer_reason: string | null;
    pattern_key: string | null;
    workflow_run_id: string | null;
    workflow_status: string | null;
    play_run_id: string | null;
    approval_policy: string | null;
    created_at: string;
  }>;
  messages: Awaited<ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>>["messages"];
  outcomes: Awaited<ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>>["outcomes"];
  conversations: Awaited<ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>>["conversations"];
  channelAccounts: Array<{
    id: string;
    display_name: string;
    kind: string;
    daily_cap: number | null;
    daily_used: number;
    daily_window_start: string | null;
    status: string;
    domain: string | null;
    sending_domain_id: string | null;
    warmup_state: string | null;
    current_daily_cap: number | null;
    spf_verified: boolean | null;
    dkim_verified: boolean | null;
    dmarc_verified: boolean | null;
    provider_status: string | null;
    provider_domain_id: string | null;
    dns_records: Array<{
      record: string;
      name: string;
      type: string;
      value: string;
      status?: string | null;
    }>;
    bounce_rate_24h: number | null;
    complaint_rate_24h: number | null;
  }>;
  llmUsage: {
    used_tokens_24h: number;
    daily_token_cap: number;
  };
  sources: Array<{
    id: string;
    name: string;
    kind: string;
    enabled: boolean;
    url: string | null;
    signal_kind: string | null;
    poll_interval_minutes: number | null;
    last_polled_at: string | null;
    signal_count: number;
    latest_run_status: string | null;
    latest_run_created_at: string | null;
    latest_run_error: string | null;
  }>;
  brief: {
    refreshed_at: string | null;
    query: string | null;
    request_id: string | null;
    summary: string | null;
    evidence_source_ids: string[];
    notes: ProductBriefItem[];
    review_items: ProductBriefItem[];
    recent_changes: ProductBriefItem[];
    quiet_exceptions: ProductBriefItem[];
  } | null;
  content_reviews: ProductBriefItem[];
  aeo_reviews: ProductBriefItem[];
  recommendation_quality: ProductRecommendationQuality;
}

export interface ProductReviewPulse {
  content: {
    open: number;
    last_activity_at: Date | null;
  };
  aeo: {
    open: number;
    last_activity_at: Date | null;
  };
}

export interface ProductRecommendationSurfaceState {
  reviews: ProductBriefItem[];
  learning: ProductRecommendationQualityBucket;
}

interface ProductRecommendationState {
  content: ProductRecommendationSurfaceState;
  aeo: ProductRecommendationSurfaceState;
}

interface ProductEngine {
  pool: Pool;
  substrateMode: ProductSubstrateMode;
  bus: EventBus & { close(): Promise<void> };
  runtime: WorkflowRuntime;
  memory: RepMemory;
}

export interface AuthIdentityWorkspaceReconciliation {
  workspace_id: string;
  role: WorkspaceRoleValue;
}

interface AuthIdentityWorkspaceReconciliationDeps {
  pool?: Pool;
  bus?: Pick<EventBus, "publish">;
  applyMembership?: (event: PublishedEvent) => Promise<void>;
}

let enginePromise: Promise<ProductEngine> | null = null;

export function hasDatabase(): boolean {
  return Boolean(tryGetPool());
}

export async function getProductEngine(): Promise<ProductEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const pool = getPool();
    const substrate = await createProductSubstrate(pool);
    const { bus, runtime } = substrate;
    const memory: RepMemory = {
      episodic: createPostgresEpisodicRepository({ pool }),
      semantic: createPostgresSemanticRepository({ pool }),
      procedural: createPostgresProceduralRepository({ pool }),
    };
    return { pool, substrateMode: substrate.mode, bus, runtime, memory };
  })();
  return enginePromise;
}

export async function resetProductEngineForTests(): Promise<void> {
  const current = enginePromise;
  enginePromise = null;
  if (!current) return;
  try {
    const engine = await current;
    await engine.bus.close();
  } catch {
    /* best-effort test cleanup */
  }
}

export async function bootstrapWorkspace(
  pool = getPool(),
  user_id = DEFAULT_PRODUCT_USER_ID,
  opts: {
    ensureMembership?: boolean;
    workspace_id?: string;
    workspace_slug?: string;
    workspace_name?: string;
  } = {},
): Promise<BootstrapResult> {
  const ensureMembership = opts.ensureMembership ?? true;
  const workspace_id = opts.workspace_id ?? randomUUID();
  const slug = opts.workspace_slug ?? DEFAULT_WORKSPACE_SLUG;
  const engine = await getProductEngine();
  const existing = opts.workspace_id
    ? await pool.query<{ id: string }>(
        `select id from workspaces where id = $1`,
        [opts.workspace_id],
      )
    : await pool.query<{ id: string }>(
        `select id from workspaces where slug = $1`,
        [slug],
      );
  const ws = existing.rows[0]?.id ?? workspace_id;
  if (!existing.rows[0]) {
    await pool.query(
      `insert into workspaces (id, slug, name, settings)
       values ($1, $2, $3, $4::jsonb)`,
      [
        ws,
        slug,
        opts.workspace_name ?? "Bombsell Demo Workspace",
        JSON.stringify({ mode: "local-product" }),
      ],
    );
    const event = await engine.bus.publish({
      workspace_id: ws,
      event_type: "workspace.created",
      source: "system",
      producer_ref: user_id,
      idempotency_key: `bootstrap:workspace.created:${ws}`,
      payload: {
        workspace_id: ws,
        created_by: user_id,
        slug,
        name: opts.workspace_name ?? "Bombsell Demo Workspace",
        settings: { mode: "local-product" },
        owner_role: "owner",
      },
    });
    await projectWorkspaceCreated(engine.pool, event);
  } else if (ensureMembership) {
    await ensureWorkspaceMembership(engine, ws, user_id, "owner");
  }

  const rep = await ensureRep(engine, ws, user_id);
  const play = await ensurePlay(engine, ws, rep.id, user_id);
  const trustedDemoState = !isProductionProductRuntime();
  const account = await ensureChannelAccount(engine, ws, trustedDemoState, user_id);
  await ensureProceduralSeed(engine, ws, rep.id, user_id);
  return {
    workspace_id: ws,
    rep_id: rep.id,
    play_id: play.id,
    channel_account_id: account.id,
  };
}

export async function assertProductWorkspaceAccess(
  session: ProductWorkspaceSession,
  pool = getPool(),
): Promise<void> {
  await withWorkspace(pool, session, async () => undefined);
}

export async function findFirstProductWorkspaceForUser(
  user_id: string,
  pool = getPool(),
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `select w.id
     from workspace_members wm
     join workspaces w on w.id = wm.workspace_id
     where wm.user_id = $1
       and wm.accepted_at is not null
       and w.archived_at is null
     order by w.created_at asc, w.id asc
     limit 1`,
    [user_id],
  );
  return result.rows[0]?.id ?? null;
}

export async function createProductWorkspaceForUser(
  input: { name: string; slug?: string },
  user_id: string,
  pool = getPool(),
): Promise<ProductWorkspace> {
  const name = input.name.trim() || "Bombsell Workspace";
  const baseSlug = slugifyWorkspace(input.slug || name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    try {
      const { rows } = await pool.query<ProductWorkspace>(
        `insert into workspaces (id, slug, name, settings)
         values ($1, $2, $3, $4::jsonb)
         returning id, slug::text as slug, name`,
        [
          id,
          slug,
          name,
          JSON.stringify({ mode: "product-activation", activated_from: "dashboard" }),
        ],
      );

      const engine = await getProductEngine();
      const event = await engine.bus.publish({
        workspace_id: id,
        event_type: "workspace.created",
        source: "user",
        producer_ref: user_id,
        idempotency_key: `workspace.created:${id}`,
        payload: {
          workspace_id: id,
          created_by: user_id,
          slug,
          name,
          settings: { mode: "product-activation", activated_from: "dashboard" },
          owner_role: "owner",
        },
      });
      await projectWorkspaceCreated(engine.pool, event);
      return rows[0]!;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        slug = `${baseSlug}-${randomBytes(2).toString("hex")}`;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not create a unique workspace slug");
}

async function projectWorkspaceCreated(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    workspace_id: string;
    created_by: string;
    slug?: string;
    name?: string;
    settings?: Record<string, unknown>;
    owner_role?: "owner" | "admin" | "member";
  };
  if (payload.slug && payload.name) {
    await pool.query(
      `insert into workspaces (id, slug, name, settings)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         settings = workspaces.settings || excluded.settings`,
      [
        payload.workspace_id,
        payload.slug,
        payload.name,
        JSON.stringify(payload.settings ?? {}),
      ],
    );
  }
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role, accepted_at)
     values ($1, $2, $3::workspace_role, now())
     on conflict (workspace_id, user_id) do update set
       role = excluded.role,
       accepted_at = coalesce(workspace_members.accepted_at, excluded.accepted_at)`,
    [payload.workspace_id, payload.created_by, payload.owner_role ?? "owner"],
  );
}

export async function reconcileWorkspaceMembershipsForAuthIdentity(
  input: {
    user_id: string;
    email?: string | null;
    email_verified?: boolean;
  },
  deps: AuthIdentityWorkspaceReconciliationDeps = {},
): Promise<AuthIdentityWorkspaceReconciliation[]> {
  if (!input.email_verified) return [];
  const email = input.email?.trim().toLowerCase();
  if (!email) return [];

  const engine = !deps.pool || !deps.bus ? await getProductEngine() : null;
  const pool = deps.pool ?? engine!.pool;
  const bus = deps.bus ?? engine!.bus;
  const applyMembership =
    deps.applyMembership ?? ((event: PublishedEvent) => projectWorkspaceMemberAccepted(pool, event));

  const { rows } = await pool.query<AuthIdentityWorkspaceReconciliation>(
    `select distinct
        wm.workspace_id,
        wm.role::text as role
       from workspace_members wm
       join auth.users member_user on member_user.id = wm.user_id
       join workspaces w on w.id = wm.workspace_id
      where lower(member_user.email) = $2
        and wm.user_id <> $1
        and wm.accepted_at is not null
        and w.archived_at is null
        and not exists (
          select 1
            from workspace_members current_member
           where current_member.workspace_id = wm.workspace_id
             and current_member.user_id = $1
             and current_member.accepted_at is not null
        )
      order by wm.workspace_id`,
    [input.user_id, email],
  );

  for (const row of rows) {
    const event = await bus.publish({
      workspace_id: row.workspace_id,
      event_type: "workspace.member.accepted",
      source: "system",
      producer_ref: input.user_id,
      idempotency_key: `auth.identity.reconciled:${row.workspace_id}:${input.user_id}:${row.role}`,
      payload: {
        workspace_id: row.workspace_id,
        user_id: input.user_id,
        role: row.role,
      },
    });
    await applyMembership(event);
  }

  return rows;
}

async function ensureWorkspaceMembership(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
  role: WorkspaceRoleValue,
): Promise<void> {
  const existing = await engine.pool.query<{
    role: WorkspaceRoleValue;
    accepted: boolean;
  }>(
    `select role::text as role, accepted_at is not null as accepted
       from workspace_members
      where workspace_id = $1 and user_id = $2
      limit 1`,
    [workspace_id, user_id],
  );
  if (existing.rows[0]?.accepted && existing.rows[0].role === role) return;

  const event = await engine.bus.publish({
    workspace_id,
    event_type: "workspace.member.accepted",
    source: "system",
    producer_ref: user_id,
    idempotency_key: `bootstrap:workspace.member.accepted:${workspace_id}:${user_id}:${role}`,
    payload: {
      workspace_id,
      user_id,
      role,
    },
  });
  await projectWorkspaceMemberAccepted(engine.pool, event);
}

async function projectWorkspaceMemberAccepted(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    workspace_id: string;
    user_id: string;
    role: WorkspaceRoleValue;
  };
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role, accepted_at)
     values ($1, $2, $3::workspace_role, now())
     on conflict (workspace_id, user_id) do update set
       role = excluded.role,
       accepted_at = coalesce(workspace_members.accepted_at, excluded.accepted_at)`,
    [payload.workspace_id, payload.user_id, payload.role],
  );
}

function slugifyWorkspace(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `workspace-${randomBytes(2).toString("hex")}`;
}

async function ensureRep(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
): Promise<{ id: string }> {
  const team = await ensureDefaultRepTeam(engine, workspace_id, user_id);
  return { id: team.sampark };
}

async function ensureDefaultRepTeam(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
): Promise<Record<"sampark" | "vaani" | "prayog" | "bodh", string>> {
  const ids: Partial<Record<"sampark" | "vaani" | "prayog" | "bodh", string>> = {};
  for (const profile of DEFAULT_REP_TEAM) {
    ids[profile.key as keyof typeof ids] = await ensureDefaultRep(
      engine,
      workspace_id,
      user_id,
      profile,
    );
  }
  return {
    sampark: ids.sampark!,
    vaani: ids.vaani!,
    prayog: ids.prayog!,
    bodh: ids.bodh!,
  };
}

async function ensureDefaultRep(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
  profile: DefaultRepProfile,
): Promise<string> {
  const existing = await engine.pool.query<{ id: string }>(
    `select id from reps where workspace_id = $1 and lower(name) = lower($2)`,
    [workspace_id, profile.name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const rep_id = randomUUID();
  const event = await engine.bus.publish({
    workspace_id,
    event_type: "rep.configured",
    source: "system",
    producer_ref: user_id,
    idempotency_key: `bootstrap:rep.configured:${workspace_id}:${profile.key}`,
    payload: {
      rep_id,
      name: profile.name,
      role: profile.role,
      status: "active",
      persona: profile.persona,
      channels: profile.channels,
      autonomy: profile.autonomy,
    },
  });
  await projectRepConfigured(engine.pool, event);
  return rep_id;
}

async function ensurePlay(
  engine: ProductEngine,
  workspace_id: string,
  rep_id: string,
  user_id: string,
): Promise<{ id: string }> {
  const existing = await engine.pool.query<{ id: string }>(
    `select id from plays where workspace_id = $1 and lower(name) = lower($2) order by version desc limit 1`,
    [workspace_id, "Funding Signal Founder Email"],
  );
  if (existing.rows[0]) return existing.rows[0];
  const play_id = randomUUID();
  const declaration =
    "When a funding signal matches a fintech founder, draft and gate a concise founder-to-founder email.";
  const event = await engine.bus.publish({
    workspace_id,
    event_type: "play.configured",
    source: "system",
    producer_ref: user_id,
    idempotency_key: `bootstrap:play.configured:${workspace_id}:funding-signal-founder-email`,
    payload: {
      play_id,
      name: "Funding Signal Founder Email",
      declaration,
      compiled: {
        trigger: { kind: "signal", filter: { kind: "funding" } },
        steps: [
          { id: "research", op: "research.signal_context" },
          { id: "draft", op: "writer.compose_email" },
          { id: "judge", op: "eval.hot_path" },
          { id: "send", op: "sender.email" },
        ],
      },
      autonomy: {
        channels: { email: { daily_cap: 25, approval: "approve_first" } },
        global: {},
      },
      default_rep_id: rep_id,
      status: "active",
      version: 1,
    },
  });
  await projectPlayConfigured(engine.pool, event);
  return { id: play_id };
}

async function findEmailDomainAccount(
  pool: Pool,
  workspace_id: string,
): Promise<EmailDomainAccount | null> {
  const existing = await pool.query<EmailDomainAccount>(
    `select id,
            display_name,
            status::text as status,
            daily_cap,
            properties
       from channel_accounts
      where workspace_id = $1 and kind = 'email_domain'
      order by created_at asc limit 1`,
    [workspace_id],
  );
  return existing.rows[0] ?? null;
}

async function ensureChannelAccount(
  engine: ProductEngine,
  workspace_id: string,
  trustedDemoState: boolean,
  user_id: string,
): Promise<{ id: string; display_name: string }> {
  const existing = await findEmailDomainAccount(engine.pool, workspace_id);
  if (existing) {
    await ensureEmailDomainProjection(engine, workspace_id, existing, trustedDemoState, user_id);
    return existing;
  }
  const id = randomUUID();
  const display_name = trustedDemoState
    ? "sampark@go.bombsell.example"
    : "Email channel not configured";
  const payload = {
    channel_account_id: id,
    kind: "email_domain" as const,
    display_name,
    daily_cap: trustedDemoState ? 25 : 0,
    transport: trustedDemoState ? "dry-run" as const : "unconfigured" as const,
  };
  const event = await engine.bus.publish({
    workspace_id,
    event_type: "channel.account.configured",
    source: "system",
    producer_ref: user_id,
    idempotency_key: `bootstrap:channel.account.configured:${workspace_id}:email-domain`,
    payload,
  });
  await projectEmailAccountConfigured(engine.pool, event);
  return { id, display_name };
}

async function ensureEmailDomainProjection(
  engine: ProductEngine,
  workspace_id: string,
  account: EmailDomainAccount,
  trustedDemoState: boolean,
  user_id: string,
): Promise<void> {
  const domain = domainFromSender(account.display_name);
  if (!domain) return;
  const existingDomain = await engine.pool.query<{ id: string }>(
    `select id from sending_domains
      where workspace_id = $1 and channel_account_id = $2 and domain = $3
      limit 1`,
    [workspace_id, account.id, domain],
  );
  if (existingDomain.rows[0]) return;

  const payload = {
    channel_account_id: account.id,
    kind: "email_domain" as const,
    display_name: account.display_name,
    daily_cap: Math.max(0, Math.trunc(account.daily_cap ?? (trustedDemoState ? 25 : 0))),
    transport: resolveChannelAccountTransport(account, trustedDemoState),
  };
  const event = await engine.bus.publish({
    workspace_id,
    event_type: "channel.account.configured",
    source: "system",
    producer_ref: user_id,
    idempotency_key: configurationEventKey(
      "channel.account.configured",
      workspace_id,
      account.id,
      payload,
    ),
    payload,
  });
  await projectEmailAccountConfigured(engine.pool, event);
}

function resolveChannelAccountTransport(
  account: EmailDomainAccount,
  trustedDemoState: boolean,
): ProductEmailTransport {
  const transport = account.properties?.transport;
  if (transport === "resend" || transport === "dry-run" || transport === "unconfigured") {
    return transport;
  }
  if (account.status !== "connected") return "unconfigured";
  if (trustedDemoState) return "dry-run";
  return resolveProductEmailTransportMode();
}

async function ensureSendingDomain(
  pool: Pool,
  workspace_id: string,
  channel_account_id: string,
  display_name: string,
  trustedDemoState = !isProductionProductRuntime(),
  targetDailyCap = trustedDemoState ? 25 : 0,
): Promise<void> {
  const domain = domainFromSender(display_name);
  if (!domain) return;
  await pool.query(
    `delete from sending_domains
      where workspace_id = $1
        and channel_account_id = $2
        and domain <> $3`,
    [workspace_id, channel_account_id, domain],
  );
  await pool.query(
    `insert into sending_domains (
       workspace_id, channel_account_id, domain,
       spf_verified, dkim_verified, dmarc_verified,
       warmup_state, warmup_day, current_daily_cap, target_daily_cap,
       properties
     ) values ($1, $2, $3, $4, $4, $4, $5::domain_warmup_state, $6, $7, $8, $9::jsonb)
     on conflict (workspace_id, domain) do update set
       channel_account_id = excluded.channel_account_id,
       target_daily_cap = greatest(sending_domains.target_daily_cap, excluded.target_daily_cap),
       current_daily_cap = greatest(sending_domains.current_daily_cap, excluded.current_daily_cap),
       updated_at = now()`,
    [
      workspace_id,
      channel_account_id,
      domain,
      trustedDemoState,
      trustedDemoState ? "warmed" : "unverified",
      trustedDemoState ? 14 : 0,
      Math.max(0, Math.trunc(targetDailyCap)),
      trustedDemoState ? 25 : 0,
      JSON.stringify({
        managed_by: trustedDemoState ? "local-product-bootstrap" : "product-surface",
      }),
    ],
  );
}

function domainFromSender(display_name: string): string | null {
  const [, domain] = display_name.toLowerCase().split("@");
  return domain || null;
}

async function ensureProceduralSeed(
  engine: ProductEngine,
  workspace_id: string,
  rep_id: string,
  user_id: string,
): Promise<void> {
  await ensureProceduralSeedFor(engine, workspace_id, rep_id, user_id, {
    icp_segment: "fintech-founder",
    signal_kind: "funding",
    subject: "Congrats on the round",
    body:
      "Congrats on the raise. Usually this is when pipeline quality starts mattering more than raw volume.",
  });
}

async function ensureProceduralSeedFor(
  engine: ProductEngine,
  workspace_id: string,
  rep_id: string,
  user_id: string,
  input: {
    icp_segment: string;
    signal_kind: string;
    subject?: string;
    body?: string;
  },
): Promise<void> {
  const pattern_key = `icp:${input.icp_segment}|signal:${input.signal_kind}|stage:cold_open`;
  const existing = await engine.pool.query<{ id: string }>(
    `select id from rep_memory_procedural
      where workspace_id = $1 and rep_id = $2 and pattern_key = $3
      limit 1`,
    [workspace_id, rep_id, pattern_key],
  );
  if (existing.rows[0]) return;
  const event = await engine.bus.publish({
    workspace_id,
    event_type: "rep.memory.procedural.seeded",
    source: "system",
    producer_ref: user_id,
    idempotency_key:
      `bootstrap:rep.memory.procedural.seeded:${workspace_id}:${rep_id}:${pattern_key}`,
    payload: {
      exemplar_id: randomUUID(),
      rep_id,
      pattern_key,
      exemplar: {
        subject: input.subject ?? "Saw the signal",
        body:
          input.body ??
          "Saw the signal. The timing looked relevant enough to compare notes.",
      },
      initial_score: 0.55,
    },
  });
  await createProceduralMemorySeedProjection(engine.pool).apply(event);
}

export async function configureRep(
  input: ConfigureRepInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; rep_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const name = input.name.trim() || "Sampark";
  const role = parseRepRole(input.role);
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 25));
  const approval = parseApprovalPolicy(input.approval);
  const existing = await engine.pool.query<{ id: string }>(
    `select id from reps where workspace_id = $1 and lower(name) = lower($2) limit 1`,
    [session.workspace_id, name],
  );
  const rep_id = existing.rows[0]?.id ?? randomUUID();
  const persona = {
    voice: input.voice.trim() || "Warm, precise, low-hype, founder-to-founder.",
    story:
      input.story?.trim() ||
      "Acts on fresh buying signals without spraying generic outreach.",
    kpis: ["positive replies", "meetings booked"],
    do_not: input.do_not?.filter(Boolean) ?? [
      "Do not mention being an AI.",
      "Do not overpromise.",
    ],
    samples: input.samples?.filter(Boolean) ?? [
      "Saw the timing and thought it was worth a quick compare-notes conversation.",
    ],
  };
  const autonomy = {
    channels: {
      email: { daily_cap: dailyCap, approval },
    },
    global: {},
  };
  const payload = {
    rep_id,
    name,
    role,
    status: "active" as const,
    persona,
    channels: ["email"],
    autonomy,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "rep.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "rep.configured",
      session.workspace_id,
      rep_id,
      payload,
    ),
    payload,
  });
  await projectRepConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, rep_id };
}

function parseRepRole(role: unknown): RepRoleValue {
  const parsed = RepRole.safeParse(role);
  return parsed.success ? parsed.data : "sdr";
}

async function projectRepConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    rep_id: string;
    name: string;
    role: string;
    status: string;
    persona: Record<string, unknown>;
    channels: string[];
    autonomy: Record<string, unknown>;
  };
  await pool.query(
    `insert into reps (
       id, workspace_id, name, role, status, persona, channels, autonomy
     ) values ($1, $2, $3, $4::rep_role, $5::rep_status, $6::jsonb, $7::text[], $8::jsonb)
     on conflict (id) do update set
       name = excluded.name,
       role = excluded.role,
       status = excluded.status,
       persona = excluded.persona,
       channels = excluded.channels,
       autonomy = excluded.autonomy,
       updated_at = now()`,
    [
      payload.rep_id,
      event.workspace_id,
      payload.name,
      payload.role,
      payload.status,
      JSON.stringify(payload.persona),
      payload.channels,
      JSON.stringify(payload.autonomy),
    ],
  );
}

export async function configureIcpSegment(
  input: ConfigureIcpInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; icp_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const signalKind = parseSignalKind(input.signal_kind);
  const name = input.name.trim() || "Hiring signal ICP";
  const existing = await engine.pool.query<{ id: string }>(
    `select id from workspace_icps
      where workspace_id = $1 and lower(name) = lower($2)
      limit 1`,
    [session.workspace_id, name],
  );
  const icp_id = existing.rows[0]?.id ?? randomUUID();
  const must_haves: IcpPredicateRule[] = [
    { field: "kind", op: "eq", value: signalKind },
  ];
  const payload = {
    icp_id,
    name,
    description:
      input.description.trim() ||
      "Companies with fresh hiring signals that imply a near-term GTM or operations trigger.",
    must_haves,
    nice_to_haves: input.nice_to_haves?.filter(Boolean) ?? [
      "Recent role opening",
      "Clear buying committee",
    ],
    match_threshold: clamp01(input.match_threshold ?? 0.6),
    enabled: input.enabled ?? true,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.icp.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.icp.configured",
      session.workspace_id,
      icp_id,
      payload,
    ),
    payload,
  });
  await projectIcpConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, icp_id };
}

async function projectIcpConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<IcpRow> {
  const payload = event.payload as {
    icp_id: string;
    name: string;
    description: string;
    must_haves: IcpPredicateRule[];
    nice_to_haves: string[];
    match_threshold: number;
    enabled: boolean;
  };
  const existing = await pool.query<{ id: string }>(
    `select id from workspace_icps where workspace_id = $1 and id = $2`,
    [event.workspace_id, payload.icp_id],
  );
  if (existing.rows[0]) {
    const updated = await updateIcp(pool, event.workspace_id, payload.icp_id, {
      name: payload.name,
      description: payload.description,
      must_haves: payload.must_haves,
      nice_to_haves: payload.nice_to_haves,
      match_threshold: payload.match_threshold,
      enabled: payload.enabled,
    });
    if (!updated) throw new Error(`ICP not found after update: ${payload.icp_id}`);
    return updated;
  }
  return createIcpWithId(pool, event.workspace_id, payload);
}

async function createIcpWithId(
  pool: Pool,
  workspace_id: string,
  input: {
    icp_id: string;
    name: string;
    description: string;
    must_haves: IcpPredicateRule[];
    nice_to_haves: string[];
    match_threshold: number;
    enabled: boolean;
  },
): Promise<IcpRow> {
  const created = await createIcp(pool, workspace_id, {
    name: input.name,
    description: input.description,
    must_haves: input.must_haves,
    nice_to_haves: input.nice_to_haves,
    match_threshold: input.match_threshold,
    enabled: input.enabled,
  });
  if (created.id === input.icp_id) return created;
  await pool.query(
    `update workspace_icps set id = $3 where workspace_id = $1 and id = $2`,
    [workspace_id, created.id, input.icp_id],
  );
  const { rows } = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string;
    must_haves: IcpPredicateRule[];
    nice_to_haves: string[];
    match_threshold: string;
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
  }>(`select * from workspace_icps where id = $1`, [input.icp_id]);
  const row = rows[0]!;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description,
    must_haves: Array.isArray(row.must_haves) ? row.must_haves : [],
    nice_to_haves: Array.isArray(row.nice_to_haves) ? row.nice_to_haves : [],
    match_threshold: Number(row.match_threshold),
    enabled: row.enabled,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function trackCompanyForWorkspace(
  input: TrackCompanyInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; company_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const company = await upsertTrackedCompany(engine.pool, {
    name: input.name.trim(),
    domain: blankToUndefined(input.domain),
    industry: blankToUndefined(input.industry),
    size_bucket: blankToUndefined(input.size_bucket),
    greenhouse_id: blankToUndefined(input.greenhouse_id),
    lever_id: blankToUndefined(input.lever_id),
    ashby_id: blankToUndefined(input.ashby_id),
    workable_id: blankToUndefined(input.workable_id),
    career_rss_url: blankToUndefined(input.career_rss_url),
    properties: { managed_by: "dashboard-activation" },
  });
  await addCompanyExplicit(
    engine.pool,
    session.workspace_id,
    company.id,
    input.reason ?? "activation",
    session.user_id,
  );
  const payload = {
    company_id: company.id,
    name: company.name,
    domain: company.domain,
    reason: input.reason ?? "activation",
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.company.tracked",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.company.tracked",
      session.workspace_id,
      company.id,
      payload,
    ),
    payload,
  });
  await projectCompanyTracked(engine.pool, event, company);
  return { workspace_id: session.workspace_id, company_id: company.id };
}

async function projectCompanyTracked(
  pool: Pool,
  event: PublishedEvent,
  company?: TrackedCompany,
): Promise<void> {
  const payload = event.payload as {
    company_id: string;
    name: string;
    domain: string | null;
    reason: string | null;
  };
  if (!company) {
    await upsertTrackedCompany(pool, {
      name: payload.name,
      domain: payload.domain ?? undefined,
      properties: { projected_from: event.id },
    });
  }
  await addCompanyExplicit(
    pool,
    event.workspace_id!,
    payload.company_id,
    payload.reason ?? "activation",
    event.producer_ref,
  );
}

export async function configureWorkspaceCompanyProfile(
  input: ConfigureWorkspaceProfileInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; company_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const websiteUrl = normalizeWebsiteUrl(input.website_url);
  if (!websiteUrl) throw new Error("valid website_url required");
  const domain = domainFromWebsiteUrl(websiteUrl);
  const companyName = input.company_name.trim() || titleizeDomain(domain);
  const existing = domain
    ? await engine.pool.query<{ id: string }>(
        `select id from graph_companies
          where workspace_id = $1 and domain = $2
          limit 1`,
        [session.workspace_id, domain],
      )
    : await engine.pool.query<{ id: string }>(
        `select id from graph_companies
          where workspace_id = $1 and lower(name) = lower($2)
          order by created_at asc
          limit 1`,
        [session.workspace_id, companyName],
      );
  const company_id = existing.rows[0]?.id ?? randomUUID();
  const payload = {
    company_id,
    name: companyName,
    domain,
    website_url: websiteUrl,
    industry: blankToNull(input.industry ?? undefined),
    description: blankToNull(input.description ?? undefined),
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.company.profiled",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.company.profiled",
      session.workspace_id,
      company_id,
      payload,
    ),
    payload,
  });
  await projectWorkspaceCompanyProfiled(engine.pool, event);
  return { workspace_id: session.workspace_id, company_id };
}

export async function enrichWorkspaceProfileWithExa(
  input: ProductExaProfileInput,
  session: ProductWorkspaceSession,
): Promise<{
  workspace_id: string;
  company_id: string;
  evidence_source_ids: string[];
  summary: string;
}> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const websiteUrl = input.website_url ? normalizeWebsiteUrl(input.website_url) : null;
  const domain = websiteUrl ? domainFromWebsiteUrl(websiteUrl) : null;
  const companyName = input.company_name.trim() || (domain ? titleizeDomain(domain) : "Workspace company");
  const company_id =
    input.company_id ??
    (await findWorkspaceCompanyId(engine.pool, session.workspace_id, {
      domain,
      name: companyName,
    })) ??
    randomUUID();
  const queries = exaProfileQueries({
    companyName,
    domain,
    industry: input.industry ?? null,
    description: input.description ?? null,
  });
  const client = createExaClientFromEnv();
  const results: ExaResult[] = [];
  const requestIds: string[] = [];
  const queryHashes: string[] = [];
  const usageIds: string[] = [];
  let cacheHitCount = 0;
  const maxPerQuery = Math.max(2, Math.min(5, Math.trunc(input.max_results ?? 8)));
  const profileQuery = queries.join(" | ");
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.requested",
    source: "system",
    producer_ref: `exa:profile:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.requested",
      session.workspace_id,
      company_id,
      { query: profileQuery, intent: "profile_bootstrap", maxPerQuery },
    ),
    payload: {
      query: profileQuery,
      intent: "profile_bootstrap",
    },
  });
  for (const query of queries) {
    const search = await searchExaWithWorkspaceCache({
      pool: engine.pool,
      workspace_id: session.workspace_id,
      intent: "profile_bootstrap",
      client,
      search: {
        query,
        type: "auto",
        numResults: maxPerQuery,
        includeText: true,
        textMaxCharacters: 1600,
        highlights: true,
        summary: true,
      },
    });
    const response = search.response;
    if (response.requestId) requestIds.push(response.requestId);
    queryHashes.push(search.query_hash);
    if (search.usage_id) usageIds.push(search.usage_id);
    if (search.cache_hit) cacheHitCount += 1;
    results.push(...response.results);
    await publishExaContentsFetched(engine, session, {
      entity_id: company_id,
      intent: "profile_bootstrap",
      request_id: response.requestId,
      results: response.results,
      cache_hit: search.cache_hit,
    });
  }
  const deduped = dedupeExaResults(results).slice(0, Math.max(3, Math.min(18, input.max_results ?? 12)));
  const projected = await projectExaEvidence(engine.pool, {
    workspace_id: session.workspace_id,
    query: profileQuery,
    query_intent: "profile_bootstrap",
    request_id: requestIds[0] ?? null,
    results: deduped,
    properties: {
      company_id,
      company_name: companyName,
      website_url: websiteUrl,
      phase: "profile_bootstrap",
    },
  });
  const summary = summarizeExaEvidence(deduped, 8);
  const intelligence = buildExaProfileIntelligence(deduped);
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.completed",
    source: "system",
    producer_ref: `exa:profile:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.completed",
      session.workspace_id,
      company_id,
      { query: profileQuery, intent: "profile_bootstrap", request_ids: requestIds },
    ),
    payload: {
      query: profileQuery,
      intent: "profile_bootstrap",
      request_id: requestIds[0] ?? null,
      result_count: deduped.length,
      cache_hit: cacheHitCount === queries.length,
      cache_hit_count: cacheHitCount,
      query_hashes: queryHashes,
      usage_ids: usageIds,
    },
  });
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.evidence.projected",
    source: "system",
    producer_ref: `exa:profile:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.evidence.projected",
      session.workspace_id,
      company_id,
      { query: profileQuery, intent: "profile_bootstrap", sources: projected.sources.map((source) => source.id) },
    ),
    payload: {
      query: profileQuery,
      intent: "profile_bootstrap",
      evidence_source_ids: projected.sources.map((source) => source.id),
      result_count: deduped.length,
    },
  });
  const payload = {
    company_id,
    company_name: companyName,
    website_url: websiteUrl,
    evidence_source_ids: projected.sources.map((source) => source.id),
    summary,
    intelligence,
    query_count: queries.length,
    result_count: deduped.length,
    request_ids: requestIds,
    cache_hit_count: cacheHitCount,
    exa_usage_ids: usageIds,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.profile.enriched",
    source: "system",
    producer_ref: `exa:profile:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "workspace.profile.enriched",
      session.workspace_id,
      company_id,
      payload,
    ),
    payload,
  });
  await projectWorkspaceProfileEnriched(engine.pool, event);
  return {
    workspace_id: session.workspace_id,
    company_id,
    evidence_source_ids: payload.evidence_source_ids,
    summary,
  };
}

export async function startWorkspaceProfileEnrichmentWithExa(
  input: ProductExaProfileInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; workflow_run_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const {
    createExaProfileBootstrapWorkflow,
    EXA_PROFILE_BOOTSTRAP_WORKFLOW,
  } = await import("../exa/workflows.ts");
  engine.runtime.register(createExaProfileBootstrapWorkflow());
  const workflowInput = {
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    ...input,
  };
  const entityId =
    input.company_id ??
    createHash("sha256")
      .update(`${input.company_name}:${input.website_url ?? ""}`)
      .digest("hex")
      .slice(0, 20);
  const run = await engine.runtime.start({
    workspace_id: session.workspace_id,
    workflow_name: EXA_PROFILE_BOOTSTRAP_WORKFLOW,
    idempotency_key: configurationEventKey(
      EXA_PROFILE_BOOTSTRAP_WORKFLOW,
      session.workspace_id,
      entityId,
      workflowInput,
    ),
    input: workflowInput,
  });
  return { workspace_id: session.workspace_id, workflow_run_id: run.id };
}

export async function startWorkspaceExaResearchWorkflow(
  input: ProductExaResearchInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; workflow_run_id: string; workflow_name: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const intent = input.intent ?? "rep_research";
  const {
    createExaBriefRefreshWorkflow,
    createExaAeoAuditWorkflow,
    createExaContentOpportunityWorkflow,
    createExaDraftGroundingWorkflow,
    createExaRepResearchWorkflow,
    EXA_AEO_AUDIT_WORKFLOW,
    EXA_BRIEF_REFRESH_WORKFLOW,
    EXA_CONTENT_OPPORTUNITY_WORKFLOW,
    EXA_DRAFT_GROUNDING_WORKFLOW,
    EXA_REP_RESEARCH_WORKFLOW,
  } = await import("../exa/workflows.ts");
  const workflow =
    intent === "brief_refresh"
      ? createExaBriefRefreshWorkflow()
      : intent === "draft_grounding"
      ? createExaDraftGroundingWorkflow()
      : intent === "content_research"
        ? createExaContentOpportunityWorkflow()
        : intent === "aeo_audit"
          ? createExaAeoAuditWorkflow()
          : createExaRepResearchWorkflow();
  const workflow_name =
    intent === "brief_refresh"
      ? EXA_BRIEF_REFRESH_WORKFLOW
      : intent === "draft_grounding"
      ? EXA_DRAFT_GROUNDING_WORKFLOW
      : intent === "content_research"
        ? EXA_CONTENT_OPPORTUNITY_WORKFLOW
        : intent === "aeo_audit"
          ? EXA_AEO_AUDIT_WORKFLOW
          : EXA_REP_RESEARCH_WORKFLOW;
  engine.runtime.register(workflow);
  const workflowInput = {
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    query: input.query,
    num_results: input.num_results,
    include_text: input.include_text,
    idempotency_nonce: input.idempotency_nonce,
  };
  const entityId = createHash("sha256")
    .update(`${intent}:${input.query.trim()}`)
    .digest("hex")
    .slice(0, 20);
  const run = await engine.runtime.start({
    workspace_id: session.workspace_id,
    workflow_name,
    idempotency_key: configurationEventKey(
      workflow_name,
      session.workspace_id,
      entityId,
      workflowInput,
    ),
    input: workflowInput,
  });
  return { workspace_id: session.workspace_id, workflow_run_id: run.id, workflow_name };
}

export async function startWorkspaceBriefRefreshWithExa(
  input: ProductExaBriefRefreshInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; workflow_run_id: string; workflow_name: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const {
    createExaBriefRefreshWorkflow,
    EXA_BRIEF_REFRESH_WORKFLOW,
  } = await import("../exa/workflows.ts");
  engine.runtime.register(createExaBriefRefreshWorkflow());
  const workflowInput = {
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    query: input.query,
    num_results: input.num_results,
    include_text: input.include_text,
    idempotency_nonce: input.idempotency_nonce,
  };
  const entityId = createHash("sha256")
    .update(`${input.query?.trim() ?? "auto"}:${new Date().toISOString().slice(0, 10)}`)
    .digest("hex")
    .slice(0, 20);
  const run = await engine.runtime.start({
    workspace_id: session.workspace_id,
    workflow_name: EXA_BRIEF_REFRESH_WORKFLOW,
    idempotency_key: configurationEventKey(
      EXA_BRIEF_REFRESH_WORKFLOW,
      session.workspace_id,
      entityId,
      { ...workflowInput, idempotency_nonce: input.idempotency_nonce ?? null },
    ),
    input: workflowInput,
  });
  return {
    workspace_id: session.workspace_id,
    workflow_run_id: run.id,
    workflow_name: EXA_BRIEF_REFRESH_WORKFLOW,
  };
}

export async function refreshWorkspaceBriefWithExa(
  input: ProductExaBriefRefreshInput,
  session: ProductWorkspaceSession,
): Promise<ProductExaBriefRefreshResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const context = await loadBriefRefreshContext(engine.pool, session.workspace_id);
  const query = (input.query?.trim() || buildBriefRefreshQuery(context)).trim();
  if (!query) throw new Error("brief refresh query required");
  const entityId = createHash("sha256")
    .update(`brief_refresh:${query}`)
    .digest("hex")
    .slice(0, 20);
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.requested",
    source: "system",
    producer_ref: `exa:brief:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.requested",
      session.workspace_id,
      entityId,
      { query, intent: "brief_refresh", num_results: input.num_results ?? 8 },
    ),
    payload: {
      query,
      intent: "brief_refresh",
    },
  });
  const search = await searchExaWithWorkspaceCache({
    pool: engine.pool,
    workspace_id: session.workspace_id,
    intent: "brief_refresh",
    client: createExaClientFromEnv(),
    search: {
      query,
      type: "auto",
      numResults: Math.max(3, Math.min(12, Math.trunc(input.num_results ?? 8))),
      includeText: input.include_text ?? true,
      textMaxCharacters: 1600,
      highlights: true,
      summary: true,
    },
  });
  const response = search.response;
  await publishExaContentsFetched(engine, session, {
    entity_id: entityId,
    intent: "brief_refresh",
    request_id: response.requestId,
    results: response.results,
    cache_hit: search.cache_hit,
  });
  const projected = await projectExaEvidence(engine.pool, {
    workspace_id: session.workspace_id,
    query,
    query_intent: "brief_refresh",
    request_id: response.requestId,
    results: response.results,
    properties: {
      phase: "brief_refresh",
      company_name: context.company?.name ?? null,
      recent_signal_ids: context.signals.map((signal) => signal.id),
    },
  });
  const evidenceSourceIds = projected.sources.map((source) => source.id);
  const summary = summarizeExaEvidence(response.results, 6);
  const brief = buildBriefRefreshPayload({
    context,
    results: response.results,
    evidence_source_ids: evidenceSourceIds,
  });
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.completed",
    source: "system",
    producer_ref: `exa:brief:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.completed",
      session.workspace_id,
      entityId,
      { query, intent: "brief_refresh", request_id: response.requestId },
    ),
    payload: {
      query,
      intent: "brief_refresh",
      request_id: response.requestId,
      result_count: response.results.length,
      cache_hit: search.cache_hit,
      cache_hit_count: search.cache_hit ? 1 : 0,
      query_hashes: [search.query_hash],
      usage_ids: search.usage_id ? [search.usage_id] : [],
    },
  });
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.evidence.projected",
    source: "system",
    producer_ref: `exa:brief:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.evidence.projected",
      session.workspace_id,
      entityId,
      { query, intent: "brief_refresh", evidence_source_ids: evidenceSourceIds },
    ),
    payload: {
      query,
      intent: "brief_refresh",
      evidence_source_ids: evidenceSourceIds,
      result_count: response.results.length,
    },
  });
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "rep.brief.refreshed",
    source: "system",
    producer_ref: `exa:brief:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "rep.brief.refreshed",
      session.workspace_id,
      entityId,
      {
        query,
        request_id: response.requestId,
        evidence_source_ids: evidenceSourceIds,
        usage_id: search.usage_id,
      },
    ),
    payload: {
      query,
      request_id: response.requestId,
      evidence_source_ids: evidenceSourceIds,
      summary,
      result_count: response.results.length,
      cache_hit: search.cache_hit,
      exa_usage_id: search.usage_id,
      ...brief,
    },
  });
  return {
    workspace_id: session.workspace_id,
    request_id: response.requestId,
    evidence_source_ids: evidenceSourceIds,
    summary,
    ...brief,
  };
}

export async function researchWorkspaceWithExa(
  input: ProductExaResearchInput,
  session: ProductWorkspaceSession,
): Promise<ProductExaResearchResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const query = input.query.trim();
  if (!query) throw new Error("query required");
  const intent = input.intent ?? "rep_research";
  if (intent === "brief_refresh") {
    return refreshWorkspaceBriefWithExa(
      {
        query,
        num_results: input.num_results,
        include_text: input.include_text,
        idempotency_nonce: input.idempotency_nonce,
      },
      session,
    );
  }
  const planned = await planExaResearchQuery(engine.pool, {
    workspace_id: session.workspace_id,
    intent,
    query,
  });
  const exaQuery = planned.query;
  const researchEntityId = createHash("sha256")
    .update(`${intent}:${exaQuery}`)
    .digest("hex")
    .slice(0, 20);
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.requested",
    source: "system",
    producer_ref: `exa:${intent}:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.requested",
      session.workspace_id,
      researchEntityId,
      { query: exaQuery, intent, num_results: input.num_results ?? 8 },
    ),
    payload: {
      query: exaQuery,
      intent,
      original_query: planned.query_plan ? planned.original_query : undefined,
      query_plan: planned.query_plan,
    },
  });
  const search = await searchExaWithWorkspaceCache({
    pool: engine.pool,
    workspace_id: session.workspace_id,
    intent,
    client: createExaClientFromEnv(),
    search: {
      query: exaQuery,
      type: "auto",
      numResults: Math.max(1, Math.min(25, Math.trunc(input.num_results ?? 8))),
      includeText: input.include_text ?? true,
      textMaxCharacters: 1800,
      highlights: true,
      summary: true,
    },
  });
  const response = search.response;
  await publishExaContentsFetched(engine, session, {
    entity_id: researchEntityId,
    intent,
    request_id: response.requestId,
    results: response.results,
    cache_hit: search.cache_hit,
  });
  const projected = await projectExaEvidence(engine.pool, {
    workspace_id: session.workspace_id,
    query: exaQuery,
    query_intent: intent,
    request_id: response.requestId,
    results: response.results,
    properties: {
      phase: intent,
      original_query: planned.query_plan ? planned.original_query : null,
      query_plan: planned.query_plan ?? null,
    },
  });
  const evidenceSourceIds = projected.sources.map((source) => source.id);
  const summary = summarizeExaEvidence(response.results, 8);
  const reviewPayload = buildExaResearchReviewPayload(intent, response.results, evidenceSourceIds);
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.query.completed",
    source: "system",
    producer_ref: `exa:${intent}:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.query.completed",
      session.workspace_id,
      researchEntityId,
      { query: exaQuery, intent, request_id: response.requestId },
    ),
    payload: {
      query: exaQuery,
      intent,
      original_query: planned.query_plan ? planned.original_query : undefined,
      query_plan: planned.query_plan,
      request_id: response.requestId,
      result_count: response.results.length,
      cache_hit: search.cache_hit,
      cache_hit_count: search.cache_hit ? 1 : 0,
      query_hashes: [search.query_hash],
      usage_ids: search.usage_id ? [search.usage_id] : [],
    },
  });
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.evidence.projected",
    source: "system",
    producer_ref: `exa:${intent}:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.evidence.projected",
      session.workspace_id,
      researchEntityId,
      { query: exaQuery, intent, evidence_source_ids: evidenceSourceIds },
    ),
    payload: {
      query: exaQuery,
      intent,
      original_query: planned.query_plan ? planned.original_query : undefined,
      query_plan: planned.query_plan,
      evidence_source_ids: evidenceSourceIds,
      result_count: response.results.length,
    },
  });
  const eventType =
    intent === "content_research"
      ? "content.opportunity.discovered"
      : intent === "aeo_audit"
        ? "aeo.audit.completed"
        : "rep.research.completed";
  const completionKeyPayload = {
    query: exaQuery,
    evidence_source_ids: evidenceSourceIds,
    request_id: response.requestId,
    ...(intent === "content_research" || intent === "aeo_audit"
      ? { review_contract: "structured_review_v1" }
      : {}),
  };
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: eventType,
    source: "system",
    producer_ref: `exa:${intent}:${session.user_id}`,
    idempotency_key: configurationEventKey(
      eventType,
      session.workspace_id,
      createHash("sha256").update(exaQuery).digest("hex").slice(0, 20),
      completionKeyPayload,
    ),
    payload: {
      query: exaQuery,
      original_query: planned.query_plan ? planned.original_query : undefined,
      query_plan: planned.query_plan,
      request_id: response.requestId,
      evidence_source_ids: evidenceSourceIds,
      summary,
      result_count: response.results.length,
      cache_hit: search.cache_hit,
      exa_usage_id: search.usage_id,
      ...reviewPayload,
    },
  });
  return {
    workspace_id: session.workspace_id,
    request_id: response.requestId,
    evidence_source_ids: evidenceSourceIds,
    summary,
    ...reviewPayload,
  };
}

export async function reviewProductRecommendation(
  input: ProductRecommendationReviewInput,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationReviewResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const reviewId = input.review_id.trim();
  if (!reviewId) throw new Error("review_id is required");
  const recommendation = await findProductRecommendationForReview(
    engine.pool,
    session.workspace_id,
    reviewId,
  );
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${reviewId}`);
  }
  if (!recommendation.review_kind || !recommendation.source_event_id) {
    throw new Error(`Recommendation is missing review metadata: ${reviewId}`);
  }
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "recommendation.reviewed",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "recommendation.reviewed",
      session.workspace_id,
      reviewId,
      {
        decision: input.decision,
        note: input.note?.trim() || null,
      },
    ),
    payload: {
      review_id: reviewId,
      review_kind: recommendation.review_kind,
      source_event_id: recommendation.source_event_id,
      decision: input.decision,
      note: input.note?.trim() || null,
      item: {
        title: recommendation.title,
        detail: recommendation.detail,
        url: recommendation.url ?? null,
        evidence_source_ids: recommendation.evidence_source_ids ?? [],
      },
    },
  });
  return {
    workspace_id: session.workspace_id,
    review_id: reviewId,
    decision: input.decision,
  };
}

export async function updateProductRecommendation(
  input: ProductRecommendationUpdateInput,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationUpdateResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const reviewId = input.review_id.trim();
  if (!reviewId) throw new Error("review_id is required");
  const recommendation = await findProductRecommendationForReview(
    engine.pool,
    session.workspace_id,
    reviewId,
    { includeDeleted: false },
  );
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${reviewId}`);
  }
  if (!recommendation.review_kind || !recommendation.source_event_id) {
    throw new Error(`Recommendation is missing review metadata: ${reviewId}`);
  }
  const title = input.title.trim();
  if (!title) throw new Error("Recommendation title is required");
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "recommendation.updated",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "recommendation.updated",
      session.workspace_id,
      reviewId,
      {
        title,
        detail: input.detail.trim(),
        url: input.url?.trim() || null,
        note: input.note?.trim() || null,
      },
    ),
    payload: {
      review_id: reviewId,
      review_kind: recommendation.review_kind,
      source_event_id: recommendation.source_event_id,
      note: input.note?.trim() || null,
      item: {
        title,
        detail: input.detail.trim(),
        url: input.url?.trim() || null,
        evidence_source_ids: recommendation.evidence_source_ids ?? [],
      },
    },
  });
  return {
    workspace_id: session.workspace_id,
    review_id: reviewId,
  };
}

export async function deleteProductRecommendation(
  input: ProductRecommendationDeleteInput,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationDeleteResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const reviewId = input.review_id.trim();
  if (!reviewId) throw new Error("review_id is required");
  const recommendation = await findProductRecommendationForReview(
    engine.pool,
    session.workspace_id,
    reviewId,
    { includeDeleted: true },
  );
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${reviewId}`);
  }
  if (!recommendation.review_kind || !recommendation.source_event_id) {
    throw new Error(`Recommendation is missing review metadata: ${reviewId}`);
  }
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "recommendation.deleted",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "recommendation.deleted",
      session.workspace_id,
      reviewId,
      { reason: input.reason?.trim() || null },
    ),
    payload: {
      review_id: reviewId,
      review_kind: recommendation.review_kind,
      source_event_id: recommendation.source_event_id,
      reason: input.reason?.trim() || null,
      item: {
        title: recommendation.title,
        detail: recommendation.detail,
        url: recommendation.url ?? null,
        evidence_source_ids: recommendation.evidence_source_ids ?? [],
      },
    },
  });
  return {
    workspace_id: session.workspace_id,
    review_id: reviewId,
    deleted: true,
  };
}

export async function recordProductRecommendationOutcome(
  input: ProductRecommendationOutcomeInput,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationOutcomeResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const reviewId = input.review_id.trim();
  if (!reviewId) throw new Error("review_id is required");

  const review = await findAcceptedRecommendationReview(
    engine.pool,
    session.workspace_id,
    reviewId,
  );
  if (!review) {
    throw new Error(`Accepted recommendation review not found: ${reviewId}`);
  }

  const pattern_key = recommendationResearchPatternKey(review.review_kind);
  const attribution = await findOrSeedRecommendationOutcomeAttribution(
    engine,
    session,
    reviewId,
    review,
    pattern_key,
    input.kind,
    input.external_ref ?? null,
  );
  const occurredAtInput = input.occurred_at?.trim() || null;
  const occurred_at = occurredAtInput
    ? new Date(occurredAtInput).toISOString()
    : new Date().toISOString();
  const properties = {
    ...(input.properties ?? {}),
    recommendation_review_id: reviewId,
    recommendation_review_kind: review.review_kind,
    recommendation_source_event_id: review.source_event_id,
    recommendation_item: review.item,
    external_ref: input.external_ref ?? null,
    pattern_key,
    exemplar_ids: attribution.exemplar_ids,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "outcome.recorded",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "outcome.recorded",
      session.workspace_id,
      reviewId,
      {
        kind: input.kind,
        score: input.score ?? null,
        occurred_at: occurredAtInput,
        external_ref: input.external_ref ?? null,
      },
    ),
    payload: {
      outcome_id: randomUUID(),
      kind: input.kind,
      score: clamp01(input.score ?? defaultRecommendationOutcomeScore(input.kind)),
      conversation_id: null,
      attributed_play_id: null,
      attributed_play_run_id: null,
      attributed_message_id: null,
      attributed_signal_id: null,
      attributed_rep_id: attribution.rep_id,
      properties,
      provenance: {
        source: "recommendation.outcome",
        review_event_id: review.event_id,
        recorded_by: session.user_id,
      },
      occurred_at,
    },
  });
  if (engine.substrateMode === "postgres") {
    await projectVisibleProductState(engine);
  }
  return {
    workspace_id: session.workspace_id,
    review_id: reviewId,
    outcome_id: event.payload.outcome_id,
    kind: input.kind,
    attributed_rep_id: attribution.rep_id,
    pattern_key,
    exemplar_ids: attribution.exemplar_ids,
  };
}

export async function recordProductCampaignOutcome(
  input: ProductCampaignOutcomeInput,
  session: ProductWorkspaceSession,
): Promise<ProductCampaignOutcomeResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const playRunId = input.play_run_id.trim();
  if (!playRunId) throw new Error("play_run_id is required");

  const playRun = await findCampaignOutcomePlayRun(
    engine.pool,
    session.workspace_id,
    playRunId,
  );
  if (!playRun) throw new Error(`Play run not found: ${playRunId}`);

  const pattern_key = campaignOutcomePatternKey(playRun.play_id);
  const attribution = await findOrSeedCampaignOutcomeAttribution(
    engine,
    session,
    playRun,
    pattern_key,
    input.kind,
    input.note ?? null,
  );
  const occurredAtInput = input.occurred_at?.trim() || null;
  const occurred_at = occurredAtInput
    ? new Date(occurredAtInput).toISOString()
    : new Date().toISOString();
  const properties = {
    ...(input.properties ?? {}),
    campaign_play_run_id: playRunId,
    campaign_play_id: playRun.play_id,
    campaign_play_name: playRun.play_name,
    external_ref: input.external_ref ?? null,
    note: input.note?.trim() || null,
    pattern_key,
    exemplar_ids: attribution.exemplar_ids,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "outcome.recorded",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "outcome.recorded",
      session.workspace_id,
      playRunId,
      {
        kind: input.kind,
        score: input.score ?? null,
        occurred_at: occurredAtInput,
        external_ref: input.external_ref ?? null,
        note: input.note?.trim() || null,
      },
    ),
    payload: {
      outcome_id: randomUUID(),
      kind: input.kind,
      score: clamp01(input.score ?? defaultCampaignOutcomeScore(input.kind)),
      conversation_id: null,
      attributed_play_id: playRun.play_id,
      attributed_play_run_id: playRunId,
      attributed_message_id: null,
      attributed_signal_id: playRun.trigger_event_signal_id,
      attributed_rep_id: attribution.rep_id,
      properties,
      provenance: {
        source: "campaign.outcome",
        play_run_id: playRunId,
        recorded_by: session.user_id,
      },
      occurred_at,
    },
  });
  if (engine.substrateMode === "postgres") {
    await projectVisibleProductState(engine);
  }
  return {
    workspace_id: session.workspace_id,
    play_run_id: playRunId,
    outcome_id: event.payload.outcome_id,
    kind: input.kind,
    attributed_rep_id: attribution.rep_id,
    pattern_key,
    exemplar_ids: attribution.exemplar_ids,
  };
}

async function publishExaContentsFetched(
  engine: ProductEngine,
  session: ProductWorkspaceSession,
  input: {
    entity_id: string;
    intent: string;
    request_id: string | null;
    results: readonly ExaResult[];
    cache_hit?: boolean;
  },
): Promise<void> {
  const ids = input.results.flatMap((result) => (result.id ? [result.id] : []));
  const urls = input.results.flatMap((result) => (result.url ? [result.url] : []));
  if (ids.length === 0 && urls.length === 0) return;
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "exa.contents.fetched",
    source: "system",
    producer_ref: `exa:${input.intent}:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "exa.contents.fetched",
      session.workspace_id,
      input.entity_id,
      {
        intent: input.intent,
        request_id: input.request_id,
        ids,
        urls,
      },
    ),
    payload: {
      request_id: input.request_id,
      ids,
      urls,
      result_count: input.results.length,
      cache_hit: input.cache_hit ?? false,
    },
  });
}

export async function configureExaOpenWebSignalSource(
  input: ProductExaSignalDiscoveryInput,
  session: ProductWorkspaceSession,
): Promise<BootstrapResult & { source_id: string }> {
  const result = await configureWorkspaceSignalSource(
    {
      adapter: "exa",
      name: input.source_name?.trim() || "Exa open-web intelligence",
      provider: "exa",
      query: input.query,
      signal_kind: input.signal_kind,
      limit: input.limit,
      max_daily_items: input.max_daily_items,
      max_daily_calls: input.max_daily_calls,
      monthly_spend_cap_usd: input.monthly_spend_cap_usd,
      poll_interval_minutes: 60,
      enabled: input.enabled ?? true,
    },
    session,
  );
  if (!result.source_id) throw new Error("Exa source configuration did not return a source id.");
  return { ...result, source_id: result.source_id };
}

async function projectWorkspaceCompanyProfiled(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    company_id: string;
    name: string;
    domain: string | null;
    website_url: string;
    industry: string | null;
    description: string | null;
  };
  await pool.query(
    `insert into graph_companies (
       id, workspace_id, name, domain, industry, description, properties, provenance
     ) values (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb
     )
     on conflict (id) do update set
       name = excluded.name,
       domain = coalesce(excluded.domain, graph_companies.domain),
       industry = coalesce(excluded.industry, graph_companies.industry),
       description = coalesce(excluded.description, graph_companies.description),
       properties = graph_companies.properties || excluded.properties,
       provenance = graph_companies.provenance || excluded.provenance,
       updated_at = now()`,
    [
      payload.company_id,
      event.workspace_id,
      payload.name,
      payload.domain,
      payload.industry,
      payload.description,
      JSON.stringify({
        profile_role: "workspace_company",
        website_url: payload.website_url,
      }),
      JSON.stringify({
        source: "firecrawl",
        event_id: event.id,
      }),
    ],
  );
}

async function projectWorkspaceProfileEnriched(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    company_id: string;
    evidence_source_ids: string[];
    summary: string;
    intelligence?: {
      source_domains?: string[];
      market_terms?: string[];
      positioning_notes?: string[];
      competitor_mentions?: string[];
      audience_terms?: string[];
      proof_points?: string[];
      evidence_cards?: Array<{
        title?: string;
        url?: string;
        source_domain?: string | null;
        snippet?: string | null;
        published_at?: string | null;
      }>;
    };
    query_count: number;
    result_count: number;
    request_ids: string[];
  };
  await pool.query(
    `update graph_companies
        set properties = properties || $3::jsonb,
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [
      event.workspace_id,
      payload.company_id,
      JSON.stringify({
        exa_profile: {
          evidence_source_ids: payload.evidence_source_ids,
          summary: payload.summary,
          intelligence: payload.intelligence ?? {
            source_domains: [],
            market_terms: [],
            positioning_notes: [],
            competitor_mentions: [],
            audience_terms: [],
            proof_points: [],
            evidence_cards: [],
          },
          query_count: payload.query_count,
          result_count: payload.result_count,
          request_ids: payload.request_ids,
          enriched_at: event.occurred_at,
        },
      }),
    ],
  );
}

export async function configureDefaultSignalAggregator(
  input: {
    company_name: string;
    website_url?: string | null;
    industry?: string | null;
    description?: string | null;
    signal_kind?: string;
  },
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; source_count: number }> {
  const companyName = input.company_name.trim() || "the company";
  const industry = input.industry?.trim();
  const marketPhrase =
    industry || signalKeywordsFromDescription(input.description) || "B2B SaaS";
  // Keep signup/profile bootstrap predictable and free-source-first. Paid Exa
  // monitoring is configured explicitly through product.signal.discover_open_web.
  const sourceInputs: ConfigureWorkspaceSignalSourceInput[] = [
    {
      adapter: "google_news",
      name: `${companyName} market news`,
      query: `${marketPhrase} hiring funding launch`,
      signal_kind: input.signal_kind ?? "press_mention",
      poll_interval_minutes: 30,
    },
    {
      adapter: "hn_front",
      name: "Hacker News launch signals",
      signal_kind: "product_launch",
      poll_interval_minutes: 60,
    },
    {
      adapter: "hn_whos_hiring",
      name: "HN hiring signals",
      signal_kind: "hiring",
      poll_interval_minutes: 60,
    },
    {
      adapter: "product_hunt",
      name: "Product Hunt launches",
      signal_kind: "product_launch",
      poll_interval_minutes: 60,
    },
  ];
  let source_count = 0;
  for (const source of sourceInputs) {
    await configureWorkspaceSignalSource(source, session);
    source_count++;
  }
  return { workspace_id: session.workspace_id, source_count };
}

export async function configureSignalEmailPlay(
  input: ConfigureSignalEmailPlayInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; play_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const signalKind = parseSignalKind(input.signal_kind);
  const name = input.name?.trim() || `${titleizeSignalKind(signalKind)} Signal Email`;
  const existing = await engine.pool.query<{ id: string; version: number }>(
    `select id, version from plays
      where workspace_id = $1 and lower(name) = lower($2)
      order by version desc
      limit 1`,
    [session.workspace_id, name],
  );
  const play_id = existing.rows[0]?.id ?? randomUUID();
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 25));
  const approval = parseApprovalPolicy(input.approval);
  const declaration =
    input.description?.trim() ||
    `When a ${signalKind.replace(/_/g, " ")} Signal matches ${input.icp_name ?? "the ICP"}, draft, judge, gate, and send one concise founder-led email.`;
  const compiled = {
    workflow: SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
    channel: "email",
    trigger: { kind: "signal", filter: { kind: signalKind } },
    steps: [
      { id: "research", op: "research.signal_context" },
      { id: "draft", op: "writer.compose_email" },
      { id: "judge", op: "eval.hot_path" },
      { id: "approval", op: "approval.channel_gate" },
      { id: "send", op: "sender.email" },
    ],
  };
  const autonomy = {
    channels: { email: { daily_cap: dailyCap, approval } },
    global: {},
  };
  const payload = {
    play_id,
    name,
    declaration,
    compiled,
    autonomy,
    default_rep_id: input.rep_id,
    status: "active" as const,
    version: existing.rows[0]?.version ?? 1,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "play.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "play.configured",
      session.workspace_id,
      play_id,
      payload,
    ),
    payload,
  });
  await projectPlayConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, play_id };
}

export async function configureSignalLinkedInPlay(
  input: ConfigureSignalLinkedInPlayInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; play_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const signalKind = parseSignalKind(input.signal_kind);
  const action = parseLinkedInAction(input.action) ?? "linkedin_dm";
  const actionLabel = titleizeLinkedInAction(action);
  const name = input.name?.trim() || `${titleizeSignalKind(signalKind)} Signal ${actionLabel}`;
  const existing = await engine.pool.query<{ id: string; version: number }>(
    `select id, version from plays
      where workspace_id = $1 and lower(name) = lower($2)
      order by version desc
      limit 1`,
    [session.workspace_id, name],
  );
  const play_id = existing.rows[0]?.id ?? randomUUID();
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 10));
  const approval = parseApprovalPolicy(input.approval);
  const declaration =
    input.description?.trim() ||
    `When a ${signalKind.replace(/_/g, " ")} Signal matches ${input.icp_name ?? "the ICP"}, research, draft, judge, gate, and send one concise LinkedIn touch.`;
  const compiled = {
    workflow: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
    channel: action,
    trigger: { kind: "signal", filter: { kind: signalKind } },
    steps: [
      { id: "research", op: "research.signal_context" },
      { id: "draft", op: "writer.compose_linkedin" },
      { id: "judge", op: "eval.hot_path" },
      { id: "approval", op: "approval.channel_gate" },
      { id: "send", op: "sender.linkedin" },
    ],
  };
  const autonomy = {
    channels: { [action]: { daily_cap: dailyCap, approval } },
    global: {},
  };
  const payload = {
    play_id,
    name,
    declaration,
    compiled,
    autonomy,
    default_rep_id: input.rep_id,
    status: "active" as const,
    version: existing.rows[0]?.version ?? 1,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "play.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "play.configured",
      session.workspace_id,
      play_id,
      payload,
    ),
    payload,
  });
  await projectPlayConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, play_id };
}

async function projectPlayConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    play_id: string;
    name: string;
    declaration: string;
    compiled: Record<string, unknown>;
    autonomy: Record<string, unknown>;
    default_rep_id: string | null;
    status: string;
    version: number;
  };
  await pool.query(
    `insert into plays (
       id, workspace_id, name, description, declaration, compiled,
       compiler_version, autonomy, default_rep_id, status, version
     ) values ($1, $2, $3, $4, $5, $6::jsonb, 'dashboard-v1', $7::jsonb, $8, $9::play_status, $10)
     on conflict (id) do update set
       name = excluded.name,
       description = excluded.description,
       declaration = excluded.declaration,
       compiled = excluded.compiled,
       compiler_version = excluded.compiler_version,
       autonomy = excluded.autonomy,
       default_rep_id = excluded.default_rep_id,
       status = excluded.status,
       updated_at = now()`,
    [
      payload.play_id,
      event.workspace_id,
      payload.name,
      payload.declaration,
      payload.declaration,
      JSON.stringify(payload.compiled),
      JSON.stringify(payload.autonomy),
      payload.default_rep_id,
      payload.status,
      payload.version,
    ],
  );
}

export async function configureActivationSetup(
  input: ConfigureActivationInput,
  session: ProductWorkspaceSession,
): Promise<ActivationSetupResult> {
  const engine = await getProductEngine();
  const rep = await configureRep(input.rep, session);
  await ensureDefaultRepTeam(engine, session.workspace_id, session.user_id);
  const icp = await configureIcpSegment(input.icp, session);
  const signalKind = parseSignalKind(input.icp.signal_kind);
  const play = await configureSignalEmailPlay(
    {
      rep_id: rep.rep_id,
      signal_kind: signalKind,
      icp_name: input.icp.name,
      daily_cap: input.play?.daily_cap ?? input.rep.daily_cap,
      approval: input.play?.approval ?? input.rep.approval,
      name: input.play?.name,
      description: input.play?.description,
    },
    session,
  );
  let channel_account_id: string | undefined;
  if (input.email?.display_name) {
    const email = await configureWorkspaceEmailAccount(input.email, session);
    channel_account_id = email.channel_account_id;
  }
  let tracked_company_id: string | undefined;
  if (input.company?.name?.trim()) {
    const tracked = await trackCompanyForWorkspace(input.company, session);
    tracked_company_id = tracked.company_id;
  }
  let source_id: string | undefined;
  if (input.source?.url?.trim()) {
    await configureRssSource(input.source, session);
    const row = await getPool().query<{ id: string }>(
      `select id from graph_sources
        where workspace_id = $1 and name = $2
        order by created_at desc
        limit 1`,
      [session.workspace_id, input.source.name],
    );
    source_id = row.rows[0]?.id ?? source_id;
  }
  await ensureProceduralSeedFor(engine, session.workspace_id, rep.rep_id, session.user_id, {
    icp_segment: icp.icp_id,
    signal_kind: signalKind,
    subject: "Saw the hiring signal",
    body:
      "Saw the new role. Usually that means the operating motion is changing fast enough to compare notes.",
  });
  return {
    workspace_id: session.workspace_id,
    rep_id: rep.rep_id,
    icp_id: icp.icp_id,
    play_id: play.play_id,
    channel_account_id,
    tracked_company_id,
    source_id,
  };
}

function parseSignalKind(kind: unknown): SignalKindValue {
  const parsed = SignalKind.safeParse(kind);
  return parsed.success ? parsed.data : "hiring";
}

function titleizeSignalKind(kind: string): string {
  return kind
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseLinkedInAction(action: unknown): LinkedInChannelName | null {
  return action === "linkedin_connection" ||
    action === "linkedin_dm" ||
    action === "linkedin_comment"
    ? action
    : null;
}

function titleizeLinkedInAction(action: LinkedInChannelName): string {
  if (action === "linkedin_connection") return "LinkedIn Connection";
  if (action === "linkedin_comment") return "LinkedIn Comment";
  return "LinkedIn DM";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.6;
  return Math.min(1, Math.max(0, value));
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function blankToNull(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.hostname === "localhost") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function domainFromWebsiteUrl(websiteUrl: string): string | null {
  try {
    return new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function titleizeDomain(domain: string | null): string {
  const stem = domain?.split(".")[0]?.replace(/[-_]+/g, " ") ?? "Workspace";
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function findWorkspaceCompanyId(
  pool: Pool,
  workspace_id: string,
  input: { domain: string | null; name: string },
): Promise<string | null> {
  const existing = input.domain
    ? await pool.query<{ id: string }>(
        `select id from graph_companies
          where workspace_id = $1 and domain = $2
          limit 1`,
        [workspace_id, input.domain],
      )
    : await pool.query<{ id: string }>(
        `select id from graph_companies
          where workspace_id = $1 and lower(name) = lower($2)
          order by created_at asc
          limit 1`,
        [workspace_id, input.name],
      );
  return existing.rows[0]?.id ?? null;
}

function exaProfileQueries(input: {
  companyName: string;
  domain: string | null;
  industry: string | null;
  description: string | null;
}): string[] {
  const market = input.industry || signalKeywordsFromDescription(input.description) || "B2B SaaS";
  const domainPart = input.domain ? ` ${input.domain}` : "";
  return [
    `${input.companyName}${domainPart} product customers competitors positioning`,
    `${input.companyName}${domainPart} recent launch funding hiring news`,
    `${market} competitors alternatives buyer pain points ${input.companyName}`,
  ];
}

interface BriefRefreshContext {
  company: {
    name: string;
    domain: string | null;
    industry: string | null;
    description: string | null;
    exa_summary: string | null;
  } | null;
  signals: Array<{
    id: string;
    kind: string;
    title: string;
    content: string | null;
    url: string | null;
    freshness_at: Date;
  }>;
  approvals: Array<{
    id: string;
    kind: string;
    reason: string | null;
  }>;
  conversations: Array<{
    id: string;
    status: string;
    topic: string | null;
  }>;
}

async function loadBriefRefreshContext(
  pool: Pool,
  workspace_id: string,
): Promise<BriefRefreshContext> {
  const [company, signals, approvals, conversations] = await Promise.all([
    pool.query<{
      name: string;
      domain: string | null;
      industry: string | null;
      description: string | null;
      exa_summary: string | null;
    }>(
      `select name,
              domain::text as domain,
              industry,
              description,
              properties #>> '{exa_profile,summary}' as exa_summary
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc, created_at desc
        limit 1`,
      [workspace_id],
    ),
    pool.query<{
      id: string;
      kind: string;
      title: string;
      content: string | null;
      url: string | null;
      freshness_at: Date;
    }>(
      `select id, kind::text as kind, title, content, url, freshness_at
         from signals
        where workspace_id = $1
        order by freshness_at desc
        limit 5`,
      [workspace_id],
    ),
    pool.query<{
      id: string;
      kind: string;
      reason: string | null;
    }>(
      `select id, kind, reason
         from workflow_approvals
        where workspace_id = $1
          and decision = 'pending'
        order by created_at desc
        limit 5`,
      [workspace_id],
    ),
    pool.query<{
      id: string;
      status: string;
      topic: string | null;
    }>(
      `select id, status::text as status, topic
         from conversations
        where workspace_id = $1
        order by last_activity_at desc
        limit 5`,
      [workspace_id],
    ),
  ]);
  return {
    company: company.rows[0] ?? null,
    signals: signals.rows,
    approvals: approvals.rows,
    conversations: conversations.rows,
  };
}

function buildBriefRefreshQuery(context: BriefRefreshContext): string {
  const companyName = context.company?.name ?? "workspace company";
  const domain = context.company?.domain ? ` ${context.company.domain}` : "";
  const market = context.company?.industry ?? signalKeywordsFromDescription(context.company?.description) ?? "B2B SaaS";
  const signals = context.signals
    .slice(0, 3)
    .map((signal) => `${signal.kind}: ${signal.title}`)
    .join("; ");
  const focus = signals
    ? `Recent watched signals: ${signals}.`
    : "Look for recent launches, hiring, funding, market shifts, competitor mentions, and buyer pain changes.";
  return [
    `${companyName}${domain}`,
    market,
    "what changed today for GTM outreach content AEO review",
    focus,
  ].join(" ");
}

function buildBriefRefreshPayload(input: {
  context: BriefRefreshContext;
  results: readonly ExaResult[];
  evidence_source_ids: string[];
}): Omit<ProductExaBriefRefreshResult, "workspace_id" | "request_id" | "summary" | "evidence_source_ids"> {
  const evidenceItems: ProductBriefItem[] = input.results.slice(0, 4).map((result, index) =>
    briefItemFromExaResult(result, input.evidence_source_ids[index] ? [input.evidence_source_ids[index]!] : []),
  );
  const recentChanges: ProductBriefItem[] = input.context.signals.slice(0, 3).map((signal) => ({
    title: signal.title,
    detail: `${signal.kind.replace(/_/g, " ")} signal from ${signal.freshness_at.toISOString().slice(0, 10)}.`,
    url: signal.url,
    evidence_source_ids: [],
  }));
  const reviewItems: ProductBriefItem[] = input.context.approvals.slice(0, 3).map((approval) => ({
    title: approval.kind.replace(/_/g, " "),
    detail: approval.reason ?? "A workflow is waiting for review.",
    evidence_source_ids: [],
  }));
  const quietExceptions: ProductBriefItem[] = input.context.conversations
    .filter((conversation) => conversation.status === "awaiting_us")
    .slice(0, 3)
    .map((conversation) => ({
      title: conversation.topic ?? "Conversation needs attention",
      detail: "A conversation is waiting on the workspace before the Rep can continue.",
      evidence_source_ids: [],
    }));
  if (quietExceptions.length === 0 && input.context.signals.length === 0) {
    quietExceptions.push({
      title: "No urgent public-web changes",
      detail: "Exa did not find a stronger change than the current watched context for this Brief refresh.",
      evidence_source_ids: input.evidence_source_ids.slice(0, 2),
    });
  }
  return {
    notes: evidenceItems.slice(0, 3),
    review_items: reviewItems,
    recent_changes: recentChanges,
    quiet_exceptions: quietExceptions,
  };
}

function briefItemFromExaResult(result: ExaResult, evidence_source_ids: string[]): ProductBriefItem {
  const url = canonicalUrl(result.url);
  const host = url ? domainFromWebsiteUrl(url) : null;
  return {
    title: (result.title || host || "Public-web evidence").replace(/\s+/g, " ").trim().slice(0, 140),
    detail: profileSnippetFromResult(result) ?? "Fresh public-web evidence is available for Rep context.",
    url,
    evidence_source_ids,
  };
}

function buildExaResearchReviewPayload(
  intent: NonNullable<ProductExaResearchInput["intent"]>,
  results: readonly ExaResult[],
  evidence_source_ids: string[],
): Pick<ProductExaResearchResult, "review_items" | "opportunities" | "gaps"> {
  if (intent !== "content_research" && intent !== "aeo_audit") return {};
  const items = results.slice(0, 6).map((result, index) =>
    briefItemFromExaResult(
      result,
      evidence_source_ids[index] ? [evidence_source_ids[index]!] : [],
    ),
  );
  if (intent === "content_research") {
    const opportunities = items.map((item) => ({
      ...item,
      detail: contentOpportunityDetail(item.detail),
    }));
    return {
      opportunities,
      review_items: opportunities.slice(0, 3),
    };
  }
  const gaps = items.map((item) => ({
    ...item,
    detail: aeoGapDetail(item.detail),
  }));
  return {
    gaps,
    review_items: gaps.slice(0, 3),
  };
}

function contentOpportunityDetail(detail: string): string {
  const cleaned = cleanProfileLine(detail, 220);
  return cleaned
    ? `Angle worth posting: ${cleaned}`
    : "An angle worth posting based on recent market evidence.";
}

function aeoGapDetail(detail: string): string {
  const cleaned = cleanProfileLine(detail, 220);
  return cleaned
    ? `AI engines (ChatGPT, Perplexity, Google AI Overviews) miss or mis-cite this. Publish a structured answer to earn the citation: ${cleaned}`
    : "AI engines are not citing the brand on this question. Publish a structured answer (schema-marked, sourced) so ChatGPT, Perplexity, and Google AI Overviews can reference it.";
}

function dedupeExaResults(results: readonly ExaResult[]): ExaResult[] {
  const seen = new Set<string>();
  const out: ExaResult[] = [];
  for (const result of results) {
    const key = canonicalUrl(result.url) ?? result.id ?? result.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

function buildExaProfileIntelligence(results: readonly ExaResult[]): {
  source_domains: string[];
  market_terms: string[];
  positioning_notes: string[];
  competitor_mentions: string[];
  audience_terms: string[];
  proof_points: string[];
  evidence_cards: Array<{
    title: string;
    url: string;
    source_domain: string | null;
    snippet: string | null;
    published_at: string | null;
  }>;
} {
  const sourceDomains = new Set<string>();
  const termCounts = new Map<string, number>();
  const positioningNotes: string[] = [];
  const competitorMentions: string[] = [];
  const audienceTerms = new Set<string>();
  const proofPoints: string[] = [];
  const evidenceCards = results.flatMap((result) => {
    const url = canonicalUrl(result.url);
    for (const term of profileTermsFromResult(result)) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
    collectProfileSignals(result, {
      positioningNotes,
      competitorMentions,
      audienceTerms,
      proofPoints,
    });
    if (!url) return [];
    const sourceDomain = domainFromWebsiteUrl(url);
    if (sourceDomain) sourceDomains.add(sourceDomain);
    return [{
      title: (result.title || sourceDomain || url).replace(/\s+/g, " ").trim().slice(0, 160),
      url,
      source_domain: sourceDomain,
      snippet: profileSnippetFromResult(result),
      published_at: normalizeOptionalDate(result.publishedDate),
    }];
  }).slice(0, 8);

  return {
    source_domains: [...sourceDomains].slice(0, 10),
    market_terms: [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([term]) => term)
      .slice(0, 12),
    positioning_notes: uniqueStrings(positioningNotes).slice(0, 4),
    competitor_mentions: uniqueStrings(competitorMentions).slice(0, 4),
    audience_terms: [...audienceTerms].slice(0, 8),
    proof_points: uniqueStrings(proofPoints).slice(0, 4),
    evidence_cards: evidenceCards,
  };
}

function collectProfileSignals(
  result: ExaResult,
  out: {
    positioningNotes: string[];
    competitorMentions: string[];
    audienceTerms: Set<string>;
    proofPoints: string[];
  },
): void {
  const title = cleanProfileLine(result.title, 140);
  const snippet = profileSnippetFromResult(result);
  const haystack = [result.title, result.summary, result.highlights.join(" "), result.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (snippet && out.positioningNotes.length < 6) out.positioningNotes.push(snippet);
  if (/(alternative|competitor|versus|\bvs\.?\b|compare|comparison)/i.test(haystack)) {
    const mention = title ?? snippet;
    if (mention) out.competitorMentions.push(mention);
  }
  if (/(customer|case study|testimonial|review|launch|funding|raised|partner|integration)/i.test(haystack)) {
    const proof = snippet ?? title;
    if (proof) out.proofPoints.push(proof);
  }
  for (const term of profileAudienceTerms(haystack)) {
    out.audienceTerms.add(term);
  }
}

function profileAudienceTerms(text: string): string[] {
  const terms = [
    ["founders", /\bfounders?\b/],
    ["gtm teams", /\bgtm\b|go[-\s]?to[-\s]?market/],
    ["sales teams", /\bsales\b|sdr|outbound/],
    ["marketers", /\bmarketing\b|demand generation|content/],
    ["operators", /\boperators?\b|operations\b|revops/],
    ["developers", /\bdevelopers?\b|engineering\b|api\b/],
    ["buyers", /\bbuyers?\b|procurement|evaluation/],
    ["revenue teams", /\brevenue\b|pipeline|crm/],
  ] as const;
  return terms.flatMap(([label, pattern]) => (pattern.test(text) ? [label] : []));
}

function cleanProfileLine(value: string | null | undefined, max: number): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanProfileLine(value, 220);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function profileTermsFromResult(result: ExaResult): string[] {
  const stopwords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "business",
    "can",
    "company",
    "customer",
    "customers",
    "from",
    "has",
    "have",
    "into",
    "more",
    "news",
    "new",
    "our",
    "platform",
    "product",
    "software",
    "that",
    "the",
    "their",
    "this",
    "with",
    "your",
  ]);
  const text = [
    result.title,
    result.summary,
    result.highlights.join(" "),
  ].filter(Boolean).join(" ");
  const terms = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return [...new Set(terms.filter((term) => !stopwords.has(term)))].slice(0, 20);
}

function profileSnippetFromResult(result: ExaResult): string | null {
  const value = result.summary ?? result.highlights[0] ?? result.text ?? null;
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 260) : null;
}

function normalizeOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(ref|ref_src)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function signalKeywordsFromDescription(description: string | null | undefined): string | null {
  const words =
    description
      ?.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4)
      .filter((word) => !COMMON_PROFILE_WORDS.has(word)) ?? [];
  const picked = [...new Set(words)].slice(0, 4);
  return picked.length ? picked.join(" ") : null;
}

const COMMON_PROFILE_WORDS = new Set([
  "that",
  "with",
  "from",
  "this",
  "they",
  "their",
  "company",
  "companies",
  "helps",
  "teams",
  "customers",
  "business",
  "platform",
  "software",
  "service",
  "services",
]);

export async function configureWorkspaceEmailAccount(
  input: ConfigureEmailInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; channel_account_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const existing = await findEmailDomainAccount(engine.pool, session.workspace_id);
  const channel_account_id = existing?.id ?? randomUUID();
  const transport = resolveProductEmailTransportMode();
  const payload = {
    channel_account_id,
    kind: "email_domain" as const,
    display_name: input.display_name,
    daily_cap: Math.max(0, Math.trunc(input.daily_cap)),
    transport,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "channel.account.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "channel.account.configured",
      session.workspace_id,
      channel_account_id,
      payload,
    ),
    payload,
  });
  await projectEmailAccountConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, channel_account_id };
}

export async function getLinkedInAccountConnectIntent(
  session: ProductWorkspaceSession,
): Promise<LinkedInAccountConnectIntent> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return {
    workspace_id: session.workspace_id,
    connect_url: productRouteUrl("/api/auth/linkedin"),
    provider_configured: resolveLinkedInProviderAuthUrl() !== null,
  };
}

export async function getOutlookAccountConnectIntent(
  session: ProductWorkspaceSession,
): Promise<OutlookAccountConnectIntent> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return {
    workspace_id: session.workspace_id,
    connect_url: productRouteUrl("/api/auth/outlook"),
    provider_configured: Boolean(
      process.env.MICROSOFT_CLIENT_ID &&
        process.env.MICROSOFT_CLIENT_SECRET &&
        process.env.SESSION_SECRET,
    ),
  };
}

export async function configureEmailAccount(
  input: ConfigureEmailInput,
  session?: ProductWorkspaceSession,
): Promise<BootstrapResult> {
  const engine = await getProductEngine();
  const boot = session
    ? await bootstrapWorkspace(engine.pool, session.user_id, {
        ensureMembership: false,
        workspace_id: session.workspace_id,
      })
    : await bootstrapWorkspace(engine.pool);
  const scoped = session ?? {
    workspace_id: boot.workspace_id,
    user_id: DEFAULT_PRODUCT_USER_ID,
  };
  if (scoped.workspace_id !== boot.workspace_id) {
    throw new Error("Configured workspace does not match the product session.");
  }
  await assertProductWorkspaceAccess(scoped, engine.pool);
  const transport = resolveProductEmailTransportMode();
  const payload = {
    channel_account_id: boot.channel_account_id,
    kind: "email_domain" as const,
    display_name: input.display_name,
    daily_cap: Math.max(0, Math.trunc(input.daily_cap)),
    transport,
  };
  const event = await engine.bus.publish({
    workspace_id: boot.workspace_id,
    event_type: "channel.account.configured",
    source: "user",
    producer_ref: scoped.user_id,
    idempotency_key: configurationEventKey(
      "channel.account.configured",
      boot.workspace_id,
      boot.channel_account_id,
      payload,
    ),
    payload,
  });
  await projectEmailAccountConfigured(engine.pool, event);
  return boot;
}

function productRouteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const origin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  return origin ? `${origin}${normalized}` : normalized;
}

async function projectEmailAccountConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    channel_account_id: string;
    kind: "email_domain";
    display_name: string;
    daily_cap: number;
    transport: "resend" | "dry-run" | "unconfigured";
  };
  const status = payload.transport === "unconfigured" ? "disconnected" : "connected";
  await pool.query(
    `insert into channel_accounts (
       id, workspace_id, kind, display_name, status, daily_cap, daily_used, properties
     ) values ($1, $2, $3::channel_account_kind, $4, $5::channel_account_status, $6, 0, $7::jsonb)
     on conflict (id) do update set
       display_name = excluded.display_name,
       daily_cap = excluded.daily_cap,
       status = excluded.status,
       properties = channel_accounts.properties || excluded.properties,
       updated_at = now()`,
    [
      payload.channel_account_id,
      event.workspace_id,
      payload.kind,
      payload.display_name,
      status,
      payload.daily_cap,
      JSON.stringify({ transport: payload.transport, configured_event_id: event.id }),
    ],
  );
  await ensureSendingDomain(
    pool,
    event.workspace_id,
    payload.channel_account_id,
    payload.display_name,
    !isProductionProductRuntime(),
    payload.daily_cap,
  );
}

async function resolveProductOutcomeAttribution(event: PublishedEvent) {
  const payload = event.payload as {
    attributed_rep_id?: string | null;
    attributed_message_id?: string | null;
    properties?: Record<string, unknown>;
  };
  const props = payload.properties ?? {};
  const exemplar_ids = Array.isArray(props.exemplar_ids)
    ? props.exemplar_ids.filter((id): id is string => typeof id === "string")
    : [];
  const pattern_key = typeof props.pattern_key === "string" ? props.pattern_key : null;
  if (payload.attributed_rep_id && pattern_key && exemplar_ids.length > 0) {
    return {
      scope: {
        workspace_id: event.workspace_id,
        rep_id: payload.attributed_rep_id,
      },
      pattern_key,
      exemplar_ids,
      seed: productSeedFromProperties(props),
    };
  }

  if (payload.attributed_message_id) {
    const engine = await getProductEngine();
    const { rows } = await engine.pool.query<{
      subject: string | null;
      body: string | null;
      provenance: Record<string, unknown> | null;
      rep_id: string | null;
    }>(
      `select m.subject,
              m.body,
              m.provenance,
              c.rep_id
         from messages m
         left join conversations c
           on c.id = m.conversation_id
          and c.workspace_id = m.workspace_id
        where m.id = $1 and m.workspace_id = $2
        limit 1`,
      [payload.attributed_message_id, event.workspace_id],
    );
    const row = rows[0];
    const rep_id = payload.attributed_rep_id ?? row?.rep_id ?? null;
    const provenance = row?.provenance ?? null;
    const messagePatternKey =
      typeof provenance?.pattern_key === "string" ? provenance.pattern_key : null;
    const messageExemplarIds = Array.isArray(provenance?.exemplar_ids)
      ? provenance.exemplar_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (rep_id && provenance && messagePatternKey && messageExemplarIds.length > 0) {
      return {
        scope: {
          workspace_id: event.workspace_id,
          rep_id,
        },
        pattern_key: messagePatternKey,
        exemplar_ids: messageExemplarIds,
        seed: productSeedFromMessage(provenance, row.subject, row.body),
      };
    }
  }

  return null;
}

function productSeedFromProperties(
  properties: Record<string, unknown>,
): { pattern_key: string; exemplar: Record<string, unknown>; initial_score?: number } | null {
  const pattern_key =
    typeof properties.seed_pattern_key === "string" ? properties.seed_pattern_key : null;
  const exemplar =
    properties.seed_exemplar &&
    typeof properties.seed_exemplar === "object" &&
    !Array.isArray(properties.seed_exemplar)
      ? properties.seed_exemplar as Record<string, unknown>
      : null;
  if (!pattern_key || !exemplar) return null;
  const initial_score =
    typeof properties.seed_initial_score === "number"
      ? properties.seed_initial_score
      : undefined;
  return {
    pattern_key,
    exemplar,
    initial_score,
  };
}

function productSeedFromMessage(
  provenance: Record<string, unknown>,
  subject: string | null,
  body: string | null,
): { pattern_key: string; exemplar: Record<string, unknown> } | null {
  const pattern_key =
    typeof provenance.seed_pattern_key === "string" ? provenance.seed_pattern_key : null;
  if (!pattern_key || !body?.trim()) return null;
  return {
    pattern_key,
    exemplar: {
      subject: subject ?? null,
      body,
    },
  };
}

function createProductEventProjections(engine: ProductEngine): DurableEventProjection[] {
  return [
    {
      name: "workspace.created.v1",
      eventTypes: ["workspace.created"],
      apply: (event) => projectWorkspaceCreated(engine.pool, event),
    },
    {
      name: "workspace.member_accepted.v1",
      eventTypes: ["workspace.member.accepted"],
      apply: (event) => projectWorkspaceMemberAccepted(engine.pool, event),
    },
    {
      name: "workspace.company_profile.v1",
      eventTypes: ["workspace.company.profiled"],
      apply: (event) => projectWorkspaceCompanyProfiled(engine.pool, event),
    },
    {
      name: "workspace.profile_enrichment.v1",
      eventTypes: ["workspace.profile.enriched"],
      apply: (event) => projectWorkspaceProfileEnriched(engine.pool, event),
    },
    {
      name: "workspace.source_configuration.v1",
      eventTypes: ["workspace.source.configured"],
      apply: (event) => projectWorkspaceSourceConfigured(engine.pool, event),
    },
    {
      name: "signal.discovered.projector.v1",
      eventTypes: ["signal.discovered"],
      apply: async (event) => {
        await projectSignalDiscovered(engine.pool, event.workspace_id, event.payload as never);
        await engine.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.ingested",
          source: "system",
          producer_ref: "projection:signal.discovered",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.ingested`,
          payload: {
            signal_id: (event.payload as { signal_id: string }).signal_id,
            source_id: (event.payload as { source_id: string | null }).source_id,
            kind: (event.payload as { kind: string | null }).kind,
            novelty_score: null,
          },
        });
      },
    },
    {
      name: "signal.classifier.v1",
      eventTypes: ["signal.ingested"],
      apply: async (event) => {
        const signalId = (event.payload as { signal_id?: string }).signal_id;
        if (!signalId) return;
        await classifySignal(
          {
            pool: engine.pool,
            bus: engine.bus,
            llm: createSignalClassifierLLM(engine, event.workspace_id),
          },
          { signal_id: signalId },
        );
      },
    },
    {
      name: "signal.classification.projector.v1",
      eventTypes: ["signal.classification.completed"],
      apply: async (event) => {
        await projectSignalClassification(engine.pool, event.workspace_id, event.payload as never);
        const payload = event.payload as {
          signal_id: string;
          disposition: "matched" | "dismissed";
          match_reason: string;
          matches: Array<{ icp_segment: string; match_score: number }>;
        };
        if (payload.disposition === "dismissed") {
          await engine.bus.publish({
            workspace_id: event.workspace_id,
            event_type: "signal.dismissed",
            source: "system",
            producer_ref: "projection:signal.classification.completed",
            correlation_id: event.correlation_id ?? event.id,
            causation_id: event.id,
            idempotency_key: `projection:${event.id}:signal.dismissed`,
            payload: {
              signal_id: payload.signal_id,
              reason: payload.match_reason,
            },
          });
          return;
        }
        for (const match of payload.matches) {
          await engine.bus.publish({
            workspace_id: event.workspace_id,
            event_type: "signal.matched",
            source: "system",
            producer_ref: "projection:signal.classification.completed",
            correlation_id: event.correlation_id ?? event.id,
            causation_id: event.id,
            idempotency_key:
              `projection:${event.id}:signal.matched:${match.icp_segment}`,
            payload: {
              signal_id: payload.signal_id,
              match_score: match.match_score,
              icp_segment: match.icp_segment,
            },
          });
        }
      },
    },
    {
      name: "signal.expiry.projector.v1",
      eventTypes: ["signal.expiry.requested"],
      apply: async (event) => {
        const flipped = await projectSignalExpiry(
          engine.pool,
          event.workspace_id,
          event.payload as never,
        );
        if (!flipped) return;
        await engine.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.expired",
          source: "system",
          producer_ref: "projection:signal.expiry.requested",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.expired`,
          payload: {
            signal_id: (event.payload as { signal_id: string }).signal_id,
            reason: (event.payload as { reason: string }).reason,
          },
        });
      },
    },
    {
      name: EMAIL_ACCOUNT_CONFIGURATION_PROJECTION,
      eventTypes: ["channel.account.configured"],
      apply: (event) => projectEmailAccountConfigured(engine.pool, event),
    },
    createLinkedInProviderAuthorizationProjection({
      pool: engine.pool,
      bus: engine.bus,
    }),
    createEmailDeliveryFeedbackProjection({
      pool: engine.pool,
      bus: engine.bus,
    }),
    createChannelAccountLifecycleProjection(engine.pool),
    createConversationLifecycleProjection(engine.pool),
    createMessageLifecycleProjection(engine.pool),
    createReplyLifecycleProjection(engine.pool),
    createOutcomeLifecycleProjection(engine.pool),
    createOutcomeMemoryUpdateProjection({
      bus: engine.bus,
      attribution: resolveProductOutcomeAttribution,
    }),
    createRecommendationLearningProjection({
      pool: engine.pool,
      bus: engine.bus,
    }),
    createProceduralMemorySeedProjection(engine.pool),
    createProceduralMemoryStateProjection(engine.pool),
    createSendingDomainProjection({
      pool: engine.pool,
      bus: engine.bus,
    }),
  ];
}

async function projectVisibleProductState(engine: ProductEngine): Promise<void> {
  if (engine.substrateMode !== "postgres") return;
  await runDurableEventProjectionsOnce(
    engine.pool,
    createProductEventProjections(engine),
    {
      leaseOwner: `product-state:${process.pid}:${randomBytes(4).toString("hex")}`,
      limit: 250,
    },
  );
}

export async function startSendingDomainOperation(
  operation: SendingDomainOperation,
  session: ProductWorkspaceSession,
): Promise<void> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    id: string;
    channel_account_id: string;
    domain: string;
    provider_domain_id: string | null;
  }>(
    `select id,
            channel_account_id,
            domain::text as domain,
            properties->>'provider_domain_id' as provider_domain_id
       from sending_domains
      where workspace_id = $1
      order by created_at asc
      limit 1`,
    [session.workspace_id],
  );
  const domain = rows[0];
  if (!domain) throw new Error("Configure an email sender before provisioning its domain.");
  if (operation !== "provision" && !domain.provider_domain_id) {
    throw new Error("Provision the sending domain before requesting verification.");
  }
  engine.runtime.register(
    createSendingDomainProvisioningWorkflow({
      bus: engine.bus,
    }),
  );
  await engine.runtime.start({
    workspace_id: session.workspace_id,
    workflow_name: SENDING_DOMAIN_PROVISIONING_WORKFLOW,
    idempotency_key:
      operation === "provision"
        ? `sending-domain:${domain.id}:provision`
        : `sending-domain:${domain.id}:${operation}:${Date.now()}`,
    input: {
      workspace_id: session.workspace_id,
      sending_domain_id: domain.id,
      channel_account_id: domain.channel_account_id,
      domain: domain.domain,
      operation,
      provider_domain_id: domain.provider_domain_id,
    },
  });
}

export async function configureRssSource(
  input: ConfigureRssSourceInput,
  session?: ProductWorkspaceSession,
): Promise<BootstrapResult> {
  return configureWorkspaceSignalSource(
    {
      adapter: "rss",
      name: input.name,
      url: input.url,
      signal_kind: input.signal_kind,
      poll_interval_minutes: input.poll_interval_minutes,
    },
    session,
  );
}

export async function configureWorkspaceSignalSource(
  input: ConfigureWorkspaceSignalSourceInput,
  session?: ProductWorkspaceSession,
): Promise<BootstrapResult> {
  const engine = await getProductEngine();
  const boot = session
    ? {
        workspace_id: session.workspace_id,
        rep_id: "",
        play_id: "",
        channel_account_id: "",
      }
    : await bootstrapWorkspace(engine.pool);
  const scoped = session ?? {
    workspace_id: boot.workspace_id,
    user_id: DEFAULT_PRODUCT_USER_ID,
  };
  if (scoped.workspace_id !== boot.workspace_id) {
    throw new Error("Configured workspace does not match the product session.");
  }
  await assertProductWorkspaceAccess(scoped, engine.pool);
  const minutes = Number.isFinite(input.poll_interval_minutes)
    ? Math.max(1, Math.trunc(input.poll_interval_minutes ?? 15))
    : 15;
  const adapter = parseWorkspaceSignalSourceAdapter(input.adapter);
  const sourceKind = sourceKindForAdapter(adapter);
  const name = input.name.trim() || defaultWorkspaceSourceName(adapter);
  const config = sourceConfigForAdapter(adapter, input, minutes);
  const provider = signalSourceProvider(input.provider);
  const quota = sourceQuotaConfig(input);
  const existing = await engine.pool.query<{ id: string }>(
    `select id from graph_sources
      where workspace_id = $1 and kind = $2::source_kind and lower(name) = lower($3)
      order by created_at asc
      limit 1`,
    [boot.workspace_id, sourceKind, name],
  );
  const source_id = existing.rows[0]?.id ?? randomUUID();
  const payload = {
    source_id,
    source_kind: sourceKind,
    adapter,
    name,
    config,
    enabled: input.enabled ?? true,
    poll_cadence_sec: minutes * 60,
    properties: {
      managed_by: "signal-aggregator",
      acquisition_mode: isPushSignalSourceAdapter(adapter)
        ? "push"
        : adapter === "rss"
          ? "workspace_pull"
          : "workspace_adapter",
      ...(provider ? { provider } : {}),
      ...(quota ? { quota } : {}),
      ...(isPushSignalSourceAdapter(adapter)
        ? { ingestion_contract: "bombsell_signal_v1" }
        : {}),
    },
  };
  const event = await engine.bus.publish({
    workspace_id: boot.workspace_id,
    event_type: "workspace.source.configured",
    source: "user",
    producer_ref: scoped.user_id,
    idempotency_key: configurationEventKey(
      "workspace.source.configured",
      boot.workspace_id,
      source_id,
      payload,
    ),
    payload,
  });
  await projectWorkspaceSourceConfigured(engine.pool, event);
  return { ...boot, source_id };
}

async function projectWorkspaceSourceConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    source_id: string;
    source_kind: SourceKind;
    adapter: WorkspaceSignalSourceAdapter;
    name: string;
    config: Record<string, unknown>;
    enabled: boolean;
    poll_cadence_sec: number;
    properties: Record<string, unknown>;
  };
  await pool.query(
    `insert into graph_sources (
       id, workspace_id, kind, name, config, enabled, properties
     ) values ($1, $2, $3::source_kind, $4, $5::jsonb, $6, $7::jsonb)
     on conflict (id) do update set
       kind = excluded.kind,
       name = excluded.name,
       config = excluded.config,
       enabled = excluded.enabled,
       properties = graph_sources.properties || excluded.properties`,
    [
      payload.source_id,
      event.workspace_id,
      payload.source_kind,
      payload.name,
      JSON.stringify(payload.config),
      payload.enabled,
      JSON.stringify(payload.properties),
    ],
  );
  await pool.query(
    `insert into workspace_source_configs (
       workspace_id, source_id, enabled, poll_cadence_sec, config_overrides
     ) values ($1, $2, $3, $4, '{}'::jsonb)
     on conflict (workspace_id, source_id) do update set
       enabled = excluded.enabled,
       poll_cadence_sec = excluded.poll_cadence_sec`,
    [
      event.workspace_id,
      payload.source_id,
      isPushSignalSourceAdapter(payload.adapter) ? false : payload.enabled,
      payload.poll_cadence_sec,
    ],
  );
}

export async function discoverSignalFromSource(
  input: DiscoverWorkspaceSignalInput,
  session: ProductWorkspaceSession,
): Promise<DiscoveredSignalResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const result = await discoverWorkspaceSignalOnce(
    {
      pool: engine.pool,
      bus: engine.bus,
      embedder: createProductEmbeddingClient(),
    },
    {
      workspace_id: session.workspace_id,
      source_id: input.source_id,
      external_id: input.external_id,
      title: input.title,
      content: input.content ?? undefined,
      url: input.url ?? undefined,
      kind: input.signal_kind == null ? null : parseSignalKind(input.signal_kind),
      freshness_at: input.freshness_at ?? new Date().toISOString(),
      structured: input.structured ?? {},
      provenance: input.provenance ?? {},
      producer_ref: `surface:signal-discovery:${session.user_id}`,
    },
  );
  if (result.outcome === "skipped:source_not_found") {
    throw new Error("Signal source not found in this workspace.");
  }
  return {
    workspace_id: session.workspace_id,
    outcome: result.outcome,
    signal_id: "signal_id" in result ? result.signal_id : undefined,
    event_id: "event_id" in result ? result.event_id : undefined,
  };
}

export async function discoverSignalFromWebhook(
  input: DiscoverWorkspaceSignalInput,
  opts: DiscoverSignalWebhookOptions = {},
): Promise<DiscoveredSignalResult> {
  const engine = await getProductEngine();
  const source = await engine.pool.query<{ workspace_id: string }>(
    `select workspace_id
       from graph_sources
      where id = $1 and enabled
      limit 1`,
    [input.source_id],
  );
  const workspace_id = source.rows[0]?.workspace_id;
  if (!workspace_id) {
    throw new Error("Signal source not found.");
  }
  const result = await discoverWorkspaceSignalOnce(
    {
      pool: engine.pool,
      bus: engine.bus,
      embedder: createProductEmbeddingClient(),
    },
    {
      workspace_id,
      source_id: input.source_id,
      external_id: input.external_id,
      title: input.title,
      content: input.content ?? undefined,
      url: input.url ?? undefined,
      kind: input.signal_kind == null ? null : parseSignalKind(input.signal_kind),
      freshness_at: input.freshness_at ?? new Date().toISOString(),
      structured: input.structured ?? {},
      provenance: input.provenance ?? {},
      producer_ref: opts.producerRef ?? "webhook:signals",
    },
  );
  if (result.outcome === "skipped:source_not_found") {
    throw new Error("Signal source not found.");
  }
  return {
    workspace_id,
    outcome: result.outcome,
    signal_id: "signal_id" in result ? result.signal_id : undefined,
    event_id: "event_id" in result ? result.event_id : undefined,
  };
}

function parseWorkspaceSignalSourceAdapter(
  adapter: WorkspaceSignalSourceAdapter,
): WorkspaceSignalSourceAdapter {
  switch (adapter) {
    case "rss":
    case "google_news":
    case "hn_front":
    case "hn_whos_hiring":
    case "product_hunt":
    case "reddit":
    case "exa":
    case "x_search":
    case "webhook":
      return adapter;
    default:
      return "rss";
  }
}

function sourceKindForAdapter(adapter: WorkspaceSignalSourceAdapter): SourceKind {
  switch (adapter) {
    case "product_hunt":
      return "product_hunt";
    case "hn_front":
    case "hn_whos_hiring":
      return "hn";
    case "rss":
    case "google_news":
      return "rss";
    case "exa":
      return "web_monitor";
    case "reddit":
    case "x_search":
      return "other";
    case "webhook":
      return "web_monitor";
  }
}

function defaultWorkspaceSourceName(adapter: WorkspaceSignalSourceAdapter): string {
  switch (adapter) {
    case "google_news":
      return "Google News signals";
    case "hn_front":
      return "Hacker News front page";
    case "hn_whos_hiring":
      return "HN Who is hiring";
    case "product_hunt":
      return "Product Hunt launches";
    case "reddit":
      return "Reddit signals";
    case "exa":
      return "Exa open-web intelligence";
    case "x_search":
      return "X search signals";
    case "webhook":
      return "Push signal ingress";
    case "rss":
      return "Signal feed";
  }
}

function sourceConfigForAdapter(
  adapter: WorkspaceSignalSourceAdapter,
  input: ConfigureWorkspaceSignalSourceInput,
  minutes: number,
): Record<string, unknown> {
  const signalKind = validSignalKind(input.signal_kind)
    ? input.signal_kind
    : defaultSignalKindForAdapter(adapter);
  const base = {
    adapter,
    kind: signalKind,
    signal_kind: signalKind,
    poll_interval_ms: minutes * 60_000,
  };
  switch (adapter) {
    case "google_news":
      return {
        ...base,
        query: input.query?.trim() || input.name.trim() || "B2B SaaS hiring",
      };
    case "reddit":
      return {
        ...base,
        subreddit: input.subreddit?.trim() || "SaaS",
      };
    case "x_search":
      return {
        ...base,
        provider: signalSourceProvider(input.provider) ?? "x_official",
        query: input.query?.trim() || input.name.trim(),
        limit: positiveInteger(input.limit) ?? 25,
        max_items_per_poll: 10,
        ...(sourceQuotaConfig(input) ?? {}),
      };
    case "exa":
      return {
        ...base,
        provider: "exa",
        query: input.query?.trim() || input.name.trim(),
        limit: positiveInteger(input.limit) ?? 10,
        include_text: true,
        text_max_characters: 1600,
        highlights: true,
        summary: true,
        ...(sourceQuotaConfig(input) ?? {}),
      };
    case "webhook":
      return {
        ...base,
        provider: signalSourceProvider(input.provider) ?? "generic",
        query: input.query?.trim() || undefined,
        ...(sourceQuotaConfig(input) ?? {}),
        ingestion_contract: "bombsell_signal_v1",
        webhook_payload: {
          external_id: "provider event id",
          title: "required",
          content: "optional",
          url: "optional",
          signal_kind: signalKind,
          structured: {},
          provenance: {},
        },
      };
    case "product_hunt":
      return {
        ...base,
        limit: 25,
      };
    case "hn_front":
    case "hn_whos_hiring":
      return base;
    case "rss":
      return {
        ...base,
        url: input.url?.trim(),
      };
  }
}

function isPushSignalSourceAdapter(adapter: WorkspaceSignalSourceAdapter): boolean {
  return adapter === "webhook";
}

function signalSourceProvider(provider: unknown): string | undefined {
  if (typeof provider !== "string") return undefined;
  const normalized = provider.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return normalized || undefined;
}

function sourceQuotaConfig(
  input: Pick<
    ConfigureWorkspaceSignalSourceInput,
    "max_daily_items" | "max_daily_calls" | "monthly_spend_cap_usd"
  >,
): Record<string, number> | undefined {
  const quota: Record<string, number> = {};
  const maxDailyItems = positiveInteger(input.max_daily_items);
  const maxDailyCalls = positiveInteger(input.max_daily_calls);
  const monthlySpendCapUsd = positiveNumber(input.monthly_spend_cap_usd);
  if (maxDailyItems !== undefined) quota.max_daily_items = maxDailyItems;
  if (maxDailyCalls !== undefined) quota.max_daily_calls = maxDailyCalls;
  if (monthlySpendCapUsd !== undefined) {
    quota.monthly_spend_cap_usd = Number(monthlySpendCapUsd.toFixed(2));
  }
  return Object.keys(quota).length > 0 ? quota : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value > 0 ? value : undefined;
}

function defaultSignalKindForAdapter(adapter: WorkspaceSignalSourceAdapter): string {
  switch (adapter) {
    case "hn_whos_hiring":
      return "hiring";
    case "hn_front":
    case "product_hunt":
      return "product_launch";
    case "google_news":
    case "rss":
    case "reddit":
      return "press_mention";
    case "exa":
      return "other";
    case "x_search":
      return "competitor_move";
    case "webhook":
      return "other";
  }
}

function validSignalKind(kind: unknown): boolean {
  return (
    kind === "funding" ||
    kind === "hiring" ||
    kind === "leadership_change" ||
    kind === "product_launch" ||
    kind === "acquisition" ||
    kind === "churn_risk" ||
    kind === "competitor_move" ||
    kind === "podcast_mention" ||
    kind === "press_mention" ||
    kind === "regulation" ||
    kind === "expansion" ||
    kind === "layoff" ||
    kind === "other"
  );
}

export async function submitManualSignal(
  input: SubmitSignalInput,
  session?: ProductWorkspaceSession,
): Promise<SubmittedSignalResult> {
  const engine = await getProductEngine();
  const boot = session
    ? {
        workspace_id: session.workspace_id,
        rep_id: "",
        play_id: "",
        channel_account_id: "",
      }
    : await bootstrapWorkspace(engine.pool);
  const scoped = session ?? {
    workspace_id: boot.workspace_id,
    user_id: DEFAULT_PRODUCT_USER_ID,
  };
  if (scoped.workspace_id !== boot.workspace_id) {
    throw new Error("Configured workspace does not match the product session.");
  }
  await assertProductWorkspaceAccess(scoped, engine.pool);
  const signalKind = parseSignalKind(input.signal_kind ?? "funding");
  const icpSegment =
    input.icp_segment?.trim() ||
    (await findDefaultIcpSegment(engine.pool, boot.workspace_id)) ||
    "fintech-founder";
  const store = createPostgresVerticalSliceStore(engine.pool);
  const now = new Date().toISOString();
  const company: GraphCompany = {
    id: randomUUID(),
    workspace_id: boot.workspace_id,
    name: input.company_name,
    domain: input.company_domain || null,
    industry: "Unknown",
    size_bucket: null,
    description: null,
    properties: {},
    provenance: { source: "manual-signal-form" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const [given, ...rest] = input.person_name.trim().split(/\s+/);
  const person: GraphPerson = {
    id: randomUUID(),
    workspace_id: boot.workspace_id,
    full_name: input.person_name,
    given_name: given || input.person_name,
    family_name: rest.length ? rest.join(" ") : null,
    title: "Founder",
    company_id: company.id,
    emails: [input.person_email],
    phones: [],
    linkedin_url: null,
    x_handle: null,
    properties: {},
    provenance: { source: "manual-signal-form" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const signal = await ingestManualSignal(
    {
      workspace_id: boot.workspace_id,
      kind: signalKind,
      title: input.signal_title,
      content: input.signal_content,
      url: input.signal_url || null,
      icp_segment: icpSegment,
      match_score: clamp01(input.match_score ?? 0.86),
      company,
      person,
      properties: {
        email_approval: input.approval,
        simulate_outcome_kind:
          input.simulate_outcome_kind ??
          (input.approval === "none" ? "positive_reply" : null),
      },
    },
    {
      store,
      bus: engine.bus,
      producer_ref: "surface:manual-signal",
    },
  );
  return { signal_id: signal.id, workspace_id: boot.workspace_id };
}

async function findDefaultIcpSegment(
  pool: Pool,
  workspace_id: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from workspace_icps
      where workspace_id = $1 and enabled
      order by created_at asc
      limit 1`,
    [workspace_id],
  );
  return rows[0]?.id ?? null;
}

export async function submitSignalAndDispatch(
  input: SubmitSignalInput,
  session?: ProductWorkspaceSession,
): Promise<SubmittedSignalResult> {
  return submitManualSignal(input, session);
}

function createGovernedLLM(
  engine: ProductEngine,
  workspace_id: string,
  purpose: string,
): LLMClient | undefined {
  if (!process.env.DEEPSEEK_API_KEY) return undefined;
  return createBudgetedLLMClient({
    llm: createDeepSeekClientFromEnv(),
    pool: engine.pool,
    bus: engine.bus,
    workspace_id,
    purpose,
  });
}

function createSignalClassifierLLM(
  engine: ProductEngine,
  workspace_id: string,
): LLMClient {
  const llm = createGovernedLLM(engine, workspace_id, "classifier.signal");
  if (llm) return llm;
  if (isProductionProductRuntime()) {
    throw new ProductEnvironmentError("signal classification", ["DEEPSEEK_API_KEY"]);
  }
  return createLocalSignalClassifierLLM();
}

function createLocalSignalClassifierLLM(): LLMClient {
  return {
    async complete(req) {
      const prompt = req.messages.map((message) => message.content).join("\n");
      const kind =
        prompt.match(/kind:\s+([a-z_]+)/)?.[1] ??
        prompt.match(/classified_kind:\s+([a-z_]+)/)?.[1] ??
        "press_mention";
      const icpIds = [...prompt.matchAll(/icp_id:\s+([0-9a-f-]{36})/gi)].map(
        (match) => match[1],
      );
      const payload = {
        kind,
        per_icp: icpIds.map((icp_id) => ({
          icp_id,
          score: 0.72,
          reason: "Local deterministic classifier matched the configured signal kind.",
        })),
      };
      return {
        content: JSON.stringify(payload),
        model: "local-signal-classifier",
        finish_reason: "stop",
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    },
  };
}

function createProductEmailTransport(): EmailTransport | undefined {
  if (resolveProductEmailTransportMode() === "resend") {
    return createResendEmailTransport({ apiKey: process.env.RESEND_API_KEY! });
  }
  return isProductionProductRuntime() ? undefined : createDryRunEmailTransport();
}

function createProductOutlookSender(
  pool: Pool,
  bus: EventBus,
): OutlookSender | undefined {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return createOutlookSender({ pool, bus, clientId, clientSecret });
}

function createGovernedJudge(engine: ProductEngine, workspace_id: string) {
  const fallback = createHeuristicJudge({ threshold: 0.55 });
  const llm = createGovernedLLM(engine, workspace_id, "judge.hot_path");
  if (!llm) return fallback;
  return createFallbackJudge({
    primary: createDeepSeekJudge({ llm, threshold: 0.6 }),
    fallback,
    shouldFallback: isLLMBudgetExceededError,
  });
}

function registerSignalEmailWorkflow(engine: ProductEngine, workspace_id?: string): void {
  const store = createPostgresVerticalSliceStore(engine.pool);
  const transport = createProductEmailTransport();
  const writerLlm = workspace_id
    ? createGovernedLLM(engine, workspace_id, "writer.email")
    : undefined;
  const judge = workspace_id
    ? createGovernedJudge(engine, workspace_id)
    : createHeuristicJudge({ threshold: 0.55 });

  engine.runtime.register(
    createSignalToEmailPlayWorkflow({
      store,
      memory: engine.memory,
      judge,
      writerLlm,
      email: createDatabaseBackedEmailChannel(engine.pool, transport, engine.bus),
      bus: engine.bus,
      workspaceContextProvider: (input) =>
        getWorkflowWorkspaceContext(engine, input.workspace_id),
      draftGroundingProvider: (input) =>
        groundDraftWithExaForWorkflow(engine, input),
    }),
  );
}

function registerReplyEmailWorkflow(engine: ProductEngine, workspace_id?: string): void {
  const store = createPostgresVerticalSliceStore(engine.pool);
  const transport = createProductEmailTransport();
  const writerLlm = workspace_id
    ? createGovernedLLM(engine, workspace_id, "writer.email.reply")
    : undefined;
  const judge = workspace_id
    ? createGovernedJudge(engine, workspace_id)
    : createHeuristicJudge({ threshold: 0.55 });

  engine.runtime.register(
    createReplyToEmailPlayWorkflow({
      store,
      memory: engine.memory,
      judge,
      writerLlm,
      email: createDatabaseBackedEmailChannel(engine.pool, transport, engine.bus),
      bus: engine.bus,
      workspaceContextProvider: (input) =>
        getWorkflowWorkspaceContext(engine, input.workspace_id),
    }),
  );
}

async function getWorkflowWorkspaceContext(
  engine: ProductEngine,
  workspace_id: string,
): Promise<string | null> {
  const user_id = await getWorkflowUserId(engine.pool, workspace_id);
  if (!user_id) return null;
  const { getWorkspaceAgentContext } = await import("./context.ts");
  const context = await getWorkspaceAgentContext(
    { workspace_id, user_id },
    engine.pool,
  );
  return context.markdown;
}

async function getWorkflowUserId(pool: Pool, workspace_id: string): Promise<string | null> {
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

async function groundDraftWithExaForWorkflow(
  engine: ProductEngine,
  input: DraftGroundingProviderInput,
): Promise<ProductExaResearchResult | null> {
  const user_id = await getWorkflowUserId(engine.pool, input.workspace_id);
  if (!user_id) return null;
  return researchWorkspaceWithExa(
    {
      query: input.query,
      intent: "draft_grounding",
      num_results: 3,
      include_text: true,
      idempotency_nonce: `play:${input.play_run_id}:${input.signal.id}:${input.channel}`,
    },
    { workspace_id: input.workspace_id, user_id },
  );
}

function registerSignalIngestionWorkflows(engine: ProductEngine): void {
  engine.runtime.register(
    createRssSignalIngestionWorkflow({
      pool: engine.pool,
      bus: engine.bus,
      embedder: createProductEmbeddingClient(),
    }),
  );
  engine.runtime.register(
    createWorkspacePollWorkflow({
      pool: engine.pool,
      bus: engine.bus,
      embedder: createProductEmbeddingClient(),
    }),
  );
}

function createProductEmbeddingClient(): EmbeddingClient {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) return createOpenAIEmbeddingClient({ apiKey });
  if (isProductionProductRuntime()) {
    throw new ProductEnvironmentError("signal ingestion embeddings", ["OPENAI_API_KEY"]);
  }
  return createMockEmbeddingClient();
}

function registerSendingDomainProvisioningWorkflow(engine: ProductEngine): void {
  engine.runtime.register(
    createSendingDomainProvisioningWorkflow({
      bus: engine.bus,
    }),
  );
}

function registerSendingDomainWarmupWorkflow(engine: ProductEngine): void {
  engine.runtime.register(
    createSendingDomainWarmupWorkflow({
      bus: engine.bus,
    }),
  );
}

function createDatabaseBackedEmailChannel(
  pool: Pool,
  transport: EmailTransport | undefined,
  bus?: EventBus,
): EmailChannel {
  return createPostgresOwnedDomainEmailChannel({
    pool,
    transport,
    outlook: bus ? createProductOutlookSender(pool, bus) : undefined,
  });
}

async function createDatabaseBackedLinkedInChannel(
  pool: Pool,
  workspace_id: string,
  action: LinkedInChannelName,
): Promise<LinkedInChannel> {
  const { rows } = await pool.query<{
    id: string;
    display_name: string;
    kind: "linkedin_session" | "linkedin_oauth";
    status: LinkedInSessionAccount["status"];
    daily_cap: number | null;
    daily_used: number | null;
  }>(
    `select id, display_name, kind::text as kind, status::text as status,
            daily_cap, daily_used
       from channel_accounts
      where workspace_id = $1
        and kind in ('linkedin_session','linkedin_oauth')
      order by last_used_at nulls first, created_at asc`,
    [workspace_id],
  );
  return createNativeLinkedInChannel({
    action,
    accounts: rows.map((row) => ({
      id: row.id,
      display_name: row.display_name,
      kind: row.kind,
      status: row.status,
      daily_cap: Math.max(0, Math.trunc(row.daily_cap ?? 0)),
      daily_used: Math.max(0, Math.trunc(row.daily_used ?? 0)),
    })),
    transport: createProductLinkedInTransport(),
  });
}

function createProductLinkedInTransport(): LinkedInTransport {
  const mode = resolveProductLinkedInTransportMode();
  if (mode === "provider") {
    return createHttpLinkedInTransport({
      endpoint: process.env.LINKEDIN_PROVIDER_URL!,
      apiKey: process.env.LINKEDIN_PROVIDER_API_KEY!,
    });
  }
  if (mode === "dry-run") return createDryRunLinkedInTransport();
  return createUnconfiguredLinkedInTransport();
}

async function startSignalEmailPlay(
  engine: ProductEngine,
  input: {
    workspace_id: string;
    play_id: string;
    rep_id: string;
    signal_id: string;
    person_id: string;
    trigger_event_id: string | null;
    approval: SignalToEmailPlayInput["email_approval"];
    policy: PlayChannelPolicy;
    simulate_outcome_kind?: SignalToEmailPlayInput["simulate_outcome_kind"];
  },
) {
  const store = createPostgresVerticalSliceStore(engine.pool);
  const signal = await store.getSignal(input.signal_id);
  if (!signal) throw new Error(`Signal not found: ${input.signal_id}`);
  const person = await store.getPerson(input.person_id);
  if (!person) throw new Error(`Person not found: ${input.person_id}`);
  const transport = createProductEmailTransport();
  const email = createDatabaseBackedEmailChannel(engine.pool, transport, engine.bus);
  const writerLlm = createGovernedLLM(engine, input.workspace_id, "writer.email");
  const judge = createGovernedJudge(engine, input.workspace_id);
  engine.runtime.register(
    createSignalToEmailPlayWorkflow({
      store,
      memory: engine.memory,
      judge,
      writerLlm,
      email,
      bus: engine.bus,
      workspaceContextProvider: (workflowInput) =>
        getWorkflowWorkspaceContext(engine, workflowInput.workspace_id),
      draftGroundingProvider: (workflowInput) =>
        groundDraftWithExaForWorkflow(engine, workflowInput),
    }),
  );
  const play_run_id = randomUUID();
  return engine.runtime.start<SignalToEmailPlayInput, SignalToEmailPlayOutput>({
    workspace_id: input.workspace_id,
    workflow_name: SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
    play_id: input.play_id,
    play_run_id,
    idempotency_key: `signal:${signal.id}:play:${input.play_id}`,
    correlation_id: input.trigger_event_id ?? undefined,
    causation_id: input.trigger_event_id ?? undefined,
    input: {
      workspace_id: input.workspace_id,
      play_id: input.play_id,
      play_run_id,
      rep_id: input.rep_id,
      signal_id: signal.id,
      person_id: person.id,
      company_id: signal.related_company_id,
      trigger_event_id: input.trigger_event_id,
      email_approval: input.approval,
      play_channel_policy: input.policy,
      simulate_outcome_kind: input.simulate_outcome_kind ?? null,
    },
  });
}

async function startSignalLinkedInPlay(
  engine: ProductEngine,
  input: {
    workspace_id: string;
    play_id: string;
    rep_id: string;
    signal_id: string;
    person_id: string;
    trigger_event_id: string | null;
    action: LinkedInChannelName;
    approval: SignalToLinkedInPlayInput["linkedin_approval"];
    policy: PlayChannelPolicy;
    simulate_outcome_kind?: SignalToLinkedInPlayInput["simulate_outcome_kind"];
  },
) {
  const store = createPostgresVerticalSliceStore(engine.pool);
  const signal = await store.getSignal(input.signal_id);
  if (!signal) throw new Error(`Signal not found: ${input.signal_id}`);
  const person = await store.getPerson(input.person_id);
  if (!person) throw new Error(`Person not found: ${input.person_id}`);
  const linkedin = await createDatabaseBackedLinkedInChannel(
    engine.pool,
    input.workspace_id,
    input.action,
  );
  const writerLlm = createGovernedLLM(engine, input.workspace_id, "writer.linkedin");
  const judge = createGovernedJudge(engine, input.workspace_id);
  engine.runtime.register(
    createSignalToLinkedInPlayWorkflow({
      store,
      memory: engine.memory,
      judge,
      writerLlm,
      linkedin,
      bus: engine.bus,
      workspaceContextProvider: (workflowInput) =>
        getWorkflowWorkspaceContext(engine, workflowInput.workspace_id),
      draftGroundingProvider: (workflowInput) =>
        groundDraftWithExaForWorkflow(engine, workflowInput),
    }),
  );
  const play_run_id = randomUUID();
  return engine.runtime.start<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    workspace_id: input.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
    play_id: input.play_id,
    play_run_id,
    idempotency_key: `signal:${signal.id}:play:${input.play_id}`,
    correlation_id: input.trigger_event_id ?? undefined,
    causation_id: input.trigger_event_id ?? undefined,
    input: {
      workspace_id: input.workspace_id,
      play_id: input.play_id,
      play_run_id,
      rep_id: input.rep_id,
      signal_id: signal.id,
      person_id: person.id,
      company_id: signal.related_company_id,
      trigger_event_id: input.trigger_event_id,
      action: input.action,
      linkedin_approval: input.approval,
      play_channel_policy: input.policy,
      simulate_outcome_kind: input.simulate_outcome_kind ?? null,
    },
  });
}

export async function dispatchSignalPlaysOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  registerSignalEmailWorkflow(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    event_id: string;
    workspace_id: string;
    signal_id: string;
    person_id: string;
    play_id: string;
    rep_id: string;
    workflow_name: string;
    target_channel: string;
    signal_properties: Record<string, unknown>;
    play_autonomy: Record<string, unknown>;
  }>(
    `select e.id as event_id,
            e.workspace_id,
            e.payload->>'signal_id' as signal_id,
            target_person.id as person_id,
            p.id as play_id,
            p.default_rep_id as rep_id,
            coalesce(p.compiled->>'workflow', $1) as workflow_name,
            coalesce(p.compiled->>'channel', 'email') as target_channel,
            s.properties as signal_properties,
            p.autonomy as play_autonomy
       from events e
       join signals s
         on s.id = (e.payload->>'signal_id')::uuid
        and s.workspace_id = e.workspace_id
       join plays p
         on p.workspace_id = e.workspace_id
        and p.status = 'active'
        and p.default_rep_id is not null
        and p.compiled->'trigger'->>'kind' = 'signal'
        and (
          p.compiled #>> '{trigger,filter,kind}' is null
          or p.compiled #>> '{trigger,filter,kind}' = s.kind::text
        )
       join lateral (
         select gp.id
           from graph_persons gp
          where gp.workspace_id = e.workspace_id
            and (
              (coalesce(p.compiled->>'channel', 'email') = 'email' and cardinality(gp.emails) > 0)
              or (
                coalesce(p.compiled->>'channel', 'email') in (
                  'linkedin_dm',
                  'linkedin_connection',
                  'linkedin_comment'
                )
                and gp.linkedin_url is not null
              )
            )
            and (
              gp.id = s.related_person_id
              or (
                s.related_person_id is null
                and s.related_company_id is not null
                and gp.company_id = s.related_company_id
              )
            )
          order by (gp.id = s.related_person_id) desc, gp.created_at asc
          limit 1
       ) target_person on true
       left join workflow_runs wr
         on wr.workspace_id = e.workspace_id
        and wr.workflow_name = coalesce(p.compiled->>'workflow', $1)
        and wr.idempotency_key = concat('signal:', e.payload->>'signal_id', ':play:', p.id::text)
      where e.event_type = 'signal.matched'
        and wr.id is null
        and coalesce(p.compiled->>'workflow', $1) = any($2::text[])
        and ($4::uuid is null or e.workspace_id = $4)
      order by e.occurred_at asc
      limit $3`,
    [
      SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
      [SIGNAL_TO_EMAIL_PLAY_WORKFLOW, SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW],
      opts.limit ?? 25,
      session?.workspace_id ?? null,
    ],
  );

  let dispatched = 0;
  for (const row of rows) {
    const simulate = simulateOutcomeFromSignal(row.signal_properties);
    if (row.workflow_name === SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW) {
      const action = parseLinkedInAction(row.target_channel) ?? "linkedin_dm";
      const policy = resolvePlayChannelPolicy(row.play_autonomy, action, {
        approval: parseApprovalPolicy(row.signal_properties.linkedin_approval),
      });
      await startSignalLinkedInPlay(engine, {
        workspace_id: row.workspace_id,
        play_id: row.play_id,
        rep_id: row.rep_id,
        signal_id: row.signal_id,
        person_id: row.person_id,
        trigger_event_id: row.event_id,
        action,
        approval: policy.approval,
        policy,
        simulate_outcome_kind: simulate,
      });
    } else {
      const policy = resolvePlayChannelPolicy(row.play_autonomy, "email", {
        approval: parseApprovalPolicy(row.signal_properties.email_approval),
      });
      await startSignalEmailPlay(engine, {
        workspace_id: row.workspace_id,
        play_id: row.play_id,
        rep_id: row.rep_id,
        signal_id: row.signal_id,
        person_id: row.person_id,
        trigger_event_id: row.event_id,
        approval: policy.approval,
        policy,
        simulate_outcome_kind: simulate,
      });
    }
    dispatched++;
  }
  return dispatched;
}

export async function dispatchReplyEmailPlaysOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  registerReplyEmailWorkflow(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    event_id: string;
    workspace_id: string;
    conversation_id: string;
    inbound_message_id: string;
    rep_id: string;
  }>(
    `select e.id as event_id,
            e.workspace_id,
            e.payload->>'conversation_id' as conversation_id,
            e.payload->>'message_id' as inbound_message_id,
            c.rep_id
       from events e
       join conversations c
         on c.workspace_id = e.workspace_id
        and c.id = (e.payload->>'conversation_id')::uuid
       left join workflow_runs wr
         on wr.workspace_id = e.workspace_id
        and wr.workflow_name = $1
        and wr.idempotency_key = concat('reply:', e.payload->>'message_id', ':email')
      where e.event_type = 'reply.classified'
        and e.payload->>'intent' in ('positive', 'neutral')
        and wr.id is null
        and ($3::uuid is null or e.workspace_id = $3)
      order by e.occurred_at asc
      limit $2`,
    [
      REPLY_TO_EMAIL_PLAY_WORKFLOW,
      opts.limit ?? 25,
      session?.workspace_id ?? null,
    ],
  );

  let dispatched = 0;
  for (const row of rows) {
    registerReplyEmailWorkflow(engine, row.workspace_id);
    const play_run_id = randomUUID();
    await engine.runtime.start<ReplyToEmailPlayInput, ReplyToEmailPlayOutput>({
      workspace_id: row.workspace_id,
      workflow_name: REPLY_TO_EMAIL_PLAY_WORKFLOW,
      play_run_id,
      idempotency_key: `reply:${row.inbound_message_id}:email`,
      correlation_id: row.event_id,
      causation_id: row.event_id,
      input: {
        workspace_id: row.workspace_id,
        play_id: null,
        play_run_id,
        rep_id: row.rep_id,
        conversation_id: row.conversation_id,
        inbound_message_id: row.inbound_message_id,
        trigger_event_id: row.event_id,
        reply_approval: "always",
      },
    });
    dispatched++;
  }
  return dispatched;
}

type ProductDispatchEventType = "signal.matched" | "reply.classified";

interface ProductEventDispatchSubscriptionAdapter {
  subscribe(
    eventType: ProductDispatchEventType,
    handler: (event: PublishedEvent) => Promise<void>,
    durableName: string,
  ): Promise<Subscription>;
}

interface ProductEventDispatcherOptions {
  limit?: number;
  dispatchSignalPlays?: typeof dispatchSignalPlaysOnce;
  dispatchReplyEmailPlays?: typeof dispatchReplyEmailPlaysOnce;
}

export async function registerProductEventDispatchers(
  adapter: ProductEventDispatchSubscriptionAdapter,
  opts: ProductEventDispatcherOptions = {},
): Promise<Subscription[]> {
  const limit = opts.limit ?? 25;
  const dispatchSignalPlays = opts.dispatchSignalPlays ?? dispatchSignalPlaysOnce;
  const dispatchReplyEmailPlays =
    opts.dispatchReplyEmailPlays ?? dispatchReplyEmailPlaysOnce;

  const signalSubscription = await adapter.subscribe(
    "signal.matched",
    async () => {
      await dispatchSignalPlays({ limit });
    },
    "product-signal-play-dispatcher-v1",
  );
  const replySubscription = await adapter.subscribe(
    "reply.classified",
    async () => {
      await dispatchReplyEmailPlays({ limit });
    },
    "product-reply-play-dispatcher-v1",
  );

  return [signalSubscription, replySubscription];
}

interface RssSourceRow {
  id: string;
  workspace_id: string;
  config: Record<string, unknown>;
  properties: Record<string, unknown>;
  last_polled_at: Date | null;
}

function pollIntervalMs(row: RssSourceRow): number {
  const msCandidates = [row.config.poll_interval_ms, row.properties.poll_interval_ms];
  const secondsCandidates = [
    row.config.poll_interval_seconds,
    row.properties.poll_interval_seconds,
  ];
  for (const value of msCandidates) {
    const numeric = numericConfigValue(value);
    if (numeric) return Math.max(60_000, Math.trunc(numeric));
  }
  for (const value of secondsCandidates) {
    const numeric = numericConfigValue(value);
    if (numeric) return Math.max(60_000, Math.trunc(numeric * 1000));
  }
  return 15 * 60_000;
}

function numericConfigValue(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isSourceDue(row: RssSourceRow, now: Date): boolean {
  if (!row.last_polled_at) return true;
  return now.getTime() - row.last_polled_at.getTime() >= pollIntervalMs(row);
}

function pollBucket(row: RssSourceRow, now: Date): number {
  return Math.floor(now.getTime() / pollIntervalMs(row));
}

export async function dispatchRssSourceIngestionOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  registerSignalIngestionWorkflows(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<RssSourceRow>(
    `select id, workspace_id, config, properties, last_polled_at
      from graph_sources
      where kind = 'rss'
        and coalesce(config->>'adapter', 'rss') = 'rss'
        and enabled = true
        and not exists (
          select 1 from workspace_source_configs wsc
           where wsc.workspace_id = graph_sources.workspace_id
             and wsc.source_id = graph_sources.id
        )
        and ($2::uuid is null or workspace_id = $2)
      order by coalesce(last_polled_at, '-infinity'::timestamptz) asc,
               created_at asc
      limit $1`,
    [opts.limit ?? 25, session?.workspace_id ?? null],
  );

  const now = new Date();
  let dispatched = 0;
  for (const row of rows) {
    if (!isSourceDue(row, now)) continue;
    await engine.runtime.start({
      workspace_id: row.workspace_id,
      workflow_name: RSS_SIGNAL_INGESTION_WORKFLOW,
      idempotency_key: `rss:${row.id}:bucket:${pollBucket(row, now)}`,
      input: {
        workspace_id: row.workspace_id,
        source_id: row.id,
      },
    });
    dispatched++;
  }
  return dispatched;
}

export async function dispatchWorkspaceSourcePollsOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  registerSignalIngestionWorkflows(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    source_id: string;
    workspace_id: string;
    poll_cadence_sec: number;
    last_polled_at: Date | null;
  }>(
    `select wsc.source_id,
            wsc.workspace_id,
            wsc.poll_cadence_sec,
            wsc.last_polled_at
       from workspace_source_configs wsc
       join graph_sources gs
         on gs.workspace_id = wsc.workspace_id and gs.id = wsc.source_id
       join workspaces w on w.id = wsc.workspace_id
      where wsc.enabled
        and gs.enabled
        and w.archived_at is null
        and ($2::uuid is null or wsc.workspace_id = $2)
      order by coalesce(wsc.last_polled_at, '-infinity'::timestamptz) asc,
               gs.created_at asc
      limit $1`,
    [opts.limit ?? 25, session?.workspace_id ?? null],
  );

  const now = new Date();
  let dispatched = 0;
  for (const row of rows) {
    const due =
      !row.last_polled_at ||
      now.getTime() - row.last_polled_at.getTime() >= row.poll_cadence_sec * 1000;
    if (!due) continue;
    const cadenceBucket = Math.floor(now.getTime() / (row.poll_cadence_sec * 1000));
    await engine.runtime.start({
      workspace_id: row.workspace_id,
      workflow_name: WORKSPACE_POLL_WORKFLOW,
      idempotency_key:
        `workspace-source:${row.workspace_id}:${row.source_id}:bucket:${cadenceBucket}`,
      input: {
        workspace_id: row.workspace_id,
        source_id: row.source_id,
      },
    });
    dispatched++;
  }
  return dispatched;
}

export async function runWorkspaceSignalAggregatorOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<{ dispatched: number; resumed: number; projected: DurableProjectionTick | null }> {
  const engine = await getProductEngine();
  const dispatched = await dispatchWorkspaceSourcePollsOnce(opts, session);
  if (engine.substrateMode !== "postgres") {
    return { dispatched, resumed: 0, projected: null };
  }
  const resumed = await resumeRunnableWorkflowsOnce({
    limit: opts.limit,
    leaseMs: opts.leaseMs,
    leaseOwner: opts.leaseOwner,
  });
  const projected = await projectPendingProductEventsOnce({
    limit: opts.limit ?? 25,
    leaseOwner: opts.leaseOwner,
  });
  return { dispatched, resumed, projected };
}

export async function dispatchSendingDomainWarmupsOnce(
  opts: DispatchOptions = {},
): Promise<number> {
  const engine = await getProductEngine();
  registerSendingDomainWarmupWorkflow(engine);
  const { rows } = await engine.pool.query<{
    id: string;
    workspace_id: string;
    channel_account_id: string;
    domain: string;
    warmup_day: number;
    target_daily_cap: number;
  }>(
    `select id,
            workspace_id,
            channel_account_id,
            domain::text as domain,
            warmup_day,
            target_daily_cap
       from sending_domains
      where warmup_state = 'warming'
        and spf_verified and dkim_verified and dmarc_verified
        and target_daily_cap > current_daily_cap
        and (
          warmup_day = 0
          or updated_at <= now() - interval '24 hours'
        )
      order by updated_at asc
      limit $1`,
    [opts.limit ?? 25],
  );
  for (const row of rows) {
    const nextDay = row.warmup_day + 1;
    await engine.runtime.start({
      workspace_id: row.workspace_id,
      workflow_name: SENDING_DOMAIN_WARMUP_WORKFLOW,
      idempotency_key: `sending-domain:${row.id}:warmup:day:${nextDay}`,
      input: {
        workspace_id: row.workspace_id,
        sending_domain_id: row.id,
        channel_account_id: row.channel_account_id,
        domain: row.domain,
        next_day: nextDay,
        target_daily_cap: row.target_daily_cap,
      },
    });
  }
  return rows.length;
}

export async function projectPendingProductEventsOnce(
  opts: DispatchOptions = {},
): Promise<DurableProjectionTick> {
  const engine = await getProductEngine();
  const leaseOwner =
    opts.leaseOwner ?? `product-projector:${process.pid}:${randomBytes(4).toString("hex")}`;
  return runDurableEventProjectionsOnce(
    engine.pool,
    createProductEventProjections(engine),
    {
      leaseOwner,
      limit: opts.limit,
      leaseMs: opts.leaseMs,
    },
  );
}

export async function resumeRunnableWorkflowsOnce(
  opts: DispatchOptions = {},
): Promise<number> {
  const engine = await getProductEngine();
  registerSignalIngestionWorkflows(engine);
  const leaseOwner =
    opts.leaseOwner ?? `product-worker:${process.pid}:${randomBytes(4).toString("hex")}`;
  const leaseMs = opts.leaseMs ?? DEFAULT_WORKFLOW_LEASE_MS;
  await renewWorkflowRunLeases(engine.pool, {
    leaseOwner,
    leaseMs,
    workflowNames: RUNNABLE_WORKFLOW_NAMES,
  });
  const rows = await claimRunnableWorkflowRuns(engine.pool, {
    leaseOwner,
    leaseMs,
    limit: opts.limit ?? 25,
    workflowNames: RUNNABLE_WORKFLOW_NAMES,
  });
  let resumed = 0;
  for (const row of rows) {
    if (row.workflow_name === SIGNAL_TO_EMAIL_PLAY_WORKFLOW) {
      registerSignalEmailWorkflow(engine, row.workspace_id);
    } else if (row.workflow_name === REPLY_TO_EMAIL_PLAY_WORKFLOW) {
      registerReplyEmailWorkflow(engine, row.workspace_id);
    } else if (row.workflow_name === WORKSPACE_POLL_WORKFLOW) {
      registerSignalIngestionWorkflows(engine);
    } else if (row.workflow_name === SENDING_DOMAIN_PROVISIONING_WORKFLOW) {
      registerSendingDomainProvisioningWorkflow(engine);
    } else if (row.workflow_name === SENDING_DOMAIN_WARMUP_WORKFLOW) {
      registerSendingDomainWarmupWorkflow(engine);
    }
    try {
      const run = await engine.runtime.resume(row.id);
      if (run) resumed++;
    } catch (err) {
      await engine.pool.query(
        `update workflow_runs
            set lease_owner = null,
                lease_expires_at = null
          where id = $1 and lease_owner = $2`,
        [row.id, leaseOwner],
      );
      throw err;
    }
  }
  return resumed;
}

export async function renewWorkflowRunLeases(
  pool: Pool,
  opts: Omit<WorkflowLeaseOptions, "limit">,
): Promise<number> {
  const workflowNames = [...(opts.workflowNames ?? RUNNABLE_WORKFLOW_NAMES)];
  const leaseMs = Math.max(1000, Math.floor(opts.leaseMs ?? DEFAULT_WORKFLOW_LEASE_MS));
  const { rowCount } = await pool.query(
    `update workflow_runs
        set lease_expires_at = now() + ($3::int * interval '1 millisecond')
      where workflow_name = any($1::text[])
        and lease_owner = $2
        and status in ('running', 'awaiting_approval', 'awaiting_event')`,
    [workflowNames, opts.leaseOwner, leaseMs],
  );
  return rowCount ?? 0;
}

export async function claimRunnableWorkflowRuns(
  pool: Pool,
  opts: WorkflowLeaseOptions,
): Promise<Array<{ id: string; workspace_id: string; workflow_name: string }>> {
  const workflowNames = [...(opts.workflowNames ?? RUNNABLE_WORKFLOW_NAMES)];
  const limit = opts.limit ?? 25;
  const leaseMs = Math.max(1000, Math.floor(opts.leaseMs ?? DEFAULT_WORKFLOW_LEASE_MS));
  const { rows } = await pool.query<{
    id: string;
    workspace_id: string;
    workflow_name: string;
  }>(
    `with candidates as (
       select id
         from workflow_runs
        where workflow_name = any($1::text[])
          and status in ('running', 'awaiting_approval', 'awaiting_event')
          and (lease_expires_at is null or lease_expires_at < now())
        order by created_at asc
        limit $2
        for update skip locked
     )
     update workflow_runs wr
        set lease_owner = $3,
            lease_expires_at = now() + ($4::int * interval '1 millisecond')
       from candidates
      where wr.id = candidates.id
      returning wr.id, wr.workspace_id, wr.workflow_name`,
    [workflowNames, limit, opts.leaseOwner, leaseMs],
  );
  return rows;
}

export async function retryFailedWorkflowRun(
  run_id: string,
  session?: ProductWorkspaceSession,
): Promise<void> {
  const engine = await getProductEngine();
  const { rows } = await engine.pool.query<{
    id: string;
    workspace_id: string;
    workflow_name: string;
    status: string;
    input: Record<string, unknown>;
  }>(
    `select id, workspace_id, workflow_name, status, input
       from workflow_runs
      where id = $1
      limit 1`,
    [run_id],
  );
  const run = rows[0];
  if (!run || run.status !== "failed") return;
  if (session) {
    if (run.workspace_id !== session.workspace_id) return;
    await assertProductWorkspaceAccess(session, engine.pool);
  }
  if (run.workflow_name === SIGNAL_TO_EMAIL_PLAY_WORKFLOW) {
    registerSignalEmailWorkflow(engine, run.workspace_id);
  } else if (run.workflow_name === REPLY_TO_EMAIL_PLAY_WORKFLOW) {
    registerReplyEmailWorkflow(engine, run.workspace_id);
  } else if (
    run.workflow_name === RSS_SIGNAL_INGESTION_WORKFLOW ||
    run.workflow_name === WORKSPACE_POLL_WORKFLOW
  ) {
    registerSignalIngestionWorkflows(engine);
  } else if (run.workflow_name === SENDING_DOMAIN_PROVISIONING_WORKFLOW) {
    registerSendingDomainProvisioningWorkflow(engine);
  } else if (run.workflow_name === SENDING_DOMAIN_WARMUP_WORKFLOW) {
    registerSendingDomainWarmupWorkflow(engine);
  }

  let retryRunId = run.id;
  if (run.workflow_name === RSS_SIGNAL_INGESTION_WORKFLOW) {
    const retry = await engine.runtime.start({
      workspace_id: run.workspace_id,
      workflow_name: run.workflow_name,
      idempotency_key: `recovery:${run.id}:${Date.now()}`,
      correlation_id: run.id,
      causation_id: run.id,
      input: run.input,
    });
    retryRunId = retry.id;
  } else {
    const retry = await engine.runtime.resume(run.id);
    retryRunId = retry?.id ?? run.id;
  }

  await engine.bus.publish({
    workspace_id: run.workspace_id,
    event_type: "workflow.run.retried",
    source: "user",
    producer_ref: session?.user_id ?? DEFAULT_PRODUCT_USER_ID,
    correlation_id: run.id,
    causation_id: run.id,
    payload: {
      run_id: run.id,
      workflow_name: run.workflow_name,
      retry_run_id: retryRunId,
    },
  });
}

export async function redriveDeadLetteredEventDispatch(
  event_id: string,
  session: ProductWorkspaceSession,
): Promise<boolean> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const redriven = await redriveDeadLetteredDispatch(engine.pool, event_id, {
    workspace_id: session.workspace_id,
  });
  if (!redriven) return false;
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "event.dispatch.redriven",
    source: "user",
    producer_ref: session.user_id,
    correlation_id: event_id,
    causation_id: event_id,
    payload: {
      event_id,
      redriven_by: session.user_id,
      status: "pending",
    },
  });
  return true;
}

export async function listDeadLetteredEventDispatches(
  session: ProductWorkspaceSession,
  input: { limit?: number } = {},
): Promise<DeadLetteredDispatch[]> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return listDeadLetteredDispatches(engine.pool, session.workspace_id, input.limit ?? 50);
}

function simulateOutcomeFromSignal(
  signalProperties: Record<string, unknown>,
): SignalToEmailPlayInput["simulate_outcome_kind"] {
  const value = signalProperties.simulate_outcome_kind;
  return value === "positive_reply" || value === "meeting_booked" ? value : null;
}

export async function approveWorkflowApproval(
  approval_id: string,
  decision: "approved" | "rejected",
  session?: ProductWorkspaceSession,
  note?: string,
): Promise<void> {
  const engine = await getProductEngine();
  if (session) {
    const { rows } = await engine.pool.query<{ workspace_id: string }>(
      `select workspace_id from workflow_approvals where id = $1`,
      [approval_id],
    );
    if (!rows[0] || rows[0].workspace_id !== session.workspace_id) return;
    await assertProductWorkspaceAccess(session, engine.pool);
  }
  await engine.runtime.resolveApproval(approval_id, {
    decision,
    decided_by: session?.user_id ?? DEFAULT_PRODUCT_USER_ID,
    note,
  });
  await waitForApprovalDecision(engine.pool, approval_id);
}

async function waitForApprovalDecision(pool: Pool, approval_id: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ decision: string }>(
      `select decision from workflow_approvals where id = $1`,
      [approval_id],
    );
    if (rows[0]?.decision !== "pending") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function getProductReviewPulse(
  pool = getPool(),
  session: ProductWorkspaceSession,
): Promise<ProductReviewPulse> {
  await assertProductWorkspaceAccess(session, pool);
  const [reviewEvents, recommendationFeedback, recommendationMutations, recommendationOutcomes] = await Promise.all([
    pool.query<{
      event_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
      evidence: Array<{
        id: string;
        url: string | null;
        title: string | null;
        snippet: string | null;
      }>;
    }>(
      `select id::text as event_id,
              event_type,
              payload,
              occurred_at,
              '[]'::jsonb as evidence
         from events
        where workspace_id = $1
          and event_type in ('content.opportunity.discovered', 'aeo.audit.completed')
        order by occurred_at desc
        limit 100`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      review_kind: ProductRecommendationKind | string | null;
      decision: ProductRecommendationDecision;
      note: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              payload->>'review_kind' as review_kind,
              payload->>'decision' as decision,
              payload->>'note' as note,
              occurred_at
         from events
        where workspace_id = $1
          and event_type = 'recommendation.reviewed'
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      event_type: "recommendation.updated" | "recommendation.deleted";
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              event_type,
              payload,
              occurred_at
         from events
        where workspace_id = $1
          and event_type in ('recommendation.updated', 'recommendation.deleted')
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      outcome_id: string;
      kind: ProductRecommendationOutcomeKind | string;
      external_ref: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (properties->>'recommendation_review_id')
              properties->>'recommendation_review_id' as review_id,
              id::text as outcome_id,
              kind::text as kind,
              properties->>'external_ref' as external_ref,
              occurred_at
         from outcomes
        where workspace_id = $1
          and properties ? 'recommendation_review_id'
        order by properties->>'recommendation_review_id', occurred_at desc`,
      [session.workspace_id],
    ),
  ]);
  const recommendationFeedbackById = recommendationFeedbackState(recommendationFeedback.rows);
  const recommendationMutationById = recommendationMutationState(recommendationMutations.rows);
  const recommendationOutcomeById = recommendationOutcomeState(recommendationOutcomes.rows);
  const contentReviews = applyRecommendationOutcomeState(
    productExaReviewState(
      reviewEvents.rows,
      "content.opportunity.discovered",
      recommendationFeedbackById,
      recommendationMutationById,
      24,
    ),
    recommendationOutcomeById,
  );
  const aeoReviews = applyRecommendationOutcomeState(
    productExaReviewState(
      reviewEvents.rows,
      "aeo.audit.completed",
      recommendationFeedbackById,
      recommendationMutationById,
      24,
    ),
    recommendationOutcomeById,
  );
  return {
    content: {
      open: contentReviews.filter((item) => !item.outcome_id).length,
      last_activity_at: productBriefItemsLatestActivity(contentReviews),
    },
    aeo: {
      open: aeoReviews.filter((item) => !item.outcome_id).length,
      last_activity_at: productBriefItemsLatestActivity(aeoReviews),
    },
  };
}

export async function getProductRecommendationSurface(
  pool = getPool(),
  session: ProductWorkspaceSession,
  surface: ProductRecommendationKind,
): Promise<ProductRecommendationSurfaceState> {
  const state = await getProductRecommendationState(pool, session);
  return surface === "content_opportunity" ? state.content : state.aeo;
}

async function getProductRecommendationState(
  pool: Pool,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationState> {
  await assertProductWorkspaceAccess(session, pool);
  const [reviewEvents, recommendationFeedback, recommendationMutations, recommendationOutcomes] = await Promise.all([
    pool.query<{
      event_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
      evidence: Array<{
        id: string;
        url: string | null;
        title: string | null;
        snippet: string | null;
      }>;
    }>(
      `select e.id::text as event_id,
              e.event_type,
              e.payload,
              e.occurred_at,
              coalesce(
                jsonb_agg(
                  distinct jsonb_build_object(
                    'id', gs.id::text,
                    'url', gs.config->>'url',
                    'title', coalesce(gs.properties->>'title', gs.name),
                    'snippet', gs.properties->>'snippet'
                  )
                ) filter (where gs.id is not null),
                '[]'::jsonb
              ) as evidence
         from events e
         left join lateral jsonb_array_elements_text(
           coalesce(e.payload->'evidence_source_ids', '[]'::jsonb)
         ) evidence_ids(id) on true
         left join graph_sources gs
           on gs.workspace_id = e.workspace_id
          and gs.id::text = evidence_ids.id
        where e.workspace_id = $1
          and e.event_type in ('content.opportunity.discovered', 'aeo.audit.completed')
        group by e.id
        order by e.occurred_at desc
        limit 100`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      review_kind: ProductRecommendationKind | string | null;
      decision: ProductRecommendationDecision;
      note: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              payload->>'review_kind' as review_kind,
              payload->>'decision' as decision,
              payload->>'note' as note,
              occurred_at
         from events
        where workspace_id = $1
          and event_type = 'recommendation.reviewed'
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      event_type: "recommendation.updated" | "recommendation.deleted";
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              event_type,
              payload,
              occurred_at
         from events
        where workspace_id = $1
          and event_type in ('recommendation.updated', 'recommendation.deleted')
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [session.workspace_id],
    ),
    pool.query<{
      review_id: string;
      outcome_id: string;
      kind: ProductRecommendationOutcomeKind | string;
      external_ref: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (properties->>'recommendation_review_id')
              properties->>'recommendation_review_id' as review_id,
              id::text as outcome_id,
              kind::text as kind,
              properties->>'external_ref' as external_ref,
              occurred_at
         from outcomes
        where workspace_id = $1
          and properties ? 'recommendation_review_id'
        order by properties->>'recommendation_review_id', occurred_at desc`,
      [session.workspace_id],
    ),
  ]);
  const recommendationFeedbackById = recommendationFeedbackState(recommendationFeedback.rows);
  const recommendationMutationById = recommendationMutationState(recommendationMutations.rows);
  const recommendationOutcomeById = recommendationOutcomeState(recommendationOutcomes.rows);
  const recommendationQuality = productRecommendationQualityState(recommendationFeedback.rows);
  const content = applyRecommendationOutcomeState(
    productExaReviewState(
      reviewEvents.rows,
      "content.opportunity.discovered",
      recommendationFeedbackById,
      recommendationMutationById,
      24,
    ),
    recommendationOutcomeById,
  );
  const aeo = applyRecommendationOutcomeState(
    productExaReviewState(
      reviewEvents.rows,
      "aeo.audit.completed",
      recommendationFeedbackById,
      recommendationMutationById,
      24,
    ),
    recommendationOutcomeById,
  );
  return {
    content: {
      reviews: content,
      learning: recommendationQuality.content_opportunity,
    },
    aeo: {
      reviews: aeo,
      learning: recommendationQuality.aeo_gap,
    },
  };
}

export async function getProductCompanyProfile(
  pool = getPool(),
  session: ProductWorkspaceSession,
): Promise<ProductCompanyProfile | null> {
  await assertProductWorkspaceAccess(session, pool);
  const { rows } = await pool.query<{
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    description: string | null;
    properties: Record<string, unknown>;
  }>(
    `select id, name, domain::text as domain, industry, description, properties
       from graph_companies
      where workspace_id = $1
        and properties->>'profile_role' = 'workspace_company'
      order by updated_at desc, created_at desc
      limit 1`,
    [session.workspace_id],
  );
  return productProfileState(rows[0] ?? null);
}

export async function getAppState(
  pool = getPool(),
  session?: ProductWorkspaceSession,
): Promise<AppState> {
  const existing = session
    ? await pool.query<{ id: string }>(
        `select id from workspaces where id = $1`,
        [session.workspace_id],
      )
    : await pool.query<{ id: string }>(
        `select id from workspaces where slug = $1`,
        [DEFAULT_WORKSPACE_SLUG],
      );
  if (!existing.rows[0]) {
    return {
      configured: false,
      approvals: [],
      runs: [],
      events: [],
      recoveryQueue: [],
      messages: [],
      outcomes: [],
      conversations: [],
      channelAccounts: [],
      profile: null,
      brief: null,
      content_reviews: [],
      aeo_reviews: [],
      recommendation_quality: defaultRecommendationQuality(),
      llmUsage: { used_tokens_24h: 0, daily_token_cap: 0 },
      sources: [],
      eventTrace: {
        summary: {
          correlation_id: null,
          event_count: 0,
          started_at: null,
          ended_at: null,
          root_event_type: null,
          terminal_event_type: null,
          contains_failure: false,
        },
        events: [],
      },
      sendTraces: [],
    };
  }
  const boot = session
    ? await bootstrapWorkspace(pool, session.user_id, {
        ensureMembership: false,
        workspace_id: session.workspace_id,
      })
    : await bootstrapWorkspace(pool);
  const scoped = session ?? {
    workspace_id: boot.workspace_id,
    user_id: DEFAULT_PRODUCT_USER_ID,
  };
  if (scoped.workspace_id !== boot.workspace_id) {
    throw new Error("Configured workspace does not match the product session.");
  }
  await assertProductWorkspaceAccess(scoped, pool);
  await projectVisibleProductState(await getProductEngine());
  const store = createPostgresVerticalSliceStore(pool);
  const snapshot = await store.snapshot();
  const [
    approvals,
    llmUsage,
    runs,
    recovery,
    events,
    sendTraces,
    accounts,
    sources,
    profile,
    brief,
    exaReviews,
    recommendationFeedback,
    recommendationMutations,
    recommendationOutcomes,
  ] = await Promise.all([
    pool.query<{
      id: string;
      run_id: string;
      kind: string;
      reason: string | null;
      payload: Record<string, unknown>;
      decision: string;
      created_at: Date;
    }>(
      `select id, run_id, kind, reason, payload, decision, created_at
         from workflow_approvals
        where workspace_id = $1
        order by created_at desc
        limit 20`,
      [boot.workspace_id],
    ),
    pool.query<{
      used_tokens_24h: string;
      daily_token_cap: string | null;
    }>(
      `select coalesce((
                select sum(total_tokens)::text
                  from workspace_llm_usage
                 where workspace_id = w.id
                   and created_at >= now() - interval '24 hours'
              ), '0') as used_tokens_24h,
              coalesce(
                w.settings #>> '{llm,daily_token_cap}',
                w.settings->>'llm_daily_token_cap'
              ) as daily_token_cap
         from workspaces w
        where w.id = $1`,
      [boot.workspace_id],
    ),
    pool.query<{
      id: string;
      status: string;
      workflow_name: string;
      input: Record<string, unknown>;
      output: Record<string, unknown> | null;
      created_at: Date;
      ended_at: Date | null;
    }>(
      `select id, status, workflow_name, input, output, created_at, ended_at
         from workflow_runs
        where workspace_id = $1
        order by created_at desc
        limit 20`,
      [boot.workspace_id],
    ),
    pool.query<{
      id: string;
      workflow_name: string;
      status: string;
      input: Record<string, unknown>;
      error: { message?: string } | null;
      failed_step_name: string | null;
      failed_step_attempt: number | null;
      created_at: Date;
      ended_at: Date | null;
    }>(
      `select wr.id,
              wr.workflow_name,
              wr.status,
              wr.input,
              wr.error,
              failed_step.step_name as failed_step_name,
              failed_step.attempt as failed_step_attempt,
              wr.created_at,
              wr.ended_at
         from workflow_runs wr
         left join lateral (
           select ws.step_name, ws.attempt
             from workflow_steps ws
            where ws.run_id = wr.id
              and ws.status = 'failed'
            order by ws.ended_at desc nulls last, ws.created_at desc
            limit 1
         ) failed_step on true
        where wr.workspace_id = $1
          and wr.status = 'failed'
          and wr.workflow_name = any($2::text[])
          and not exists (
            select 1
              from workflow_runs newer
             where newer.workspace_id = wr.workspace_id
               and newer.workflow_name = wr.workflow_name
               and newer.status = 'completed'
               and newer.created_at > wr.created_at
               and coalesce(newer.input->>'source_id', '') = coalesce(wr.input->>'source_id', '')
               and coalesce(newer.input->>'signal_id', '') = coalesce(wr.input->>'signal_id', '')
          )
        order by wr.ended_at desc nulls last, wr.created_at desc
        limit 20`,
      [boot.workspace_id, [SIGNAL_TO_EMAIL_PLAY_WORKFLOW, RSS_SIGNAL_INGESTION_WORKFLOW]],
    ),
    pool.query<{ id: string; event_type: string; occurred_at: Date }>(
      `select id, event_type, occurred_at
         from events
        where workspace_id = $1
        order by occurred_at desc
        limit 50`,
      [boot.workspace_id],
    ),
    pool.query<{
      message_id: string;
      status: string;
      subject: string | null;
      rep_name: string | null;
      person_name: string | null;
      company_name: string | null;
      signal_title: string | null;
      signal_kind: string | null;
      signal_url: string | null;
      eval_score: string | null;
      eval_passed: boolean | null;
      eval_notes: Record<string, unknown> | null;
      defer_reason: string | null;
      pattern_key: string | null;
      workflow_run_id: string | null;
      workflow_status: string | null;
      play_run_id: string | null;
      approval_policy: string | null;
      created_at: Date;
    }>(
      `select m.id as message_id,
              m.status::text as status,
              m.subject,
              r.name as rep_name,
              gp.full_name as person_name,
              gc.name as company_name,
              s.title as signal_title,
              s.kind::text as signal_kind,
              s.url as signal_url,
              m.eval_score::text as eval_score,
              m.eval_passed,
              m.eval_notes,
              m.properties->>'defer_reason' as defer_reason,
              m.provenance->>'pattern_key' as pattern_key,
              wr.id as workflow_run_id,
              wr.status::text as workflow_status,
              wr.play_run_id,
              wr.input->>'email_approval' as approval_policy,
              m.created_at
         from messages m
         join conversations c
           on c.id = m.conversation_id
          and c.workspace_id = m.workspace_id
         left join reps r
           on r.id = c.rep_id
          and r.workspace_id = c.workspace_id
         left join graph_persons gp
           on gp.id = c.counterparty_person_id
          and gp.workspace_id = c.workspace_id
         left join graph_companies gc
           on gc.id = c.counterparty_company_id
          and gc.workspace_id = c.workspace_id
         left join signals s
           on s.id = c.origin_signal_id
          and s.workspace_id = c.workspace_id
         left join lateral (
           select id, status, input, play_run_id
             from workflow_runs
            where workspace_id = m.workspace_id
              and workflow_name = $2
              and output->>'message_id' = m.id::text
            order by created_at desc
            limit 1
         ) wr on true
        where m.workspace_id = $1
          and m.direction = 'outbound'
        order by m.created_at desc
        limit 10`,
      [boot.workspace_id, SIGNAL_TO_EMAIL_PLAY_WORKFLOW],
    ),
    pool.query<{
      id: string;
      display_name: string;
      kind: string;
      daily_cap: number | null;
      daily_used: number;
      daily_window_start: Date | null;
      status: string;
      domain: string | null;
      warmup_state: string | null;
      current_daily_cap: number | null;
      sending_domain_id: string | null;
      spf_verified: boolean | null;
      dkim_verified: boolean | null;
      dmarc_verified: boolean | null;
      provider_status: string | null;
      provider_domain_id: string | null;
      dns_records: Array<{
        record: string;
        name: string;
        type: string;
        value: string;
        status?: string | null;
      }>;
      bounce_rate_24h: string | null;
      complaint_rate_24h: string | null;
    }>(
      `select ca.id,
              ca.display_name,
              ca.kind,
              ca.daily_cap,
              ca.daily_used,
              ca.daily_window_start,
              ca.status,
              sd.id as sending_domain_id,
              sd.domain::text as domain,
              sd.warmup_state,
              sd.current_daily_cap,
              sd.spf_verified,
              sd.dkim_verified,
              sd.dmarc_verified,
              sd.properties->>'provider_status' as provider_status,
              sd.properties->>'provider_domain_id' as provider_domain_id,
              coalesce(sd.properties->'dns_records', '[]'::jsonb) as dns_records,
              sd.bounce_rate_24h::text as bounce_rate_24h,
              sd.complaint_rate_24h::text as complaint_rate_24h
         from channel_accounts ca
         left join sending_domains sd
           on sd.channel_account_id = ca.id
        where ca.workspace_id = $1
        order by ca.created_at asc`,
      [boot.workspace_id],
    ),
    pool.query<{
      id: string;
      name: string;
      kind: string;
      enabled: boolean;
      config: Record<string, unknown>;
      properties: Record<string, unknown>;
      last_polled_at: Date | null;
      signal_count: string;
      latest_run_status: string | null;
      latest_run_created_at: Date | null;
      latest_run_error: { message?: string } | null;
    }>(
      `select gs.id,
              gs.name,
              gs.kind,
              gs.enabled,
              gs.config,
              gs.properties,
              gs.last_polled_at,
              count(s.id)::text as signal_count,
              latest.status as latest_run_status,
              latest.created_at as latest_run_created_at,
              latest.error as latest_run_error
         from graph_sources gs
         left join signals s
           on s.workspace_id = gs.workspace_id
          and s.source_id = gs.id
         left join lateral (
           select wr.status, wr.created_at, wr.error
             from workflow_runs wr
            where wr.workspace_id = gs.workspace_id
              and wr.workflow_name = any($2::text[])
              and wr.input->>'source_id' = gs.id::text
            order by wr.created_at desc
            limit 1
         ) latest on true
        where gs.workspace_id = $1
        group by gs.id, latest.status, latest.created_at, latest.error
        order by gs.created_at desc`,
      [boot.workspace_id, [RSS_SIGNAL_INGESTION_WORKFLOW, WORKSPACE_POLL_WORKFLOW]],
    ),
    pool.query<{
      id: string;
      name: string;
      domain: string | null;
      industry: string | null;
      description: string | null;
      properties: Record<string, unknown>;
    }>(
      `select id, name, domain::text as domain, industry, description, properties
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc, created_at desc
        limit 1`,
      [boot.workspace_id],
    ),
    pool.query<{
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select payload, occurred_at
         from events
        where workspace_id = $1
          and event_type = 'rep.brief.refreshed'
        order by occurred_at desc
        limit 1`,
      [boot.workspace_id],
    ),
    pool.query<{
      event_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
      evidence: Array<{
        id: string;
        url: string | null;
        title: string | null;
        snippet: string | null;
      }>;
    }>(
      `select e.id::text as event_id,
              e.event_type,
              e.payload,
              e.occurred_at,
              coalesce(
                jsonb_agg(
                  distinct jsonb_build_object(
                    'id', gs.id::text,
                    'url', gs.config->>'url',
                    'title', coalesce(gs.properties->>'title', gs.name),
                    'snippet', gs.properties->>'snippet'
                  )
                ) filter (where gs.id is not null),
                '[]'::jsonb
              ) as evidence
         from events e
         left join lateral jsonb_array_elements_text(
           coalesce(e.payload->'evidence_source_ids', '[]'::jsonb)
         ) evidence_ids(id) on true
         left join graph_sources gs
           on gs.workspace_id = e.workspace_id
          and gs.id::text = evidence_ids.id
        where e.workspace_id = $1
          and e.event_type in ('content.opportunity.discovered', 'aeo.audit.completed')
        group by e.id
        order by e.occurred_at desc
        limit 10`,
      [boot.workspace_id],
    ),
    pool.query<{
      review_id: string;
      review_kind: ProductRecommendationKind | string | null;
      decision: ProductRecommendationDecision;
      note: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              payload->>'review_kind' as review_kind,
              payload->>'decision' as decision,
              payload->>'note' as note,
              occurred_at
         from events
        where workspace_id = $1
          and event_type = 'recommendation.reviewed'
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [boot.workspace_id],
    ),
    pool.query<{
      review_id: string;
      event_type: "recommendation.updated" | "recommendation.deleted";
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              event_type,
              payload,
              occurred_at
         from events
        where workspace_id = $1
          and event_type in ('recommendation.updated', 'recommendation.deleted')
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [boot.workspace_id],
    ),
    pool.query<{
      review_id: string;
      outcome_id: string;
      kind: ProductRecommendationOutcomeKind | string;
      external_ref: string | null;
      occurred_at: Date;
    }>(
      `select distinct on (properties->>'recommendation_review_id')
              properties->>'recommendation_review_id' as review_id,
              id::text as outcome_id,
              kind::text as kind,
              properties->>'external_ref' as external_ref,
              occurred_at
         from outcomes
        where workspace_id = $1
          and properties ? 'recommendation_review_id'
        order by properties->>'recommendation_review_id', occurred_at desc`,
      [boot.workspace_id],
    ),
  ]);
  const recommendationFeedbackById = recommendationFeedbackState(recommendationFeedback.rows);
  const recommendationMutationById = recommendationMutationState(recommendationMutations.rows);
  const recommendationOutcomeById = recommendationOutcomeState(recommendationOutcomes.rows);
  const recommendationQuality = productRecommendationQualityState(recommendationFeedback.rows);
  const latestWorkflowRunId = sendTraces.rows[0]?.workflow_run_id;
  const eventTrace = latestWorkflowRunId
    ? await getEventTraceForCorrelation(pool, {
        workspace_id: boot.workspace_id,
        correlation_id: latestWorkflowRunId,
      })
    : await getLatestEventTraceForWorkspace(pool, {
        workspace_id: boot.workspace_id,
      });

  return {
    configured: true,
    bootstrap: boot,
    approvals: approvals.rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    })),
    runs: runs.rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      ended_at: row.ended_at?.toISOString() ?? null,
    })),
    recoveryQueue: recovery.rows.map((row) => ({
      id: row.id,
      workflow_name: row.workflow_name,
      status: row.status,
      input: row.input,
      error: row.error?.message ?? null,
      failed_step_name: row.failed_step_name,
      failed_step_attempt: row.failed_step_attempt,
      created_at: row.created_at.toISOString(),
      ended_at: row.ended_at?.toISOString() ?? null,
    })),
    events: events.rows.map((row) => ({
      ...row,
      occurred_at: row.occurred_at.toISOString(),
    })),
    eventTrace,
    profile: productProfileState(profile.rows[0] ?? null),
    brief: productBriefState(brief.rows[0] ?? null),
    content_reviews: applyRecommendationOutcomeState(productExaReviewState(
      exaReviews.rows,
      "content.opportunity.discovered",
      recommendationFeedbackById,
      recommendationMutationById,
    ), recommendationOutcomeById),
    aeo_reviews: applyRecommendationOutcomeState(productExaReviewState(
      exaReviews.rows,
      "aeo.audit.completed",
      recommendationFeedbackById,
      recommendationMutationById,
    ), recommendationOutcomeById),
    recommendation_quality: recommendationQuality,
    sendTraces: sendTraces.rows.map((row) => ({
      message_id: row.message_id,
      status: row.status,
      subject: row.subject,
      rep_name: row.rep_name,
      person_name: row.person_name,
      company_name: row.company_name,
      signal_title: row.signal_title,
      signal_kind: row.signal_kind,
      signal_url: row.signal_url,
      eval_score: row.eval_score == null ? null : Number(row.eval_score),
      eval_passed: row.eval_passed,
      eval_notes: row.eval_notes,
      defer_reason: row.defer_reason,
      pattern_key: row.pattern_key,
      workflow_run_id: row.workflow_run_id,
      workflow_status: row.workflow_status,
      play_run_id: row.play_run_id,
      approval_policy: row.approval_policy,
      created_at: row.created_at.toISOString(),
    })),
    conversations: snapshot.conversations,
    messages: snapshot.messages,
    outcomes: snapshot.outcomes,
    channelAccounts: accounts.rows.map((row) => ({
      ...row,
      daily_window_start: row.daily_window_start?.toISOString() ?? null,
      bounce_rate_24h: row.bounce_rate_24h == null ? null : Number(row.bounce_rate_24h),
      complaint_rate_24h: row.complaint_rate_24h == null ? null : Number(row.complaint_rate_24h),
    })),
    llmUsage: {
      used_tokens_24h: Number(llmUsage.rows[0]?.used_tokens_24h ?? 0),
      daily_token_cap: Number(
        llmUsage.rows[0]?.daily_token_cap ??
          process.env.BOMBSELL_LLM_DAILY_TOKEN_CAP ??
          100_000,
      ),
    },
    sources: sources.rows.map((row) => {
      const pollMs = numericConfigValue(row.config.poll_interval_ms);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        enabled: row.enabled,
        url: stringStateValue(row.config.url ?? row.config.feed_url ?? row.config.rss_url),
        signal_kind: stringStateValue(row.config.kind ?? row.config.signal_kind),
        poll_interval_minutes: pollMs == null ? null : Math.round(pollMs / 60_000),
        last_polled_at: row.last_polled_at?.toISOString() ?? null,
        signal_count: Number(row.signal_count),
        latest_run_status: row.latest_run_status,
        latest_run_created_at: row.latest_run_created_at?.toISOString() ?? null,
        latest_run_error: row.latest_run_error?.message ?? null,
      };
    }),
  };
}

function productProfileState(row: {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  description: string | null;
  properties: Record<string, unknown>;
} | null): AppState["profile"] {
  if (!row) return null;
  const exaProfile = recordStateValue(row.properties.exa_profile);
  const intelligence = recordStateValue(exaProfile?.intelligence);
  const evidenceIds = arrayStringStateValue(exaProfile?.evidence_source_ids);
  return {
    company_id: row.id,
    company_name: row.name,
    domain: row.domain,
    website_url: stringStateValue(row.properties.website_url),
    industry: row.industry,
    description: row.description,
    exa_summary: stringStateValue(exaProfile?.summary),
    exa_source_domains: arrayStringStateValue(intelligence?.source_domains),
    exa_market_terms: arrayStringStateValue(intelligence?.market_terms),
    exa_positioning_notes: arrayStringStateValue(intelligence?.positioning_notes),
    exa_competitor_mentions: arrayStringStateValue(intelligence?.competitor_mentions),
    exa_audience_terms: arrayStringStateValue(intelligence?.audience_terms),
    exa_proof_points: arrayStringStateValue(intelligence?.proof_points),
    exa_evidence_cards: profileEvidenceCardsStateValue(intelligence?.evidence_cards),
    exa_evidence_source_ids: evidenceIds,
    exa_result_count: numericConfigValue(exaProfile?.result_count) ?? 0,
    exa_enriched_at: stringStateValue(exaProfile?.enriched_at),
  };
}

function productBriefState(row: {
  payload: Record<string, unknown>;
  occurred_at: Date;
} | null): AppState["brief"] {
  if (!row) return null;
  const payload = row.payload;
  return {
    refreshed_at: row.occurred_at.toISOString(),
    query: stringStateValue(payload.query),
    request_id: stringStateValue(payload.request_id),
    summary: stringStateValue(payload.summary),
    evidence_source_ids: arrayStringStateValue(payload.evidence_source_ids),
    notes: briefItemsStateValue(payload.notes),
    review_items: briefItemsStateValue(payload.review_items),
    recent_changes: briefItemsStateValue(payload.recent_changes),
    quiet_exceptions: briefItemsStateValue(payload.quiet_exceptions),
  };
}

function productExaReviewState(
  rows: Array<{
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    occurred_at: Date;
    evidence: Array<{
      id: string;
      url: string | null;
      title: string | null;
      snippet: string | null;
    }>;
  }>,
  eventType: "content.opportunity.discovered" | "aeo.audit.completed",
  feedbackById: Map<string, ProductRecommendationFeedbackState> = new Map(),
  mutationsById: Map<string, ProductRecommendationMutationState> = new Map(),
  limit = 8,
): ProductBriefItem[] {
  return rows
    .filter((row) => row.event_type === eventType)
    .flatMap((row) => {
      const key = eventType === "content.opportunity.discovered" ? "opportunities" : "gaps";
      const payloadItems = briefItemsStateValue(row.payload[key] ?? row.payload.review_items);
      if (payloadItems.length > 0) {
        return payloadItems.flatMap((item) =>
          decorateProductReviewItem(row.event_id, eventType, item, feedbackById, mutationsById),
        );
      }
      const evidence = row.evidence[0];
      if (evidence) {
        return decorateProductReviewItem(row.event_id, eventType, {
          title: evidence.title ?? (eventType === "content.opportunity.discovered"
            ? "Content angle to review"
            : "Answer gap to review"),
          detail: evidence.snippet ?? stringStateValue(row.payload.summary) ?? "",
          url: evidence.url,
          evidence_source_ids: [evidence.id],
        }, feedbackById, mutationsById);
      }
      const summary = stringStateValue(row.payload.summary);
      return summary
        ? decorateProductReviewItem(row.event_id, eventType, {
          title: eventType === "content.opportunity.discovered"
            ? "Content angle to review"
            : "Answer gap to review",
          detail: summary,
          evidence_source_ids: arrayStringStateValue(row.payload.evidence_source_ids),
        }, feedbackById, mutationsById)
        : [];
    })
    .slice(0, limit);
}

interface ProductRecommendationFeedbackState {
  decision: ProductRecommendationDecision;
  note: string | null;
  occurred_at: string;
}

type ProductRecommendationMutationState =
  | {
      type: "updated";
      item: {
        title: string;
        detail: string;
        url: string | null;
        evidence_source_ids: string[];
      };
      note: string | null;
      occurred_at: string;
    }
  | {
      type: "deleted";
      reason: string | null;
      occurred_at: string;
    };

interface ProductRecommendationOutcomeState {
  outcome_id: string;
  kind: ProductRecommendationOutcomeKind;
  external_ref: string | null;
  occurred_at: string;
}

function recommendationOutcomeState(rows: Array<{
  review_id: string | null;
  outcome_id: string;
  kind: ProductRecommendationOutcomeKind | string;
  external_ref: string | null;
  occurred_at: Date;
}>): Map<string, ProductRecommendationOutcomeState> {
  const outcomes = new Map<string, ProductRecommendationOutcomeState>();
  for (const row of rows) {
    if (!row.review_id) continue;
    if (
      row.kind !== "post_published" &&
      row.kind !== "follower_lift" &&
      row.kind !== "engagement_lift"
    ) {
      continue;
    }
    outcomes.set(row.review_id, {
      outcome_id: row.outcome_id,
      kind: row.kind,
      external_ref: row.external_ref,
      occurred_at: row.occurred_at.toISOString(),
    });
  }
  return outcomes;
}

function applyRecommendationOutcomeState(
  items: ProductBriefItem[],
  outcomesByReviewId: Map<string, ProductRecommendationOutcomeState>,
): ProductBriefItem[] {
  return items.map((item) => {
    const outcome = item.review_id ? outcomesByReviewId.get(item.review_id) : null;
    if (!outcome) return item;
    return {
      ...item,
      outcome_id: outcome.outcome_id,
      outcome_kind: outcome.kind,
      outcome_recorded_at: outcome.occurred_at,
      outcome_external_ref: outcome.external_ref,
    };
  });
}

function productBriefItemsLatestActivity(items: ProductBriefItem[]): Date | null {
  const times = items
    .map((item) => item.outcome_recorded_at ?? item.reviewed_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function defaultRecommendationQuality(): ProductRecommendationQuality {
  const empty = (): ProductRecommendationQualityBucket => ({
    total_reviewed: 0,
    accepted: 0,
    ignored: 0,
    acceptance_rate: null,
    last_reviewed_at: null,
  });
  return {
    ...empty(),
    content_opportunity: empty(),
    aeo_gap: empty(),
  };
}

function productRecommendationQualityState(rows: Array<{
  review_kind: ProductRecommendationKind | string | null;
  decision: ProductRecommendationDecision | string;
  occurred_at: Date;
}>): ProductRecommendationQuality {
  const buckets = defaultRecommendationQuality();
  for (const row of rows) {
    if (row.decision !== "accepted" && row.decision !== "ignored") continue;
    if (row.review_kind !== "content_opportunity" && row.review_kind !== "aeo_gap") continue;
    applyRecommendationQualityDecision(buckets, row.decision, row.occurred_at);
    applyRecommendationQualityDecision(buckets[row.review_kind], row.decision, row.occurred_at);
  }
  finalizeRecommendationQualityBucket(buckets);
  finalizeRecommendationQualityBucket(buckets.content_opportunity);
  finalizeRecommendationQualityBucket(buckets.aeo_gap);
  return buckets;
}

function applyRecommendationQualityDecision(
  bucket: ProductRecommendationQualityBucket,
  decision: ProductRecommendationDecision,
  occurred_at: Date,
): void {
  bucket.total_reviewed += 1;
  if (decision === "accepted") bucket.accepted += 1;
  if (decision === "ignored") bucket.ignored += 1;
  const reviewedAt = occurred_at.toISOString();
  if (!bucket.last_reviewed_at || reviewedAt > bucket.last_reviewed_at) {
    bucket.last_reviewed_at = reviewedAt;
  }
}

function finalizeRecommendationQualityBucket(
  bucket: ProductRecommendationQualityBucket,
): void {
  bucket.acceptance_rate = bucket.total_reviewed > 0
    ? Number((bucket.accepted / bucket.total_reviewed).toFixed(2))
    : null;
}

function recommendationFeedbackState(rows: Array<{
  review_id: string;
  review_kind?: ProductRecommendationKind | string | null;
  decision: ProductRecommendationDecision | string;
  note: string | null;
  occurred_at: Date;
}>): Map<string, ProductRecommendationFeedbackState> {
  const feedback = new Map<string, ProductRecommendationFeedbackState>();
  for (const row of rows) {
    if (row.decision !== "accepted" && row.decision !== "ignored") continue;
    feedback.set(row.review_id, {
      decision: row.decision,
      note: row.note,
      occurred_at: row.occurred_at.toISOString(),
    });
  }
  return feedback;
}

function recommendationMutationState(rows: Array<{
  review_id: string;
  event_type: "recommendation.updated" | "recommendation.deleted";
  payload: Record<string, unknown>;
  occurred_at: Date;
}>): Map<string, ProductRecommendationMutationState> {
  const mutations = new Map<string, ProductRecommendationMutationState>();
  for (const row of rows) {
    if (!row.review_id) continue;
    if (row.event_type === "recommendation.deleted") {
      mutations.set(row.review_id, {
        type: "deleted",
        reason: stringStateValue(row.payload.reason),
        occurred_at: row.occurred_at.toISOString(),
      });
      continue;
    }
    const item = recordStateValue(row.payload.item);
    const title = stringStateValue(item?.title);
    if (!title) continue;
    mutations.set(row.review_id, {
      type: "updated",
      item: {
        title,
        detail: stringStateValue(item?.detail) ?? "",
        url: stringStateValue(item?.url),
        evidence_source_ids: arrayStringStateValue(item?.evidence_source_ids),
      },
      note: stringStateValue(row.payload.note),
      occurred_at: row.occurred_at.toISOString(),
    });
  }
  return mutations;
}

interface CampaignOutcomePlayRun {
  play_run_id: string;
  play_id: string;
  play_name: string;
  rep_id: string | null;
  rep_name: string | null;
  output: Record<string, unknown> | null;
  trigger_event_signal_id: string | null;
}

async function findCampaignOutcomePlayRun(
  pool: Pool,
  workspace_id: string,
  play_run_id: string,
): Promise<CampaignOutcomePlayRun | null> {
  const { rows } = await pool.query<CampaignOutcomePlayRun>(
    `select pr.id::text as play_run_id,
            pr.play_id::text as play_id,
            p.name as play_name,
            coalesce(
              run_rep.id,
              default_rep.id,
              campaign_rep.id,
              active_rep.id
            )::text as rep_id,
            coalesce(
              run_rep.name,
              default_rep.name,
              campaign_rep.name,
              active_rep.name
            ) as rep_name,
            pr.output,
            case
              when e.payload->>'signal_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then e.payload->>'signal_id'
              else null
            end as trigger_event_signal_id
       from play_runs pr
       join plays p on p.id = pr.play_id
       left join reps run_rep
         on run_rep.id = pr.rep_id
        and run_rep.workspace_id = pr.workspace_id
       left join reps default_rep
         on default_rep.id = p.default_rep_id
        and default_rep.workspace_id = pr.workspace_id
       left join events e
         on e.id = pr.trigger_event_id
        and e.workspace_id = pr.workspace_id
       left join lateral (
         select id, name
           from reps
          where workspace_id = pr.workspace_id
            and role = 'campaign'
            and status = 'active'
          order by created_at asc
          limit 1
       ) campaign_rep on true
       left join lateral (
         select id, name
           from reps
          where workspace_id = pr.workspace_id
            and status = 'active'
          order by created_at asc
          limit 1
       ) active_rep on true
      where pr.workspace_id = $1
        and pr.id = $2
      limit 1`,
    [workspace_id, play_run_id],
  );
  return rows[0] ?? null;
}

async function findOrSeedCampaignOutcomeAttribution(
  engine: ProductEngine,
  session: ProductWorkspaceSession,
  playRun: CampaignOutcomePlayRun,
  pattern_key: string,
  outcome_kind: ProductCampaignOutcomeKind,
  note: string | null,
): Promise<{ rep_id: string | null; exemplar_ids: string[] }> {
  if (!playRun.rep_id) return { rep_id: null, exemplar_ids: [] };
  const existing = await engine.pool.query<{ id: string }>(
    `select id::text
       from rep_memory_procedural
      where workspace_id = $1
        and rep_id = $2
        and pattern_key = $3
      order by score desc, created_at desc
      limit 3`,
    [session.workspace_id, playRun.rep_id, pattern_key],
  );
  if (existing.rows.length > 0) {
    return {
      rep_id: playRun.rep_id,
      exemplar_ids: existing.rows.map((row) => row.id),
    };
  }

  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "rep.memory.procedural.seeded",
    source: "system",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "rep.memory.procedural.seeded",
      session.workspace_id,
      playRun.play_run_id,
      {
        rep_id: playRun.rep_id,
        pattern_key,
      },
    ),
    payload: {
      exemplar_id: randomUUID(),
      rep_id: playRun.rep_id,
      pattern_key,
      exemplar: buildCampaignOutcomeLearningExemplar({
        play_id: playRun.play_id,
        play_run_id: playRun.play_run_id,
        play_name: playRun.play_name,
        rep_name: playRun.rep_name,
        outcome_kind,
        output: playRun.output,
        note,
      }),
      initial_score: 0.55,
    },
  });
  if (engine.substrateMode === "postgres") {
    await createProceduralMemorySeedProjection(engine.pool).apply(event);
  }
  return {
    rep_id: playRun.rep_id,
    exemplar_ids: [event.payload.exemplar_id],
  };
}

async function findAcceptedRecommendationReview(
  pool: Pool,
  workspace_id: string,
  review_id: string,
): Promise<{
  event_id: string;
  review_kind: ProductRecommendationKind;
  source_event_id: string;
  item: {
    title: string;
    detail: string;
    url: string | null;
    evidence_source_ids: string[];
  };
} | null> {
  const { rows } = await pool.query<{
    event_id: string;
    payload: {
      review_kind?: string;
      source_event_id?: string;
      decision?: string;
      item?: {
        title?: string;
        detail?: string;
        url?: string | null;
        evidence_source_ids?: string[];
      };
    };
  }>(
    `select id::text as event_id, payload
       from events
      where workspace_id = $1
        and event_type = 'recommendation.reviewed'
        and payload->>'review_id' = $2
      order by occurred_at desc
      limit 1`,
    [workspace_id, review_id],
  );
  const row = rows[0];
  const payload = row?.payload;
  if (!row || payload?.decision !== "accepted") return null;
  if (
    payload.review_kind !== "content_opportunity" &&
    payload.review_kind !== "aeo_gap"
  ) {
    return null;
  }
  if (!payload.source_event_id) return null;
  return {
    event_id: row.event_id,
    review_kind: payload.review_kind,
    source_event_id: payload.source_event_id,
    item: {
      title: payload.item?.title ?? "Accepted recommendation",
      detail: payload.item?.detail ?? "",
      url: payload.item?.url ?? null,
      evidence_source_ids: Array.isArray(payload.item?.evidence_source_ids)
        ? payload.item.evidence_source_ids.filter((id): id is string => typeof id === "string")
        : [],
    },
  };
}

async function findOrSeedRecommendationOutcomeAttribution(
  engine: ProductEngine,
  session: ProductWorkspaceSession,
  review_id: string,
  review: {
    review_kind: ProductRecommendationKind;
    source_event_id: string;
    item: {
      title: string;
      detail: string;
      url: string | null;
      evidence_source_ids: string[];
    };
  },
  pattern_key: string,
  outcome_kind: ProductRecommendationOutcomeKind,
  external_ref: string | null,
): Promise<{ rep_id: string | null; exemplar_ids: string[] }> {
  const { rows } = await engine.pool.query<{ rep_id: string; exemplar_id: string | null }>(
    `select r.id::text as rep_id,
            rpm.id::text as exemplar_id
       from reps r
       left join lateral (
         select id
           from rep_memory_procedural
          where workspace_id = r.workspace_id
            and rep_id = r.id
            and pattern_key = $2
          order by score desc, created_at desc
          limit 3
       ) rpm on true
      where r.workspace_id = $1
        and r.status = 'active'
      order by case
                 when $3 = 'content_opportunity' and r.role = 'content' then 0
                 when $3 = 'aeo_gap' and r.role = 'researcher' then 0
                 else 1
               end,
               case when rpm.id is null then 1 else 0 end,
               r.created_at asc`,
    [session.workspace_id, pattern_key, review.review_kind],
  );
  const rep_id = rows[0]?.rep_id ?? null;
  if (!rep_id) return { rep_id: null, exemplar_ids: [] };
  const exemplar_ids = rows
    .filter((row) => row.rep_id === rep_id && row.exemplar_id)
    .map((row) => row.exemplar_id!)
    .slice(0, 3);
  if (exemplar_ids.length > 0) {
    return {
      rep_id,
      exemplar_ids,
    };
  }

  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "rep.memory.procedural.seeded",
    source: "system",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "rep.memory.procedural.seeded",
      session.workspace_id,
      review_id,
      {
        rep_id,
        pattern_key,
        outcome_kind,
      },
    ),
    payload: {
      exemplar_id: randomUUID(),
      rep_id,
      pattern_key,
      exemplar: buildRecommendationOutcomeLearningExemplar({
        review_kind: review.review_kind,
        review_id,
        source_event_id: review.source_event_id,
        outcome_kind,
        item: review.item,
        external_ref,
      }),
      initial_score: 0.55,
    },
  });
  if (engine.substrateMode === "postgres") {
    await createProceduralMemorySeedProjection(engine.pool).apply(event);
  }
  return {
    rep_id,
    exemplar_ids: [event.payload.exemplar_id],
  };
}

function defaultRecommendationOutcomeScore(kind: ProductRecommendationOutcomeKind): number {
  if (kind === "post_published") return 0.55;
  if (kind === "follower_lift") return 0.65;
  return 0.6;
}

function defaultCampaignOutcomeScore(kind: ProductCampaignOutcomeKind): number {
  if (kind === "deal_won") return 1;
  if (kind === "meeting_booked") return 0.85;
  if (kind === "opportunity_created") return 0.75;
  if (kind === "positive_reply") return 0.65;
  if (kind === "engagement_lift") return 0.6;
  return 0.1;
}

function decorateProductReviewItem(
  source_event_id: string,
  eventType: "content.opportunity.discovered" | "aeo.audit.completed",
  item: ProductBriefItem,
  feedbackById: Map<string, ProductRecommendationFeedbackState>,
  mutationsById: Map<string, ProductRecommendationMutationState>,
): ProductBriefItem[] {
  const review_kind = productRecommendationKindForEvent(eventType);
  const review_id = productRecommendationReviewId(source_event_id, review_kind, item);
  const mutation = mutationsById.get(review_id);
  if (mutation?.type === "deleted") return [];
  const feedback = feedbackById.get(review_id);
  if (feedback?.decision === "ignored") return [];
  const effectiveItem = mutation?.type === "updated"
    ? {
        ...item,
        title: mutation.item.title,
        detail: mutation.item.detail,
        url: mutation.item.url,
        evidence_source_ids: mutation.item.evidence_source_ids.length > 0
          ? mutation.item.evidence_source_ids
          : item.evidence_source_ids,
      }
    : item;
  return [{
    ...effectiveItem,
    review_id,
    review_kind,
    source_event_id,
    decision: feedback?.decision,
    reviewed_at: feedback?.occurred_at,
    review_note: feedback?.note ?? (mutation?.type === "updated" ? mutation.note : null),
  }];
}

function productRecommendationKindForEvent(
  eventType: "content.opportunity.discovered" | "aeo.audit.completed",
): ProductRecommendationKind {
  return eventType === "content.opportunity.discovered" ? "content_opportunity" : "aeo_gap";
}

function productRecommendationReviewId(
  source_event_id: string,
  review_kind: ProductRecommendationKind,
  item: ProductBriefItem,
): string {
  const digest = createHash("sha256")
    .update(stableJson({
      title: item.title,
      detail: item.detail,
      url: item.url ?? null,
      evidence_source_ids: item.evidence_source_ids ?? [],
    }))
    .digest("hex")
    .slice(0, 16);
  return `${review_kind}:${source_event_id}:${digest}`;
}

async function findProductRecommendationForReview(
  pool: Pool,
  workspace_id: string,
  review_id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<ProductBriefItem | null> {
  const [reviewEvents, mutationEvents] = await Promise.all([
    pool.query<{
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    occurred_at: Date;
    evidence: Array<{
      id: string;
      url: string | null;
      title: string | null;
      snippet: string | null;
    }>;
  }>(
    `select e.id::text as event_id,
            e.event_type,
            e.payload,
            e.occurred_at,
            coalesce(
              jsonb_agg(
                distinct jsonb_build_object(
                  'id', gs.id::text,
                  'url', gs.config->>'url',
                  'title', coalesce(gs.properties->>'title', gs.name),
                  'snippet', gs.properties->>'snippet'
                )
              ) filter (where gs.id is not null),
              '[]'::jsonb
            ) as evidence
       from events e
       left join lateral jsonb_array_elements_text(
         coalesce(e.payload->'evidence_source_ids', '[]'::jsonb)
       ) evidence_ids(id) on true
       left join graph_sources gs
         on gs.workspace_id = e.workspace_id
        and gs.id::text = evidence_ids.id
      where e.workspace_id = $1
        and e.event_type in ('content.opportunity.discovered', 'aeo.audit.completed')
      group by e.id
      order by e.occurred_at desc
      limit 100`,
    [workspace_id],
    ),
    pool.query<{
      review_id: string;
      event_type: "recommendation.updated" | "recommendation.deleted";
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select distinct on (payload->>'review_id')
              payload->>'review_id' as review_id,
              event_type,
              payload,
              occurred_at
         from events
        where workspace_id = $1
          and event_type in ('recommendation.updated', 'recommendation.deleted')
          and payload->>'review_id' is not null
        order by payload->>'review_id', occurred_at desc`,
      [workspace_id],
    ),
  ]);
  const mutationsById = recommendationMutationState(mutationEvents.rows);
  if (!opts.includeDeleted && mutationsById.get(review_id)?.type === "deleted") {
    return null;
  }
  return [
    ...productExaReviewState(
      reviewEvents.rows,
      "content.opportunity.discovered",
      new Map(),
      mutationsById,
      100,
    ),
    ...productExaReviewState(
      reviewEvents.rows,
      "aeo.audit.completed",
      new Map(),
      mutationsById,
      100,
    ),
  ].find((item) => item.review_id === review_id) ?? null;
}

function briefItemsStateValue(value: unknown): ProductBriefItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordStateValue(item);
    const title = stringStateValue(record?.title);
    if (!record || !title) return [];
    return [{
      title,
      detail: stringStateValue(record.detail) ?? "",
      url: stringStateValue(record.url),
      evidence_source_ids: arrayStringStateValue(record.evidence_source_ids),
    }];
  });
}

function profileEvidenceCardsStateValue(value: unknown): AppState["profile"] extends infer P
  ? P extends { exa_evidence_cards: infer C } ? C : never
  : never {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const card = recordStateValue(item);
    const title = stringStateValue(card?.title);
    const url = stringStateValue(card?.url);
    if (!title || !url) return [];
    return [{
      title,
      url,
      source_domain: stringStateValue(card?.source_domain),
      snippet: stringStateValue(card?.snippet),
      published_at: stringStateValue(card?.published_at),
    }];
  }).slice(0, 8);
}

function recordStateValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayStringStateValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stringStateValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
