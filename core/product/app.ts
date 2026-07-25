import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GraphCompany, GraphPerson, SourceKind } from "../graph/types.ts";
import { grantTrialCredits, TRIAL_CREDIT_GRANT } from "../billing/credits.ts";
import { createTrialReminderProjection } from "../billing/trial-reminders.ts";
import { upsertPerson } from "../graph/nodes/persons.ts";
import {
  addCompanyExplicit,
  upsertTrackedCompany,
  type TrackedCompany,
} from "../ingest/catalog.ts";
import { discoverCompanyOwnedSignalSources } from "../ingest/source-autodiscovery.ts";
import {
  DEFAULT_GOOGLE_NEWS_QUERIES,
  DEFAULT_RSS_FEEDS,
} from "../ingest/default-news-queries.ts";
import type { ExaSearchType } from "../exa/client.ts";
import {
  buildExaSocialSignalQuery,
  exaSocialFreshnessStartDate,
  normalizeExaSocialIntents,
  normalizeExaSocialPlatforms,
  type ExaSocialPlatform,
  type ExaSocialSignalIntent,
} from "../exa/social-signals.ts";
import {
  type IcpPredicateRule,
} from "../ingest/icps.ts";
import { RepRole, type RepRole as RepRoleValue } from "../primitives/rep.ts";
import {
  SignalKind,
  type SignalKind as SignalKindValue,
} from "../primitives/signal.ts";
import type { Signal } from "../primitives/index.ts";
import { deterministicConversationId } from "../primitives/conversation-identity.ts";
import {
  evaluateRelationshipOutreach,
  loadRelationshipOutreachState,
} from "../primitives/conversation-policy.ts";
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
  WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
  WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW,
  WORKSPACE_CHANNEL_READINESS_WORKFLOW,
  WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
  WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW,
  WORKSPACE_CONTACT_WATERFALL_WORKFLOW,
  WORKSPACE_EVAL_GATE_WORKFLOW,
  WORKSPACE_MEETING_PREP_WORKFLOW,
  WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW,
  WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW,
  WORKSPACE_PROFILE_ICP_WORKFLOW,
  WORKSPACE_REPLY_TRIAGE_WORKFLOW,
  WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
  WORKSPACE_SKILL_OPTIMIZER_WORKFLOW,
  WORKSPACE_SOURCE_DISCOVERY_WORKFLOW,
  WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW,
  WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
  type ActivationSetupGraphInput,
  type BombsellLangGraphState,
  type ChannelReadinessGraphInput,
  type CompanyBrainGraphInput,
  type LeadMatchingGraphInput,
  type MeetingPrepGraphInput,
  type ProfileIcpGraphInput,
  type SignalIngestionGraphInput,
} from "../agents/langgraph/index.ts";
import {
  createFallbackJudge,
  createHeuristicJudge,
  evalGate,
  type JudgeInput,
} from "../agents/eval/index.ts";
import {
  createLinkedInWriterRole,
  createResearcherRole,
  createWriterRole,
} from "../agents/reps/index.ts";
import type { ResearchResult } from "../agents/reps/roles/researcher.ts";
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
  createDeepSeekIntentClassifier,
  getOutlookCalendarAvailability,
  handleInboundEmail,
  createOutlookSender,
  createPostgresOwnedDomainEmailChannel,
  createResendEmailTransport,
  type IntentClassifier,
  type EmailTransport,
  type EmailChannel,
  type OutlookCalendarAvailability,
  type OutlookSender,
  type ReplyIntent,
} from "../channels/email/index.ts";
import {
  CONTACT_RESOLUTION_MAX_RETRIES,
  CONTACT_RESOLUTION_RETRY_WORKFLOW,
  CONTACT_RESOLUTION_WORKFLOW,
  createContactResolutionRetryWorkflow,
  createContactResolutionProviders,
  createContactResolutionWorkflow,
  type ContactCandidate,
  type ContactChannel,
  type ContactResolutionInput,
  type ContactResolutionOutput,
  type ContactResolutionRetryInput,
} from "../contacts/index.ts";
import { createChannelAccountLifecycleProjection } from "../channels/account-lifecycle.ts";
import {
  createDryRunLinkedInTransport,
  createHttpLinkedInTransport,
  createLinkedInProviderAuthorizationProjection,
  createPostgresLinkedInChannel,
  resolveLinkedInProviderAuthUrl,
  createUnconfiguredLinkedInTransport,
  type LinkedInChannel,
  type LinkedInChannelName,
  type LinkedInTransport,
} from "../channels/linkedin/index.ts";
import { createMessageLifecycleProjection } from "../channels/message-lifecycle.ts";
export { getWorkspaceActivationState } from "./activation-state.ts";
import { createReplyLifecycleProjection } from "../channels/reply-lifecycle.ts";
import {
  createRssSignalIngestionWorkflow,
  ingestManualSignal,
  RSS_SIGNAL_INGESTION_WORKFLOW,
} from "../signals/index.ts";
import {
  createAccountIntentProjection,
  classifySignal,
  createMockEmbeddingClient,
  createOpenAIEmbeddingClient,
  createWorkspacePollWorkflow,
  discoverWorkspaceSignalOnce,
  projectSignalCompanyLinked,
  projectSignalClassification,
  projectSignalDismissal,
  projectSignalDiscovered,
  projectSignalExpiry,
  repairMatchedSignalCompanyLinksOnce,
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
  type ApprovalPolicy,
  type PlayChannelPolicy,
} from "../plays/autonomy.ts";
import {
  createBudgetedLLMClient,
  createDeepSeekClientFromEnv,
  isLLMBudgetExceededError,
  type LLMClient,
} from "../agents/llm/index.ts";
import {
  normalizePublicHostname,
  normalizePublicHttpUrl,
  publicHostnameFromUrl,
} from "../../lib/network/public-url.ts";
import {
  createDeepSeekJudge,
  isMalformedJudgeResponseError,
} from "../agents/eval/adapters/deepseek-judge.ts";
import type {
  WorkflowRun,
  WorkflowRuntime,
  WorkflowRunStatus,
} from "../substrate/workflows/index.ts";
import {
  createWorkflowApprovalProjection,
  projectWorkflowApprovalDecision,
} from "../substrate/workflows/index.ts";
export { isStaleRestateApprovalResolutionError } from "../substrate/workflows/index.ts";
import { createEmailDeliveryFeedbackProjection } from "./email-feedback.ts";
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
import { getConversationTrustTrace } from "./conversation-trust.ts";
import {
  assessSignalResearchEligibility,
  SIGNAL_RESEARCH_ELIGIBILITY_SQL,
} from "./signal-outreach-eligibility.ts";
import {
  createProductSubstrate,
  type ProductSubstrateMode,
} from "./substrate.ts";
import { excludeLegacySharedDefaultWorkspace } from "../../lib/workspace-selection.ts";
import {
  buildCampaignOutcomeLearningExemplar,
  campaignOutcomePatternKey,
} from "./campaign-learning.ts";
import {
  buildCampaignStrategyRecommendation,
  type CampaignStrategyRecommendation,
  type CampaignOptimizerRecommendation,
  type CampaignOptimizerOutcomeKind,
} from "./campaign-optimizer.ts";
import {
  buildSkillOptimizationPlan,
  type SkillOptimizationPlan,
} from "./skill-optimizer.ts";
import {
  planCampaignDispatchAllocations,
  type CampaignDispatchAllocation,
  type CampaignDispatchCandidate,
  type CampaignDispatchPlan,
  type CampaignDispatchStrategy,
} from "./campaign-allocation.ts";
import {
  createSelectedOutreachSkill,
  outreachSkillProvenance,
  selectOutreachSkill,
  type OutreachSkillChannel,
  type OutreachSkillStage,
  type SelectedOutreachSkill,
} from "../agents/skills/outreach.ts";
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
import {
  buildMeetingPrepNote,
  type MeetingPrepNote,
} from "../meetings/prep.ts";
import {
  loadWorkspaceLaunchReadiness,
  type LaunchReadinessRequiredChannel,
  type WorkspaceLaunchReadiness,
} from "./launch-readiness.ts";
import {
  loadQualifiedSignalWorkbench,
  type QualifiedSignalItem,
} from "./qualified-signals.ts";
import {
  buildVerticalIntelligencePack,
  type VerticalIntelligencePack,
  type VerticalIntelligenceProfileInput,
} from "./vertical-intelligence.ts";
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
  recoverTransientDeadLetterDispatches,
  runDurableEventProjectionsOnce,
  redriveDeadLetteredDispatch,
  type DeadLetteredDispatch,
  type EventBus,
  type EventPayload,
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
const EMAIL_ACCOUNT_CONFIGURATION_PROJECTION =
  "channel.email_account_configuration.v1";
const CONTACT_RESOLUTION_REPAIR_KEY = "restate-step-publish-v1";
const SIGNAL_PLAY_REPAIR_KEY = "restate-step-publish-v1";
const SIGNAL_PLAY_REJUDGE_REPAIR_KEY = "judge-fallback-v1";
const REPAIRABLE_DRAFT_REJECTION_PATTERN =
  "(being an AI|as an AI|AI language model|language model|judge returned non-JSON response)";
const RUNNABLE_WORKFLOW_NAMES = [
  WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
  WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW,
  WORKSPACE_SKILL_OPTIMIZER_WORKFLOW,
  WORKSPACE_CHANNEL_READINESS_WORKFLOW,
  WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
  WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW,
  WORKSPACE_CONTACT_WATERFALL_WORKFLOW,
  WORKSPACE_EVAL_GATE_WORKFLOW,
  WORKSPACE_MEETING_PREP_WORKFLOW,
  WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW,
  WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW,
  WORKSPACE_PROFILE_ICP_WORKFLOW,
  WORKSPACE_REPLY_TRIAGE_WORKFLOW,
  WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
  WORKSPACE_SOURCE_DISCOVERY_WORKFLOW,
  WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW,
  WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
  CONTACT_RESOLUTION_WORKFLOW,
  CONTACT_RESOLUTION_RETRY_WORKFLOW,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  RSS_SIGNAL_INGESTION_WORKFLOW,
  WORKSPACE_POLL_WORKFLOW,
  SENDING_DOMAIN_PROVISIONING_WORKFLOW,
  SENDING_DOMAIN_WARMUP_WORKFLOW,
  "content.opportunity.exa",
  "aeo.audit.exa",
] as const;
const EXA_CONTENT_OPPORTUNITY_WORKFLOW_NAME = "content.opportunity.exa";
const EXA_AEO_AUDIT_WORKFLOW_NAME = "aeo.audit.exa";
const DEFAULT_RECOMMENDATION_RESEARCH_CADENCE_MS = 24 * 60 * 60 * 1000;
type WorkspaceRoleValue = "owner" | "admin" | "member";
type ProductEmailTransport = "resend" | "dry-run" | "unconfigured";
const DEFAULT_WORKSPACE_AUTONOMY_MODE: WorkspaceAutonomyMode = "autonomous";
const DEFAULT_CHANNEL_APPROVAL: ApprovalPolicy = "none";

function defaultWorkspaceSettings(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    autonomy_mode: DEFAULT_WORKSPACE_AUTONOMY_MODE,
    default_channel_approval: DEFAULT_CHANNEL_APPROVAL,
  };
}

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
    key: "outbound",
    name: "Outbound agent",
    role: "sdr",
    channels: ["email"],
    persona: {
      voice: "Warm, precise, low-hype, founder-to-founder.",
      story: "Owns outreach from fresh market signals to useful conversations.",
      kpis: ["positive replies", "meetings booked"],
      do_not: ["Do not mention being an AI.", "Do not overpromise."],
      samples: [
        "Saw the launch. The timing feels worth a quick compare-notes conversation.",
      ],
    },
    autonomy: {
      channels: { email: { daily_cap: 25, approval: "none" } },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type WorkspaceSignalSourceAdapter =
  | "rss"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "sec_edgar"
  | "google_news"
  | "hn_front"
  | "hn_whos_hiring"
  | "product_hunt"
  | "reddit"
  | "exa"
  | "x_search"
  | "webhook";

const verifiedProductWorkspaceAccess: unique symbol = Symbol(
  "verifiedProductWorkspaceAccess",
);

export interface ProductWorkspaceSession {
  workspace_id: string;
  user_id: string;
  readonly [verifiedProductWorkspaceAccess]?: true;
}

export function verifiedProductWorkspaceSession(
  session: Pick<ProductWorkspaceSession, "workspace_id" | "user_id">,
): ProductWorkspaceSession {
  return {
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    [verifiedProductWorkspaceAccess]: true,
  };
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

export interface ConfigureCrmDestinationInput {
  provider: string;
  display_name?: string;
  webhook_url?: string | null;
  sync_mode?: "qualified_contacts" | "qualified_and_sent" | "full_loop";
  include_sent_outreach?: boolean;
  include_replies_meetings?: boolean;
}

export interface QueueCrmHandoffInput {
  limit?: number;
  confirm_queue?: boolean;
}

export interface CrmHandoffRecord {
  signal_id: string;
  signal_kind: string;
  signal_title: string;
  match_score: number | null;
  match_reason: string | null;
  company: {
    company_id: string | null;
    name: string | null;
    domain: string | null;
    industry: string | null;
  };
  contact: {
    person_id: string;
    full_name: string;
    title: string | null;
    email: string | null;
    email_verified: boolean;
    email_status: string | null;
    linkedin_url: string | null;
    linkedin_ready: boolean;
    contact_fit_decision: "fit" | "unsure" | "not_fit" | null;
  };
  outreach: {
    conversation_id: string;
    message_id: string;
    channel: string;
    status: string;
    eval_score: number | null;
    eval_passed: boolean | null;
    sent_at: string | null;
  } | null;
  outcomes: Array<{
    outcome_id: string;
    kind: string;
    score: number;
    occurred_at: string;
  }>;
}

export interface QueueCrmHandoffResult {
  workspace_id: string;
  handoff_id: string;
  channel_account_id: string;
  provider: string;
  sync_mode: "qualified_contacts" | "qualified_and_sent" | "full_loop";
  queued_records: number;
  skipped_records: number;
  event_id: string;
  records: CrmHandoffRecord[];
  delivery: {
    status: "delivered" | "failed" | "not_configured";
    event_id: string | null;
    status_code: number | null;
    error: string | null;
    webhook_url_configured: boolean;
  };
  next_action: {
    label: string;
    detail: string;
    href: string;
  };
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

export interface UpdateIcpTextInput {
  icp_id?: string;
  name?: string;
  description?: string;
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

export interface OutlookCalendarConnectIntent {
  workspace_id: string;
  connect_url: string;
  provider_configured: boolean;
  scope: "Calendars.ReadBasic";
}

export interface ConfigureActivationInput {
  rep: ConfigureRepInput;
  icp: ConfigureIcpInput;
  play?: Partial<Omit<ConfigureSignalEmailPlayInput, "rep_id">>;
  email?: ConfigureEmailInput;
  company?: TrackCompanyInput;
  source?: ConfigureRssSourceInput;
}

export type WorkspaceAutonomyMode = "autonomous" | "review_only";

export interface ConfigureWorkspaceAutonomyModeInput {
  mode: WorkspaceAutonomyMode;
}

export interface ConfigureWorkspaceAutonomyModeResult {
  workspace_id: string;
  mode: WorkspaceAutonomyMode;
  approval: ApprovalPolicy;
  rep_count: number;
  play_count: number;
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
  board_slug?: string;
  company_name?: string;
  company_domain?: string;
  website_url?: string;
  industry?: string;
  size_bucket?: string;
  sec_cik?: string;
  source_tier?: string;
  source_authority?: number;
  source_reason?: string;
  signal_kind?: string;
  url?: string;
  query?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  search_type?: ExaSearchType;
  category?: string;
  start_published_date?: string;
  platforms?: ExaSocialPlatform[];
  intent_presets?: ExaSocialSignalIntent[];
  subreddit?: string;
  limit?: number;
  max_daily_items?: number;
  max_daily_calls?: number;
  monthly_spend_cap_usd?: number;
  bypass_icp_filter?: boolean;
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

export interface MatchWorkspaceSignalInput {
  signal_id: string;
}

export interface MatchWorkspaceSignalOptions {
  correlation_id?: string | null;
  causation_id?: string | null;
  producerRef?: string;
}

export interface MatchWorkspaceSignalResult {
  workspace_id: string;
  signal_id: string;
  status: "matched" | "dismissed" | "skipped";
  kind: SignalKindValue | null;
  matched_icp_ids: string[];
  match_score: number | null;
  match_reason: string | null;
  matches: Array<{ icp_segment: string; match_score: number; reason: string }>;
  skip_reason:
    | "no_icps"
    | "budget"
    | "not_found"
    | "non_json"
    | "filtered"
    | null;
}

export interface ConfigureWorkspaceProfileInput {
  company_name: string;
  website_url: string;
  industry?: string | null;
  size_bucket?: string | null;
  description?: string | null;
  value_proposition?: string | null;
  customer_pain_points?: string | null;
  target_titles?: string | null;
  target_markets?: string | null;
  key_features?: string | null;
  social_proof?: string | null;
  signal_keywords?: string | null;
  competitor_watchlist?: string | null;
  linkedin_signal_behaviors?: string | null;
  exclusion_rules?: string | null;
  preferred_language?: string | null;
  outreach_goal?: string | null;
  message_tone?: string | null;
  linkedin_company_url?: string | null;
  auto_enrich_email_addresses?: boolean;
  prevent_team_contact_duplication?: boolean;
  profile_source?: "manual" | "firecrawl" | "fallback";
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

export type ProductRecommendationDraftChannel =
  | "x_post"
  | "linkedin_comment"
  | "web"
  | "other";

export interface ProductRecommendationDraftInput {
  review_id: string;
  channel?: ProductRecommendationDraftChannel;
}

export interface ProductRecommendationDraftResult {
  workspace_id: string;
  review_id: string;
  conversation_id: string;
  message_id: string;
  channel: ProductRecommendationDraftChannel;
  attributed_rep_id: string;
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

export interface ProductCampaignStrategyInput {
  lookback_days?: number;
  min_samples?: number;
}

export interface ProductCampaignStrategyResult extends CampaignStrategyRecommendation {
  recommendation_id: string;
}

export interface ProductSkillOptimizerInput {
  lookback_days?: number;
  min_samples?: number;
}

export interface ProductSkillOptimizerResult extends SkillOptimizationPlan {
  recommendation_id: string;
}

export interface ProductMessagePersonalizationInput {
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id?: string | null;
  channel?: OutreachSkillChannel;
  stage?: OutreachSkillStage;
  play_id?: string | null;
  play_run_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  use_llm?: boolean;
}

export interface ProductMessagePersonalizationResult {
  workspace_id: string;
  conversation_id: string | null;
  message_id: string;
  channel: OutreachSkillChannel;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id: string | null;
  subject: string | null;
  body: string;
  pattern_key: string;
  seed_pattern_key: string | null;
  skill_key: string;
  skill_version: string;
  exemplar_ids: string[];
  procedural_exemplar_count: number;
  personalization_context_markdown: string;
  provenance: Record<string, unknown>;
  llm_used: boolean;
  next_action: "run_eval_gate";
}

export type ProductDraftEvalArtifactKind = JudgeInput["artifact"]["kind"];
export type ProductDraftEvalSkillContext = NonNullable<
  NonNullable<JudgeInput["context"]>["outreach_skill"]
>;

export interface ProductDraftEvalInput {
  message_id: string;
  rep_id: string;
  channel: string;
  body: string;
  subject?: string | null;
  artifact_kind?: ProductDraftEvalArtifactKind;
  signal_summary?: string | null;
  counterparty_summary?: string | null;
  personalization_context_markdown?: string | null;
  workspace_context_markdown?: string | null;
  outreach_skill?: ProductDraftEvalSkillContext | null;
}

export interface ProductDraftEvalResult {
  workspace_id: string;
  message_id: string;
  rep_id: string;
  channel: string;
  decision: "pass" | "reject";
  eval_score: number;
  threshold: number;
  passed: boolean;
  notes: Record<string, unknown>;
  judged_event_id: string;
  rejected_event_id: string | null;
  rejection_reason: string | null;
  next_action: "continue_to_play_gate" | "revise_draft";
}

export interface ProductReplyTriageInput {
  channel?: "email";
  external_id: string;
  external_thread_id?: string | null;
  in_reply_to?: string | null;
  references?: string[];
  from_email: string;
  from_name?: string | null;
  subject: string;
  body_text: string;
  body_html?: string | null;
  received_at: string;
  channel_account_id?: string | null;
  ingress_event_id?: string | null;
}

export interface ProductReplyTriageResult {
  workspace_id: string;
  channel: "email";
  matched_conversation_id: string | null;
  inbound_message_id: string | null;
  intent: ReplyIntent | null;
  intent_confidence: number | null;
  outcome_id: string | null;
  next_action:
    | "generate_meeting_prep"
    | "draft_reply"
    | "block_contact"
    | "stop"
    | "review_unmatched";
}

export interface ProductMeetingPrepInput {
  conversation_id: string;
}

export interface ProductMeetingPrepResult extends MeetingPrepNote {
  workspace_id: string;
  meeting_prep_id: string;
}

export interface ProductLaunchReadinessInput {
  required_channel?: LaunchReadinessRequiredChannel;
}

export type ProductLaunchReadinessResult = WorkspaceLaunchReadiness;

export interface ProductVerticalIntelligenceInput {
  company_id?: string | null;
}

export type ProductVerticalIntelligenceResult = VerticalIntelligencePack;

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
  query?: string;
  source_name?: string;
  company_name?: string;
  industry?: string | null;
  signal_keywords?: string | null;
  competitor_watchlist?: string | null;
  linkedin_signal_behaviors?: string | null;
  signal_kind?: string;
  platforms?: ExaSocialPlatform[];
  intent_presets?: ExaSocialSignalIntent[];
  include_domains?: string[];
  exclude_domains?: string[];
  search_type?: ExaSearchType;
  category?: string;
  freshness_days?: number;
  limit?: number;
  max_daily_items?: number;
  max_daily_calls?: number;
  monthly_spend_cap_usd?: number;
  bypass_icp_filter?: boolean;
  enabled?: boolean;
}

export interface ProductExaSocialSignalPackInput {
  company_name: string;
  industry?: string | null;
  description?: string | null;
  signal_keywords?: string | null;
  competitor_watchlist?: string | null;
  linkedin_signal_behaviors?: string | null;
  platforms?: ExaSocialPlatform[];
  freshness_days?: number;
  limit?: number;
  max_daily_items?: number;
  max_daily_calls?: number;
  monthly_spend_cap_usd?: number;
  enabled?: boolean;
}

export interface ProductExaSocialSignalPackResult {
  workspace_id: string;
  source_count: number;
  sources: Array<{
    source_id: string;
    name: string;
    signal_kind: string;
  }>;
}

export interface SubmittedSignalResult {
  signal_id: string;
  workspace_id: string;
}

export interface DispatchOptions {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
  signal_id?: string;
  play_id?: string;
}

export interface WorkspaceSourcePollRunNowInput {
  source_id: string;
}

export interface WorkspaceSourcePollRunNowResult {
  workspace_id: string;
  source_id: string;
  workflow_name: typeof WORKSPACE_POLL_WORKFLOW;
  workflow_run_id: string;
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
  company_size?: string | null;
  description: string | null;
  value_proposition?: string | null;
  customer_pain_points?: string | null;
  target_titles?: string | null;
  target_markets?: string | null;
  key_features?: string | null;
  social_proof?: string | null;
  signal_keywords?: string | null;
  competitor_watchlist?: string | null;
  linkedin_signal_behaviors?: string | null;
  exclusion_rules?: string | null;
  preferred_language?: string | null;
  outreach_goal?: string | null;
  message_tone?: string | null;
  linkedin_company_url?: string | null;
  auto_enrich_email_addresses?: boolean;
  prevent_team_contact_duplication?: boolean;
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

export interface ProductOperatingBrief {
  workspace_id: string;
  generated_at: string;
  windows: {
    last_24h: {
      qualified_signals: number;
      emails_sent: number;
      linkedin_dms_sent: number;
      replies: number;
      meetings: number;
    };
    last_7d: {
      qualified_signals: number;
      emails_sent: number;
      linkedin_dms_sent: number;
      replies: number;
      meetings: number;
      useful_outcomes: number;
    };
  };
  operations: {
    pending_reviews: number;
    unhealthy_channels: number;
    bounced_24h: number;
  };
  channel_readiness: {
    email_connected: boolean;
    linkedin_connected: boolean;
    connected_count: number;
  };
  signal_types: Array<{
    kind: string;
    count_24h: number;
    count_7d: number;
    with_contacts_7d: number;
    with_drafts_7d: number;
  }>;
  next_action: {
    key:
      | "review_drafts"
      | "repair_channels"
      | "connect_accounts"
      | "prepare_outreach"
      | "open_agent";
    label: string;
    detail: string;
    href: string;
  };
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
  messages: Awaited<
    ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>
  >["messages"];
  outcomes: Awaited<
    ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>
  >["outcomes"];
  conversations: Awaited<
    ReturnType<ReturnType<typeof createPostgresVerticalSliceStore>["snapshot"]>
  >["conversations"];
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
    await engine.runtime.drain?.();
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
        JSON.stringify(defaultWorkspaceSettings({ mode: "local-product" })),
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
        settings: defaultWorkspaceSettings({ mode: "local-product" }),
        owner_role: "owner",
      },
    });
    await projectWorkspaceCreated(engine, event);
  } else if (ensureMembership) {
    await ensureWorkspaceMembership(engine, ws, user_id, "owner");
  }

  const rep = await ensureRep(engine, ws, user_id);
  const play = await ensurePlay(engine, ws, rep.id, user_id);
  const trustedDemoState = !isProductionProductRuntime();
  const account = await ensureChannelAccount(
    engine,
    ws,
    trustedDemoState,
    user_id,
  );
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
  if (session[verifiedProductWorkspaceAccess]) return;
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
       and ${excludeLegacySharedDefaultWorkspace("w", "wm")}
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
  opts: { workspace_id?: string } = {},
): Promise<ProductWorkspace> {
  const name = input.name.trim() || "Bombsell Workspace";
  const baseSlug = slugifyWorkspace(input.slug || name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = opts.workspace_id ?? randomUUID();
    try {
      const { rows } = await pool.query<ProductWorkspace>(
        `insert into workspaces (id, slug, name, settings)
         values ($1, $2, $3, $4::jsonb)
         on conflict (id) do nothing
         returning id, slug::text as slug, name`,
        [
          id,
          slug,
          name,
          JSON.stringify(
            defaultWorkspaceSettings({
              mode: "product-activation",
              activated_from: "dashboard",
            }),
          ),
        ],
      );
      const workspace = rows[0] ?? (
        await pool.query<ProductWorkspace>(
          `select id, slug::text as slug, name
             from workspaces
            where id = $1
            limit 1`,
          [id],
        )
      ).rows[0];
      if (!workspace) {
        throw new Error(`Workspace ${id} was not available after creation.`);
      }

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
          settings: defaultWorkspaceSettings({
            mode: "product-activation",
            activated_from: "dashboard",
          }),
          owner_role: "owner",
        },
      });
      await projectWorkspaceCreated(engine, event);
      return workspace;
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

export async function getOrCreateProductWorkspaceForUser(
  input: { name: string; slug?: string },
  user_id: string,
  pool = getPool(),
): Promise<ProductWorkspace> {
  const existingId = await findFirstProductWorkspaceForUser(user_id, pool);
  if (existingId) {
    const { rows } = await pool.query<ProductWorkspace>(
      `select id, slug::text as slug, name
         from workspaces
        where id = $1
        limit 1`,
      [existingId],
    );
    if (rows[0]) return rows[0];
  }

  const { rows } = await pool.query<{ generation: string }>(
    `select count(*)::text as generation
       from workspace_members wm
       join workspaces w on w.id = wm.workspace_id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is not null`,
    [user_id],
  );
  const generation = Number(rows[0]?.generation ?? 0);
  return createProductWorkspaceForUser(input, user_id, pool, {
    workspace_id: onboardingWorkspaceId(user_id, generation),
  });
}

function onboardingWorkspaceId(userId: string, generation: number): string {
  const bytes = createHash("sha256")
    .update(`bombsell:onboarding-workspace:v1:${userId}:${generation}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function projectWorkspaceCreated(
  engine: Pick<ProductEngine, "pool" | "bus">,
  event: PublishedEvent,
): Promise<void> {
  const { pool, bus } = engine;
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
  // Provision the trial credit allotment. Idempotent — a replayed
  // workspace.created does not re-grant.
  const granted = await grantTrialCredits(pool, payload.workspace_id);
  if (granted) {
    await bus.publish({
      workspace_id: payload.workspace_id,
      event_type: "workspace.trial.granted",
      source: "system",
      producer_ref: "product.workspace.created",
      idempotency_key: `workspace.trial.granted:${payload.workspace_id}`,
      payload: {
        workspace_id: payload.workspace_id,
        credits_granted: TRIAL_CREDIT_GRANT,
        credits_remaining: TRIAL_CREDIT_GRANT,
        credits_total: TRIAL_CREDIT_GRANT,
      },
    });
  }
}

async function projectWorkspaceConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    workspace_id: string;
    settings: Record<string, unknown>;
  };
  await pool.query(
    `update workspaces
        set settings = settings || $2::jsonb
      where id = $1`,
    [payload.workspace_id, JSON.stringify(payload.settings)],
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
    deps.applyMembership ??
    ((event: PublishedEvent) => projectWorkspaceMemberAccepted(pool, event));

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
        and ${excludeLegacySharedDefaultWorkspace("w", "wm")}
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
  return { id: team.outbound };
}

async function ensureDefaultRepTeam(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
): Promise<Record<"outbound", string>> {
  const ids: Partial<Record<"outbound", string>> = {};
  for (const profile of DEFAULT_REP_TEAM) {
    ids[profile.key as keyof typeof ids] = await ensureDefaultRep(
      engine,
      workspace_id,
      user_id,
      profile,
    );
  }
  return {
    outbound: ids.outbound!,
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
        channels: { email: { daily_cap: 25, approval: "none" } },
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
    await ensureEmailDomainProjection(
      engine,
      workspace_id,
      existing,
      trustedDemoState,
      user_id,
    );
    return existing;
  }
  const id = randomUUID();
  const display_name = trustedDemoState
    ? "outbound@go.bombsell.example"
    : "Email channel not configured";
  const payload = {
    channel_account_id: id,
    kind: "email_domain" as const,
    display_name,
    daily_cap: trustedDemoState ? 25 : 0,
    transport: trustedDemoState
      ? ("dry-run" as const)
      : ("unconfigured" as const),
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
    daily_cap: Math.max(
      0,
      Math.trunc(account.daily_cap ?? (trustedDemoState ? 25 : 0)),
    ),
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
  if (
    transport === "resend" ||
    transport === "dry-run" ||
    transport === "unconfigured"
  ) {
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
        managed_by: trustedDemoState
          ? "local-product-bootstrap"
          : "product-surface",
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
    body: "Congrats on the raise. Usually this is when pipeline quality starts mattering more than raw volume.",
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
    idempotency_key: `bootstrap:rep.memory.procedural.seeded:${workspace_id}:${rep_id}:${pattern_key}`,
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
  const name = input.name.trim() || "Outbound agent";
  const role = parseRepRole(input.role);
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 25));
  const approval =
    parseApprovalPolicy(input.approval) ??
    (await getWorkspaceDefaultApproval(engine.pool, session.workspace_id));
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

async function getWorkspaceDefaultApproval(
  pool: Pool,
  workspace_id: string,
): Promise<ApprovalPolicy> {
  const { rows } = await pool.query<{ approval: string | null }>(
    `select settings->>'default_channel_approval' as approval
       from workspaces
      where id = $1`,
    [workspace_id],
  );
  return parseApprovalPolicy(rows[0]?.approval) ?? DEFAULT_CHANNEL_APPROVAL;
}

function parseWorkspaceAutonomyMode(value: unknown): WorkspaceAutonomyMode {
  return value === "review_only"
    ? "review_only"
    : DEFAULT_WORKSPACE_AUTONOMY_MODE;
}

function workspaceAutonomyApproval(
  mode: WorkspaceAutonomyMode,
): ApprovalPolicy {
  return mode === "review_only" ? "always" : DEFAULT_CHANNEL_APPROVAL;
}

function channelNamesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (channel): channel is string =>
      typeof channel === "string" && channel.trim().length > 0,
  );
}

function compiledChannelNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const channel = value.channel;
  return typeof channel === "string" && channel.trim() ? [channel.trim()] : [];
}

function defaultDailyCapForChannel(channel: string): number {
  if (channel.startsWith("linkedin")) return 10;
  if (channel === "content" || channel === "aeo") return 3;
  return 25;
}

function nonnegativeChannelDailyCap(value: unknown, fallback: number): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.trunc(numeric)
    : fallback;
}

function retuneAutonomyApproval(
  value: unknown,
  approval: ApprovalPolicy,
  fallbackChannels: readonly string[] = [],
): Record<string, unknown> {
  const autonomy = isRecord(value) ? value : {};
  const existingChannels = isRecord(autonomy.channels) ? autonomy.channels : {};
  const channelNames = new Set<string>([
    ...Object.keys(existingChannels),
    ...fallbackChannels.filter(Boolean),
  ]);
  const channels: Record<string, unknown> = {};
  for (const channel of channelNames) {
    const existing = isRecord(existingChannels[channel])
      ? existingChannels[channel]
      : {};
    channels[channel] = {
      ...existing,
      daily_cap: nonnegativeChannelDailyCap(
        existing.daily_cap,
        defaultDailyCapForChannel(channel),
      ),
      approval,
    };
  }
  return {
    ...autonomy,
    channels,
    global: isRecord(autonomy.global) ? autonomy.global : {},
  };
}

export async function configureWorkspaceAutonomyMode(
  input: ConfigureWorkspaceAutonomyModeInput,
  session: ProductWorkspaceSession,
): Promise<ConfigureWorkspaceAutonomyModeResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const mode = parseWorkspaceAutonomyMode(input.mode);
  const approval = workspaceAutonomyApproval(mode);
  const settings = {
    autonomy_mode: mode,
    default_channel_approval: approval,
  };
  const workspacePayload = {
    workspace_id: session.workspace_id,
    settings,
  };
  const workspaceEvent = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.configured",
      session.workspace_id,
      session.workspace_id,
      workspacePayload,
    ),
    payload: workspacePayload,
  });
  await projectWorkspaceConfigured(engine.pool, workspaceEvent);

  const [reps, plays] = await Promise.all([
    engine.pool.query<{
      id: string;
      name: string;
      role: RepRoleValue;
      status: "draft" | "active" | "paused";
      persona: Record<string, unknown>;
      channels: string[] | null;
      autonomy: Record<string, unknown> | null;
    }>(
      `select id,
              name,
              role::text as role,
              status::text as status,
              persona,
              channels,
              autonomy
         from reps
        where workspace_id = $1
          and status <> 'retired'
        order by created_at asc`,
      [session.workspace_id],
    ),
    engine.pool.query<{
      id: string;
      name: string;
      declaration: string;
      compiled: Record<string, unknown> | null;
      autonomy: Record<string, unknown> | null;
      default_rep_id: string | null;
      status: "draft" | "active" | "paused" | "archived";
      version: number;
    }>(
      `select id,
              name,
              declaration,
              compiled,
              autonomy,
              default_rep_id,
              status::text as status,
              version
         from plays
        where workspace_id = $1
          and status in ('draft', 'active', 'paused', 'archived')
        order by created_at asc`,
      [session.workspace_id],
    ),
  ]);

  let rep_count = 0;
  for (const row of reps.rows) {
    const channels = channelNamesFrom(row.channels);
    const payload = {
      rep_id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      persona: row.persona ?? {},
      channels,
      autonomy: retuneAutonomyApproval(row.autonomy, approval, channels),
    };
    const event = await engine.bus.publish({
      workspace_id: session.workspace_id,
      event_type: "rep.configured",
      source: "user",
      producer_ref: session.user_id,
      idempotency_key: configurationEventKey(
        "rep.configured",
        session.workspace_id,
        row.id,
        payload,
      ),
      payload,
    });
    await projectRepConfigured(engine.pool, event);
    rep_count++;
  }

  let play_count = 0;
  for (const row of plays.rows) {
    const fallbackChannels = compiledChannelNames(row.compiled);
    const payload = {
      play_id: row.id,
      name: row.name,
      declaration: row.declaration,
      compiled: row.compiled ?? {},
      autonomy: retuneAutonomyApproval(
        row.autonomy,
        approval,
        fallbackChannels,
      ),
      default_rep_id: row.default_rep_id,
      status: row.status,
      version: row.version,
    };
    const event = await engine.bus.publish({
      workspace_id: session.workspace_id,
      event_type: "play.configured",
      source: "user",
      producer_ref: session.user_id,
      idempotency_key: configurationEventKey(
        "play.configured",
        session.workspace_id,
        row.id,
        payload,
      ),
      payload,
    });
    await projectPlayConfigured(engine.pool, event);
    play_count++;
  }

  return {
    workspace_id: session.workspace_id,
    mode,
    approval,
    rep_count,
    play_count,
  };
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

export async function updateIcpText(
  input: UpdateIcpTextInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; icp_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    id: string;
    name: string;
    description: string;
    updated_at: Date;
  }>(
    `select id, name, description, updated_at from workspace_icps
      where workspace_id = $1
        and ($2::uuid is null or id = $2)
      order by created_at asc
      limit 1`,
    [session.workspace_id, input.icp_id ?? null],
  );
  const existing = rows[0];
  if (!existing) throw new Error("workspace ICP not found");
  const name = input.name?.trim() || undefined;
  const description = input.description?.trim() || undefined;
  if (!name && !description) throw new Error("ICP name or description required");
  if (
    (name === undefined || name === existing.name) &&
    (description === undefined || description === existing.description)
  ) {
    return { workspace_id: session.workspace_id, icp_id: existing.id };
  }
  const payload = {
    icp_id: existing.id,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.icp.text_updated",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.icp.text_updated",
      session.workspace_id,
      existing.id,
      { ...payload, previous_updated_at: existing.updated_at.toISOString() },
    ),
    payload,
  });
  await projectIcpTextUpdated(engine.pool, event);
  return { workspace_id: session.workspace_id, icp_id: existing.id };
}

export async function captureWorkspaceOwnerEmail(
  email: string,
  session: ProductWorkspaceSession,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{ owner_email: string | null }>(
    `select nullif(trim(settings->>'owner_email'), '') as owner_email
       from workspaces where id = $1`,
    [session.workspace_id],
  );
  if (rows[0]?.owner_email?.toLowerCase() === normalized) return;
  const payload = {
    workspace_id: session.workspace_id,
    settings: { owner_email: normalized },
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "workspace.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "workspace.configured",
      session.workspace_id,
      `owner-email:${normalized}`,
      payload,
    ),
    payload,
  });
  await projectWorkspaceConfigured(engine.pool, event);
}

async function projectIcpConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    icp_id: string;
    name: string;
    description: string;
    must_haves: IcpPredicateRule[];
    nice_to_haves: string[];
    match_threshold: number;
    enabled: boolean;
  };
  const result = await pool.query(
    `insert into workspace_icps (
       id, workspace_id, name, description, must_haves, nice_to_haves,
       match_threshold, enabled
     ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
     on conflict (id) do update
       set name = excluded.name,
           description = excluded.description,
           must_haves = excluded.must_haves,
           nice_to_haves = excluded.nice_to_haves,
           match_threshold = excluded.match_threshold,
           enabled = excluded.enabled,
           updated_at = now()
     where workspace_icps.workspace_id = excluded.workspace_id`,
    [
      payload.icp_id,
      event.workspace_id,
      payload.name,
      payload.description,
      JSON.stringify(payload.must_haves),
      JSON.stringify(payload.nice_to_haves),
      payload.match_threshold,
      payload.enabled,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`ICP workspace mismatch: ${payload.icp_id}`);
  }
}

async function projectIcpTextUpdated(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    icp_id: string;
    name?: string;
    description?: string;
  };
  const result = await pool.query(
    `update workspace_icps
        set name = coalesce($3, name),
            description = coalesce($4, description),
            updated_at = now()
      where workspace_id = $1 and id = $2`,
    [
      event.workspace_id,
      payload.icp_id,
      payload.name ?? null,
      payload.description ?? null,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`ICP not found: ${payload.icp_id}`);
  }
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
    size_bucket: blankToNull(input.size_bucket ?? undefined),
    description: blankToNull(input.description ?? undefined),
    value_proposition: blankToNull(input.value_proposition ?? undefined),
    customer_pain_points: blankToNull(input.customer_pain_points ?? undefined),
    target_titles: blankToNull(input.target_titles ?? undefined),
    target_markets: blankToNull(input.target_markets ?? undefined),
    key_features: blankToNull(input.key_features ?? undefined),
    social_proof: blankToNull(input.social_proof ?? undefined),
    signal_keywords: blankToNull(input.signal_keywords ?? undefined),
    competitor_watchlist: blankToNull(input.competitor_watchlist ?? undefined),
    linkedin_signal_behaviors: blankToNull(
      input.linkedin_signal_behaviors ?? undefined,
    ),
    exclusion_rules: blankToNull(input.exclusion_rules ?? undefined),
    preferred_language: blankToNull(input.preferred_language ?? undefined),
    outreach_goal: blankToNull(input.outreach_goal ?? undefined),
    message_tone: blankToNull(input.message_tone ?? undefined),
    linkedin_company_url: blankToNull(input.linkedin_company_url ?? undefined),
    auto_enrich_email_addresses: input.auto_enrich_email_addresses ?? true,
    prevent_team_contact_duplication:
      input.prevent_team_contact_duplication ?? true,
    profile_source: input.profile_source ?? "manual",
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
  const websiteUrl = input.website_url
    ? normalizeWebsiteUrl(input.website_url)
    : null;
  const domain = websiteUrl ? domainFromWebsiteUrl(websiteUrl) : null;
  const companyName =
    input.company_name.trim() ||
    (domain ? titleizeDomain(domain) : "Workspace company");
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
  const maxPerQuery = Math.max(
    2,
    Math.min(5, Math.trunc(input.max_results ?? 8)),
  );
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
  const deduped = dedupeExaResults(results).slice(
    0,
    Math.max(3, Math.min(18, input.max_results ?? 12)),
  );
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
      {
        query: profileQuery,
        intent: "profile_bootstrap",
        request_ids: requestIds,
      },
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
      {
        query: profileQuery,
        intent: "profile_bootstrap",
        sources: projected.sources.map((source) => source.id),
      },
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
  const { createExaProfileBootstrapWorkflow, EXA_PROFILE_BOOTSTRAP_WORKFLOW } =
    await import("../exa/workflows.ts");
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
): Promise<{
  workspace_id: string;
  workflow_run_id: string;
  workflow_name: string;
}> {
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
  return {
    workspace_id: session.workspace_id,
    workflow_run_id: run.id,
    workflow_name,
  };
}

export async function startWorkspaceBriefRefreshWithExa(
  input: ProductExaBriefRefreshInput,
  session: ProductWorkspaceSession,
): Promise<{
  workspace_id: string;
  workflow_run_id: string;
  workflow_name: string;
}> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const { createExaBriefRefreshWorkflow, EXA_BRIEF_REFRESH_WORKFLOW } =
    await import("../exa/workflows.ts");
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
    .update(
      `${input.query?.trim() ?? "auto"}:${new Date().toISOString().slice(0, 10)}`,
    )
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
  const context = await loadBriefRefreshContext(
    engine.pool,
    session.workspace_id,
  );
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
      {
        query,
        intent: "brief_refresh",
        evidence_source_ids: evidenceSourceIds,
      },
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
  const reviewPayload = buildExaResearchReviewPayload(
    intent,
    response.results,
    evidenceSourceIds,
  );
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
      score: clamp01(
        input.score ?? defaultRecommendationOutcomeScore(input.kind),
      ),
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

export async function draftProductRecommendation(
  input: ProductRecommendationDraftInput,
  session: ProductWorkspaceSession,
): Promise<ProductRecommendationDraftResult> {
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
  const repId = await findRecommendationRepForKind(
    engine.pool,
    session.workspace_id,
    review.review_kind,
  );
  if (!repId)
    throw new Error("No active Rep is available to draft this recommendation.");

  const channel =
    input.channel ?? defaultRecommendationDraftChannel(review.review_kind);
  const target = await ensureRecommendationDraftTarget(
    engine.pool,
    session.workspace_id,
  );
  const openedAt = new Date().toISOString();
  const conversationEvent = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "conversation.opened",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "conversation.opened",
      session.workspace_id,
      reviewId,
      { channel, purpose: "recommendation_draft" },
    ),
    payload: {
      conversation_id: deterministicConversationId({
        workspace_id: session.workspace_id,
        counterparty_person_id: target.person_id,
        counterparty_company_id: target.company_id,
      }),
      rep_id: repId,
      counterparty_person_id: target.person_id,
      counterparty_company_id: target.company_id,
      origin_signal_id: null,
      topic: review.item.title,
      properties: {
        source: "recommendation.draft",
        review_id: reviewId,
        review_kind: review.review_kind,
        source_event_id: review.source_event_id,
        channel,
      },
      opened_at: openedAt,
    },
  });
  if (engine.substrateMode === "postgres") {
    await createConversationLifecycleProjection(engine.pool).apply(
      conversationEvent,
    );
  }

  const draftEvent = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "draft.proposed",
    source: "user",
    producer_ref: `user:${session.user_id}`,
    correlation_id: conversationEvent.correlation_id ?? conversationEvent.id,
    causation_id: conversationEvent.id,
    idempotency_key: configurationEventKey(
      "draft.proposed",
      session.workspace_id,
      reviewId,
      { channel, purpose: "recommendation_draft" },
    ),
    payload: {
      conversation_id: conversationEvent.payload.conversation_id,
      message_id: randomUUID(),
      channel,
      rep_id: repId,
      subject: recommendationDraftSubject(
        review.review_kind,
        review.item.title,
      ),
      body: recommendationDraftBody(review.review_kind, review.item),
      provenance: {
        source: "recommendation.draft",
        review_id: reviewId,
        review_kind: review.review_kind,
        source_event_id: review.source_event_id,
        pattern_key: recommendationResearchPatternKey(review.review_kind),
      },
      properties: {
        recommendation_item: review.item,
        draft_contract: "recommendation_draft_v1",
      },
      proposed_at: openedAt,
    },
  });
  if (engine.substrateMode === "postgres") {
    await createMessageLifecycleProjection(engine.pool).apply(draftEvent);
  }

  return {
    workspace_id: session.workspace_id,
    review_id: reviewId,
    conversation_id: draftEvent.payload.conversation_id,
    message_id: draftEvent.payload.message_id,
    channel,
    attributed_rep_id: repId,
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

export async function optimizeProductCampaignStrategy(
  input: ProductCampaignStrategyInput,
  session: ProductWorkspaceSession,
): Promise<ProductCampaignStrategyResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const lookbackDays = Math.max(
    1,
    Math.min(180, Math.trunc(input.lookback_days ?? 30)),
  );
  const minSamples = Math.max(
    1,
    Math.min(50, Math.trunc(input.min_samples ?? 3)),
  );
  const outcomeKinds: CampaignOptimizerOutcomeKind[] = [
    "positive_reply",
    "meeting_booked",
    "opportunity_created",
    "deal_won",
    "engagement_lift",
    "unsubscribe",
    "bounce",
    "do_not_contact",
  ];
  const [playRuns, outcomes] = await Promise.all([
    engine.pool.query<{
      play_run_id: string;
      play_id: string;
      play_name: string;
      rep_id: string | null;
      rep_name: string | null;
      channel: string | null;
      skill_key: string | null;
      pattern_key: string | null;
      segment_key: string | null;
      created_at: Date;
    }>(
      `select pr.id::text as play_run_id,
              pr.play_id::text as play_id,
              p.name as play_name,
              coalesce(run_rep.id, default_rep.id)::text as rep_id,
              coalesce(run_rep.name, default_rep.name) as rep_name,
              coalesce(
                pr.output->>'channel',
                pr.input->>'channel',
                p.compiled #>> '{trigger,channel}',
                p.compiled #>> '{channel}'
              ) as channel,
              coalesce(
                pr.output->>'skill_key',
                pr.output #>> '{draft,provenance,skill_key}',
                pr.output #>> '{provenance,skill_key}',
                pr.output #>> '{draft,provenance,pattern_key}',
                pr.output #>> '{provenance,pattern_key}',
                pr.input->>'skill_key',
                pr.input->>'pattern_key'
              ) as skill_key,
              coalesce(
                pr.output #>> '{draft,provenance,pattern_key}',
                pr.output #>> '{provenance,pattern_key}',
                pr.input->>'pattern_key'
              ) as pattern_key,
              coalesce(
                pr.output->>'segment_key',
                pr.output->>'icp_segment',
                pr.input->>'segment_key',
                pr.input->>'icp_id',
                p.compiled #>> '{icp,name}'
              ) as segment_key,
              pr.created_at
         from play_runs pr
         join plays p
           on p.id = pr.play_id
          and p.workspace_id = pr.workspace_id
         left join reps run_rep
           on run_rep.id = pr.rep_id
          and run_rep.workspace_id = pr.workspace_id
         left join reps default_rep
           on default_rep.id = p.default_rep_id
          and default_rep.workspace_id = pr.workspace_id
        where pr.workspace_id = $1
          and pr.created_at >= now() - ($2::int * interval '1 day')
        order by pr.created_at desc
        limit 500`,
      [session.workspace_id, lookbackDays],
    ),
    engine.pool.query<{
      outcome_id: string;
      play_run_id: string | null;
      play_id: string | null;
      kind: CampaignOptimizerOutcomeKind;
      score: string | null;
      occurred_at: Date;
    }>(
      `select id::text as outcome_id,
              attributed_play_run_id::text as play_run_id,
              attributed_play_id::text as play_id,
              kind::text as kind,
              score::text as score,
              occurred_at
         from outcomes
        where workspace_id = $1
          and occurred_at >= now() - ($2::int * interval '1 day')
          and kind::text = any($3::text[])
        order by occurred_at desc
        limit 500`,
      [session.workspace_id, lookbackDays, outcomeKinds],
    ),
  ]);

  const recommendation = buildCampaignStrategyRecommendation({
    workspace_id: session.workspace_id,
    play_runs: playRuns.rows,
    outcomes: outcomes.rows,
    min_samples: minSamples,
  });
  const recommendation_id = randomUUID();
  const generatedBucket = recommendation.generated_at.slice(0, 13);
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "campaign.strategy.recommended",
    source: "system",
    producer_ref: `campaign-optimizer:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "campaign.strategy.recommended",
      session.workspace_id,
      generatedBucket,
      {
        lookback_days: lookbackDays,
        min_samples: minSamples,
        variants: recommendation.variants.map((variant) => variant.variant_key),
      },
    ),
    payload: {
      recommendation_id,
      generated_at: recommendation.generated_at,
      min_samples: recommendation.min_samples,
      summary: recommendation.summary,
      variants: recommendation.variants,
    },
  });
  const eventPayload = event.payload as { recommendation_id: string };
  return {
    ...recommendation,
    recommendation_id: eventPayload.recommendation_id,
  };
}

export async function optimizeProductPlaySkills(
  input: ProductSkillOptimizerInput,
  session: ProductWorkspaceSession,
): Promise<ProductSkillOptimizerResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const lookbackDays = Math.max(
    1,
    Math.min(180, Math.trunc(input.lookback_days ?? 30)),
  );
  const minSamples = Math.max(
    1,
    Math.min(50, Math.trunc(input.min_samples ?? 3)),
  );
  const outcomeKinds: CampaignOptimizerOutcomeKind[] = [
    "positive_reply",
    "meeting_booked",
    "opportunity_created",
    "deal_won",
    "engagement_lift",
    "unsubscribe",
    "bounce",
    "do_not_contact",
  ];
  const [playRuns, outcomes, memoryUpdates] = await Promise.all([
    engine.pool.query<{
      play_run_id: string;
      play_id: string;
      play_name: string;
      rep_id: string | null;
      rep_name: string | null;
      channel: string | null;
      skill_key: string | null;
      pattern_key: string | null;
      segment_key: string | null;
      created_at: Date;
    }>(
      `select pr.id::text as play_run_id,
              pr.play_id::text as play_id,
              p.name as play_name,
              coalesce(run_rep.id, default_rep.id)::text as rep_id,
              coalesce(run_rep.name, default_rep.name) as rep_name,
              coalesce(
                pr.output->>'channel',
                pr.input->>'channel',
                p.compiled #>> '{trigger,channel}',
                p.compiled #>> '{channel}'
              ) as channel,
              coalesce(
                pr.output->>'skill_key',
                pr.output #>> '{draft,provenance,skill_key}',
                pr.output #>> '{provenance,skill_key}',
                pr.output #>> '{draft,provenance,pattern_key}',
                pr.output #>> '{provenance,pattern_key}',
                pr.input->>'skill_key',
                pr.input->>'pattern_key'
              ) as skill_key,
              coalesce(
                pr.output #>> '{draft,provenance,pattern_key}',
                pr.output #>> '{provenance,pattern_key}',
                pr.input->>'pattern_key'
              ) as pattern_key,
              coalesce(
                pr.output->>'segment_key',
                pr.output->>'icp_segment',
                pr.input->>'segment_key',
                pr.input->>'icp_id',
                p.compiled #>> '{icp,name}'
              ) as segment_key,
              pr.created_at
         from play_runs pr
         join plays p
           on p.id = pr.play_id
          and p.workspace_id = pr.workspace_id
         left join reps run_rep
           on run_rep.id = pr.rep_id
          and run_rep.workspace_id = pr.workspace_id
         left join reps default_rep
           on default_rep.id = p.default_rep_id
          and default_rep.workspace_id = pr.workspace_id
        where pr.workspace_id = $1
          and pr.created_at >= now() - ($2::int * interval '1 day')
        order by pr.created_at desc
        limit 500`,
      [session.workspace_id, lookbackDays],
    ),
    engine.pool.query<{
      outcome_id: string;
      play_run_id: string | null;
      play_id: string | null;
      kind: CampaignOptimizerOutcomeKind;
      score: string | null;
      occurred_at: Date;
    }>(
      `select id::text as outcome_id,
              attributed_play_run_id::text as play_run_id,
              attributed_play_id::text as play_id,
              kind::text as kind,
              score::text as score,
              occurred_at
         from outcomes
        where workspace_id = $1
          and occurred_at >= now() - ($2::int * interval '1 day')
          and kind::text = any($3::text[])
        order by occurred_at desc
        limit 500`,
      [session.workspace_id, lookbackDays, outcomeKinds],
    ),
    engine.pool.query<{
      event_id: string;
      rep_id: string | null;
      pattern_key: string;
      delta_score: string | null;
      win: boolean | null;
      occurred_at: Date;
    }>(
      `select id::text as event_id,
              payload ->> 'rep_id' as rep_id,
              payload ->> 'pattern_key' as pattern_key,
              (payload ->> 'delta_score')::text as delta_score,
              nullif(payload ->> 'win', '')::boolean as win,
              occurred_at
         from events
        where workspace_id = $1
          and event_type = 'rep.memory.procedural.updated'
          and occurred_at >= now() - ($2::int * interval '1 day')
          and payload ->> 'pattern_key' is not null
        order by occurred_at desc
        limit 500`,
      [session.workspace_id, lookbackDays],
    ),
  ]);

  const campaignRecommendation = buildCampaignStrategyRecommendation({
    workspace_id: session.workspace_id,
    play_runs: playRuns.rows,
    outcomes: outcomes.rows,
    min_samples: minSamples,
  });
  const plan = buildSkillOptimizationPlan({
    workspace_id: session.workspace_id,
    variants: campaignRecommendation.variants,
    memory_updates: memoryUpdates.rows,
    min_samples: minSamples,
    generated_at: campaignRecommendation.generated_at,
  });
  const recommendation_id = randomUUID();
  const generatedBucket = plan.generated_at.slice(0, 13);
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "play.skill.optimization.recommended",
    source: "system",
    producer_ref: `skill-optimizer:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "play.skill.optimization.recommended",
      session.workspace_id,
      generatedBucket,
      {
        lookback_days: lookbackDays,
        min_samples: minSamples,
        recommendations: plan.recommendations.map(
          (item) =>
            `${item.skill_key}:${item.pattern_key}:${item.channel ?? "any"}:${item.segment_key}`,
        ),
      },
    ),
    payload: {
      recommendation_id,
      generated_at: plan.generated_at,
      min_samples: plan.min_samples,
      summary: plan.summary,
      recommendations: plan.recommendations,
    },
  });
  const eventPayload = event.payload as { recommendation_id: string };
  return {
    ...plan,
    recommendation_id: eventPayload.recommendation_id,
  };
}

export async function personalizeProductMessage(
  input: ProductMessagePersonalizationInput,
  session: ProductWorkspaceSession,
): Promise<ProductMessagePersonalizationResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const store = createPostgresVerticalSliceStore(engine.pool);
  const [rep, signal, person, profile] = await Promise.all([
    store.getRep(input.rep_id),
    store.getSignal(input.signal_id),
    store.getPerson(input.person_id),
    getProductCompanyProfile(engine.pool, session),
  ]);
  if (!rep) throw new Error(`Rep not found: ${input.rep_id}`);
  if (!signal) throw new Error(`Signal not found: ${input.signal_id}`);
  if (!person) throw new Error(`Person not found: ${input.person_id}`);
  if (rep.workspace_id !== session.workspace_id)
    throw new Error("Rep does not belong to workspace.");
  if (signal.workspace_id !== session.workspace_id)
    throw new Error("Signal does not belong to workspace.");
  if (person.workspace_id !== session.workspace_id)
    throw new Error("Person does not belong to workspace.");

  const company_id =
    input.company_id ?? signal.related_company_id ?? person.company_id ?? null;
  const company = await store.getCompany(company_id);
  const channel = normalizePersonalizationChannel(input.channel);
  const stage = input.stage ?? "cold_open";
  const workspaceContextMarkdown = await getWorkflowWorkspaceContext(
    engine,
    session.workspace_id,
  );
  const roleContext = {
    rep,
    tool_context: {
      workspace_id: session.workspace_id,
      user_id: session.user_id,
      rep_id: rep.id,
    },
    memory: engine.memory,
    judge: createHeuristicJudge({ threshold: 0.55 }),
    workspace_context_markdown: workspaceContextMarkdown,
  };
  const research = await createResearcherRole().invoke(
    { signal, person, company },
    roleContext,
  );
  const basePatternKey = personalizationBasePatternKey(
    research.pattern_key,
    channel,
  );
  const skill = createSelectedOutreachSkill({
    channel,
    stage,
    signal_kind: signal.kind,
    action: channel === "email" ? null : channel,
    person_title: person.title,
    base_pattern_key: basePatternKey,
    slot_values: messagePersonalizationSlotValues({
      signal,
      person,
      company,
      profile,
      workspaceContextMarkdown,
      channel,
      research,
    }),
  });
  const personalizationContextMarkdown = buildMessagePersonalizationContext({
    signal,
    person,
    company,
    profile,
    skill,
    workspaceContextMarkdown,
  });
  const writerLlm =
    input.use_llm === false
      ? undefined
      : createGovernedLLM(
          engine,
          session.workspace_id,
          channel === "email"
            ? "writer.email.personalization"
            : "writer.linkedin.personalization",
        );
  const draft =
    channel === "email"
      ? await createWriterRole({ llm: writerLlm }).invoke(
          {
            channel: "email",
            research,
            recipient_name:
              person.given_name ??
              person.full_name.split(" ")[0] ??
              person.full_name,
            skill,
            personalization_context_markdown: personalizationContextMarkdown,
          },
          roleContext,
        )
      : await createLinkedInWriterRole({ llm: writerLlm }).invoke(
          {
            action: linkedInPersonalizationChannel(channel),
            pattern_key: basePatternKey,
            research,
            person,
            company,
            skill,
          },
          roleContext,
        );
  const message_id = input.message_id?.trim() || randomUUID();
  const personalized_at = new Date().toISOString();
  const subject =
    "subject" in draft && typeof draft.subject === "string"
      ? draft.subject
      : null;
  const body = String(draft.body);
  const skillPayload: Record<string, unknown> | null = draft.skill
    ? { ...draft.skill }
    : null;
  const provenance = {
    graph_name: "message.personalization_graph.v1",
    pattern_key: draft.pattern_key,
    ...(draft.seed_pattern_key
      ? { seed_pattern_key: draft.seed_pattern_key }
      : {}),
    exemplar_ids: draft.exemplar_ids,
    play_id: input.play_id ?? null,
    play_run_id: input.play_run_id ?? null,
    research: {
      pattern_key: research.pattern_key,
      signal_summary: research.signal_summary,
      counterparty_summary: research.counterparty_summary,
    },
    personalization_context: {
      signal_id: signal.id,
      person_id: person.id,
      company_id: company?.id ?? null,
      generated_at: personalized_at,
    },
    ...outreachSkillProvenance(draft.skill, {
      pattern_key: draft.pattern_key,
      seed_pattern_key: draft.seed_pattern_key,
    }),
  };
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "message.personalized",
    source: "agent",
    producer_ref: `rep:${rep.id}`,
    idempotency_key: configurationEventKey(
      "message.personalized",
      session.workspace_id,
      message_id,
      {
        channel,
        pattern_key: draft.pattern_key,
        play_id: input.play_id ?? null,
        play_run_id: input.play_run_id ?? null,
      },
    ),
    payload: {
      conversation_id: input.conversation_id ?? null,
      message_id,
      channel,
      rep_id: rep.id,
      play_id: input.play_id ?? null,
      play_run_id: input.play_run_id ?? null,
      signal_id: signal.id,
      person_id: person.id,
      company_id: company?.id ?? null,
      subject,
      body,
      personalization_context_markdown: personalizationContextMarkdown,
      skill: skillPayload,
      provenance,
      personalized_at,
    },
  });

  return {
    workspace_id: session.workspace_id,
    conversation_id: input.conversation_id ?? null,
    message_id,
    channel,
    rep_id: rep.id,
    signal_id: signal.id,
    person_id: person.id,
    company_id: company?.id ?? null,
    subject,
    body,
    pattern_key: draft.pattern_key,
    seed_pattern_key: draft.seed_pattern_key,
    skill_key: draft.skill?.skill_key ?? skill.skill_key,
    skill_version: draft.skill?.version ?? skill.version,
    exemplar_ids: draft.exemplar_ids,
    procedural_exemplar_count: draft.procedural_exemplars.length,
    personalization_context_markdown: personalizationContextMarkdown,
    provenance,
    llm_used: Boolean(writerLlm),
    next_action: "run_eval_gate",
  };
}

export async function evaluateProductDraft(
  input: ProductDraftEvalInput,
  session: ProductWorkspaceSession,
): Promise<ProductDraftEvalResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const store = createPostgresVerticalSliceStore(engine.pool);
  const rep = await store.getRep(input.rep_id);
  if (!rep) throw new Error(`Rep not found: ${input.rep_id}`);
  const gate = await evalGate(
    {
      judge: createGovernedJudge(engine, session.workspace_id),
      bus: engine.bus,
    },
    {
      workspace_id: session.workspace_id,
      rep,
      message_id: input.message_id,
      artifact: {
        kind: input.artifact_kind ?? "draft",
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
      },
      context: {
        signal_summary: input.signal_summary ?? undefined,
        counterparty_summary: input.counterparty_summary ?? undefined,
        personalization_context_markdown:
          input.personalization_context_markdown ?? undefined,
        workspace_context_markdown:
          input.workspace_context_markdown ?? undefined,
        outreach_skill: input.outreach_skill ?? null,
      },
    },
  );
  return {
    workspace_id: session.workspace_id,
    message_id: input.message_id,
    rep_id: rep.id,
    channel: input.channel,
    decision: gate.decision,
    eval_score: gate.verdict.score,
    threshold: gate.verdict.threshold,
    passed: gate.verdict.passed,
    notes: gate.verdict.notes as unknown as Record<string, unknown>,
    judged_event_id: gate.events.judged.id,
    rejected_event_id: gate.events.rejected?.id ?? null,
    rejection_reason: gate.rejection_reason ?? null,
    next_action:
      gate.decision === "pass" ? "continue_to_play_gate" : "revise_draft",
  };
}

export async function triageProductReply(
  input: ProductReplyTriageInput,
  session: ProductWorkspaceSession,
): Promise<ProductReplyTriageResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const channel = input.channel ?? "email";
  if (channel !== "email") {
    throw new Error(`Reply triage does not support ${channel}`);
  }
  const result = await handleInboundEmail(
    {
      pool: engine.pool,
      bus: engine.bus,
      classifier: createProductReplyIntentClassifier(
        engine,
        session.workspace_id,
      ),
      memory: engine.memory,
      ingress_event_id: input.ingress_event_id ?? undefined,
    },
    {
      workspace_id: session.workspace_id,
      external_id: input.external_id,
      external_thread_id: input.external_thread_id ?? undefined,
      in_reply_to: input.in_reply_to ?? undefined,
      references: input.references ?? [],
      from: {
        email: input.from_email,
        name: input.from_name ?? undefined,
      },
      subject: input.subject,
      body_text: input.body_text,
      body_html: input.body_html ?? undefined,
      received_at: input.received_at,
      channel_account_id: input.channel_account_id ?? undefined,
    },
  );
  return {
    workspace_id: session.workspace_id,
    channel: "email",
    matched_conversation_id: result.matched_conversation_id,
    inbound_message_id: result.inbound_message_id,
    intent: result.intent ?? null,
    intent_confidence: result.intent_confidence ?? null,
    outcome_id: result.outcome_id ?? null,
    next_action: replyTriageNextAction(result),
  };
}

function normalizePersonalizationChannel(
  channel: OutreachSkillChannel | undefined,
): OutreachSkillChannel {
  const next = channel ?? "email";
  if (
    next === "email" ||
    next === "linkedin_connection" ||
    next === "linkedin_dm" ||
    next === "linkedin_comment"
  ) {
    return next;
  }
  throw new Error(`Message personalization does not support ${next}`);
}

function linkedInPersonalizationChannel(
  channel: OutreachSkillChannel,
): LinkedInChannelName {
  if (
    channel === "linkedin_connection" ||
    channel === "linkedin_dm" ||
    channel === "linkedin_comment"
  ) {
    return channel;
  }
  throw new Error(`Message personalization does not support ${channel}`);
}

function personalizationBasePatternKey(
  researchPatternKey: string,
  channel: OutreachSkillChannel,
): string {
  return channel === "email"
    ? researchPatternKey
    : `${researchPatternKey}|channel:${channel}`;
}

function messagePersonalizationSlotValues(input: {
  signal: Signal;
  person: GraphPerson;
  company: GraphCompany | null;
  profile: ProductCompanyProfile | null;
  workspaceContextMarkdown: string | null;
  channel: OutreachSkillChannel;
  research: ResearchResult;
}): Record<string, string> {
  const signalHook = compactPersonalizationText(
    [input.signal.title, input.signal.content].filter(Boolean).join(" "),
    220,
  );
  const counterpartyContext = compactPersonalizationText(
    [
      input.person.full_name,
      input.person.title,
      input.company?.name ? `at ${input.company.name}` : null,
      input.company?.industry,
    ]
      .filter(Boolean)
      .join(" "),
    180,
  );
  const profileProof = messageProfileProof(input.profile);
  const workspaceProof =
    profileProof ??
    firstUsefulContextLine(input.workspaceContextMarkdown) ??
    "Use the workspace profile, ICP, vertical intelligence, and prior Outcomes only when supported.";
  const role = input.person.title ?? "their team";
  const channelAsk =
    input.channel === "email"
      ? "Worth a quick reply if this is relevant?"
      : "Open to comparing notes?";
  return {
    signal_hook: signalHook,
    why_now: input.signal.freshness_at
      ? `Fresh signal observed ${input.signal.freshness_at}.`
      : "The signal is current enough to justify timely outreach.",
    inferred_problem: compactPersonalizationText(
      `${role} may need to turn this signal into a concrete GTM priority without adding manual research work.`,
      220,
    ),
    proof_or_relevance: compactPersonalizationText(workspaceProof, 240),
    peer_pattern: compactPersonalizationText(workspaceProof, 240),
    counterparty_context: counterpartyContext,
    reply_question: channelAsk,
    signal_summary: compactPersonalizationText(
      input.research.signal_summary,
      240,
    ),
  };
}

function buildMessagePersonalizationContext(input: {
  signal: Signal;
  person: GraphPerson;
  company: GraphCompany | null;
  profile: ProductCompanyProfile | null;
  skill: SelectedOutreachSkill;
  workspaceContextMarkdown: string | null;
}): string {
  const profileIngredients = messageProfileIngredientLines(input.profile);
  const sections = [
    "## Signal Timing And Why Now",
    `- Signal: ${input.signal.title}`,
    input.signal.content
      ? `- Detail: ${compactPersonalizationText(input.signal.content, 500)}`
      : null,
    input.signal.url ? `- Source: ${input.signal.url}` : null,
    `- Kind: ${input.signal.kind}`,
    "",
    "## Counterparty",
    `- Person: ${input.person.full_name}`,
    input.person.title ? `- Role: ${input.person.title}` : null,
    input.company?.name ? `- Company: ${input.company.name}` : null,
    input.company?.description
      ? `- Company context: ${compactPersonalizationText(input.company.description, 420)}`
      : null,
    "",
    "## Profile Message Ingredients",
    profileIngredients.length > 0
      ? profileIngredients.map((line) => `- ${line}`).join("\n")
      : "- No Profile message ingredients configured yet.",
    "",
    "## Workspace And Vertical Context",
    input.workspaceContextMarkdown
      ? compactPersonalizationText(input.workspaceContextMarkdown, 1800)
      : "- No workspace context available.",
    "",
    "## Play Skill",
    `- Skill: ${input.skill.name} (${input.skill.skill_key}@${input.skill.version})`,
    ...input.skill.framework.map((step) => `- ${step}`),
    "Constraints:",
    ...input.skill.constraints.map((constraint) => `- ${constraint}`),
  ].filter((line): line is string => line !== null);
  return sections.join("\n");
}

function messageProfileIngredientLines(
  profile: ProductCompanyProfile | null,
): string[] {
  if (!profile) return [];
  const fields: Array<[string, string | null | undefined]> = [
    ["Company", profile.company_name],
    ["Website", profile.website_url],
    ["Industry", profile.industry],
    ["Value proposition", profile.value_proposition],
    ["Customer pain points", profile.customer_pain_points],
    ["Key features", profile.key_features],
    ["Social proof", profile.social_proof],
    ["Buyer roles", profile.target_titles],
    ["Target markets", profile.target_markets],
    ["Signal keywords", profile.signal_keywords],
    ["Competitors to watch", profile.competitor_watchlist],
    ["LinkedIn behavior to watch", profile.linkedin_signal_behaviors],
    ["Outreach goal", profile.outreach_goal],
    ["Message tone", profile.message_tone],
    ["LinkedIn company page", profile.linkedin_company_url],
  ];
  return fields
    .map(([label, value]) => {
      const text = compactPersonalizationText(value, 220);
      return text ? `${label}: ${text}` : null;
    })
    .filter((line): line is string => Boolean(line));
}

function messageProfileProof(
  profile: ProductCompanyProfile | null,
): string | null {
  const ingredients = messageProfileIngredientLines(profile);
  const proof = ingredients.find((line) => line.startsWith("Social proof:"));
  const value = ingredients.find((line) => line.startsWith("Value proposition:"));
  const pain = ingredients.find((line) =>
    line.startsWith("Customer pain points:"),
  );
  return proof ?? value ?? pain ?? ingredients[0] ?? null;
}

function firstUsefulContextLine(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return (
    value
      .split("\n")
      .map((line) => line.replace(/^[-#*\s]+/, "").trim())
      .find((line) => line.length > 8) ?? null
  );
}

function compactPersonalizationText(
  value: string | null | undefined,
  maxLength: number,
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function replyTriageNextAction(
  result: Awaited<ReturnType<typeof handleInboundEmail>>,
): ProductReplyTriageResult["next_action"] {
  if (!result.matched_conversation_id || !result.inbound_message_id) {
    return "review_unmatched";
  }
  if (result.intent === "meeting_intent" || result.intent === "positive") {
    return "generate_meeting_prep";
  }
  if (result.intent === "neutral") return "draft_reply";
  if (result.intent === "unsubscribe" || result.intent === "do_not_contact") {
    return "block_contact";
  }
  return "stop";
}

export async function generateProductMeetingPrep(
  input: ProductMeetingPrepInput,
  session: ProductWorkspaceSession,
): Promise<ProductMeetingPrepResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const conversation_id = input.conversation_id.trim();
  if (!conversation_id) throw new Error("conversation_id is required");
  const trace = await getConversationTrustTrace(
    {
      workspace_id: session.workspace_id,
      conversation_id,
    },
    engine.pool,
  );
  if (!trace) throw new Error(`Conversation not found: ${conversation_id}`);
  const note = buildMeetingPrepNote({
    conversation: {
      id: trace.conversation.id,
      topic: trace.conversation.topic,
      counterparty_person_id: trace.conversation.counterparty_person_id,
      counterparty_name: trace.conversation.counterparty_name,
      counterparty_title: trace.conversation.counterparty_title,
      counterparty_linkedin_url: trace.conversation.counterparty_linkedin_url,
      company_id: trace.conversation.company_id,
      company_name: trace.conversation.company_name,
      company_domain: trace.conversation.company_domain,
      company_industry: trace.conversation.company_industry,
      company_description: trace.conversation.company_description,
      rep_id: trace.conversation.rep_id,
      rep_name: trace.conversation.rep_name,
      rep_role: trace.conversation.rep_role,
      signal_id: trace.conversation.signal_id,
      signal_title: trace.conversation.signal_title,
      signal_kind: trace.conversation.signal_kind,
      signal_content: trace.conversation.signal_content,
      signal_url: trace.conversation.signal_url,
    },
    user: {
      user_id: session.user_id,
    },
    messages: trace.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      subject: message.subject,
      body: message.body,
      intent_class: message.intent_class,
      created_at: message.sent_at ?? message.created_at,
    })),
    outcomes: trace.outcomes.map((outcome) => ({
      id: outcome.id,
      kind: outcome.kind,
      occurred_at: outcome.occurred_at,
    })),
    calendar: await resolveMeetingPrepCalendar(
      engine,
      session.workspace_id,
      session.user_id,
    ),
  });
  const meeting_prep_id = randomUUID();
  const generatedBucket = note.generated_at.slice(0, 13);
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "meeting.prep.generated",
    source: "system",
    producer_ref: `meeting-prep:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "meeting.prep.generated",
      session.workspace_id,
      `${conversation_id}:${generatedBucket}`,
      {
        latest_message_id: trace.messages.at(-1)?.id ?? null,
        latest_outcome_id: trace.outcomes.at(-1)?.id ?? null,
      },
    ),
    payload: {
      meeting_prep_id,
      conversation_id: note.conversation_id,
      generated_at: note.generated_at,
      status: note.status,
      next_action: note.next_action,
      summary: note.summary,
      thread_summary: note.thread_summary,
      thread_turns: note.thread_turns,
      agenda: note.agenda,
      suggested_questions: note.suggested_questions,
      suggested_times: note.suggested_times,
      availability_status: note.availability_status,
      availability_reason: note.availability_reason,
      calendar_provider: note.calendar_provider,
      calendar_account_id: note.calendar_account_id,
      calendar_account_display_name: note.calendar_account_display_name,
      profile_context: note.profile_context,
      source_refs: note.source_refs,
    },
  });
  const eventPayload = event.payload as { meeting_prep_id: string };
  return {
    workspace_id: session.workspace_id,
    meeting_prep_id: eventPayload.meeting_prep_id,
    ...note,
  };
}

export async function getProductLaunchReadiness(
  input: ProductLaunchReadinessInput,
  session: ProductWorkspaceSession,
): Promise<ProductLaunchReadinessResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return loadWorkspaceLaunchReadiness(engine.pool, session.workspace_id, {
    required_channel: input.required_channel ?? "any",
  });
}

interface VerticalProfileRow {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  exa_summary: string | null;
  evidence_source_ids: unknown;
  intelligence: unknown;
  updated_at: Date;
}

interface VerticalIcpRow {
  id: string;
  name: string;
  description: string;
  must_haves: unknown[];
  nice_to_haves: string[];
  match_threshold: string;
  enabled: boolean;
  updated_at: Date;
}

interface VerticalSemanticRow {
  id: string;
  rep_id: string | null;
  subject_type: string;
  subject_id: string;
  facts: Record<string, unknown> | null;
  confidence: string | null;
  last_observed_at: Date;
}

interface VerticalPlaybookRow {
  id: string;
  rep_id: string | null;
  pattern_key: string;
  score: string;
  win_count: number;
  loss_count: number;
  last_used_at: Date | null;
  created_at: Date;
}

export async function refreshWorkspaceVerticalIntelligence(
  input: ProductVerticalIntelligenceInput,
  session: ProductWorkspaceSession,
): Promise<ProductVerticalIntelligenceResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const profile = await loadVerticalProfile(
    engine.pool,
    session.workspace_id,
    input.company_id ?? null,
  );
  if (!profile) {
    throw new Error(
      "Workspace company profile is required before vertical intelligence can refresh.",
    );
  }
  const [icps, semantic, playbooks] = await Promise.all([
    loadVerticalIcps(engine.pool, session.workspace_id),
    loadVerticalSemanticMemory(engine.pool, session.workspace_id),
    loadVerticalPlaybooks(engine.pool, session.workspace_id),
  ]);
  const pack = buildVerticalIntelligencePack({
    workspace_id: session.workspace_id,
    profile: {
      company_id: profile.company_id,
      company_name: profile.company_name,
      domain: profile.domain,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
      exa_summary: profile.exa_summary,
      evidence_source_ids: arrayStringStateValue(profile.evidence_source_ids),
      intelligence: recordStateValue(
        profile.intelligence,
      ) as VerticalIntelligenceProfileInput["intelligence"],
      updated_at: profile.updated_at,
    },
    icps: icps.rows,
    semantic: semantic.rows,
    playbooks: playbooks.rows,
  });
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "vertical.intelligence.updated",
    source: "system",
    producer_ref: `vertical-intelligence:${session.user_id}`,
    idempotency_key: configurationEventKey(
      "vertical.intelligence.updated",
      session.workspace_id,
      profile.company_id,
      {
        generated_bucket: pack.generated_at.slice(0, 13),
        fact_ids: pack.facts.map((fact) => fact.id),
      },
    ),
    payload: {
      company_id: pack.company_id,
      company_name: pack.company_name,
      vertical: pack.vertical,
      generated_at: pack.generated_at,
      graph_name: pack.graph_name,
      run_id: pack.run_id,
      confidence: pack.confidence,
      facts: pack.facts,
      prompt_context: pack.prompt_context,
      evidence_source_ids: pack.evidence_source_ids,
      redaction_status: pack.redaction_status,
    },
  });
  await projectVerticalIntelligenceUpdated(engine.pool, event);
  return pack;
}

async function loadVerticalProfile(
  pool: Pool,
  workspace_id: string,
  company_id: string | null,
): Promise<VerticalProfileRow | null> {
  const { rows } = await pool.query<VerticalProfileRow>(
    `select id::text as company_id,
            name as company_name,
            domain::text as domain,
            properties->>'website_url' as website_url,
            industry,
            description,
            properties #>> '{exa_profile,summary}' as exa_summary,
            coalesce(properties #> '{exa_profile,evidence_source_ids}', '[]'::jsonb) as evidence_source_ids,
            coalesce(properties #> '{exa_profile,intelligence}', '{}'::jsonb) as intelligence,
            updated_at
       from graph_companies
      where workspace_id = $1
        and ($2::uuid is null or id = $2)
        and (
          $2::uuid is not null
          or properties->>'profile_role' = 'workspace_company'
        )
      order by updated_at desc
      limit 1`,
    [workspace_id, company_id],
  );
  return rows[0] ?? null;
}

async function loadVerticalIcps(
  pool: Pool,
  workspace_id: string,
): Promise<{ rows: VerticalIcpRow[] }> {
  return pool.query<VerticalIcpRow>(
    `select id::text,
            name,
            description,
            must_haves,
            nice_to_haves,
            match_threshold::text as match_threshold,
            enabled,
            updated_at
       from workspace_icps
      where workspace_id = $1
      order by enabled desc, updated_at desc
      limit 12`,
    [workspace_id],
  );
}

async function loadVerticalSemanticMemory(
  pool: Pool,
  workspace_id: string,
): Promise<{ rows: VerticalSemanticRow[] }> {
  return pool.query<VerticalSemanticRow>(
    `select id::text,
            rep_id::text,
            subject_type,
            subject_id::text,
            facts,
            confidence::text,
            last_observed_at
       from rep_memory_semantic
      where workspace_id = $1
        and (
          facts ? 'objection'
          or facts ? 'objections'
          or facts ? 'pain'
          or facts ? 'proof'
          or facts ? 'buying_trigger'
          or facts ? 'competitor'
        )
      order by confidence desc nulls last, last_observed_at desc
      limit 16`,
    [workspace_id],
  );
}

async function loadVerticalPlaybooks(
  pool: Pool,
  workspace_id: string,
): Promise<{ rows: VerticalPlaybookRow[] }> {
  return pool.query<VerticalPlaybookRow>(
    `select id::text,
            rep_id::text,
            pattern_key,
            score::text,
            win_count,
            loss_count,
            last_used_at,
            created_at
       from rep_memory_procedural
      where workspace_id = $1
      order by score desc, win_count desc, created_at desc
      limit 16`,
    [workspace_id],
  );
}

async function projectVerticalIntelligenceUpdated(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as Omit<
    VerticalIntelligencePack,
    "workspace_id"
  >;
  const result = await pool.query(
    `update graph_companies
        set properties = properties ||
              jsonb_build_object('vertical_intelligence', $3::jsonb),
            provenance = provenance ||
              jsonb_build_object('vertical_intelligence_event_id', $4::text),
            updated_at = now()
      where workspace_id = $1 and id = $2`,
    [
      event.workspace_id,
      payload.company_id,
      JSON.stringify({
        workspace_id: event.workspace_id,
        ...payload,
      }),
      event.id,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      `Vertical intelligence target company was not found: ${payload.company_id}`,
    );
  }
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
  const urls = input.results.flatMap((result) =>
    result.url ? [result.url] : [],
  );
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
  const planned = planExaOpenWebSignalSource(input);
  const result = await configureWorkspaceSignalSource(
    {
      adapter: "exa",
      name: planned.source_name,
      provider: "exa",
      query: planned.query,
      signal_kind: input.signal_kind,
      source_tier: planned.source_tier,
      source_authority: planned.source_authority,
      source_reason: planned.source_reason,
      search_type: planned.search_type,
      category: planned.category,
      include_domains: planned.include_domains,
      exclude_domains: planned.exclude_domains,
      start_published_date: planned.start_published_date,
      platforms: planned.platforms,
      intent_presets: planned.intent_presets,
      bypass_icp_filter: input.bypass_icp_filter,
      limit: input.limit,
      max_daily_items: input.max_daily_items,
      max_daily_calls: input.max_daily_calls,
      monthly_spend_cap_usd: input.monthly_spend_cap_usd,
      poll_interval_minutes: 60,
      enabled: input.enabled ?? true,
    },
    session,
  );
  if (!result.source_id)
    throw new Error("Exa source configuration did not return a source id.");
  return { ...result, source_id: result.source_id };
}

export async function configureExaSocialSignalPack(
  input: ProductExaSocialSignalPackInput,
  session: ProductWorkspaceSession,
): Promise<ProductExaSocialSignalPackResult> {
  const companyName = input.company_name.trim() || "Workspace";
  const signalKeywords = compactSearchTerms(
    input.signal_keywords,
    signalKeywordsFromDescription(input.description),
  );
  const shared = {
    company_name: companyName,
    industry: input.industry ?? null,
    signal_keywords: signalKeywords || undefined,
    competitor_watchlist: input.competitor_watchlist ?? undefined,
    linkedin_signal_behaviors: input.linkedin_signal_behaviors ?? undefined,
    platforms: input.platforms ?? ["x", "linkedin"],
    freshness_days: input.freshness_days ?? 7,
    limit: input.limit ?? 15,
    max_daily_items: input.max_daily_items ?? 25,
    max_daily_calls: input.max_daily_calls ?? 6,
    monthly_spend_cap_usd: input.monthly_spend_cap_usd ?? 3,
    bypass_icp_filter: true,
    enabled: input.enabled ?? true,
    search_type: "fast" as const,
  };
  const definitions: Array<{
    source_name: string;
    signal_kind: ProductExaSignalDiscoveryInput["signal_kind"];
    intent_presets: ExaSocialSignalIntent[];
  }> = [
    {
      source_name: `${companyName} X/LinkedIn hiring posts`,
      signal_kind: "hiring",
      intent_presets: ["hiring"],
    },
    {
      source_name: `${companyName} X/LinkedIn funding posts`,
      signal_kind: "funding",
      intent_presets: ["funding"],
    },
    {
      source_name: `${companyName} X/LinkedIn launch and feature posts`,
      signal_kind: "product_launch",
      intent_presets: ["product_launch", "feature_release"],
    },
    {
      source_name: `${companyName} X/LinkedIn leadership posts`,
      signal_kind: "leadership_change",
      intent_presets: ["leadership_change"],
    },
    {
      source_name: `${companyName} X/LinkedIn pain and migration posts`,
      signal_kind: "churn_risk",
      intent_presets: ["buyer_intent", "pain"],
    },
  ];

  const sources: ProductExaSocialSignalPackResult["sources"] = [];
  for (const definition of definitions) {
    const result = await configureExaOpenWebSignalSource(
      {
        ...shared,
        source_name: definition.source_name,
        signal_kind: definition.signal_kind,
        intent_presets: definition.intent_presets,
        bypass_icp_filter: shared.bypass_icp_filter,
      },
      session,
    );
    sources.push({
      source_id: result.source_id,
      name: definition.source_name,
      signal_kind: definition.signal_kind ?? "other",
    });
  }

  return {
    workspace_id: session.workspace_id,
    source_count: sources.length,
    sources,
  };
}

function planExaOpenWebSignalSource(input: ProductExaSignalDiscoveryInput): {
  source_name: string;
  query: string;
  source_tier: "aggregator";
  source_authority: number;
  source_reason: string;
  search_type: ExaSearchType;
  category?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  start_published_date?: string;
  platforms?: ExaSocialPlatform[];
  intent_presets?: ExaSocialSignalIntent[];
} {
  const query = blankToNull(input.query ?? undefined);
  const requestedPlatforms =
    input.platforms && input.platforms.length
      ? normalizeExaSocialPlatforms(input.platforms)
      : [];
  const requestedIntents = normalizeExaSocialIntents(input.intent_presets);
  const shouldBuildSocialQuery = !query && (
    requestedIntents.length > 0 ||
    Boolean(blankToNull(input.signal_kind ?? undefined))
  );
  const socialPlan = shouldBuildSocialQuery
    ? buildExaSocialSignalQuery({
        company_name: input.company_name ?? null,
        industry: input.industry ?? null,
        signal_keywords: input.signal_keywords ?? null,
        competitor_watchlist: input.competitor_watchlist ?? null,
        linkedin_signal_behaviors: input.linkedin_signal_behaviors ?? null,
        platforms: requestedPlatforms.length ? requestedPlatforms : undefined,
        intents: requestedIntents.length ? requestedIntents : undefined,
        signal_kind: input.signal_kind ?? null,
        freshness_days: input.freshness_days ?? null,
      })
    : null;
  const source_name =
    input.source_name?.trim() ||
    socialPlan?.source_name ||
    "Exa open-web intelligence";
  const include_domains = dedupeStringList([
    ...(socialPlan?.include_domains ?? []),
    ...(input.include_domains ?? []),
  ]);
  const exclude_domains = dedupeStringList(input.exclude_domains ?? []);
  const resolvedQuery = query ?? socialPlan?.query;
  if (!resolvedQuery) {
    throw new Error("Exa open-web source requires a query or signal intent presets.");
  }
  const source_reason = socialPlan ? "exa_social_posts" : "exa_open_web_search";
  return {
    source_name,
    query: resolvedQuery,
    source_tier: "aggregator",
    source_authority: socialPlan ? 0.64 : 0.68,
    source_reason,
    search_type: input.search_type ?? (socialPlan ? "fast" : "auto"),
    category: blankToNull(input.category ?? undefined) ?? undefined,
    include_domains: include_domains.length ? include_domains : undefined,
    exclude_domains: exclude_domains.length ? exclude_domains : undefined,
    start_published_date:
      typeof input.freshness_days === "number"
        ? exaSocialFreshnessStartDate(input.freshness_days)
        : undefined,
    platforms:
      requestedPlatforms.length || socialPlan?.platforms?.length
        ? socialPlan?.platforms ?? requestedPlatforms
        : undefined,
    intent_presets:
      requestedIntents.length || socialPlan?.intents?.length
        ? socialPlan?.intents ?? requestedIntents
        : undefined,
  };
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
    size_bucket?: string | null;
    description: string | null;
    value_proposition?: string | null;
    customer_pain_points?: string | null;
    target_titles?: string | null;
    target_markets?: string | null;
    key_features?: string | null;
    social_proof?: string | null;
    signal_keywords?: string | null;
    competitor_watchlist?: string | null;
    linkedin_signal_behaviors?: string | null;
    exclusion_rules?: string | null;
    preferred_language?: string | null;
    outreach_goal?: string | null;
    message_tone?: string | null;
    linkedin_company_url?: string | null;
    auto_enrich_email_addresses?: boolean;
    prevent_team_contact_duplication?: boolean;
    profile_source?: "manual" | "firecrawl" | "fallback";
  };
  await pool.query(
    `insert into graph_companies (
       id, workspace_id, name, domain, industry, size_bucket, description, properties, provenance
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
     )
     on conflict (id) do update set
       name = excluded.name,
       domain = coalesce(excluded.domain, graph_companies.domain),
       industry = excluded.industry,
       size_bucket = excluded.size_bucket,
       description = excluded.description,
       properties = case
         when excluded.properties->>'profile_source' = 'manual'
           then (graph_companies.properties - 'exa_profile') || excluded.properties
         else graph_companies.properties || excluded.properties
       end,
       provenance = graph_companies.provenance || excluded.provenance,
       updated_at = now()`,
    [
      payload.company_id,
      event.workspace_id,
      payload.name,
      payload.domain,
      payload.industry,
      payload.size_bucket ?? null,
      payload.description,
      JSON.stringify({
        profile_role: "workspace_company",
        website_url: payload.website_url,
        value_proposition: payload.value_proposition ?? null,
        customer_pain_points: payload.customer_pain_points ?? null,
        target_titles: payload.target_titles ?? null,
        target_markets: payload.target_markets ?? null,
        key_features: payload.key_features ?? null,
        social_proof: payload.social_proof ?? null,
        signal_keywords: payload.signal_keywords ?? null,
        competitor_watchlist: payload.competitor_watchlist ?? null,
        linkedin_signal_behaviors: payload.linkedin_signal_behaviors ?? null,
        exclusion_rules: payload.exclusion_rules ?? null,
        preferred_language: payload.preferred_language ?? null,
        outreach_goal: payload.outreach_goal ?? null,
        message_tone: payload.message_tone ?? null,
        linkedin_company_url: payload.linkedin_company_url ?? null,
        auto_enrich_email_addresses:
          payload.auto_enrich_email_addresses ?? true,
        prevent_team_contact_duplication:
          payload.prevent_team_contact_duplication ?? true,
        profile_source: payload.profile_source ?? event.source,
        profile_updated_at: event.occurred_at,
      }),
      JSON.stringify({
        source: payload.profile_source ?? event.source,
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
    signal_keywords?: string | null;
    competitor_watchlist?: string | null;
    linkedin_signal_behaviors?: string | null;
    signal_kind?: string;
  },
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; source_count: number }> {
  const companyName = input.company_name.trim() || "the company";
  const industry = input.industry?.trim();
  const marketPhrase =
    industry || signalKeywordsFromDescription(input.description) || "B2B SaaS";
  const keywordPhrase = compactSearchTerms(
    input.signal_keywords,
    input.competitor_watchlist,
    input.linkedin_signal_behaviors,
  );
  // Keep signup/profile bootstrap predictable and free-source-first. Paid Exa
  // monitoring is configured explicitly through product.signal.discover_open_web.
  const ownedSources = await discoverCompanyOwnedSignalSources({
    company_name: companyName,
    website_url: input.website_url,
  });
  const sourceInputs: ConfigureWorkspaceSignalSourceInput[] = [
    ...ownedSources.map((source): ConfigureWorkspaceSignalSourceInput => ({
      adapter: source.adapter,
      name: source.name,
      url: source.url,
      board_slug: source.board_slug,
      company_name: source.company_name,
      company_domain: source.company_domain,
      signal_kind: source.signal_kind,
      poll_interval_minutes: source.poll_interval_minutes,
      source_tier: source.source_tier,
      source_authority: 0.95,
      source_reason: source.source_reason,
    })),
    {
      adapter: "google_news",
      name: `${companyName} market news`,
      query: compactSearchTerms(
        marketPhrase,
        keywordPhrase,
        "hiring funding launch",
      ),
      signal_kind: input.signal_kind ?? "press_mention",
      poll_interval_minutes: 30,
      source_tier: "aggregator",
      source_authority: 0.66,
      source_reason: "free_news_recall",
    },
    ...DEFAULT_GOOGLE_NEWS_QUERIES.map((q): ConfigureWorkspaceSignalSourceInput => ({
      adapter: "google_news",
      name: q.name,
      query: q.query,
      signal_kind: q.signal_kind,
      poll_interval_minutes: q.poll_interval_minutes,
      source_tier: q.source_tier,
      source_authority: q.source_authority,
      source_reason: q.source_reason,
    })),
    ...DEFAULT_RSS_FEEDS.map((f): ConfigureWorkspaceSignalSourceInput => ({
      adapter: "rss",
      name: f.name,
      url: f.url,
      signal_kind: f.signal_kind,
      poll_interval_minutes: f.poll_interval_minutes,
      source_tier: f.source_tier,
      source_authority: f.source_authority,
      source_reason: f.source_reason,
    })),
    {
      adapter: "hn_front",
      name: "Hacker News launch signals",
      signal_kind: "product_launch",
      poll_interval_minutes: 60,
      source_tier: "community",
      source_authority: 0.58,
      source_reason: "developer_launch_recall",
    },
    {
      adapter: "hn_whos_hiring",
      name: "HN hiring signals",
      signal_kind: "hiring",
      poll_interval_minutes: 60,
      source_tier: "trusted",
      source_authority: 0.82,
      source_reason: "public_hiring_thread",
    },
    {
      adapter: "product_hunt",
      name: "Product Hunt launches",
      signal_kind: "product_launch",
      poll_interval_minutes: 60,
      source_tier: "trusted",
      source_authority: 0.82,
      source_reason: "public_launch_source",
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
  const name =
    input.name?.trim() || `${titleizeSignalKind(signalKind)} Signal Email`;
  const existing = await engine.pool.query<{ id: string; version: number }>(
    `select id, version from plays
      where workspace_id = $1 and lower(name) = lower($2)
      order by version desc
      limit 1`,
    [session.workspace_id, name],
  );
  const play_id = existing.rows[0]?.id ?? randomUUID();
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 25));
  const approval =
    parseApprovalPolicy(input.approval) ??
    (await getWorkspaceDefaultApproval(engine.pool, session.workspace_id));
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
  const name =
    input.name?.trim() ||
    `${titleizeSignalKind(signalKind)} Signal ${actionLabel}`;
  const existing = await engine.pool.query<{ id: string; version: number }>(
    `select id, version from plays
      where workspace_id = $1 and lower(name) = lower($2)
      order by version desc
      limit 1`,
    [session.workspace_id, name],
  );
  const play_id = existing.rows[0]?.id ?? randomUUID();
  const dailyCap = Math.max(0, Math.trunc(input.daily_cap ?? 10));
  const approval =
    parseApprovalPolicy(input.approval) ??
    (await getWorkspaceDefaultApproval(engine.pool, session.workspace_id));
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
  await ensureProceduralSeedFor(
    engine,
    session.workspace_id,
    rep.rep_id,
    session.user_id,
    {
      icp_segment: icp.icp_id,
      signal_kind: signalKind,
      subject: "Saw the hiring signal",
      body: "Saw the new role. Usually that means the operating motion is changing fast enough to compare notes.",
    },
  );
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

export interface WorkspaceActivationSetupRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_ACTIVATION_SETUP_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export interface WorkspaceProfileIcpRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_PROFILE_ICP_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export interface WorkspaceSignalIngestionRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_SIGNAL_INGESTION_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export interface WorkspaceSignalMatchingRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_SIGNAL_MATCHING_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export interface WorkspaceChannelReadinessRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_CHANNEL_READINESS_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export interface WorkspaceCompanyBrainBriefRunResult {
  workspace_id: string;
  workflow_name: typeof WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW;
  workflow_run_id: string;
  output: BombsellLangGraphState | null;
}

export async function runWorkspaceCompanyBrainBrief(
  input: Omit<CompanyBrainGraphInput, "workspace_id" | "user_id"> & {
    idempotency_nonce?: string | null;
  },
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<WorkspaceCompanyBrainBriefRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  await registerWorkspaceCompanyBrainWorkflows(engine);
  const workflowInput: CompanyBrainGraphInput = {
    ...input,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
  };
  const run = await engine.runtime.start<
    CompanyBrainGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
    idempotency_key: companyBrainBriefIdempotencyKey(
      session.workspace_id,
      workflowInput,
      input.idempotency_nonce,
    ),
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Company brain brief workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Company brain brief workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export async function runWorkspaceSignalIngestion(
  input: Omit<SignalIngestionGraphInput, "workspace_id" | "user_id"> & {
    idempotency_nonce?: string | null;
  },
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<WorkspaceSignalIngestionRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  await registerWorkspaceSignalIngestionWorkflow(engine);
  const workflowInput: SignalIngestionGraphInput = {
    ...input,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
  };
  const run = await engine.runtime.start<
    SignalIngestionGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
    idempotency_key: signalIngestionIdempotencyKey(
      session.workspace_id,
      workflowInput,
      input.idempotency_nonce,
    ),
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Signal ingestion workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Signal ingestion workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_SIGNAL_INGESTION_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export async function runWorkspaceSignalMatching(
  input: Omit<LeadMatchingGraphInput, "workspace_id" | "user_id">,
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
    correlationId?: string | null;
    causationEventId?: string | null;
  } = {},
): Promise<WorkspaceSignalMatchingRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const signal_id = input.signal_id.trim();
  if (!signal_id) throw new Error("signal_id required");
  await registerWorkspaceSignalMatchingWorkflow(engine);
  const workflowInput: LeadMatchingGraphInput = {
    ...input,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    signal_id,
    thread_id:
      input.thread_id ?? `signal-match:${session.workspace_id}:${signal_id}`,
    correlation_id: input.correlation_id ?? opts.correlationId ?? undefined,
    causation_event_id:
      input.causation_event_id ?? opts.causationEventId ?? null,
  };
  const run = await engine.runtime.start<
    LeadMatchingGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
    idempotency_key: signalMatchingIdempotencyKey(
      session.workspace_id,
      signal_id,
    ),
    correlation_id: workflowInput.correlation_id,
    causation_id: workflowInput.causation_event_id ?? undefined,
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Signal matching workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Signal matching workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export async function runWorkspaceChannelReadiness(
  input: Omit<ChannelReadinessGraphInput, "workspace_id" | "user_id">,
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
    correlationId?: string | null;
    causationEventId?: string | null;
  } = {},
): Promise<WorkspaceChannelReadinessRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  await registerWorkspaceChannelReadinessWorkflow(engine);
  const required_channel = input.required_channel ?? "any";
  const workflowInput: ChannelReadinessGraphInput = {
    ...input,
    required_channel,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    thread_id:
      input.thread_id ??
      `channel-readiness:${session.workspace_id}:${required_channel}`,
    correlation_id: input.correlation_id ?? opts.correlationId ?? undefined,
    causation_event_id:
      input.causation_event_id ?? opts.causationEventId ?? null,
  };
  const run = await engine.runtime.start<
    ChannelReadinessGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_CHANNEL_READINESS_WORKFLOW,
    idempotency_key: channelReadinessIdempotencyKey(
      session.workspace_id,
      workflowInput,
    ),
    correlation_id: workflowInput.correlation_id,
    causation_id: workflowInput.causation_event_id ?? undefined,
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_CHANNEL_READINESS_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Channel readiness workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Channel readiness workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_CHANNEL_READINESS_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export async function runWorkspaceProfileIcpDraft(
  input: Omit<ProfileIcpGraphInput, "workspace_id" | "user_id">,
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<WorkspaceProfileIcpRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const websiteUrl = normalizeWebsiteUrl(input.website_url);
  if (!websiteUrl) throw new Error("valid website_url required");
  await registerWorkspaceProfileIcpWorkflow(engine);
  const workflowInput: ProfileIcpGraphInput = {
    ...input,
    website_url: websiteUrl,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
  };
  const run = await engine.runtime.start<
    ProfileIcpGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_PROFILE_ICP_WORKFLOW,
    idempotency_key: profileIcpIdempotencyKey(
      session.workspace_id,
      workflowInput,
    ),
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_PROFILE_ICP_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(completed.error?.message ?? "Profile ICP workflow failed.");
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Profile ICP workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_PROFILE_ICP_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export async function runWorkspaceActivationSetup(
  input: Omit<ActivationSetupGraphInput, "workspace_id" | "user_id">,
  session: ProductWorkspaceSession,
  opts: {
    wait?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<WorkspaceActivationSetupRunResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const websiteUrl = normalizeWebsiteUrl(input.website_url);
  if (!websiteUrl) throw new Error("valid website_url required");
  await registerWorkspaceActivationSetupWorkflow(engine);
  const workflowInput: ActivationSetupGraphInput = {
    ...input,
    website_url: websiteUrl,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
  };
  const run = await engine.runtime.start<
    ActivationSetupGraphInput,
    BombsellLangGraphState
  >({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
    idempotency_key: activationSetupIdempotencyKey(
      session.workspace_id,
      workflowInput,
    ),
    input: workflowInput,
  });
  if (opts.wait === false) {
    return {
      workspace_id: session.workspace_id,
      workflow_name: WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
      workflow_run_id: run.id,
      output: run.output ?? null,
    };
  }
  const completed = await waitForWorkflowTerminal<BombsellLangGraphState>(
    engine.runtime,
    run.id,
    opts.timeoutMs ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Activation setup workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    throw new Error(
      `Activation setup workflow ended with status ${completed.status}.`,
    );
  }
  return {
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
    workflow_run_id: run.id,
    output: completed.output ?? null,
  };
}

export interface ProductContactWaterfallInput {
  signal_id: string;
  company_id: string;
  play_id: string;
  rep_id: string;
  channel: ContactChannel;
  limit?: number;
  repair_key?: string | null;
  wait?: boolean;
  timeout_ms?: number;
}

export interface ProductContactWaterfallResult {
  workspace_id: string;
  workflow_name: typeof CONTACT_RESOLUTION_WORKFLOW;
  workflow_run_id: string;
  workflow_status: WorkflowRunStatus;
  decision: "started" | ContactResolutionOutput["decision"];
  contact_resolution_id: string | null;
  candidates: ContactCandidate[];
  selected_person_id: string | null;
  defer_reason: string | null;
}

export async function runProductContactWaterfall(
  input: ProductContactWaterfallInput,
  session: ProductWorkspaceSession,
): Promise<ProductContactWaterfallResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const workflowInput: ContactResolutionInput = {
    workspace_id: session.workspace_id,
    signal_id: input.signal_id,
    company_id: input.company_id,
    play_id: input.play_id,
    rep_id: input.rep_id,
    channel: input.channel,
    limit: input.limit,
    repair_key: input.repair_key ?? null,
  };
  const run = await startContactResolution(engine, workflowInput);
  if (input.wait === false) {
    return contactWaterfallResultFromRun(session.workspace_id, run, null);
  }
  const completed = await waitForWorkflowTerminal<ContactResolutionOutput>(
    engine.runtime,
    run.id,
    input.timeout_ms ?? 30_000,
  );
  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message ?? "Contact waterfall workflow failed.",
    );
  }
  if (completed.status !== "completed") {
    return contactWaterfallResultFromRun(session.workspace_id, completed, null);
  }
  return contactWaterfallResultFromRun(
    session.workspace_id,
    completed,
    completed.output ?? null,
  );
}

function contactWaterfallResultFromRun(
  workspace_id: string,
  run: WorkflowRun<unknown, ContactResolutionOutput>,
  output: ContactResolutionOutput | null,
): ProductContactWaterfallResult {
  return {
    workspace_id,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    workflow_run_id: run.id,
    workflow_status: run.status,
    decision: output?.decision ?? "started",
    contact_resolution_id: output?.contact_resolution_id ?? null,
    candidates: output?.candidates ?? [],
    selected_person_id: output?.selected_person_id ?? null,
    defer_reason: output?.defer_reason ?? null,
  };
}

export interface DismissProductSignalInput {
  signal_id: string;
  reason?: string | null;
}

export interface DismissProductSignalResult {
  workspace_id: string;
  signal_id: string;
  dismissed: boolean;
  status: string | null;
}

export type ProductPersonFitDecision = "fit" | "unsure" | "not_fit";

export interface RecordProductPersonFitFeedbackInput {
  person_id: string;
  decision: ProductPersonFitDecision;
  note?: string | null;
}

export interface RecordProductPersonFitFeedbackResult {
  workspace_id: string;
  person_id: string;
  decision: ProductPersonFitDecision;
}

export async function dismissProductSignal(
  input: DismissProductSignalInput,
  session: ProductWorkspaceSession,
): Promise<DismissProductSignalResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const reason =
    input.reason?.trim() ||
    "Skipped from Agent because the signal is not a fit for outreach.";
  const { rows } = await engine.pool.query<{ status: string }>(
    `select status::text as status
       from signals
      where workspace_id = $1
        and id = $2
      limit 1`,
    [session.workspace_id, input.signal_id],
  );
  const status = rows[0]?.status ?? null;
  if (!status) {
    throw new Error("Signal not found in the active workspace.");
  }
  if (status === "dismissed" || status === "spent") {
    return {
      workspace_id: session.workspace_id,
      signal_id: input.signal_id,
      dismissed: false,
      status,
    };
  }
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "signal.dismissal.requested",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: `signal.dismissal.requested:${session.workspace_id}:${input.signal_id}`,
    payload: {
      signal_id: input.signal_id,
      reason,
    },
  });
  const dismissed = await projectSignalDismissal(
    engine.pool,
    session.workspace_id,
    event.payload,
  );
  if (dismissed) {
    await engine.bus.publish({
      workspace_id: session.workspace_id,
      event_type: "signal.dismissed",
      source: "system",
      producer_ref: "projection:signal.dismissal.requested",
      correlation_id: event.correlation_id ?? event.id,
      causation_id: event.id,
      idempotency_key: `projection:${event.id}:signal.dismissed`,
      payload: {
        signal_id: input.signal_id,
        reason,
      },
    });
  }
  return {
    workspace_id: session.workspace_id,
    signal_id: input.signal_id,
    dismissed,
    status: dismissed ? "dismissed" : status,
  };
}

export async function recordProductPersonFitFeedback(
  input: RecordProductPersonFitFeedbackInput,
  session: ProductWorkspaceSession,
): Promise<RecordProductPersonFitFeedbackResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const decision = personFitDecision(input.decision);
  const { rows } = await engine.pool.query<{ id: string }>(
    `select id
       from graph_persons
      where workspace_id = $1
        and id = $2
      limit 1`,
    [session.workspace_id, input.person_id],
  );
  if (!rows[0]) throw new Error("Contact not found in the active workspace.");
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "person.fit_feedback.recorded",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: `person.fit_feedback.recorded:${session.workspace_id}:${input.person_id}:${randomUUID()}`,
    payload: {
      person_id: input.person_id,
      decision,
      note: input.note?.trim() || null,
      recorded_by: session.user_id,
      recorded_at: new Date().toISOString(),
    },
  });
  await projectPersonFitFeedback(
    engine.pool,
    session.workspace_id,
    event.payload as {
      person_id: string;
      decision: ProductPersonFitDecision;
      note?: string | null;
      recorded_by?: string | null;
      recorded_at?: string;
    },
  );
  return {
    workspace_id: session.workspace_id,
    person_id: input.person_id,
    decision,
  };
}

function personFitDecision(value: string): ProductPersonFitDecision {
  if (value === "fit" || value === "not_fit" || value === "unsure") return value;
  return "unsure";
}

async function projectPersonFitFeedback(
  pool: Pool,
  workspace_id: string,
  payload: {
    person_id: string;
    decision: ProductPersonFitDecision;
    note?: string | null;
    recorded_by?: string | null;
    recorded_at?: string;
  },
): Promise<void> {
  const score =
    payload.decision === "fit" ? 1 : payload.decision === "not_fit" ? 0 : 0.5;
  await pool.query(
    `update graph_persons
        set properties = properties || jsonb_build_object(
              'contact_fit',
              jsonb_build_object(
                'decision', $3::text,
                'score', $4::numeric,
                'note', $5::text,
                'recorded_by', $6::uuid,
                'recorded_at', $7::timestamptz,
                'source', 'dashboard'
              )
            ),
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [
      workspace_id,
      payload.person_id,
      payload.decision,
      score,
      payload.note ?? null,
      payload.recorded_by ?? null,
      payload.recorded_at ?? new Date().toISOString(),
    ],
  );
}

export async function matchWorkspaceSignal(
  input: MatchWorkspaceSignalInput,
  session: ProductWorkspaceSession,
  opts: MatchWorkspaceSignalOptions = {},
): Promise<MatchWorkspaceSignalResult> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    workspace_id: string;
    status: string | null;
    kind: string | null;
    match_score: string | number | null;
    match_reason: string | null;
    audience_hint: Record<string, unknown> | null;
  }>(
    `select workspace_id,
            status::text as status,
            kind::text as kind,
            match_score,
            match_reason,
            audience_hint
       from signals
      where id = $1
      limit 1`,
    [input.signal_id],
  );
  const signal = rows[0];
  const signalWorkspaceId = signal?.workspace_id;
  if (!signalWorkspaceId) {
    return {
      workspace_id: session.workspace_id,
      signal_id: input.signal_id,
      status: "skipped",
      kind: null,
      matched_icp_ids: [],
      match_score: null,
      match_reason: null,
      matches: [],
      skip_reason: "not_found",
    };
  }
  if (signalWorkspaceId !== session.workspace_id) {
    throw new Error("Signal not found in the active workspace.");
  }
  if (signal.status === "matched" || signal.status === "spent" || signal.status === "dismissed") {
    return matchWorkspaceSignalTerminalResult(session.workspace_id, input.signal_id, signal);
  }
  const outcome = await classifySignal(
    {
      pool: engine.pool,
      bus: engine.bus,
      llm: createSignalClassifierLLM(engine, session.workspace_id),
      correlation_id: opts.correlation_id,
      causation_id: opts.causation_id,
      producer_ref: opts.producerRef ?? "product:signal.match",
    },
    { signal_id: input.signal_id },
  );
  if (outcome.status === "matched") {
    return {
      workspace_id: session.workspace_id,
      signal_id: input.signal_id,
      status: "matched",
      kind: outcome.kind,
      matched_icp_ids: outcome.matched_icp_ids,
      match_score: outcome.match_score,
      match_reason: outcome.match_reason,
      matches: outcome.matches,
      skip_reason: null,
    };
  }
  if (outcome.status === "dismissed") {
    return {
      workspace_id: session.workspace_id,
      signal_id: input.signal_id,
      status: "dismissed",
      kind: null,
      matched_icp_ids: [],
      match_score: null,
      match_reason: outcome.reason,
      matches: [],
      skip_reason: null,
    };
  }
  return {
    workspace_id: session.workspace_id,
    signal_id: input.signal_id,
    status: "skipped",
    kind: null,
    matched_icp_ids: [],
    match_score: null,
    match_reason: outcome.reason,
    matches: [],
    skip_reason: outcome.reason,
  };
}

function matchWorkspaceSignalTerminalResult(
  workspace_id: string,
  signal_id: string,
  signal: {
    status: string | null;
    kind: string | null;
    match_score: string | number | null;
    match_reason: string | null;
    audience_hint: Record<string, unknown> | null;
  },
): MatchWorkspaceSignalResult {
  if (signal.status === "matched") {
    const matches = matchesFromAudienceHint(signal.audience_hint);
    const matched_icp_ids = matches.map((match) => match.icp_segment);
    return {
      workspace_id,
      signal_id,
      status: "matched",
      kind: parseSignalKindOrNull(signal.kind),
      matched_icp_ids,
      match_score: nullableNumber(signal.match_score),
      match_reason: signal.match_reason,
      matches,
      skip_reason: null,
    };
  }
  if (signal.status === "dismissed") {
    return {
      workspace_id,
      signal_id,
      status: "dismissed",
      kind: parseSignalKindOrNull(signal.kind),
      matched_icp_ids: [],
      match_score: nullableNumber(signal.match_score),
      match_reason: signal.match_reason,
      matches: [],
      skip_reason: null,
    };
  }
  return {
    workspace_id,
    signal_id,
    status: "skipped",
    kind: parseSignalKindOrNull(signal.kind),
    matched_icp_ids: [],
    match_score: nullableNumber(signal.match_score),
    match_reason: signal.match_reason,
    matches: [],
    skip_reason: null,
  };
}

function matchesFromAudienceHint(
  audience_hint: Record<string, unknown> | null,
): Array<{ icp_segment: string; match_score: number; reason: string }> {
  const matchedIcps = Array.isArray(audience_hint?.matched_icps)
    ? audience_hint.matched_icps
    : [];
  const matches: Array<{ icp_segment: string; match_score: number; reason: string }> = [];
  for (const entry of matchedIcps) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const icp_segment = typeof candidate.icp_id === "string"
      ? candidate.icp_id
      : typeof candidate.icp_segment === "string"
        ? candidate.icp_segment
        : null;
    const match_score = nullableNumber(candidate.score ?? candidate.match_score);
    if (!icp_segment || match_score == null) continue;
    matches.push({
      icp_segment,
      match_score,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return matches;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseSignalKind(kind: unknown): SignalKindValue {
  const parsed = SignalKind.safeParse(kind);
  return parsed.success ? parsed.data : "hiring";
}

function parseSignalKindOrNull(kind: unknown): SignalKindValue | null {
  return typeof kind === "string" ? parseSignalKind(kind) : null;
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

function activationSetupIdempotencyKey(
  workspace_id: string,
  input: ActivationSetupGraphInput,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id,
        website_url: input.website_url,
        company_hint: input.company_hint ?? null,
        industry_hint: input.industry_hint ?? null,
        description_hint: input.description_hint ?? null,
        customer_pain_points: input.customer_pain_points ?? null,
        target_titles: input.target_titles ?? null,
        target_markets: input.target_markets ?? null,
        key_features: input.key_features ?? null,
        social_proof: input.social_proof ?? null,
        signal_keywords: input.signal_keywords ?? null,
        competitor_watchlist: input.competitor_watchlist ?? null,
        linkedin_signal_behaviors: input.linkedin_signal_behaviors ?? null,
        exclusion_rules: input.exclusion_rules ?? null,
        preferred_language: input.preferred_language ?? null,
        outreach_goal: input.outreach_goal ?? null,
        message_tone: input.message_tone ?? null,
        allowed_industries: input.allowed_industries ?? [],
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `activation.setup:${workspace_id}:${digest}`;
}

function profileIcpIdempotencyKey(
  workspace_id: string,
  input: ProfileIcpGraphInput,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id,
        website_url: input.website_url,
        company_hint: input.company_hint ?? null,
        allowed_industries: input.allowed_industries ?? [],
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `profile.icp:${workspace_id}:${digest}`;
}

function channelReadinessIdempotencyKey(
  workspace_id: string,
  input: ChannelReadinessGraphInput,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id,
        required_channel: input.required_channel ?? "any",
        causation_event_id: input.causation_event_id ?? null,
        run_id: input.run_id ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `channel.readiness:${workspace_id}:${digest}`;
}

function signalIngestionIdempotencyKey(
  workspace_id: string,
  input: SignalIngestionGraphInput,
  nonce?: string | null,
): string {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id,
        limit: input.limit ?? null,
        nonce: nonce?.trim() || `minute:${minuteBucket}`,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `signal.ingestion:${workspace_id}:${digest}`;
}

function companyBrainBriefIdempotencyKey(
  workspace_id: string,
  input: CompanyBrainGraphInput,
  nonce?: string | null,
): string {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        brief_type: input.brief_type ?? "workspace",
        task: input.task ?? null,
        rep_id: input.rep_id ?? null,
        signal_id: input.signal_id ?? null,
        play_id: input.play_id ?? null,
        play_run_id: input.play_run_id ?? null,
        conversation_id: input.conversation_id ?? null,
        message_id: input.message_id ?? null,
        outcome_id: input.outcome_id ?? null,
        company_id: input.company_id ?? null,
        person_id: input.person_id ?? null,
        nonce: nonce?.trim() || `minute:${minuteBucket}`,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `company.brief:${workspace_id}:${digest}`;
}

async function waitForWorkflowTerminal<O>(
  runtime: WorkflowRuntime,
  run_id: string,
  timeoutMs: number,
): Promise<WorkflowRun<unknown, O>> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const run = await runtime.get<unknown, O>(run_id);
    if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Workflow ${run_id} did not finish within ${timeoutMs}ms.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.hostname === "localhost")
      return null;
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
  const market =
    input.industry ||
    signalKeywordsFromDescription(input.description) ||
    "B2B SaaS";
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
  const market =
    context.company?.industry ??
    signalKeywordsFromDescription(context.company?.description) ??
    "B2B SaaS";
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
}): Omit<
  ProductExaBriefRefreshResult,
  "workspace_id" | "request_id" | "summary" | "evidence_source_ids"
> {
  const evidenceItems: ProductBriefItem[] = input.results
    .slice(0, 4)
    .map((result, index) =>
      briefItemFromExaResult(
        result,
        input.evidence_source_ids[index]
          ? [input.evidence_source_ids[index]!]
          : [],
      ),
    );
  const recentChanges: ProductBriefItem[] = input.context.signals
    .slice(0, 3)
    .map((signal) => ({
      title: signal.title,
      detail: `${signal.kind.replace(/_/g, " ")} signal from ${signal.freshness_at.toISOString().slice(0, 10)}.`,
      url: signal.url,
      evidence_source_ids: [],
    }));
  const reviewItems: ProductBriefItem[] = input.context.approvals
    .slice(0, 3)
    .map((approval) => ({
      title: approval.kind.replace(/_/g, " "),
      detail: approval.reason ?? "A workflow is waiting for review.",
      evidence_source_ids: [],
    }));
  const quietExceptions: ProductBriefItem[] = input.context.conversations
    .filter((conversation) => conversation.status === "awaiting_us")
    .slice(0, 3)
    .map((conversation) => ({
      title: conversation.topic ?? "Conversation needs attention",
      detail:
        "A conversation is waiting on the workspace before the Rep can continue.",
      evidence_source_ids: [],
    }));
  if (quietExceptions.length === 0 && input.context.signals.length === 0) {
    quietExceptions.push({
      title: "No urgent public-web changes",
      detail:
        "Exa did not find a stronger change than the current watched context for this Brief refresh.",
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

function briefItemFromExaResult(
  result: ExaResult,
  evidence_source_ids: string[],
): ProductBriefItem {
  const url = canonicalUrl(result.url);
  const host = url ? domainFromWebsiteUrl(url) : null;
  return {
    title: (result.title || host || "Public-web evidence")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140),
    detail:
      profileSnippetFromResult(result) ??
      "Fresh public-web evidence is available for Rep context.",
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
  const items = results
    .slice(0, 6)
    .map((result, index) =>
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
  const evidenceCards = results
    .flatMap((result) => {
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
      return [
        {
          title: (result.title || sourceDomain || url)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160),
          url,
          source_domain: sourceDomain,
          snippet: profileSnippetFromResult(result),
          published_at: normalizeOptionalDate(result.publishedDate),
        },
      ];
    })
    .slice(0, 8);

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
  const haystack = [
    result.title,
    result.summary,
    result.highlights.join(" "),
    result.text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (snippet && out.positioningNotes.length < 6)
    out.positioningNotes.push(snippet);
  if (
    /(alternative|competitor|versus|\bvs\.?\b|compare|comparison)/i.test(
      haystack,
    )
  ) {
    const mention = title ?? snippet;
    if (mention) out.competitorMentions.push(mention);
  }
  if (
    /(customer|case study|testimonial|review|launch|funding|raised|partner|integration)/i.test(
      haystack,
    )
  ) {
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
  return terms.flatMap(([label, pattern]) =>
    pattern.test(text) ? [label] : [],
  );
}

function cleanProfileLine(
  value: string | null | undefined,
  max: number,
): string | null {
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
  const text = [result.title, result.summary, result.highlights.join(" ")]
    .filter(Boolean)
    .join(" ");
  const terms =
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return [...new Set(terms.filter((term) => !stopwords.has(term)))].slice(
    0,
    20,
  );
}

function profileSnippetFromResult(result: ExaResult): string | null {
  const value = result.summary ?? result.highlights[0] ?? result.text ?? null;
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 260) : null;
}

function normalizeOptionalDate(
  value: string | null | undefined,
): string | null {
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

function signalKeywordsFromDescription(
  description: string | null | undefined,
): string | null {
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

function compactSearchTerms(
  ...values: Array<string | null | undefined>
): string {
  return [
    ...new Set(
      values
        .flatMap((value) => value?.split(/[\n,]+/) ?? [])
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ]
    .slice(0, 12)
    .join(" ");
}

function dedupeStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
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
  const existing = await findEmailDomainAccount(
    engine.pool,
    session.workspace_id,
  );
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

export async function configureWorkspaceCrmDestination(
  input: ConfigureCrmDestinationInput,
  session: ProductWorkspaceSession,
): Promise<{ workspace_id: string; channel_account_id: string }> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const existing = await findCrmDestinationAccount(
    engine.pool,
    session.workspace_id,
  );
  const channel_account_id = existing?.id ?? randomUUID();
  const provider = normalizeCrmProvider(input.provider);
  const sync_mode = input.sync_mode ?? "qualified_contacts";
  const webhook_url = normalizeOptionalUrl(input.webhook_url);
  const payload = {
    channel_account_id,
    kind: "crm" as const,
    provider,
    display_name: input.display_name?.trim() || crmProviderLabel(provider),
    webhook_url,
    sync_mode,
    include_sent_outreach:
      input.include_sent_outreach ?? sync_mode !== "qualified_contacts",
    include_replies_meetings:
      input.include_replies_meetings ?? sync_mode === "full_loop",
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "crm.destination.configured",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "crm.destination.configured",
      session.workspace_id,
      channel_account_id,
      payload,
    ),
    payload,
  });
  await projectCrmDestinationConfigured(engine.pool, event);
  return { workspace_id: session.workspace_id, channel_account_id };
}

async function findCrmDestinationAccount(
  pool: Pool,
  workspace_id: string,
): Promise<{ id: string } | null> {
  const existing = await pool.query<{ id: string }>(
    `select id
       from channel_accounts
      where workspace_id = $1
        and kind = 'crm'
      order by case when status = 'connected' then 0 else 1 end,
               updated_at desc,
               created_at desc
      limit 1`,
    [workspace_id],
  );
  return existing.rows[0] ?? null;
}

async function projectCrmDestinationConfigured(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    channel_account_id: string;
    provider: string;
    display_name: string;
    webhook_url: string | null;
    sync_mode: "qualified_contacts" | "qualified_and_sent" | "full_loop";
    include_sent_outreach: boolean;
    include_replies_meetings: boolean;
  };
  await pool.query(
    `insert into channel_accounts (
       id, workspace_id, kind, display_name, status, daily_cap, daily_used, credentials, properties
     ) values ($1, $2, 'crm'::channel_account_kind, $3, 'connected'::channel_account_status, null, 0, $4::jsonb, $5::jsonb)
     on conflict (id) do update set
       display_name = excluded.display_name,
       status = excluded.status,
       credentials = excluded.credentials,
       properties = channel_accounts.properties || excluded.properties,
       updated_at = now()`,
    [
      payload.channel_account_id,
      event.workspace_id,
      payload.display_name,
      JSON.stringify({
        webhook_url: payload.webhook_url,
      }),
      JSON.stringify({
        provider: payload.provider,
        sync_mode: payload.sync_mode,
        webhook_configured: Boolean(payload.webhook_url),
        include_sent_outreach: payload.include_sent_outreach,
        include_replies_meetings: payload.include_replies_meetings,
        configured_event_id: event.id,
      }),
    ],
  );
}

export async function queueWorkspaceCrmHandoff(
  input: QueueCrmHandoffInput,
  session: ProductWorkspaceSession,
): Promise<QueueCrmHandoffResult> {
  if (input.confirm_queue !== true) {
    throw new Error(
      "Queueing a CRM handoff packages qualified contacts, signal proof, outreach context, and outcome learning. Set confirm_queue=true to continue.",
    );
  }
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const destination = await loadCrmDestinationAccount(
    engine.pool,
    session.workspace_id,
  );
  if (!destination) {
    throw new Error("Configure CRM handoff in Profile before queueing CRM sync.");
  }
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 10)));
  const workbench = await loadQualifiedSignalWorkbench(
    engine.pool,
    session.workspace_id,
    { limit: Math.max(limit, 10) },
  );
  const records = buildCrmHandoffRecords(workbench.signals).slice(0, limit);
  if (records.length === 0) {
    throw new Error(
      "No CRM-ready qualified contacts found. Resolve a verified email or LinkedIn profile for a qualified Signal first.",
    );
  }
  const outcomesByKey = destination.include_replies_meetings
    ? await loadCrmHandoffOutcomes(engine.pool, session.workspace_id, records)
    : new Map<string, CrmHandoffRecord["outcomes"]>();
  const enrichedRecords = records.map((record) => ({
    ...record,
    outreach: destination.include_sent_outreach ? record.outreach : null,
    outcomes: destination.include_replies_meetings
      ? outcomesByKey.get(record.signal_id) ??
        (record.outreach?.conversation_id
          ? outcomesByKey.get(record.outreach.conversation_id)
          : undefined) ??
        []
      : [],
  }));
  const handoff_id = randomUUID();
  const syncMode = destination.sync_mode;
  const payload = {
    handoff_id,
    channel_account_id: destination.id,
    provider: destination.provider,
    sync_mode: syncMode,
    contact_count: enrichedRecords.length,
    signal_count: new Set(enrichedRecords.map((record) => record.signal_id)).size,
    include_sent_outreach: destination.include_sent_outreach,
    include_replies_meetings: destination.include_replies_meetings,
    records: enrichedRecords,
  };
  const event = await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "crm.handoff.queued",
    source: "user",
    producer_ref: session.user_id,
    idempotency_key: configurationEventKey(
      "crm.handoff.queued",
      session.workspace_id,
      destination.id,
      {
        queued_hour: new Date().toISOString().slice(0, 13),
        signal_ids: enrichedRecords.map((record) => record.signal_id),
        contact_ids: enrichedRecords.map((record) => record.contact.person_id),
        sync_mode: syncMode,
      },
    ),
    payload,
  });
  await projectCrmHandoffQueued(engine.pool, event);
  const delivery = await deliverCrmHandoffWebhook({
    engine,
    session,
    destination,
    handoff_id,
    queued_event_id: event.id,
    payload,
  });
  const skipped = Math.max(0, workbench.signals.length - enrichedRecords.length);
  return {
    workspace_id: session.workspace_id,
    handoff_id,
    channel_account_id: destination.id,
    provider: destination.provider,
    sync_mode: syncMode,
    queued_records: enrichedRecords.length,
    skipped_records: skipped,
    event_id: event.id,
    records: enrichedRecords,
    delivery,
    next_action: {
      label:
        delivery.status === "delivered"
          ? "CRM payload delivered"
          : delivery.webhook_url_configured
            ? "Review CRM delivery"
            : "Connect native CRM",
      detail:
        delivery.status === "delivered"
          ? "The CRM webhook accepted the qualified-contact package with signal, outreach, and outcome proof."
          : delivery.webhook_url_configured
            ? "The CRM handoff package was queued, but webhook delivery failed. Review the CRM destination URL or retry the handoff."
            : "The handoff package is queued and available through MCP/API; add native OAuth or webhook delivery when this account is ready.",
      href: "/dashboard/profile#crm-sync",
    },
  };
}

interface CrmDestinationAccount {
  id: string;
  provider: string;
  sync_mode: "qualified_contacts" | "qualified_and_sent" | "full_loop";
  include_sent_outreach: boolean;
  include_replies_meetings: boolean;
  webhook_configured: boolean;
  webhook_url: string | null;
}

async function loadCrmDestinationAccount(
  pool: Pool,
  workspace_id: string,
): Promise<CrmDestinationAccount | null> {
  const result = await pool.query<{
    id: string;
    provider: string | null;
    sync_mode: string | null;
    include_sent_outreach: boolean | null;
    include_replies_meetings: boolean | null;
    webhook_configured: boolean | null;
    webhook_url: string | null;
  }>(
    `select id::text,
            properties->>'provider' as provider,
            properties->>'sync_mode' as sync_mode,
            (properties->>'include_sent_outreach')::boolean as include_sent_outreach,
            (properties->>'include_replies_meetings')::boolean as include_replies_meetings,
            (properties->>'webhook_configured')::boolean as webhook_configured,
            credentials->>'webhook_url' as webhook_url
       from channel_accounts
      where workspace_id = $1
        and kind = 'crm'
        and status = 'connected'
      order by updated_at desc, created_at desc
      limit 1`,
    [workspace_id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider ?? "custom",
    sync_mode: isCrmSyncMode(row.sync_mode)
      ? row.sync_mode
      : "qualified_contacts",
    include_sent_outreach: row.include_sent_outreach ?? false,
    include_replies_meetings: row.include_replies_meetings ?? false,
    webhook_configured: row.webhook_configured ?? false,
    webhook_url: row.webhook_url ?? null,
  };
}

async function deliverCrmHandoffWebhook({
  engine,
  session,
  destination,
  handoff_id,
  queued_event_id,
  payload,
}: {
  engine: Awaited<ReturnType<typeof getProductEngine>>;
  session: ProductWorkspaceSession;
  destination: CrmDestinationAccount;
  handoff_id: string;
  queued_event_id: string;
  payload: {
    handoff_id: string;
    channel_account_id: string;
    provider: string;
    sync_mode: "qualified_contacts" | "qualified_and_sent" | "full_loop";
    contact_count: number;
    signal_count: number;
    include_sent_outreach: boolean;
    include_replies_meetings: boolean;
    records: CrmHandoffRecord[];
  };
}): Promise<QueueCrmHandoffResult["delivery"]> {
  const webhookUrl = destination.webhook_url;
  if (!webhookUrl) {
    return {
      status: "not_configured",
      event_id: null,
      status_code: null,
      error: null,
      webhook_url_configured: false,
    };
  }

  const endpoint = crmWebhookEndpoint(webhookUrl);
  if (!endpoint) {
    const error = "CRM webhook URL must use http or https.";
    const failed = await publishCrmHandoffWebhookFailed({
      engine,
      session,
      destination,
      handoff_id,
      queued_event_id,
      endpointHost: null,
      statusCode: null,
      error,
      retryable: false,
    });
    await projectCrmHandoffWebhookStatus(engine.pool, failed);
    return {
      status: "failed",
      event_id: failed.id,
      status_code: null,
      error,
      webhook_url_configured: true,
    };
  }

  const endpointHost = endpoint.host;
  const body = JSON.stringify({
    type: "crm.handoff",
    workspace_id: session.workspace_id,
    event_id: queued_event_id,
    ...payload,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Bombsell CRM Handoff/1.0",
        "x-bombsell-event-type": "crm.handoff.queued",
        "x-bombsell-handoff-id": handoff_id,
      },
      body,
      signal: controller.signal,
    });
    const statusCode = response.status;
    if (!response.ok) {
      const error = `CRM webhook returned HTTP ${statusCode}`;
      const failed = await publishCrmHandoffWebhookFailed({
        engine,
        session,
        destination,
        handoff_id,
        queued_event_id,
        endpointHost,
        statusCode,
        error,
        retryable: true,
      });
      await projectCrmHandoffWebhookStatus(engine.pool, failed);
      return {
        status: "failed",
        event_id: failed.id,
        status_code: statusCode,
        error,
        webhook_url_configured: true,
      };
    }
    const delivered = await engine.bus.publish({
      workspace_id: session.workspace_id,
      event_type: "crm.handoff.webhook.delivered",
      source: "system",
      producer_ref: "crm:webhook",
      correlation_id: queued_event_id,
      causation_id: queued_event_id,
      idempotency_key: `crm-webhook-delivered:${session.workspace_id}:${handoff_id}`,
      payload: {
        handoff_id,
        channel_account_id: destination.id,
        provider: destination.provider,
        endpoint_host: endpointHost,
        status_code: statusCode,
        delivered_at: new Date().toISOString(),
        contact_count: payload.contact_count,
        signal_count: payload.signal_count,
      },
    });
    await projectCrmHandoffWebhookStatus(engine.pool, delivered);
    return {
      status: "delivered",
      event_id: delivered.id,
      status_code: statusCode,
      error: null,
      webhook_url_configured: true,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CRM webhook delivery failed";
    const failed = await publishCrmHandoffWebhookFailed({
      engine,
      session,
      destination,
      handoff_id,
      queued_event_id,
      endpointHost,
      statusCode: null,
      error: message,
      retryable: true,
    });
    await projectCrmHandoffWebhookStatus(engine.pool, failed);
    return {
      status: "failed",
      event_id: failed.id,
      status_code: null,
      error: message,
      webhook_url_configured: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function publishCrmHandoffWebhookFailed({
  engine,
  session,
  destination,
  handoff_id,
  queued_event_id,
  endpointHost,
  statusCode,
  error,
  retryable,
}: {
  engine: Awaited<ReturnType<typeof getProductEngine>>;
  session: ProductWorkspaceSession;
  destination: CrmDestinationAccount;
  handoff_id: string;
  queued_event_id: string;
  endpointHost: string | null;
  statusCode: number | null;
  error: string;
  retryable: boolean;
}): Promise<PublishedEvent> {
  return engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "crm.handoff.webhook.failed",
    source: "system",
    producer_ref: "crm:webhook",
    correlation_id: queued_event_id,
    causation_id: queued_event_id,
    idempotency_key: `crm-webhook-failed:${session.workspace_id}:${handoff_id}`,
    payload: {
      handoff_id,
      channel_account_id: destination.id,
      provider: destination.provider,
      endpoint_host: endpointHost,
      status_code: statusCode,
      error,
      retryable,
      failed_at: new Date().toISOString(),
    },
  });
}

function isCrmSyncMode(
  value: string | null,
): value is "qualified_contacts" | "qualified_and_sent" | "full_loop" {
  return (
    value === "qualified_contacts" ||
    value === "qualified_and_sent" ||
    value === "full_loop"
  );
}

function buildCrmHandoffRecords(
  signals: QualifiedSignalItem[],
): CrmHandoffRecord[] {
  const records: CrmHandoffRecord[] = [];
  for (const signal of signals) {
    const contact = signal.contacts.find(
      (candidate) =>
        candidate.contact_fit_decision !== "not_fit" &&
        (candidate.verification.email_verified === true ||
          candidate.verification.linkedin_ready === true),
    );
    if (!contact) continue;
    records.push({
      signal_id: signal.id,
      signal_kind: signal.kind,
      signal_title: signal.title,
      match_score: signal.match_score,
      match_reason: signal.match_reason,
      company: {
        company_id: signal.company.id,
        name: signal.company.name,
        domain: signal.company.domain,
        industry: signal.company.industry,
      },
      contact: {
        person_id: contact.person_id,
        full_name: contact.full_name,
        title: contact.title,
        email: contact.verification.email_verified === true
          ? (contact.emails[0] ?? null)
          : null,
        email_verified: contact.verification.email_verified === true,
        email_status: contact.verification.email_status ?? null,
        linkedin_url: contact.linkedin_url,
        linkedin_ready: contact.verification.linkedin_ready === true,
        contact_fit_decision: contact.contact_fit_decision,
      },
      outreach: signal.outreach_draft
        ? {
            conversation_id: signal.outreach_draft.conversation_id,
            message_id: signal.outreach_draft.message_id,
            channel: signal.outreach_draft.channel,
            status: signal.outreach_draft.status,
            eval_score: signal.outreach_draft.eval_score,
            eval_passed: signal.outreach_draft.eval_passed,
            sent_at: signal.outreach_draft.sent_at?.toISOString() ?? null,
          }
        : null,
      outcomes: [],
    });
  }
  return records;
}

async function loadCrmHandoffOutcomes(
  pool: Pool,
  workspace_id: string,
  records: CrmHandoffRecord[],
): Promise<Map<string, CrmHandoffRecord["outcomes"]>> {
  const signalIds = records.map((record) => record.signal_id);
  const conversationIds = records
    .map((record) => record.outreach?.conversation_id)
    .filter((value): value is string => Boolean(value));
  if (signalIds.length === 0 && conversationIds.length === 0) {
    return new Map();
  }
  const result = await pool.query<{
    key: string;
    outcome_id: string;
    kind: string;
    score: string | number | null;
    occurred_at: Date;
  }>(
    `select coalesce(o.attributed_signal_id::text, o.conversation_id::text) as key,
            o.id::text as outcome_id,
            o.kind::text as kind,
            o.score::text as score,
            o.occurred_at
       from outcomes o
      where o.workspace_id = $1
        and (
          o.attributed_signal_id::text = any($2::text[])
          or o.conversation_id::text = any($3::text[])
        )
      order by o.occurred_at desc
      limit 100`,
    [workspace_id, signalIds, conversationIds],
  );
  const byKey = new Map<string, CrmHandoffRecord["outcomes"]>();
  for (const row of result.rows) {
    const outcomes = byKey.get(row.key) ?? [];
    outcomes.push({
      outcome_id: row.outcome_id,
      kind: row.kind,
      score: Number(row.score ?? 0),
      occurred_at: row.occurred_at.toISOString(),
    });
    byKey.set(row.key, outcomes);
  }
  return byKey;
}

async function projectCrmHandoffQueued(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    channel_account_id: string;
    handoff_id: string;
    contact_count: number;
    signal_count: number;
  };
  await pool.query(
    `update channel_accounts
        set properties = properties || $3::jsonb,
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [
      event.workspace_id,
      payload.channel_account_id,
      JSON.stringify({
        last_handoff_event_id: event.id,
        last_handoff_id: payload.handoff_id,
        last_handoff_at: event.occurred_at,
        last_handoff_contact_count: payload.contact_count,
        last_handoff_signal_count: payload.signal_count,
      }),
    ],
  );
}

async function projectCrmHandoffWebhookStatus(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = event.payload as {
    channel_account_id: string;
    handoff_id: string;
    endpoint_host?: string | null;
    status_code?: number | null;
    error?: string | null;
    delivered_at?: string;
    failed_at?: string;
  };
  const delivered = event.event_type === "crm.handoff.webhook.delivered";
  await pool.query(
    `update channel_accounts
        set properties = properties || $3::jsonb,
            last_error = case when $4::boolean then null else $5::jsonb end,
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [
      event.workspace_id,
      payload.channel_account_id,
      JSON.stringify({
        last_webhook_event_id: event.id,
        last_webhook_handoff_id: payload.handoff_id,
        last_webhook_status: delivered ? "delivered" : "failed",
        last_webhook_status_code: payload.status_code ?? null,
        last_webhook_endpoint_host: payload.endpoint_host ?? null,
        last_webhook_at: delivered ? payload.delivered_at : payload.failed_at,
      }),
      delivered,
      JSON.stringify(
        delivered
          ? null
          : {
              kind: "crm_webhook_delivery_failed",
              message: payload.error ?? "CRM webhook delivery failed",
              event_id: event.id,
            },
      ),
    ],
  );
}

function crmWebhookEndpoint(value: string): { url: URL; host: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { url, host: url.host };
  } catch {
    return null;
  }
}

function normalizeCrmProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return normalized || "custom";
}

function crmProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    pipedrive: "Pipedrive",
    attio: "Attio",
    folk: "Folk",
    clay: "Clay",
    custom: "Custom CRM",
  };
  return labels[provider] ?? provider.replace(/_/g, " ");
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Unsupported URL protocol.");
    }
    return parsed.toString();
  } catch {
    throw new Error("Enter a valid CRM webhook URL.");
  }
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

export async function getOutlookCalendarConnectIntent(
  session: ProductWorkspaceSession,
): Promise<OutlookCalendarConnectIntent> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return {
    workspace_id: session.workspace_id,
    connect_url: productRouteUrl("/api/auth/outlook?intent=calendar"),
    provider_configured: Boolean(
      process.env.MICROSOFT_CLIENT_ID &&
      process.env.MICROSOFT_CLIENT_SECRET &&
      process.env.SESSION_SECRET,
    ),
    scope: "Calendars.ReadBasic",
  };
}

export async function getProductOutlookCalendarAvailability(
  session: ProductWorkspaceSession,
): Promise<OutlookCalendarAvailability> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return resolveMeetingPrepCalendar(engine, session.workspace_id, session.user_id);
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
  const status =
    payload.transport === "unconfigured" ? "disconnected" : "connected";
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
      JSON.stringify({
        transport: payload.transport,
        configured_event_id: event.id,
      }),
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
  const pattern_key =
    typeof props.pattern_key === "string" ? props.pattern_key : null;
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
      typeof provenance?.pattern_key === "string"
        ? provenance.pattern_key
        : null;
    const messageExemplarIds = Array.isArray(provenance?.exemplar_ids)
      ? provenance.exemplar_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    if (
      rep_id &&
      provenance &&
      messagePatternKey &&
      messageExemplarIds.length > 0
    ) {
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
): {
  pattern_key: string;
  exemplar: Record<string, unknown>;
  initial_score?: number;
} | null {
  const pattern_key =
    typeof properties.seed_pattern_key === "string"
      ? properties.seed_pattern_key
      : null;
  const exemplar =
    properties.seed_exemplar &&
    typeof properties.seed_exemplar === "object" &&
    !Array.isArray(properties.seed_exemplar)
      ? (properties.seed_exemplar as Record<string, unknown>)
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
    typeof provenance.seed_pattern_key === "string"
      ? provenance.seed_pattern_key
      : null;
  if (!pattern_key || !body?.trim()) return null;
  return {
    pattern_key,
    exemplar: {
      subject: subject ?? null,
      body,
    },
  };
}

const SIGNAL_COMPANY_LINKED_PROJECTION = "signal.company_linked.projector.v1";

function createSignalCompanyLinkedProjection(
  engine: ProductEngine,
): DurableEventProjection {
  return {
    name: SIGNAL_COMPANY_LINKED_PROJECTION,
    eventTypes: ["signal.company.linked"],
    apply: (event) =>
      projectSignalCompanyLinked(
        engine.pool,
        event.workspace_id,
        event.payload as never,
        event.id,
      ),
  };
}

function createProductEventProjections(
  engine: ProductEngine,
): DurableEventProjection[] {
  return [
    createWorkflowApprovalProjection(engine.pool),
    {
      name: "workspace.icp_configuration.v1",
      eventTypes: ["workspace.icp.configured"],
      apply: (event) => projectIcpConfigured(engine.pool, event),
    },
    {
      name: "workspace.icp_text.v1",
      eventTypes: ["workspace.icp.text_updated"],
      apply: (event) => projectIcpTextUpdated(engine.pool, event),
    },
    {
      name: "workspace.created.v1",
      eventTypes: ["workspace.created"],
      apply: (event) => projectWorkspaceCreated(engine, event),
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
        await projectSignalDiscovered(
          engine.pool,
          event.workspace_id,
          event.payload as never,
        );
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
            source_id: (event.payload as { source_id: string | null })
              .source_id,
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
        await startSignalMatchingWorkflowForEvent(engine, {
          workspace_id: event.workspace_id,
          signal_id: signalId,
          event_id: event.id,
          correlation_id: event.correlation_id ?? event.id,
        });
      },
    },
    createSignalCompanyLinkedProjection(engine),
    createAccountIntentProjection(engine.pool, engine.bus),
    {
      name: "signal.dismissal.projector.v1",
      eventTypes: ["signal.dismissal.requested"],
      apply: async (event) => {
        const flipped = await projectSignalDismissal(
          engine.pool,
          event.workspace_id,
          event.payload as never,
        );
        if (!flipped) return;
        await engine.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "signal.dismissed",
          source: "system",
          producer_ref: "projection:signal.dismissal.requested",
          correlation_id: event.correlation_id ?? event.id,
          causation_id: event.id,
          idempotency_key: `projection:${event.id}:signal.dismissed`,
          payload: {
            signal_id: (event.payload as { signal_id: string }).signal_id,
            reason: (event.payload as { reason: string }).reason,
          },
        });
      },
    },
    {
      name: "person.fit_feedback.projector.v1",
      eventTypes: ["person.fit_feedback.recorded"],
      apply: async (event) => {
        await projectPersonFitFeedback(
          engine.pool,
          event.workspace_id,
          event.payload as {
            person_id: string;
            decision: ProductPersonFitDecision;
            note?: string | null;
            recorded_by?: string | null;
            recorded_at?: string;
          },
        );
      },
    },
    {
      name: "crm.destination_configuration.v1",
      eventTypes: ["crm.destination.configured"],
      apply: (event) => projectCrmDestinationConfigured(engine.pool, event),
    },
    {
      name: "crm.handoff_queue.projector.v1",
      eventTypes: ["crm.handoff.queued"],
      apply: (event) => projectCrmHandoffQueued(engine.pool, event),
    },
    {
      name: "crm.handoff_webhook_status.projector.v1",
      eventTypes: [
        "crm.handoff.webhook.delivered",
        "crm.handoff.webhook.failed",
      ],
      apply: (event) => projectCrmHandoffWebhookStatus(engine.pool, event),
    },
    {
      name: "signal.classification.projector.v1",
      eventTypes: ["signal.classification.completed"],
      apply: async (event) => {
        await projectSignalClassification(
          engine.pool,
          event.workspace_id,
          event.payload as never,
        );
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
            idempotency_key: `projection:${event.id}:signal.matched:${match.icp_segment}`,
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
    createTrialReminderProjection({
      pool: engine.pool,
    }),
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
    createChannelConnectionReadinessProjection(engine),
  ];
}

function createChannelConnectionReadinessProjection(
  engine: ProductEngine,
): DurableEventProjection {
  return {
    name: "workspace.channel_readiness_on_connection.v1",
    eventTypes: ["channel.account.connected"],
    async apply(event) {
      const payload = event.payload as EventPayload<"channel.account.connected">;
      const { rows } = await engine.pool.query<{ status: string }>(
        `select status::text as status
           from channel_accounts
          where workspace_id = $1
            and id = $2
            and kind::text = $3
          limit 1`,
        [event.workspace_id, payload.channel_account_id, payload.kind],
      );
      if (rows[0]?.status !== "connected") {
        throw new Error(
          `Channel readiness refresh waiting for connected account ${payload.channel_account_id}`,
        );
      }
      await registerWorkspaceChannelReadinessWorkflow(engine);
      await engine.runtime.start<
        ChannelReadinessGraphInput,
        BombsellLangGraphState
      >({
        workspace_id: event.workspace_id,
        workflow_name: WORKSPACE_CHANNEL_READINESS_WORKFLOW,
        idempotency_key: `channel.readiness.connected:${event.id}`,
        correlation_id: event.correlation_id ?? event.id,
        causation_id: event.id,
        input: {
          workspace_id: event.workspace_id,
          user_id: userIdFromProducerRef(event.producer_ref),
          required_channel: "any",
          thread_id: `channel-readiness:${event.workspace_id}:connected`,
          correlation_id: event.correlation_id ?? event.id,
          causation_event_id: event.id,
        },
      });
    },
  };
}

function userIdFromProducerRef(producer_ref: string | null): string {
  const maybeUser = producer_ref?.startsWith("user:")
    ? producer_ref.slice("user:".length)
    : null;
  return maybeUser &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      maybeUser,
    )
    ? maybeUser
    : DEFAULT_PRODUCT_USER_ID;
}

async function projectVisibleProductState(
  engine: ProductEngine,
): Promise<void> {
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
  if (!domain)
    throw new Error(
      "Configure an email sender before provisioning its domain.",
    );
  if (operation !== "provision" && !domain.provider_domain_id) {
    throw new Error(
      "Provision the sending domain before requesting verification.",
    );
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
      ...(input.source_tier ? { source_tier: input.source_tier } : {}),
      ...(typeof input.source_authority === "number"
        ? { source_authority: input.source_authority }
        : {}),
      ...(input.source_reason ? { source_reason: input.source_reason } : {}),
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
      kind:
        input.signal_kind == null ? null : parseSignalKind(input.signal_kind),
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
      kind:
        input.signal_kind == null ? null : parseSignalKind(input.signal_kind),
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
    case "greenhouse":
    case "lever":
    case "ashby":
    case "workable":
    case "sec_edgar":
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

function sourceKindForAdapter(
  adapter: WorkspaceSignalSourceAdapter,
): SourceKind {
  switch (adapter) {
    case "product_hunt":
      return "product_hunt";
    case "hn_front":
    case "hn_whos_hiring":
      return "hn";
    case "greenhouse":
    case "lever":
    case "ashby":
    case "workable":
      return "job_board";
    case "rss":
    case "google_news":
      return "rss";
    case "sec_edgar":
      return "web_monitor";
    case "exa":
      return "web_monitor";
    case "reddit":
    case "x_search":
      return "other";
    case "webhook":
      return "web_monitor";
  }
}

function defaultWorkspaceSourceName(
  adapter: WorkspaceSignalSourceAdapter,
): string {
  switch (adapter) {
    case "greenhouse":
      return "Greenhouse hiring";
    case "lever":
      return "Lever hiring";
    case "ashby":
      return "Ashby hiring";
    case "workable":
      return "Workable hiring";
    case "sec_edgar":
      return "SEC EDGAR filings";
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
    ...(input.source_tier ? { source_tier: input.source_tier } : {}),
    ...(typeof input.source_authority === "number"
      ? { source_authority: input.source_authority }
      : {}),
    ...(input.source_reason ? { source_reason: input.source_reason } : {}),
  };
  switch (adapter) {
    case "greenhouse":
    case "lever":
    case "ashby":
    case "workable":
      return {
        ...base,
        board_slug: input.board_slug?.trim() || input.name.trim(),
        company_name: input.company_name?.trim() || input.name.trim(),
        company_domain: input.company_domain?.trim(),
        website_url: input.website_url?.trim(),
        industry: input.industry?.trim(),
        size_bucket: input.size_bucket?.trim(),
        max_items_per_poll: 10,
      };
    case "sec_edgar":
      return {
        ...base,
        sec_cik: input.sec_cik?.trim() || input.board_slug?.trim(),
        company_name: input.company_name?.trim() || input.name.trim(),
        company_domain: input.company_domain?.trim(),
        website_url: input.website_url?.trim(),
        max_items_per_poll: 10,
      };
    case "google_news":
      return {
        ...base,
        query: input.query?.trim() || input.name.trim() || "B2B SaaS hiring",
        max_items_per_poll: 10,
      };
    case "reddit":
      return {
        ...base,
        subreddit: input.subreddit?.trim() || "SaaS",
      };
    case "x_search":
      return {
        ...base,
        provider: signalSourceProvider(input.provider) ?? "twitterapi_io",
        query: input.query?.trim() || input.name.trim(),
        limit: positiveInteger(input.limit) ?? 25,
        max_items_per_poll: 10,
        ...(input.bypass_icp_filter ? { bypass_icp_filter: true } : {}),
        ...(sourceQuotaConfig(input) ?? {}),
      };
    case "exa":
      return {
        ...base,
        provider: "exa",
        query: input.query?.trim() || input.name.trim(),
        limit: positiveInteger(input.limit) ?? 10,
        type: input.search_type ?? "auto",
        category: input.category?.trim() || undefined,
        include_domains: cleanedStringArray(input.include_domains),
        exclude_domains: cleanedStringArray(input.exclude_domains),
        start_published_date: input.start_published_date?.trim() || undefined,
        platforms: cleanedStringArray(input.platforms),
        intent_presets: cleanedStringArray(input.intent_presets),
        include_text: true,
        text_max_characters: 1600,
        highlights: true,
        summary: true,
        ...(input.bypass_icp_filter ? { bypass_icp_filter: true } : {}),
        ...(sourceQuotaConfig(input) ?? {}),
      };
    case "webhook":
      const provider = signalSourceProvider(input.provider) ?? "generic";
      const websiteUrl = normalizePublicHttpUrl(
        input.website_url?.trim() || input.url?.trim(),
      );
      const companyDomain =
        normalizePublicHostname(input.company_domain?.trim()) ??
        publicHostnameFromUrl(websiteUrl);
      return {
        ...base,
        provider,
        query: input.query?.trim() || undefined,
        company_domain: companyDomain ?? undefined,
        website_url: websiteUrl ?? undefined,
        ...(provider === "bombsell_script" && companyDomain
          ? { allowed_origins: [companyDomain] }
          : {}),
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
        max_items_per_poll: 10,
      };
    case "hn_front":
    case "hn_whos_hiring":
      return { ...base, max_items_per_poll: 10 };
    case "rss":
      return {
        ...base,
        url: input.url?.trim(),
        company_name: input.company_name?.trim(),
        company_domain: input.company_domain?.trim(),
        website_url: input.website_url?.trim(),
        max_items_per_poll: 10,
      };
  }
}

function isPushSignalSourceAdapter(
  adapter: WorkspaceSignalSourceAdapter,
): boolean {
  return adapter === "webhook";
}

function signalSourceProvider(provider: unknown): string | undefined {
  if (typeof provider !== "string") return undefined;
  const normalized = provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_");
  return normalized || undefined;
}

function cleanedStringArray(
  values: readonly string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const cleaned = dedupeStringList(values);
  return cleaned.length ? cleaned : undefined;
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

function defaultSignalKindForAdapter(
  adapter: WorkspaceSignalSourceAdapter,
): string {
  switch (adapter) {
    case "hn_whos_hiring":
    case "greenhouse":
    case "lever":
    case "ashby":
    case "workable":
      return "hiring";
    case "sec_edgar":
      return "other";
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
    throw new ProductEnvironmentError("signal classification", [
      "DEEPSEEK_API_KEY",
    ]);
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
          reason:
            "Local deterministic classifier matched the configured signal kind.",
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

function createProductReplyIntentClassifier(
  engine: ProductEngine,
  workspace_id: string,
): IntentClassifier {
  const llm = createGovernedLLM(engine, workspace_id, "classifier.reply");
  if (llm) return createDeepSeekIntentClassifier({ llm });
  if (isProductionProductRuntime()) {
    throw new ProductEnvironmentError("reply triage", ["DEEPSEEK_API_KEY"]);
  }
  return createLocalReplyIntentClassifier();
}

function createLocalReplyIntentClassifier(): IntentClassifier {
  return {
    async classify(input) {
      const text = `${input.subject}\n${input.body_text}`.toLowerCase();
      if (/\b(unsubscribe|remove me|opt out)\b/.test(text)) {
        return {
          intent: "unsubscribe",
          confidence: 0.95,
          reason: "Local classifier found an unsubscribe request.",
        };
      }
      if (
        /\b(do not contact|never contact|legal|spam complaint)\b/.test(text)
      ) {
        return {
          intent: "do_not_contact",
          confidence: 0.95,
          reason: "Local classifier found a do-not-contact request.",
        };
      }
      if (/\b(out of office|ooo|on leave|vacation)\b/.test(text)) {
        return {
          intent: "ooo",
          confidence: 0.8,
          reason: "Local classifier found an out-of-office pattern.",
        };
      }
      if (
        /\b(not interested|no thanks|not a priority|no budget)\b/.test(text)
      ) {
        return {
          intent: "negative",
          confidence: 0.78,
          reason: "Local classifier found a negative reply pattern.",
        };
      }
      if (
        /\b(book|meeting|calendar|chat|call|available|availability|time[s]?|schedule)\b/.test(
          text,
        )
      ) {
        return {
          intent: "meeting_intent",
          confidence: 0.86,
          reason: "Local classifier found explicit scheduling intent.",
        };
      }
      if (/\b(interested|send me|tell me more)\b/.test(text)) {
        return {
          intent: "positive",
          confidence: 0.82,
          reason: "Local classifier found buying-interest language.",
        };
      }
      return {
        intent: "neutral",
        confidence: 0.55,
        reason: "Local classifier found no decisive reply intent.",
      };
    },
  };
}

function createProductEmailTransport(): EmailTransport | undefined {
  if (resolveProductEmailTransportMode() === "resend") {
    return createResendEmailTransport({ apiKey: process.env.RESEND_API_KEY! });
  }
  return isProductionProductRuntime()
    ? undefined
    : createDryRunEmailTransport();
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

async function resolveMeetingPrepCalendar(
  engine: ProductEngine,
  workspace_id: string,
  user_id: string,
): Promise<OutlookCalendarAvailability> {
  const outlook = createProductOutlookSender(engine.pool, engine.bus);
  if (!outlook) {
    return {
      consented: false,
      provider: "outlook",
      channel_account_id: null,
      account_display_name: null,
      suggested_times: [],
      reason: "calendar_not_configured",
    };
  }
  return getOutlookCalendarAvailability({
    pool: engine.pool,
    accessTokens: outlook,
    workspace_id,
    user_id,
  });
}

function createGovernedJudge(engine: ProductEngine, workspace_id: string) {
  const fallback = createHeuristicJudge({ threshold: 0.55 });
  const llm = createGovernedLLM(engine, workspace_id, "judge.hot_path");
  if (!llm) return fallback;
  return createFallbackJudge({
    primary: createDeepSeekJudge({
      llm,
      threshold: 0.6,
      throwOnMalformed: true,
    }),
    fallback,
    shouldFallback: (error) =>
      isLLMBudgetExceededError(error) || isMalformedJudgeResponseError(error),
  });
}

function registerSignalEmailWorkflow(
  engine: ProductEngine,
  workspace_id?: string,
): void {
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
      email: createDatabaseBackedEmailChannel(
        engine.pool,
        transport,
        engine.bus,
      ),
      bus: engine.bus,
      workspaceContextProvider: (input) =>
        getWorkflowWorkspaceContext(engine, input.workspace_id),
      draftGroundingProvider: (input) =>
        groundDraftWithExaForWorkflow(engine, input),
    }),
  );
}

function registerReplyEmailWorkflow(
  engine: ProductEngine,
  workspace_id?: string,
): void {
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
      email: createDatabaseBackedEmailChannel(
        engine.pool,
        transport,
        engine.bus,
      ),
      bus: engine.bus,
      workspaceContextProvider: (input) =>
        getWorkflowWorkspaceContext(engine, input.workspace_id),
    }),
  );
}

function registerContactResolutionWorkflow(engine: ProductEngine): void {
  engine.runtime.register(
    createContactResolutionWorkflow({
      pool: engine.pool,
      ...createContactResolutionProviders({ pool: engine.pool }),
    }),
  );
}

function registerContactResolutionRetryWorkflow(engine: ProductEngine): void {
  engine.runtime.register(createContactResolutionRetryWorkflow());
}

async function registerWorkspaceActivationSetupWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceActivationSetupWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceProfileIcpWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceProfileIcpWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceSignalMatchingWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceSignalMatchingWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceSignalIngestionWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceSignalIngestionWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceCampaignStrategyWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceCampaignStrategyWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceSkillOptimizerWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceSkillOptimizerWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceChannelReadinessWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceChannelReadinessWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceCompanyBrainWorkflows(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceCompanyBrainRecallWorkflow({
      bus: engine.bus,
    }),
  );
  engine.runtime.register(
    createWorkspaceCompanyBrainBriefWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceContactWaterfallWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceContactWaterfallWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceEvalGateWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceEvalGateWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceMeetingPrepWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceMeetingPrepWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceMessagePersonalizationWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceMessagePersonalizationWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceOutreachSkillSelectionWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceOutreachSkillSelectionWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceReplyTriageWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceReplyTriageWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceSourceDiscoveryWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceSourceDiscoveryWorkflow({
      bus: engine.bus,
    }),
  );
}

async function registerWorkspaceVerticalIntelligenceWorkflow(
  engine: ProductEngine,
): Promise<void> {
  const { registerProductTools } = await import("./tools.ts");
  registerProductTools();
  engine.runtime.register(
    createWorkspaceVerticalIntelligenceWorkflow({
      bus: engine.bus,
    }),
  );
}

async function startSignalMatchingWorkflowForEvent(
  engine: ProductEngine,
  input: {
    workspace_id: string;
    signal_id: string;
    event_id: string;
    correlation_id: string;
  },
): Promise<boolean> {
  const user_id = await getWorkflowUserId(engine.pool, input.workspace_id);
  if (!user_id) return false;
  await registerWorkspaceSignalMatchingWorkflow(engine);
  await engine.runtime.start<LeadMatchingGraphInput, BombsellLangGraphState>({
    workspace_id: input.workspace_id,
    workflow_name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
    idempotency_key: signalMatchingIdempotencyKey(
      input.workspace_id,
      input.signal_id,
    ),
    correlation_id: input.correlation_id,
    causation_id: input.event_id,
    input: {
      workspace_id: input.workspace_id,
      user_id,
      signal_id: input.signal_id,
      thread_id: `signal-match:${input.workspace_id}:${input.signal_id}`,
      correlation_id: input.correlation_id,
      causation_event_id: input.event_id,
    },
  });
  return true;
}

function signalMatchingIdempotencyKey(
  workspace_id: string,
  signal_id: string,
): string {
  return `signal-match:${workspace_id}:${signal_id}`;
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

async function getWorkflowUserId(
  pool: Pool,
  workspace_id: string,
): Promise<string | null> {
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
  if (!process.env.EXA_API_KEY?.trim()) return null;
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
    throw new ProductEnvironmentError("signal ingestion embeddings", [
      "OPENAI_API_KEY",
    ]);
  }
  return createMockEmbeddingClient();
}

function registerSendingDomainProvisioningWorkflow(
  engine: ProductEngine,
): void {
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

async function registerExaRecommendationWorkflows(
  engine: ProductEngine,
): Promise<void> {
  const { createExaAeoAuditWorkflow, createExaContentOpportunityWorkflow } =
    await import("../exa/workflows.ts");
  engine.runtime.register(createExaContentOpportunityWorkflow());
  engine.runtime.register(createExaAeoAuditWorkflow());
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
    resolveConnectedAccountUserId: (workspace_id) =>
      getWorkflowUserId(pool, workspace_id),
  });
}

async function createDatabaseBackedLinkedInChannel(
  pool: Pool,
  _workspace_id: string,
  action: LinkedInChannelName,
): Promise<LinkedInChannel> {
  return createPostgresLinkedInChannel({
    pool,
    defaultAction: action,
    resolveConnectedAccountUserId: (workspace_id) =>
      getWorkflowUserId(pool, workspace_id),
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
    repair_key?: string | null;
    campaign_allocation?: CampaignDispatchAllocation | null;
    campaign_recommendation_id?: string | null;
  },
) {
  const store = createPostgresVerticalSliceStore(engine.pool);
  const signal = await store.getSignal(input.signal_id);
  if (!signal) throw new Error(`Signal not found: ${input.signal_id}`);
  const person = await store.getPerson(input.person_id);
  if (!person) throw new Error(`Person not found: ${input.person_id}`);
  const transport = createProductEmailTransport();
  const email = createDatabaseBackedEmailChannel(
    engine.pool,
    transport,
    engine.bus,
  );
  const writerLlm = createGovernedLLM(
    engine,
    input.workspace_id,
    "writer.email",
  );
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
    idempotency_key: signalPlayIdempotencyKey(
      signal.id,
      input.play_id,
      input.repair_key,
    ),
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
      skill_key: input.campaign_allocation?.skill_key ?? null,
      skill_version: input.campaign_allocation?.skill_version ?? null,
      segment_key: input.campaign_allocation?.segment_key ?? null,
      campaign_strategy: input.campaign_allocation
        ? {
            recommendation_id: input.campaign_recommendation_id ?? null,
            variant_key: input.campaign_allocation.variant_key,
            matched_variant_key: input.campaign_allocation.matched_variant_key,
            recommendation: input.campaign_allocation.recommendation,
            allocation_weight: input.campaign_allocation.allocation_weight,
            reason: input.campaign_allocation.reason,
          }
        : null,
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
    repair_key?: string | null;
    campaign_allocation?: CampaignDispatchAllocation | null;
    campaign_recommendation_id?: string | null;
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
  const writerLlm = createGovernedLLM(
    engine,
    input.workspace_id,
    "writer.linkedin",
  );
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
  return engine.runtime.start<
    SignalToLinkedInPlayInput,
    SignalToLinkedInPlayOutput
  >({
    workspace_id: input.workspace_id,
    workflow_name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
    play_id: input.play_id,
    play_run_id,
    idempotency_key: signalPlayIdempotencyKey(
      signal.id,
      input.play_id,
      input.repair_key,
    ),
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
      skill_key: input.campaign_allocation?.skill_key ?? null,
      skill_version: input.campaign_allocation?.skill_version ?? null,
      segment_key: input.campaign_allocation?.segment_key ?? null,
      campaign_strategy: input.campaign_allocation
        ? {
            recommendation_id: input.campaign_recommendation_id ?? null,
            variant_key: input.campaign_allocation.variant_key,
            matched_variant_key: input.campaign_allocation.matched_variant_key,
            recommendation: input.campaign_allocation.recommendation,
            allocation_weight: input.campaign_allocation.allocation_weight,
            reason: input.campaign_allocation.reason,
          }
        : null,
    },
  });
}

async function startContactResolution(
  engine: ProductEngine,
  input: ContactResolutionInput,
) {
  registerContactResolutionWorkflow(engine);
  return engine.runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: input.workspace_id,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    idempotency_key: contactResolutionIdempotencyKey(input),
    correlation_id: input.trigger_event_id ?? undefined,
    causation_id: input.trigger_event_id ?? undefined,
    input,
  });
}

function contactResolutionIdempotencyKey(
  input: ContactResolutionInput,
): string {
  const base = `contact:${input.signal_id}:play:${input.play_id}:channel:${input.channel}`;
  const repairKey = sanitizeContactResolutionRepairKey(input.repair_key);
  return repairKey ? `${base}:repair:${repairKey}` : base;
}

function signalPlayIdempotencyKey(
  signalId: string,
  playId: string,
  repairKey: string | null | undefined,
): string {
  const base = `signal:${signalId}:play:${playId}`;
  const safeRepairKey = sanitizeContactResolutionRepairKey(repairKey);
  return safeRepairKey ? `${base}:repair:${safeRepairKey}` : base;
}

function sanitizeContactResolutionRepairKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 64);
  return safe || null;
}

function contactChannelForTarget(targetChannel: string): ContactChannel {
  return targetChannel === "email" ? "email" : "linkedin";
}

function contactResolverRepairKey(row: {
  resolver_run_id: string | null;
  resolver_idempotency_key: string | null;
  resolver_status: string | null;
  resolver_output: Record<string, unknown> | null;
}): string | null {
  if (!row.resolver_run_id) return null;
  if (
    row.resolver_idempotency_key?.endsWith(
      `:repair:${CONTACT_RESOLUTION_REPAIR_KEY}`,
    )
  ) {
    return null;
  }
  if (row.resolver_status === "failed") return CONTACT_RESOLUTION_REPAIR_KEY;
  if (row.resolver_status !== "completed") return null;
  if (row.resolver_output?.decision !== "deferred") return null;
  if (typeof row.resolver_output?.selected_person_id === "string") return null;
  return CONTACT_RESOLUTION_REPAIR_KEY;
}

function signalPlayRepairKey(row: {
  existing_run_status: string | null;
  existing_run_output: Record<string, unknown> | null;
  existing_draft_message_id: string | null;
  existing_rejection_reason: string | null;
}): string | null {
  if (row.existing_run_status === "failed" && !row.existing_draft_message_id) {
    return SIGNAL_PLAY_REPAIR_KEY;
  }
  if (
    row.existing_run_status === "completed" &&
    row.existing_run_output?.decision === "rejected" &&
    isRepairableDraftRejection(row.existing_rejection_reason)
  ) {
    return SIGNAL_PLAY_REJUDGE_REPAIR_KEY;
  }
  return null;
}

function isRepairableDraftRejection(
  reason: string | null | undefined,
): boolean {
  return /being an ai|as an ai|ai language model|language model|judge returned non-json response/i.test(
    reason ?? "",
  );
}

interface SignalDispatchRow {
  event_id: string;
  event_occurred_at: Date;
  match_score: number | null;
  workspace_id: string;
  signal_id: string;
  signal_title: string;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  signal_url: string | null;
  company_has_linkedin_identity: boolean;
  resolved_person_id: string | null;
  resolved_person_fit_decision: string | null;
  resolver_run_id: string | null;
  resolver_idempotency_key: string | null;
  resolver_status: string | null;
  resolver_output: Record<string, unknown> | null;
  existing_run_status: string | null;
  existing_run_output: Record<string, unknown> | null;
  existing_draft_message_id: string | null;
  existing_rejection_reason: string | null;
  play_id: string;
  play_name: string;
  rep_id: string;
  workflow_name: string;
  target_channel: string;
  signal_kind: string;
  signal_audience_hint: Record<string, unknown>;
  segment_key: string | null;
  signal_properties: Record<string, unknown>;
  play_autonomy: Record<string, unknown>;
}

interface LinkedInAcceptedFollowupDispatchRow {
  accepted_event_id: string;
  workspace_id: string;
  signal_id: string;
  person_id: string;
  play_id: string;
  rep_id: string;
  signal_properties: Record<string, unknown>;
  play_autonomy: Record<string, unknown> | null;
}

type SignalDispatchCandidate = CampaignDispatchCandidate & {
  row: SignalDispatchRow;
  original_index: number;
};

async function latestCampaignDispatchStrategy(
  pool: Pool,
  workspace_id: string,
): Promise<CampaignDispatchStrategy | null> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `select payload
       from events
      where workspace_id = $1
        and event_type = 'campaign.strategy.recommended'
      order by occurred_at desc
      limit 1`,
    [workspace_id],
  );
  return campaignDispatchStrategyFromPayload(rows[0]?.payload);
}

function campaignDispatchStrategyFromPayload(
  payload: Record<string, unknown> | null | undefined,
): CampaignDispatchStrategy | null {
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const parsed = variants
    .map((variant) =>
      variant && typeof variant === "object" && !Array.isArray(variant)
        ? campaignDispatchStrategyVariantFromRecord(
            variant as Record<string, unknown>,
          )
        : null,
    )
    .filter(
      (variant): variant is CampaignDispatchStrategy["variants"][number] =>
        Boolean(variant),
    );
  if (parsed.length === 0) return null;
  return {
    recommendation_id: stringOrNull(payload?.recommendation_id),
    generated_at: stringOrNull(payload?.generated_at),
    variants: parsed,
  };
}

function campaignDispatchStrategyVariantFromRecord(
  variant: Record<string, unknown>,
): CampaignDispatchStrategy["variants"][number] | null {
  const recommendation = campaignOptimizerRecommendationValue(
    variant.recommendation,
  );
  const play_id = stringOrNull(variant.play_id);
  const variant_key = stringOrNull(variant.variant_key);
  const skill_key = stringOrNull(variant.skill_key);
  const pattern_key = stringOrNull(variant.pattern_key);
  if (!recommendation || !play_id || !variant_key || !skill_key || !pattern_key)
    return null;
  return {
    variant_key,
    play_id,
    channel: stringOrNull(variant.channel),
    skill_key,
    segment_key: stringOrNull(variant.segment_key) ?? "all",
    allocation_weight: numberOrDefault(variant.allocation_weight, 0.2),
    recommendation,
    explanation: stringOrNull(variant.explanation),
  };
}

function campaignOptimizerRecommendationValue(
  value: unknown,
): CampaignOptimizerRecommendation | null {
  return value === "double_down" ||
    value === "hold" ||
    value === "reduce" ||
    value === "not_enough_proof"
    ? value
    : null;
}

function signalDispatchCampaignCandidate(
  row: SignalDispatchRow,
): CampaignDispatchCandidate {
  const action =
    row.workflow_name === SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW
      ? (parseLinkedInAction(row.target_channel) ?? "linkedin_dm")
      : null;
  const channel = action ?? "email";
  const selectedSkill = selectOutreachSkill({
    channel: channel as OutreachSkillChannel,
    stage: "cold_open",
    signal_kind: row.signal_kind,
    action: action as OutreachSkillChannel | null,
  });
  return {
    play_id: row.play_id,
    play_name: row.play_name,
    channel,
    skill_key: selectedSkill.skill_key,
    skill_version: selectedSkill.version,
    segment_key:
      row.segment_key ??
      stringOrNull(row.signal_audience_hint.icp_segment) ??
      "all",
  };
}

function signalDispatchCampaignSkipIdempotencyKey(
  row: SignalDispatchRow,
  allocation: CampaignDispatchAllocation,
): string {
  return [
    "campaign-dispatch-skip",
    `signal:${row.signal_id}`,
    `play:${row.play_id}`,
    `variant:${allocation.matched_variant_key ?? allocation.variant_key}`,
    `strategy:${allocation.recommendation_id ?? "none"}`,
  ].join(":");
}

async function publishCampaignDispatchSkipped(
  engine: ProductEngine,
  row: SignalDispatchRow,
  allocation: CampaignDispatchAllocation,
): Promise<void> {
  await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "campaign.dispatch.skipped",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: signalDispatchCampaignSkipIdempotencyKey(row, allocation),
    payload: {
      signal_id: row.signal_id,
      play_id: row.play_id,
      play_name: row.play_name,
      channel: allocation.channel,
      skill_key: allocation.skill_key,
      skill_version: allocation.skill_version,
      segment_key: allocation.segment_key,
      variant_key: allocation.variant_key,
      matched_variant_key: allocation.matched_variant_key,
      recommendation_id: allocation.recommendation_id,
      strategy_generated_at: allocation.strategy_generated_at,
      recommendation: allocation.recommendation,
      allocation_weight: allocation.allocation_weight,
      reason: allocation.reason,
      skipped_at: new Date().toISOString(),
    },
  });
}

async function loadPersonContactFitDecision(
  pool: Pool,
  workspace_id: string,
  person_id: string,
): Promise<ProductPersonFitDecision | null> {
  const { rows } = await pool.query<{ decision: string | null }>(
    `select properties #>> '{contact_fit,decision}' as decision
       from graph_persons
      where workspace_id = $1
        and id = $2
      limit 1`,
    [workspace_id, person_id],
  );
  return personFitDecisionOrNull(rows[0]?.decision);
}

function personFitDecisionOrNull(
  value: unknown,
): ProductPersonFitDecision | null {
  return value === "fit" || value === "not_fit" || value === "unsure"
    ? value
    : null;
}

async function publishSignalOutreachGated(
  engine: ProductEngine,
  row: SignalDispatchRow,
  person_id: string,
  channel: string,
): Promise<void> {
  await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "signal.outreach.gated",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: [
      "signal-outreach-gated",
      `signal:${row.signal_id}`,
      `play:${row.play_id}`,
      `person:${person_id}`,
      "gate:contact_fit",
    ].join(":"),
    payload: {
      signal_id: row.signal_id,
      play_id: row.play_id,
      person_id,
      channel,
      gate: "contact_fit",
      decision: "not_fit",
      reason: "Human fit feedback marked this contact as not a fit.",
      gated_at: new Date().toISOString(),
    },
  });
}

async function publishSignalResearchGated(
  engine: ProductEngine,
  row: SignalDispatchRow,
  reasons: Array<
    "missing_company_name" | "missing_signal_evidence" | "missing_company_identity"
  >,
): Promise<void> {
  await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "signal.outreach.gated",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: [
      "signal-outreach-gated",
      `signal:${row.signal_id}`,
      `play:${row.play_id}`,
      "gate:research_quality",
    ].join(":"),
    payload: {
      signal_id: row.signal_id,
      play_id: row.play_id,
      person_id: null,
      channel: contactChannelForTarget(row.target_channel),
      gate: "research_quality",
      decision: "incomplete",
      reasons,
      reason: "Signal is missing required company identity or source evidence.",
      gated_at: new Date().toISOString(),
    },
  });
}

async function publishRelationshipSignalAttached(
  engine: ProductEngine,
  row: SignalDispatchRow,
  conversation_id: string,
  role: "primary" | "supporting",
  reason: string,
): Promise<void> {
  const event = await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "conversation.signal.attached",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: [
      "conversation-signal-attached",
      `conversation:${conversation_id}`,
      `signal:${row.signal_id}`,
      `role:${role}`,
    ].join(":"),
    payload: {
      conversation_id,
      signal_id: row.signal_id,
      role,
      reason,
      score: row.match_score,
      attached_at: new Date().toISOString(),
    },
  });
  await createConversationLifecycleProjection(engine.pool).apply(event);
}

async function ensureRelationshipConversation(
  engine: ProductEngine,
  row: SignalDispatchRow,
  person_id: string,
): Promise<string> {
  const conversation_id = deterministicConversationId({
    workspace_id: row.workspace_id,
    counterparty_person_id: person_id,
    counterparty_company_id: row.company_id,
  });
  const event = await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "conversation.opened",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: [
      "relationship-conversation-opened",
      `person:${person_id}`,
      `company:${row.company_id ?? "none"}`,
    ].join(":"),
    payload: {
      conversation_id,
      rep_id: row.rep_id,
      counterparty_person_id: person_id,
      counterparty_company_id: row.company_id,
      origin_signal_id: row.signal_id,
      topic: row.signal_title,
      properties: {
        play_id: row.play_id,
        arbitration: "pre_draft",
      },
      opened_at: new Date().toISOString(),
    },
  });
  await createConversationLifecycleProjection(engine.pool).apply(event);
  return conversation_id;
}

async function publishSignalOutreachSuppressed(
  engine: ProductEngine,
  input: {
    row: SignalDispatchRow;
    conversation_id: string;
    person_id: string;
    channel: string;
    reason:
      | "better_signal_selected"
      | "recipient_cooldown"
      | "conversation_active"
      | "conversation_blocked";
    selected_signal_id?: string | null;
    retry_after: string | null;
  },
): Promise<void> {
  const { row } = input;
  await publishRelationshipSignalAttached(
    engine,
    row,
    input.conversation_id,
    "supporting",
    input.reason,
  );
  await engine.bus.publish({
    workspace_id: row.workspace_id,
    event_type: "signal.outreach.suppressed",
    source: "system",
    producer_ref: "product.dispatchSignalPlaysOnce",
    correlation_id: row.event_id,
    causation_id: row.event_id,
    idempotency_key: [
      "signal-outreach-suppressed",
      `signal:${row.signal_id}`,
      `play:${row.play_id}`,
      `reason:${input.reason}`,
      `retry:${input.retry_after ?? "none"}`,
    ].join(":"),
    payload: {
      signal_id: row.signal_id,
      play_id: row.play_id,
      conversation_id: input.conversation_id,
      person_id: input.person_id,
      company_id: row.company_id,
      channel: input.channel,
      reason: input.reason,
      selected_signal_id: input.selected_signal_id ?? null,
      retry_after: input.retry_after,
      suppressed_at: new Date().toISOString(),
    },
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(1, numeric))
    : fallback;
}

export async function dispatchSignalPlaysOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  registerSignalEmailWorkflow(engine);
  registerContactResolutionWorkflow(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const dispatchLimit = opts.limit ?? 25;
  const repairLimit = dispatchLimit;
  const candidateLimit = Math.max(dispatchLimit, dispatchLimit * 4);
  const repaired = await repairMatchedSignalCompanyLinksOnce(
    { pool: engine.pool, bus: engine.bus },
    { workspace_id: session?.workspace_id ?? null, limit: repairLimit },
  );
  if (repaired > 0 && engine.substrateMode === "postgres") {
    await runDurableEventProjectionsOnce(
      engine.pool,
      [createSignalCompanyLinkedProjection(engine)],
      {
        leaseOwner:
          opts.leaseOwner ??
          `signal-company-link:${process.pid}:${randomBytes(4).toString("hex")}`,
        limit: Math.max(repaired, repairLimit),
        leaseMs: opts.leaseMs,
      },
    );
  }
  const { rows } = await engine.pool.query<SignalDispatchRow>(
    `select e.id as event_id,
            e.occurred_at as event_occurred_at,
            nullif(e.payload->>'match_score', '')::float8 as match_score,
            e.workspace_id,
            e.payload->>'signal_id' as signal_id,
            s.title as signal_title,
            s.related_company_id::text as company_id,
            co.name as company_name,
            co.domain::text as company_domain,
            s.url as signal_url,
            exists (
              select 1
                from graph_persons identity_person
               where identity_person.workspace_id = s.workspace_id
                 and (
                   identity_person.id = s.related_person_id
                   or identity_person.company_id = s.related_company_id
                 )
                 and identity_person.linkedin_url ~* '^https?://(www\.)?linkedin\.com/(in|company)/'
            ) as company_has_linkedin_identity,
            resolved.payload->>'selected_person_id' as resolved_person_id,
            fit_person.properties #>> '{contact_fit,decision}' as resolved_person_fit_decision,
            resolver.id::text as resolver_run_id,
            resolver.idempotency_key as resolver_idempotency_key,
            resolver.status as resolver_status,
            resolver.output as resolver_output,
            coalesce(repair_wr.status::text, wr.status::text) as existing_run_status,
            coalesce(repair_wr.output, wr.output) as existing_run_output,
            existing_draft.message_id::text as existing_draft_message_id,
            existing_rejection.payload->>'reason' as existing_rejection_reason,
            p.id as play_id,
            p.name as play_name,
            p.default_rep_id as rep_id,
            coalesce(p.compiled->>'workflow', $1) as workflow_name,
            coalesce(p.compiled->>'channel', 'email') as target_channel,
            s.kind::text as signal_kind,
            coalesce(s.audience_hint, '{}'::jsonb) as signal_audience_hint,
            coalesce(
              s.audience_hint->>'icp_segment',
              p.compiled #>> '{icp,name}',
              p.compiled #>> '{trigger,filter,kind}'
            ) as segment_key,
            s.properties as signal_properties,
            p.autonomy as play_autonomy
       from events e
       join signals s
         on s.id = (e.payload->>'signal_id')::uuid
        and s.workspace_id = e.workspace_id
       join graph_companies co
         on co.workspace_id = s.workspace_id
        and co.id = s.related_company_id
       join plays p
         on p.workspace_id = e.workspace_id
        and p.status = 'active'
        and p.default_rep_id is not null
        and p.compiled->'trigger'->>'kind' = 'signal'
        and (
          p.compiled #>> '{trigger,filter,kind}' is null
          or p.compiled #>> '{trigger,filter,kind}' = s.kind::text
        )
       left join lateral (
         select strategy.occurred_at
           from events strategy
          where strategy.workspace_id = e.workspace_id
            and strategy.event_type = 'campaign.strategy.recommended'
          order by strategy.occurred_at desc
          limit 1
       ) latest_strategy on true
       left join lateral (
         select skipped.id
           from events skipped
          where skipped.workspace_id = e.workspace_id
            and skipped.event_type = 'campaign.dispatch.skipped'
            and skipped.payload->>'signal_id' = e.payload->>'signal_id'
            and skipped.payload->>'play_id' = p.id::text
            and (
              latest_strategy.occurred_at is null
              or skipped.occurred_at >= latest_strategy.occurred_at
            )
          order by skipped.occurred_at desc
          limit 1
       ) campaign_skip on true
       left join lateral (
         select gated.id
           from events gated
          where gated.workspace_id = e.workspace_id
            and gated.event_type = 'signal.outreach.gated'
            and gated.payload->>'signal_id' = e.payload->>'signal_id'
            and gated.payload->>'play_id' = p.id::text
            and gated.payload->>'gate' = 'research_quality'
          order by gated.occurred_at desc
          limit 1
       ) research_gate on true
       left join lateral (
         select suppressed.payload
           from events suppressed
          where suppressed.workspace_id = e.workspace_id
            and suppressed.event_type = 'signal.outreach.suppressed'
            and suppressed.payload->>'signal_id' = e.payload->>'signal_id'
            and suppressed.payload->>'play_id' = p.id::text
          order by suppressed.occurred_at desc
          limit 1
       ) relationship_suppression on true
       left join lateral (
         select cr.payload
           from events cr
          where cr.workspace_id = e.workspace_id
            and cr.event_type = 'contact.resolved'
            and cr.payload->>'signal_id' = e.payload->>'signal_id'
            and cr.payload->>'play_id' = p.id::text
            and cr.payload->>'channel' =
              case
                when coalesce(p.compiled->>'channel', 'email') = 'email' then 'email'
                else 'linkedin'
              end
          order by cr.occurred_at desc
          limit 1
       ) resolved on true
       left join graph_persons fit_person
         on fit_person.workspace_id = e.workspace_id
        and fit_person.id = (resolved.payload->>'selected_person_id')::uuid
       left join workflow_runs wr
         on wr.workspace_id = e.workspace_id
        and wr.workflow_name = coalesce(p.compiled->>'workflow', $1)
        and wr.idempotency_key = concat('signal:', e.payload->>'signal_id', ':play:', p.id::text)
        and $12::boolean
       left join workflow_runs repair_wr
         on repair_wr.workspace_id = e.workspace_id
        and repair_wr.workflow_name = coalesce(p.compiled->>'workflow', $1)
        and repair_wr.idempotency_key = concat(
          'signal:', e.payload->>'signal_id',
          ':play:', p.id::text,
          ':repair:',
          $9::text
       )
        and $12::boolean
       left join workflow_runs rejudge_wr
         on rejudge_wr.workspace_id = e.workspace_id
        and rejudge_wr.workflow_name = coalesce(p.compiled->>'workflow', $1)
        and rejudge_wr.idempotency_key = concat(
          'signal:', e.payload->>'signal_id',
          ':play:', p.id::text,
          ':repair:',
          $10::text
       )
        and $12::boolean
       left join lateral (
         select m.id as message_id
           from conversations c
           join messages m
             on m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
            and m.direction = 'outbound'
          where c.workspace_id = e.workspace_id
            and c.origin_signal_id = s.id
            and c.properties->>'play_id' = p.id::text
          order by m.created_at desc
          limit 1
       ) existing_draft on true
       left join lateral (
         select e.payload
           from events e
          where e.workspace_id = s.workspace_id
            and e.event_type = 'draft.rejected'
            and e.payload->>'message_id' = existing_draft.message_id::text
          order by e.occurred_at desc
          limit 1
       ) existing_rejection on true
       left join lateral (
         select wr.id,
                wr.idempotency_key,
                wr.status::text as status,
                wr.output
           from workflow_runs wr
          where wr.workspace_id = e.workspace_id
            and wr.workflow_name = $5
            and $12::boolean
            and wr.idempotency_key in (
              concat(
                'contact:', e.payload->>'signal_id',
                ':play:', p.id::text,
                ':channel:',
                case
                  when coalesce(p.compiled->>'channel', 'email') = 'email' then 'email'
                  else 'linkedin'
                end
              ),
              concat(
                'contact:', e.payload->>'signal_id',
                ':play:', p.id::text,
                ':channel:',
                case
                  when coalesce(p.compiled->>'channel', 'email') = 'email' then 'email'
                  else 'linkedin'
                end,
                ':repair:',
                $6::text
              )
            )
          order by
            case
              when wr.idempotency_key = concat(
                'contact:', e.payload->>'signal_id',
                ':play:', p.id::text,
                ':channel:',
                case
                  when coalesce(p.compiled->>'channel', 'email') = 'email' then 'email'
                  else 'linkedin'
                end,
                ':repair:',
                $6::text
              ) then 0
              else 1
            end,
            wr.created_at desc
          limit 1
       ) resolver on true
      where e.event_type = 'signal.matched'
        and (
          wr.id is null
          or (
            wr.status = 'failed'
            and repair_wr.id is null
            and existing_draft.message_id is null
          )
          or (
            coalesce(repair_wr.status::text, wr.status::text) = 'completed'
            and coalesce(repair_wr.output, wr.output)->>'decision' = 'rejected'
            and rejudge_wr.id is null
            and (existing_rejection.payload->>'reason') ~* $11::text
          )
        )
        and coalesce(p.compiled->>'workflow', $1) = any($2::text[])
        and s.related_company_id is not null
        and campaign_skip.id is null
        and research_gate.id is null
        and (
          relationship_suppression.payload is null
          or (
            relationship_suppression.payload->>'reason' = 'recipient_cooldown'
            and (relationship_suppression.payload->>'retry_after')::timestamptz <= now()
          )
        )
        and ($4::uuid is null or e.workspace_id = $4)
        and ($7::uuid is null or s.id = $7)
        and ($8::uuid is null or p.id = $8)
      order by
        case
          when (${SIGNAL_RESEARCH_ELIGIBILITY_SQL})
          then 0
          else 1
        end,
        e.occurred_at asc
      limit $3`,
    [
      SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
      [SIGNAL_TO_EMAIL_PLAY_WORKFLOW, SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW],
      candidateLimit,
      session?.workspace_id ?? null,
      CONTACT_RESOLUTION_WORKFLOW,
      CONTACT_RESOLUTION_REPAIR_KEY,
      opts.signal_id ?? null,
      opts.play_id ?? null,
      SIGNAL_PLAY_REPAIR_KEY,
      SIGNAL_PLAY_REJUDGE_REPAIR_KEY,
      REPAIRABLE_DRAFT_REJECTION_PATTERN,
      engine.substrateMode === "postgres",
    ],
  );

  const candidatesByWorkspace = new Map<string, SignalDispatchCandidate[]>();
  for (const [original_index, row] of rows.entries()) {
    const research = assessSignalResearchEligibility({
      company_name: row.company_name,
      company_domain: row.company_domain,
      signal_url: row.signal_url,
      linkedin_urls: [],
      has_linkedin_identity: row.company_has_linkedin_identity,
    });
    if (!research.eligible) {
      await publishSignalResearchGated(
        engine,
        row,
        research.reasons.filter((reason) =>
          reason !== "missing_reachable_contact"
        ),
      );
      continue;
    }
    const candidate: SignalDispatchCandidate = {
      ...signalDispatchCampaignCandidate(row),
      explicit_target: Boolean(opts.play_id),
      row,
      original_index,
    };
    const workspaceCandidates =
      candidatesByWorkspace.get(row.workspace_id) ?? [];
    workspaceCandidates.push(candidate);
    candidatesByWorkspace.set(row.workspace_id, workspaceCandidates);
  }

  const planned: Array<CampaignDispatchPlan<SignalDispatchCandidate>> = [];
  for (const [workspace_id, candidates] of candidatesByWorkspace) {
    const strategy = await latestCampaignDispatchStrategy(
      engine.pool,
      workspace_id,
    );
    planned.push(...planCampaignDispatchAllocations(candidates, strategy));
  }
  planned.sort((a, b) => {
    const dispatchRank =
      Number(b.allocation.should_dispatch) -
      Number(a.allocation.should_dispatch);
    if (dispatchRank !== 0) return dispatchRank;
    const scoreRank =
      (b.candidate.row.match_score ?? 0) -
      (a.candidate.row.match_score ?? 0);
    if (scoreRank !== 0) return scoreRank;
    const weightRank =
      b.allocation.allocation_weight - a.allocation.allocation_weight;
    if (weightRank !== 0) return weightRank;
    const recencyRank =
      b.candidate.row.event_occurred_at.getTime() -
      a.candidate.row.event_occurred_at.getTime();
    if (recencyRank !== 0) return recencyRank;
    return a.candidate.original_index - b.candidate.original_index;
  });

  const skipped = new Set<string>();
  for (const plan of planned) {
    if (plan.allocation.should_dispatch) continue;
    const key = signalDispatchCampaignSkipIdempotencyKey(
      plan.candidate.row,
      plan.allocation,
    );
    if (skipped.has(key)) continue;
    skipped.add(key);
    await publishCampaignDispatchSkipped(
      engine,
      plan.candidate.row,
      plan.allocation,
    );
  }

  let dispatched = 0;
  const selectedRelationships = new Map<
    string,
    { conversation_id: string; signal_id: string }
  >();
  for (const plan of planned) {
    if (!plan.allocation.should_dispatch) continue;
    if (dispatched >= dispatchLimit) break;
    const row = plan.candidate.row;
    const simulate = simulateOutcomeFromSignal(row.signal_properties);
    const contactChannel = contactChannelForTarget(row.target_channel);
    let personId = row.resolved_person_id;
    const resolverRepairKey = contactResolverRepairKey(row);
    const playRepairKey = signalPlayRepairKey(row);
    if (!personId) {
      if (row.resolver_run_id && !resolverRepairKey) continue;
      if (!row.company_id) continue;
      const resolver = await startContactResolution(engine, {
        workspace_id: row.workspace_id,
        signal_id: row.signal_id,
        company_id: row.company_id,
        play_id: row.play_id,
        rep_id: row.rep_id,
        channel: contactChannel,
        trigger_event_id: row.event_id,
        repair_key: resolverRepairKey,
      });
      personId = resolver.output?.selected_person_id ?? null;
      if (!personId) continue;
    }
    const fitDecision =
      personId === row.resolved_person_id
        ? personFitDecisionOrNull(row.resolved_person_fit_decision)
        : await loadPersonContactFitDecision(
            engine.pool,
            row.workspace_id,
            personId,
          );
    if (fitDecision === "not_fit") {
      await publishSignalOutreachGated(engine, row, personId, contactChannel);
      continue;
    }
    const relationshipKey = [
      row.workspace_id,
      personId,
      row.company_id ?? "no-company",
    ].join(":");
    const alreadySelected = selectedRelationships.get(relationshipKey);
    if (alreadySelected) {
      await publishSignalOutreachSuppressed(engine, {
        row,
        conversation_id: alreadySelected.conversation_id,
        person_id: personId,
        channel: contactChannel,
        reason: "better_signal_selected",
        selected_signal_id: alreadySelected.signal_id,
        retry_after: null,
      });
      continue;
    }
    const relationshipState = await loadRelationshipOutreachState(
      engine.pool,
      {
        workspace_id: row.workspace_id,
        person_id: personId,
        company_id: row.company_id,
      },
    );
    const evaluatedRelationship =
      evaluateRelationshipOutreach(relationshipState);
    const relationshipDecision =
      playRepairKey &&
      evaluatedRelationship.action === "suppress" &&
      evaluatedRelationship.reason === "conversation_active" &&
      !relationshipState?.has_reply
        ? {
            action: "allow" as const,
            conversation_id: evaluatedRelationship.conversation_id,
          }
        : evaluatedRelationship;
    if (relationshipDecision.action === "suppress") {
      await publishSignalOutreachSuppressed(engine, {
        row,
        conversation_id: relationshipDecision.conversation_id,
        person_id: personId,
        channel: contactChannel,
        reason: relationshipDecision.reason,
        retry_after: relationshipDecision.retry_after,
      });
      continue;
    }
    const conversationId =
      relationshipDecision.conversation_id ??
      (await ensureRelationshipConversation(engine, row, personId));
    await publishRelationshipSignalAttached(
      engine,
      row,
      conversationId,
      "primary",
      "selected_for_outreach",
    );
    selectedRelationships.set(relationshipKey, {
      conversation_id: conversationId,
      signal_id: row.signal_id,
    });
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
        person_id: personId,
        trigger_event_id: row.event_id,
        action,
        approval: policy.approval,
        policy,
        simulate_outcome_kind: simulate,
        repair_key: playRepairKey,
        campaign_allocation: plan.allocation,
        campaign_recommendation_id: plan.allocation.recommendation_id,
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
        person_id: personId,
        trigger_event_id: row.event_id,
        approval: policy.approval,
        policy,
        simulate_outcome_kind: simulate,
        repair_key: playRepairKey,
        campaign_allocation: plan.allocation,
        campaign_recommendation_id: plan.allocation.recommendation_id,
      });
    }
    dispatched++;
  }
  return dispatched;
}

export async function dispatchLinkedInAcceptedFollowupsOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<LinkedInAcceptedFollowupDispatchRow>(
    `with accepted as (
       select e.id as accepted_event_id,
              e.workspace_id,
              e.payload->>'person_id' as payload_person_id,
              e.payload->>'conversation_id' as payload_conversation_id,
              e.payload->>'profile_url' as profile_url,
              coalesce(nullif(e.payload->>'accepted_at', '')::timestamptz, e.occurred_at) as accepted_at
         from events e
        where e.event_type = 'linkedin.connection.accepted'
          and ($3::uuid is null or e.workspace_id = $3)
     ),
     resolved as (
       select accepted.accepted_event_id,
              accepted.workspace_id,
              accepted.accepted_at,
              coalesce(p.id, c.counterparty_person_id) as person_id,
              coalesce(p.company_id, c.counterparty_company_id) as company_id,
              resolved_person.properties #>> '{contact_fit,decision}' as contact_fit_decision,
              c.id as conversation_id,
              c.origin_signal_id
         from accepted
         left join graph_persons p
           on p.workspace_id = accepted.workspace_id
          and (
            p.id::text = accepted.payload_person_id
            or (
              accepted.profile_url is not null
              and p.linkedin_url = accepted.profile_url
            )
          )
         left join lateral (
           select c.id,
                  c.origin_signal_id,
                  c.counterparty_person_id,
                  c.counterparty_company_id,
                  c.last_activity_at
             from conversations c
            where c.workspace_id = accepted.workspace_id
              and (
                c.id::text = accepted.payload_conversation_id
                or (
                  p.id is not null
                  and c.counterparty_person_id = p.id
                )
              )
            order by case
                       when c.id::text = accepted.payload_conversation_id then 0
                       else 1
                     end,
                     c.last_activity_at desc
            limit 1
         ) c on true
         left join graph_persons resolved_person
           on resolved_person.workspace_id = accepted.workspace_id
          and resolved_person.id = coalesce(p.id, c.counterparty_person_id)
     )
     select resolved.accepted_event_id::text,
            resolved.workspace_id::text,
            s.id::text as signal_id,
            resolved.person_id::text,
            p.id::text as play_id,
            p.default_rep_id::text as rep_id,
            s.properties as signal_properties,
            p.autonomy as play_autonomy
       from resolved
       join lateral (
         select s.id,
                s.properties,
                s.kind::text as signal_kind,
                coalesce(s.ingested_at, s.freshness_at) as signal_at
           from signals s
          where s.workspace_id = resolved.workspace_id
            and s.status in ('matched','in_play')
            and (
              s.id = resolved.origin_signal_id
              or (
                resolved.origin_signal_id is null
                and (
                  s.related_person_id = resolved.person_id
                  or (
                    resolved.company_id is not null
                    and s.related_company_id = resolved.company_id
                  )
                )
              )
            )
          order by case when s.id = resolved.origin_signal_id then 0 else 1 end,
                   coalesce(s.ingested_at, s.freshness_at) desc
          limit 1
       ) s on true
       join plays p
         on p.workspace_id = resolved.workspace_id
        and p.status = 'active'
        and p.default_rep_id is not null
        and coalesce(p.compiled->>'workflow', $1) = $1
        and coalesce(p.compiled->>'channel', 'linkedin_dm') = 'linkedin_dm'
        and p.compiled->'trigger'->>'kind' = 'signal'
        and (
          p.compiled #>> '{trigger,filter,kind}' is null
          or p.compiled #>> '{trigger,filter,kind}' = s.signal_kind
        )
       left join workflow_runs wr
         on wr.workspace_id = resolved.workspace_id
        and wr.workflow_name = $1
        and wr.idempotency_key = concat(
          'signal:', s.id::text,
          ':play:', p.id::text,
          ':repair:accepted:',
          resolved.accepted_event_id::text
        )
       left join lateral (
         select m.id
           from messages m
          where m.workspace_id = resolved.workspace_id
            and resolved.conversation_id is not null
            and m.conversation_id = resolved.conversation_id
            and m.direction = 'outbound'
            and m.channel in ('linkedin_dm','linkedin_inmail','linkedin_comment')
            and coalesce(m.sent_at, m.created_at) >= resolved.accepted_at
          order by coalesce(m.sent_at, m.created_at) desc
          limit 1
       ) followup on true
      where resolved.person_id is not null
        and resolved.contact_fit_decision is distinct from 'not_fit'
        and followup.id is null
        and wr.id is null
      order by resolved.accepted_at asc
      limit $2`,
    [
      SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
      opts.limit ?? 25,
      session?.workspace_id ?? null,
    ],
  );

  let dispatched = 0;
  for (const row of rows) {
    const policy = resolvePlayChannelPolicy(
      row.play_autonomy ?? {},
      "linkedin_dm",
      {
        approval: parseApprovalPolicy(row.signal_properties.linkedin_approval),
      },
    );
    await startSignalLinkedInPlay(engine, {
      workspace_id: row.workspace_id,
      play_id: row.play_id,
      rep_id: row.rep_id,
      signal_id: row.signal_id,
      person_id: row.person_id,
      trigger_event_id: row.accepted_event_id,
      action: "linkedin_dm",
      approval: policy.approval,
      policy,
      simulate_outcome_kind: simulateOutcomeFromSignal(row.signal_properties),
      repair_key: `accepted:${row.accepted_event_id}`,
    });
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
        and e.payload->>'intent' in ('meeting_intent', 'positive', 'neutral')
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

export async function dispatchMeetingPrepOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  const engine = await getProductEngine();
  await registerWorkspaceMeetingPrepWorkflow(engine);
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    event_id: string;
    workspace_id: string;
    conversation_id: string;
    inbound_message_id: string;
  }>(
    `select e.id as event_id,
            e.workspace_id,
            e.payload->>'conversation_id' as conversation_id,
            e.payload->>'message_id' as inbound_message_id
       from events e
       join conversations c
         on c.workspace_id = e.workspace_id
        and c.id = (e.payload->>'conversation_id')::uuid
       left join workflow_runs wr
         on wr.workspace_id = e.workspace_id
        and wr.workflow_name = $1
        and wr.idempotency_key = concat('meeting-prep:', e.payload->>'message_id')
      where e.event_type = 'reply.classified'
        and e.payload->>'intent' in ('meeting_intent', 'positive')
        and wr.id is null
        and e.payload->>'conversation_id' is not null
        and e.payload->>'message_id' is not null
        and ($3::uuid is null or e.workspace_id = $3)
      order by e.occurred_at asc
      limit $2`,
    [
      WORKSPACE_MEETING_PREP_WORKFLOW,
      opts.limit ?? 25,
      session?.workspace_id ?? null,
    ],
  );

  let dispatched = 0;
  for (const row of rows) {
    const user_id = await getWorkflowUserId(engine.pool, row.workspace_id);
    if (!user_id) continue;
    await registerWorkspaceMeetingPrepWorkflow(engine);
    await engine.runtime.start<MeetingPrepGraphInput, BombsellLangGraphState>({
      workspace_id: row.workspace_id,
      workflow_name: WORKSPACE_MEETING_PREP_WORKFLOW,
      idempotency_key: `meeting-prep:${row.inbound_message_id}`,
      correlation_id: row.event_id,
      causation_id: row.event_id,
      input: {
        workspace_id: row.workspace_id,
        user_id,
        conversation_id: row.conversation_id,
        thread_id: `meeting-prep:${row.workspace_id}:${row.conversation_id}`,
        correlation_id: row.event_id,
        causation_event_id: row.event_id,
      },
    });
    dispatched++;
  }
  return dispatched;
}

type ProductDispatchEventType =
  | "signal.matched"
  | "contact.resolved"
  | "contact.resolution.deferred"
  | "contact.resolution.retry.requested"
  | "reply.classified"
  | "linkedin.connection.accepted";
type SignalMatchingDispatchEventType = "signal.ingested";

interface SignalMatchingWorkflowStarter {
  start<I, O = unknown>(opts: {
    workspace_id: string;
    workflow_name: string;
    input: I;
    idempotency_key?: string;
    correlation_id?: string;
    causation_id?: string;
  }): Promise<O>;
}

export interface SignalMatchingWorkflowDispatchDeps {
  pool?: Pool;
  workflows?: SignalMatchingWorkflowStarter;
}

export interface SignalMatchingEventDispatcherOptions {
  dispatchSignalMatching?: (event: PublishedEvent) => Promise<number>;
}

export interface SignalMatchingEventDispatchSubscriptionAdapter {
  subscribe(
    eventType: SignalMatchingDispatchEventType,
    handler: (event: PublishedEvent) => Promise<void>,
    durableName: string,
  ): Promise<Subscription>;
}

export async function dispatchSignalMatchingWorkflowFromIngestedEvent(
  event: PublishedEvent,
  deps: SignalMatchingWorkflowDispatchDeps = {},
): Promise<number> {
  const signal_id = (event.payload as { signal_id?: unknown }).signal_id;
  if (typeof signal_id !== "string" || !signal_id.trim()) return 0;
  const correlation_id = event.correlation_id ?? event.id;

  if (deps.pool && deps.workflows) {
    const user_id = await getWorkflowUserId(deps.pool, event.workspace_id);
    if (!user_id) return 0;
    await deps.workflows.start<LeadMatchingGraphInput, BombsellLangGraphState>({
      workspace_id: event.workspace_id,
      workflow_name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
      idempotency_key: signalMatchingIdempotencyKey(
        event.workspace_id,
        signal_id,
      ),
      correlation_id,
      causation_id: event.id,
      input: {
        workspace_id: event.workspace_id,
        user_id,
        signal_id,
        thread_id: `signal-match:${event.workspace_id}:${signal_id}`,
        correlation_id,
        causation_event_id: event.id,
      },
    });
    return 1;
  }

  const engine = await getProductEngine();
  const started = await startSignalMatchingWorkflowForEvent(engine, {
    workspace_id: event.workspace_id,
    signal_id,
    event_id: event.id,
    correlation_id,
  });
  return started ? 1 : 0;
}

export async function registerSignalMatchingEventDispatcher(
  adapter: SignalMatchingEventDispatchSubscriptionAdapter,
  opts: SignalMatchingEventDispatcherOptions = {},
): Promise<Subscription> {
  const dispatchSignalMatching =
    opts.dispatchSignalMatching ??
    dispatchSignalMatchingWorkflowFromIngestedEvent;
  return adapter.subscribe(
    "signal.ingested",
    async (event) => {
      await dispatchSignalMatching(event);
    },
    "product-signal-matching-workflow-dispatcher-v1",
  );
}

interface ProductEventDispatchSubscriptionAdapter {
  subscribe(
    eventType: ProductDispatchEventType | SignalMatchingDispatchEventType,
    handler: (event: PublishedEvent) => Promise<void>,
    durableName: string,
  ): Promise<Subscription>;
}

interface ProductEventDispatcherOptions {
  limit?: number;
  dispatchSignalPlays?: typeof dispatchSignalPlaysOnce;
  dispatchLinkedInAcceptedFollowups?: typeof dispatchLinkedInAcceptedFollowupsOnce;
  dispatchReplyEmailPlays?: typeof dispatchReplyEmailPlaysOnce;
  dispatchMeetingPrep?: typeof dispatchMeetingPrepOnce;
  dispatchSignalMatching?: (event: PublishedEvent) => Promise<number>;
  scheduleContactResolutionRetry?: (event: PublishedEvent) => Promise<number>;
  dispatchContactResolutionRetry?: (event: PublishedEvent) => Promise<number>;
}

export async function scheduleContactResolutionRetryFromDeferredEvent(
  event: PublishedEvent,
): Promise<number> {
  const payload = event.payload as Record<string, unknown>;
  const signal_id = stringOrNull(payload.signal_id);
  const company_id = stringOrNull(payload.company_id);
  const play_id = stringOrNull(payload.play_id);
  const rep_id = stringOrNull(payload.rep_id);
  const channel = contactChannelFromPayload(payload.channel);
  const defer_reason = stringOrNull(payload.defer_reason);
  if (!signal_id || !company_id || !play_id || !rep_id || !channel || !defer_reason) {
    return 0;
  }

  const retry_attempt = nonNegativeInteger(payload.retry_attempt);
  const engine = await getProductEngine();
  registerContactResolutionRetryWorkflow(engine);
  await engine.runtime.start<ContactResolutionRetryInput>({
    workspace_id: event.workspace_id,
    workflow_name: CONTACT_RESOLUTION_RETRY_WORKFLOW,
    idempotency_key: [
      "contact-enrichment-retry",
      signal_id,
      play_id,
      channel,
      `attempt:${retry_attempt + 1}`,
    ].join(":"),
    correlation_id: event.correlation_id ?? event.id,
    causation_id: event.id,
    input: {
      workspace_id: event.workspace_id,
      signal_id,
      company_id,
      play_id,
      rep_id,
      channel,
      retry_attempt,
      deferred_event_id: event.id,
      defer_reason,
    },
  });
  return 1;
}

export async function dispatchContactResolutionRetryRequestedEvent(
  event: PublishedEvent,
): Promise<number> {
  const payload = event.payload as Record<string, unknown>;
  const signal_id = stringOrNull(payload.signal_id);
  const company_id = stringOrNull(payload.company_id);
  const play_id = stringOrNull(payload.play_id);
  const rep_id = stringOrNull(payload.rep_id);
  const channel = contactChannelFromPayload(payload.channel);
  const defer_reason = stringOrNull(payload.defer_reason);
  const source_deferred_event_id = stringOrNull(payload.source_deferred_event_id);
  const attempt = Math.max(1, nonNegativeInteger(payload.attempt));
  if (
    !signal_id ||
    !company_id ||
    !play_id ||
    !rep_id ||
    !channel ||
    !defer_reason ||
    !source_deferred_event_id
  ) {
    return 0;
  }

  const engine = await getProductEngine();
  const { rows } = await engine.pool.query<{ resolved: boolean }>(
    `select exists (
       select 1
         from events resolved
         join events deferred
           on deferred.id = $2::uuid
          and deferred.workspace_id = $1::uuid
        where resolved.workspace_id = $1::uuid
          and resolved.event_type = 'contact.resolved'
          and resolved.payload->>'signal_id' = $3
          and resolved.payload->>'play_id' = $4
          and resolved.payload->>'channel' = $5
          and resolved.occurred_at > deferred.occurred_at
     ) as resolved`,
    [event.workspace_id, source_deferred_event_id, signal_id, play_id, channel],
  );
  if (rows[0]?.resolved) return 0;

  if (payload.exhausted === true || attempt > CONTACT_RESOLUTION_MAX_RETRIES) {
    await engine.bus.publish({
      workspace_id: event.workspace_id,
      event_type: "contact.resolution.dead_lettered",
      source: "system",
      producer_ref: "product.contact-resolution-retry",
      correlation_id: event.correlation_id ?? event.id,
      causation_id: event.id,
      idempotency_key: [
        "contact-resolution-dead-lettered",
        signal_id,
        play_id,
        channel,
      ].join(":"),
      payload: {
        signal_id,
        company_id,
        play_id,
        rep_id,
        channel,
        attempts: CONTACT_RESOLUTION_MAX_RETRIES,
        last_defer_reason: defer_reason,
        source_deferred_event_id,
        dead_lettered_at: new Date().toISOString(),
      },
    });
    return 1;
  }

  await startContactResolution(engine, {
    workspace_id: event.workspace_id,
    signal_id,
    company_id,
    play_id,
    rep_id,
    channel,
    trigger_event_id: event.id,
    repair_key: `retry:${attempt}`,
    retry_attempt: attempt,
  });
  return 1;
}

export async function registerProductEventDispatchers(
  adapter: ProductEventDispatchSubscriptionAdapter,
  opts: ProductEventDispatcherOptions = {},
): Promise<Subscription[]> {
  const limit = Math.max(1, Math.trunc(opts.limit ?? 25));
  const signalMatchingGate = createConcurrencyGate(limit);
  const dispatchSignalPlays =
    opts.dispatchSignalPlays ?? dispatchSignalPlaysOnce;
  const dispatchLinkedInAcceptedFollowups =
    opts.dispatchLinkedInAcceptedFollowups ??
    dispatchLinkedInAcceptedFollowupsOnce;
  const dispatchReplyEmailPlays =
    opts.dispatchReplyEmailPlays ?? dispatchReplyEmailPlaysOnce;
  const dispatchMeetingPrep =
    opts.dispatchMeetingPrep ?? dispatchMeetingPrepOnce;
  const dispatchSignalMatching =
    opts.dispatchSignalMatching ??
    dispatchSignalMatchingWorkflowFromIngestedEvent;
  const scheduleContactResolutionRetry =
    opts.scheduleContactResolutionRetry ??
    scheduleContactResolutionRetryFromDeferredEvent;
  const dispatchContactResolutionRetry =
    opts.dispatchContactResolutionRetry ??
    dispatchContactResolutionRetryRequestedEvent;

  const signalMatchingSubscription = await adapter.subscribe(
    "signal.ingested",
    async (event) => {
      await signalMatchingGate(() => dispatchSignalMatching(event));
    },
    "product-signal-matching-workflow-dispatcher-v1",
  );
  const signalSubscription = await adapter.subscribe(
    "signal.matched",
    async () => {
      await dispatchSignalPlays({ limit });
    },
    "product-signal-play-dispatcher-v1",
  );
  const contactSubscription = await adapter.subscribe(
    "contact.resolved",
    async () => {
      await dispatchSignalPlays({ limit });
    },
    "product-contact-play-dispatcher-v1",
  );
  const contactDeferredSubscription = await adapter.subscribe(
    "contact.resolution.deferred",
    async (event) => {
      await scheduleContactResolutionRetry(event);
    },
    "product-contact-resolution-retry-scheduler-v1",
  );
  const contactRetrySubscription = await adapter.subscribe(
    "contact.resolution.retry.requested",
    async (event) => {
      await dispatchContactResolutionRetry(event);
    },
    "product-contact-resolution-retry-dispatcher-v1",
  );
  const replySubscription = await adapter.subscribe(
    "reply.classified",
    async () => {
      await dispatchReplyEmailPlays({ limit });
    },
    "product-reply-play-dispatcher-v1",
  );
  const meetingPrepSubscription = await adapter.subscribe(
    "reply.classified",
    async () => {
      await dispatchMeetingPrep({ limit });
    },
    "product-meeting-prep-dispatcher-v1",
  );
  const linkedInAcceptedSubscription = await adapter.subscribe(
    "linkedin.connection.accepted",
    async () => {
      await dispatchLinkedInAcceptedFollowups({ limit });
    },
    "product-linkedin-accepted-followup-dispatcher-v1",
  );

  return [
    signalMatchingSubscription,
    signalSubscription,
    contactSubscription,
    contactDeferredSubscription,
    contactRetrySubscription,
    replySubscription,
    meetingPrepSubscription,
    linkedInAcceptedSubscription,
  ];
}

function contactChannelFromPayload(value: unknown): ContactChannel | null {
  return value === "email" || value === "linkedin" ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function createConcurrencyGate(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function runWithGate<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

interface RssSourceRow {
  id: string;
  workspace_id: string;
  config: Record<string, unknown>;
  properties: Record<string, unknown>;
  last_polled_at: Date | null;
}

function pollIntervalMs(row: RssSourceRow): number {
  const msCandidates = [
    row.config.poll_interval_ms,
    row.properties.poll_interval_ms,
  ];
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
      now.getTime() - row.last_polled_at.getTime() >=
        row.poll_cadence_sec * 1000;
    if (!due) continue;
    const cadenceBucket = Math.floor(
      now.getTime() / (row.poll_cadence_sec * 1000),
    );
    await engine.runtime.start({
      workspace_id: row.workspace_id,
      workflow_name: WORKSPACE_POLL_WORKFLOW,
      idempotency_key: `workspace-source:${row.workspace_id}:${row.source_id}:bucket:${cadenceBucket}`,
      input: {
        workspace_id: row.workspace_id,
        source_id: row.source_id,
      },
    });
    dispatched++;
  }
  return dispatched;
}

export async function runWorkspaceSourcePollNow(
  input: WorkspaceSourcePollRunNowInput,
  session: ProductWorkspaceSession,
): Promise<WorkspaceSourcePollRunNowResult> {
  const sourceId = input.source_id.trim();
  if (!sourceId) throw new Error("source_id required");
  const engine = await getProductEngine();
  registerSignalIngestionWorkflows(engine);
  await assertProductWorkspaceAccess(session, engine.pool);
  const { rows } = await engine.pool.query<{
    source_id: string;
    source_enabled: boolean;
    config_enabled: boolean;
  }>(
    `select gs.id::text as source_id,
            gs.enabled as source_enabled,
            wsc.enabled as config_enabled
       from graph_sources gs
       join workspace_source_configs wsc
         on wsc.workspace_id = gs.workspace_id
        and wsc.source_id = gs.id
       join workspaces w on w.id = gs.workspace_id
      where gs.workspace_id = $1
        and gs.id = $2
        and w.archived_at is null
      limit 1`,
    [session.workspace_id, sourceId],
  );
  const source = rows[0];
  if (!source) {
    throw new Error("Source not found in the active workspace.");
  }
  if (!source.source_enabled || !source.config_enabled) {
    throw new Error("Source is paused.");
  }
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const run = await engine.runtime.start({
    workspace_id: session.workspace_id,
    workflow_name: WORKSPACE_POLL_WORKFLOW,
    idempotency_key:
      `workspace-source-manual:${session.workspace_id}:${sourceId}:minute:${minuteBucket}`,
    input: {
      workspace_id: session.workspace_id,
      source_id: sourceId,
    },
  });
  return {
    workspace_id: session.workspace_id,
    source_id: sourceId,
    workflow_name: WORKSPACE_POLL_WORKFLOW,
    workflow_run_id: run.id,
  };
}

interface RecommendationResearchWorkspaceRow {
  workspace_id: string;
  user_id: string;
  workspace_name: string;
  company_name: string | null;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  last_content_event_at: Date | null;
  last_content_run_at: Date | null;
  last_aeo_event_at: Date | null;
  last_aeo_run_at: Date | null;
}

type RecommendationResearchIntent = "content_research" | "aeo_audit";

function recommendationResearchCadenceMs(): number {
  const hours = Number(
    process.env.BOMBSELL_RECOMMENDATION_RESEARCH_CADENCE_HOURS,
  );
  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_RECOMMENDATION_RESEARCH_CADENCE_MS;
  }
  return Math.max(60 * 60 * 1000, Math.trunc(hours * 60 * 60 * 1000));
}

function latestRecommendationResearchAt(
  first: Date | null,
  second: Date | null,
): Date | null {
  if (!first) return second;
  if (!second) return first;
  return first.getTime() > second.getTime() ? first : second;
}

function isRecommendationResearchDue(
  lastAt: Date | null,
  now: Date,
  cadenceMs: number,
): boolean {
  return !lastAt || now.getTime() - lastAt.getTime() >= cadenceMs;
}

function recommendationResearchQuery(
  row: RecommendationResearchWorkspaceRow,
  intent: RecommendationResearchIntent,
): string {
  const company = row.company_name ?? row.workspace_name;
  const context = [
    company,
    row.domain ? `domain ${row.domain}` : null,
    row.industry ? `industry ${row.industry}` : null,
    row.description ? `profile ${row.description}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  if (intent === "aeo_audit") {
    return [
      context,
      "Find answer-engine visibility gaps, buyer questions, comparison pages, missing proof, and pages this company should create or improve.",
    ].join(". ");
  }

  return [
    context,
    "Find fresh buyer questions, market narratives, objection patterns, proof gaps, and competitor angles worth turning into short founder-led posts.",
  ].join(". ");
}

export async function dispatchWorkspaceRecommendationResearchOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<number> {
  if (!process.env.EXA_API_KEY?.trim()) return 0;

  const engine = await getProductEngine();
  if (session) await assertProductWorkspaceAccess(session, engine.pool);
  const limit = Math.max(1, Math.trunc(opts.limit ?? 25));
  const { rows } = await engine.pool.query<RecommendationResearchWorkspaceRow>(
    `with primary_members as (
       select distinct on (workspace_id)
              workspace_id,
              user_id
         from workspace_members
        where accepted_at is not null
        order by workspace_id,
                 case role when 'owner' then 0 when 'admin' then 1 else 2 end,
                 invited_at asc
     )
     select w.id::text as workspace_id,
            pm.user_id::text as user_id,
            w.name as workspace_name,
            profile.name as company_name,
            profile.domain::text as domain,
            profile.properties->>'website_url' as website_url,
            profile.industry,
            profile.description,
            content_event.occurred_at as last_content_event_at,
            content_run.created_at as last_content_run_at,
            aeo_event.occurred_at as last_aeo_event_at,
            aeo_run.created_at as last_aeo_run_at
       from workspaces w
       join primary_members pm on pm.workspace_id = w.id
       left join lateral (
         select name, domain, industry, description, properties
           from graph_companies
          where workspace_id = w.id
            and properties->>'profile_role' = 'workspace_company'
          order by updated_at desc, created_at desc
          limit 1
       ) profile on true
       left join lateral (
         select occurred_at
           from events
          where workspace_id = w.id
            and event_type = 'content.opportunity.discovered'
          order by occurred_at desc
          limit 1
       ) content_event on true
       left join lateral (
         select created_at
           from workflow_runs
          where workspace_id = w.id
            and workflow_name = $3
          order by created_at desc
          limit 1
       ) content_run on true
       left join lateral (
         select occurred_at
           from events
          where workspace_id = w.id
            and event_type = 'aeo.audit.completed'
          order by occurred_at desc
          limit 1
       ) aeo_event on true
       left join lateral (
         select created_at
           from workflow_runs
          where workspace_id = w.id
            and workflow_name = $4
          order by created_at desc
          limit 1
       ) aeo_run on true
      where w.archived_at is null
        and ($2::uuid is null or w.id = $2)
      order by least(
          greatest(
            coalesce(content_event.occurred_at, '-infinity'::timestamptz),
            coalesce(content_run.created_at, '-infinity'::timestamptz)
          ),
          greatest(
            coalesce(aeo_event.occurred_at, '-infinity'::timestamptz),
            coalesce(aeo_run.created_at, '-infinity'::timestamptz)
          )
        ) asc,
        w.created_at asc
      limit $1`,
    [
      limit,
      session?.workspace_id ?? null,
      EXA_CONTENT_OPPORTUNITY_WORKFLOW_NAME,
      EXA_AEO_AUDIT_WORKFLOW_NAME,
    ],
  );

  const now = new Date();
  const cadenceMs = recommendationResearchCadenceMs();
  const bucket = Math.floor(now.getTime() / cadenceMs);
  let dispatched = 0;

  for (const row of rows) {
    if (dispatched >= limit) break;
    const workspaceSession = {
      workspace_id: row.workspace_id,
      user_id: row.user_id,
    };
    const contentAt = latestRecommendationResearchAt(
      row.last_content_event_at,
      row.last_content_run_at,
    );
    if (isRecommendationResearchDue(contentAt, now, cadenceMs)) {
      await startWorkspaceExaResearchWorkflow(
        {
          query: recommendationResearchQuery(row, "content_research"),
          intent: "content_research",
          include_text: true,
          num_results: 8,
          idempotency_nonce: `autonomy:content:${row.workspace_id}:bucket:${bucket}`,
        },
        workspaceSession,
      );
      dispatched++;
    }

    if (dispatched >= limit) break;
    const aeoAt = latestRecommendationResearchAt(
      row.last_aeo_event_at,
      row.last_aeo_run_at,
    );
    if (isRecommendationResearchDue(aeoAt, now, cadenceMs)) {
      await startWorkspaceExaResearchWorkflow(
        {
          query: recommendationResearchQuery(row, "aeo_audit"),
          intent: "aeo_audit",
          include_text: true,
          num_results: 8,
          idempotency_nonce: `autonomy:aeo:${row.workspace_id}:bucket:${bucket}`,
        },
        workspaceSession,
      );
      dispatched++;
    }
  }

  return dispatched;
}

export async function runWorkspaceSignalAggregatorOnce(
  opts: DispatchOptions = {},
  session?: ProductWorkspaceSession,
): Promise<{
  dispatched: number;
  resumed: number;
  projected: DurableProjectionTick | null;
}> {
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
    opts.leaseOwner ??
    `product-projector:${process.pid}:${randomBytes(4).toString("hex")}`;
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
    opts.leaseOwner ??
    `product-worker:${process.pid}:${randomBytes(4).toString("hex")}`;
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
    if (row.workflow_name === WORKSPACE_ACTIVATION_SETUP_WORKFLOW) {
      await registerWorkspaceActivationSetupWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_PROFILE_ICP_WORKFLOW) {
      await registerWorkspaceProfileIcpWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW) {
      await registerWorkspaceCampaignStrategyWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_SKILL_OPTIMIZER_WORKFLOW) {
      await registerWorkspaceSkillOptimizerWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_CHANNEL_READINESS_WORKFLOW) {
      await registerWorkspaceChannelReadinessWorkflow(engine);
    } else if (
      row.workflow_name === WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW ||
      row.workflow_name === WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW
    ) {
      await registerWorkspaceCompanyBrainWorkflows(engine);
    } else if (row.workflow_name === WORKSPACE_CONTACT_WATERFALL_WORKFLOW) {
      await registerWorkspaceContactWaterfallWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_EVAL_GATE_WORKFLOW) {
      await registerWorkspaceEvalGateWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_MEETING_PREP_WORKFLOW) {
      await registerWorkspaceMeetingPrepWorkflow(engine);
    } else if (
      row.workflow_name === WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW
    ) {
      await registerWorkspaceMessagePersonalizationWorkflow(engine);
    } else if (
      row.workflow_name === WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW
    ) {
      await registerWorkspaceOutreachSkillSelectionWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_REPLY_TRIAGE_WORKFLOW) {
      await registerWorkspaceReplyTriageWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_SOURCE_DISCOVERY_WORKFLOW) {
      await registerWorkspaceSourceDiscoveryWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW) {
      await registerWorkspaceVerticalIntelligenceWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_SIGNAL_INGESTION_WORKFLOW) {
      await registerWorkspaceSignalIngestionWorkflow(engine);
    } else if (row.workflow_name === WORKSPACE_SIGNAL_MATCHING_WORKFLOW) {
      await registerWorkspaceSignalMatchingWorkflow(engine);
    } else if (row.workflow_name === CONTACT_RESOLUTION_WORKFLOW) {
      registerContactResolutionWorkflow(engine);
    } else if (row.workflow_name === CONTACT_RESOLUTION_RETRY_WORKFLOW) {
      registerContactResolutionRetryWorkflow(engine);
    } else if (row.workflow_name === SIGNAL_TO_EMAIL_PLAY_WORKFLOW) {
      registerSignalEmailWorkflow(engine, row.workspace_id);
    } else if (row.workflow_name === REPLY_TO_EMAIL_PLAY_WORKFLOW) {
      registerReplyEmailWorkflow(engine, row.workspace_id);
    } else if (row.workflow_name === WORKSPACE_POLL_WORKFLOW) {
      registerSignalIngestionWorkflows(engine);
    } else if (row.workflow_name === SENDING_DOMAIN_PROVISIONING_WORKFLOW) {
      registerSendingDomainProvisioningWorkflow(engine);
    } else if (row.workflow_name === SENDING_DOMAIN_WARMUP_WORKFLOW) {
      registerSendingDomainWarmupWorkflow(engine);
    } else if (
      row.workflow_name === EXA_CONTENT_OPPORTUNITY_WORKFLOW_NAME ||
      row.workflow_name === EXA_AEO_AUDIT_WORKFLOW_NAME
    ) {
      await registerExaRecommendationWorkflows(engine);
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
  const leaseMs = Math.max(
    1000,
    Math.floor(opts.leaseMs ?? DEFAULT_WORKFLOW_LEASE_MS),
  );
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
  const leaseMs = Math.max(
    1000,
    Math.floor(opts.leaseMs ?? DEFAULT_WORKFLOW_LEASE_MS),
  );
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
): Promise<boolean> {
  const engine = await getProductEngine();
  const { rows } = await engine.pool.query<{
    id: string;
    workspace_id: string;
    workflow_name: string;
    status: string;
    input: Record<string, unknown>;
    play_id: string | null;
  }>(
    `select id, workspace_id, workflow_name, status, input, play_id
       from workflow_runs
      where id = $1
      limit 1`,
    [run_id],
  );
  const run = rows[0];
  if (!run || run.status !== "failed") return false;
  if (session) {
    if (run.workspace_id !== session.workspace_id) return false;
    await assertProductWorkspaceAccess(session, engine.pool);
  }
  if (run.workflow_name === WORKSPACE_ACTIVATION_SETUP_WORKFLOW) {
    await registerWorkspaceActivationSetupWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_PROFILE_ICP_WORKFLOW) {
    await registerWorkspaceProfileIcpWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW) {
    await registerWorkspaceCampaignStrategyWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_SKILL_OPTIMIZER_WORKFLOW) {
    await registerWorkspaceSkillOptimizerWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_CHANNEL_READINESS_WORKFLOW) {
    await registerWorkspaceChannelReadinessWorkflow(engine);
  } else if (
    run.workflow_name === WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW ||
    run.workflow_name === WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW
  ) {
    await registerWorkspaceCompanyBrainWorkflows(engine);
  } else if (run.workflow_name === WORKSPACE_CONTACT_WATERFALL_WORKFLOW) {
    await registerWorkspaceContactWaterfallWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_EVAL_GATE_WORKFLOW) {
    await registerWorkspaceEvalGateWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_MEETING_PREP_WORKFLOW) {
    await registerWorkspaceMeetingPrepWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW) {
    await registerWorkspaceMessagePersonalizationWorkflow(engine);
  } else if (
    run.workflow_name === WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW
  ) {
    await registerWorkspaceOutreachSkillSelectionWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_REPLY_TRIAGE_WORKFLOW) {
    await registerWorkspaceReplyTriageWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_SOURCE_DISCOVERY_WORKFLOW) {
    await registerWorkspaceSourceDiscoveryWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW) {
    await registerWorkspaceVerticalIntelligenceWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_SIGNAL_INGESTION_WORKFLOW) {
    await registerWorkspaceSignalIngestionWorkflow(engine);
  } else if (run.workflow_name === WORKSPACE_SIGNAL_MATCHING_WORKFLOW) {
    await registerWorkspaceSignalMatchingWorkflow(engine);
  } else if (run.workflow_name === SIGNAL_TO_EMAIL_PLAY_WORKFLOW) {
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
  } else if (
    run.workflow_name === EXA_CONTENT_OPPORTUNITY_WORKFLOW_NAME ||
    run.workflow_name === EXA_AEO_AUDIT_WORKFLOW_NAME
  ) {
    await registerExaRecommendationWorkflows(engine);
  }

  const retry = await engine.runtime.start({
    workspace_id: run.workspace_id,
    workflow_name: run.workflow_name,
    play_id: run.play_id ?? undefined,
    idempotency_key: `recovery:${run.id}`,
    correlation_id: run.id,
    causation_id: run.id,
    input: run.input,
  });
  const retryRunId = retry.id;

  await engine.bus.publish({
    workspace_id: run.workspace_id,
    event_type: "workflow.run.retried",
    source: "user",
    producer_ref: session?.user_id ?? DEFAULT_PRODUCT_USER_ID,
    correlation_id: run.id,
    causation_id: run.id,
    idempotency_key: `workflow.run.retried:${run.id}:${retryRunId}`,
    payload: {
      run_id: run.id,
      workflow_name: run.workflow_name,
      retry_run_id: retryRunId,
    },
  });
  return true;
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

export async function recoverTransientEventDispatches(
  session: ProductWorkspaceSession,
  input: { limit?: number } = {},
): Promise<number> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  const recovered = await recoverTransientDeadLetterDispatches(engine.pool, {
    workspace_id: session.workspace_id,
    limit: input.limit ?? 100,
  });
  if (recovered <= 0) return 0;
  await engine.bus.publish({
    workspace_id: session.workspace_id,
    event_type: "event.dispatch.transient_recovered",
    source: "user",
    producer_ref: session.user_id,
    correlation_id: session.workspace_id,
    payload: {
      recovered_count: recovered,
      recovered_by: session.user_id,
      limit: input.limit ?? 100,
    },
  });
  return recovered;
}

export async function listDeadLetteredEventDispatches(
  session: ProductWorkspaceSession,
  input: { limit?: number } = {},
): Promise<DeadLetteredDispatch[]> {
  const engine = await getProductEngine();
  await assertProductWorkspaceAccess(session, engine.pool);
  return listDeadLetteredDispatches(
    engine.pool,
    session.workspace_id,
    input.limit ?? 50,
  );
}

function simulateOutcomeFromSignal(
  signalProperties: Record<string, unknown>,
): SignalToEmailPlayInput["simulate_outcome_kind"] {
  const value = signalProperties.simulate_outcome_kind;
  return value === "positive_reply" || value === "meeting_booked"
    ? value
    : null;
}

export async function approveWorkflowApproval(
  approval_id: string,
  decision: "approved" | "rejected",
  session?: ProductWorkspaceSession,
  note?: string,
): Promise<boolean> {
  const engine = await getProductEngine();
  const { rows } = await engine.pool.query<{
    workspace_id: string;
    decision: string;
  }>(
    `select workspace_id, decision from workflow_approvals where id = $1`,
    [approval_id],
  );
  const approval = rows[0];
  if (!approval || approval.decision !== "pending") return false;
  if (session) {
    if (approval.workspace_id !== session.workspace_id) return false;
    await assertProductWorkspaceAccess(session, engine.pool);
  }
  return publishAndProjectApprovalDecision(engine.pool, engine.bus, {
    approval_id,
    workspace_id: approval.workspace_id,
    decision,
    decided_by: session?.user_id ?? DEFAULT_PRODUCT_USER_ID,
    note,
  });
}

async function publishAndProjectApprovalDecision(
  pool: Pool,
  bus: EventBus,
  input: {
    approval_id: string;
    workspace_id: string;
    decision: "approved" | "rejected" | "expired";
    decided_by: string;
    note?: string;
  },
): Promise<boolean> {
  const event = await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "approval.decided",
    source: "user",
    producer_ref: input.decided_by,
    idempotency_key: `approval.decided:${input.approval_id}`,
    payload: {
      approval_id: input.approval_id,
      decision: input.decision,
      decided_by: input.decided_by,
      note: input.note ?? null,
    },
  });
  const canonical = event.payload as { decision: string };
  if (canonical.decision !== input.decision) return false;
  const transitioned = await projectWorkflowApprovalDecision(pool, event);
  if (transitioned) return true;
  const { rows } = await pool.query<{ decision: string }>(
    `select decision from workflow_approvals where id = $1`,
    [input.approval_id],
  );
  return rows[0]?.decision === input.decision;
}

export async function getProductReviewPulse(
  pool = getPool(),
  session: ProductWorkspaceSession,
): Promise<ProductReviewPulse> {
  await assertProductWorkspaceAccess(session, pool);
  const [
    reviewEvents,
    recommendationFeedback,
    recommendationMutations,
    recommendationOutcomes,
  ] = await Promise.all([
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
  const recommendationFeedbackById = recommendationFeedbackState(
    recommendationFeedback.rows,
  );
  const recommendationMutationById = recommendationMutationState(
    recommendationMutations.rows,
  );
  const recommendationOutcomeById = recommendationOutcomeState(
    recommendationOutcomes.rows,
  );
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
  const [
    reviewEvents,
    recommendationFeedback,
    recommendationMutations,
    recommendationOutcomes,
  ] = await Promise.all([
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
  const recommendationFeedbackById = recommendationFeedbackState(
    recommendationFeedback.rows,
  );
  const recommendationMutationById = recommendationMutationState(
    recommendationMutations.rows,
  );
  const recommendationOutcomeById = recommendationOutcomeState(
    recommendationOutcomes.rows,
  );
  const recommendationQuality = productRecommendationQualityState(
    recommendationFeedback.rows,
  );
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
    size_bucket: string | null;
    description: string | null;
    properties: Record<string, unknown>;
  }>(
    `select id, name, domain::text as domain, industry, size_bucket, description, properties
       from graph_companies
      where workspace_id = $1
        and properties->>'profile_role' = 'workspace_company'
      order by updated_at desc, created_at desc
      limit 1`,
    [session.workspace_id],
  );
  return productProfileState(rows[0] ?? null);
}

export async function getProductOperatingBrief(
  pool = getPool(),
  session: ProductWorkspaceSession,
): Promise<ProductOperatingBrief> {
  await assertProductWorkspaceAccess(session, pool);
  const [summary, signalTypes, channels] = await Promise.all([
    pool.query<{
      pending_reviews: string;
      unhealthy_channels: string;
      bounced_24h: string;
      useful_outcomes_7d: string;
      qualified_signals_24h: string;
      qualified_signals_7d: string;
      emails_sent_24h: string;
      emails_sent_7d: string;
      linkedin_dms_sent_24h: string;
      linkedin_dms_sent_7d: string;
      replies_24h: string;
      replies_7d: string;
      meetings_24h: string;
      meetings_7d: string;
    }>(
      `with outlook_accounts as (
         select coalesce(
                  nullif(lower(ca.properties ->> 'mailbox_email'), ''),
                  nullif(lower(ca.display_name), ''),
                  ca.id::text
                ) as outlook_mailbox_key,
                ca.status,
                ca.last_error
           from channel_accounts ca
          where ca.workspace_id = $1
            and ca.kind = 'oauth_outlook'
       ),
       outlook_mailboxes as (
         select outlook_mailbox_key,
                bool_or(status = 'connected') as has_connected,
                bool_or(status = 'connected' and last_error is not null) as has_connected_error,
                bool_or(status::text in (
                  'needs_reauth',
                  'errored',
                  'error',
                  'rate_limited',
                  'suspended',
                  'disconnected'
                )) as has_blocked_status
           from outlook_accounts
          group by outlook_mailbox_key
       )
       select
         (select count(*)::text from workflow_approvals a
            where a.workspace_id = $1
              and a.decision = 'pending') as pending_reviews,
         ((select count(*) from outlook_mailboxes
            where has_connected_error
               or (has_blocked_status and not has_connected))
          + (select count(*) from channel_accounts ca
               where ca.workspace_id = $1
                 and ca.kind in ('email_domain','linkedin_oauth','linkedin_session')
                 and (
                   ca.status::text in ('needs_reauth','errored','error','rate_limited','suspended','disconnected')
                   or ca.last_error is not null
                 )))::text as unhealthy_channels,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.status = 'bounced'
              and m.sent_at >= now() - interval '24 hours') as bounced_24h,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as useful_outcomes_7d,
         (select count(*)::text from signals s
            where s.workspace_id = $1
              and s.status in ('matched','in_play')
              and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours') as qualified_signals_24h,
         (select count(*)::text from signals s
            where s.workspace_id = $1
              and s.status in ('matched','in_play')
              and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as qualified_signals_7d,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.channel = 'email'
              and m.status in ('sent','delivered','replied')
              and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as emails_sent_24h,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.channel = 'email'
              and m.status in ('sent','delivered','replied')
              and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as emails_sent_7d,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.channel in ('linkedin_dm','linkedin_inmail')
              and m.status in ('sent','delivered','replied')
              and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as linkedin_dms_sent_24h,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.channel in ('linkedin_dm','linkedin_inmail')
              and m.status in ('sent','delivered','replied')
              and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as linkedin_dms_sent_7d,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind = 'positive_reply'
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as replies_24h,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind = 'positive_reply'
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as replies_7d,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind = 'meeting_booked'
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as meetings_24h,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind = 'meeting_booked'
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as meetings_7d`,
      [session.workspace_id],
    ),
    pool.query<{
      kind: string;
      count_24h: string;
      count_7d: string;
      with_contacts_7d: string;
      with_drafts_7d: string;
    }>(
      `select coalesce(s.kind::text, 'other') as kind,
              count(*) filter (
                where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours'
              )::text as count_24h,
              count(*) filter (
                where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
              )::text as count_7d,
              count(*) filter (
                where exists (
                  select 1
                    from graph_persons p
                   where p.workspace_id = $1
                     and (
                       p.id = s.related_person_id
                       or (
                         s.related_company_id is not null
                         and p.company_id = s.related_company_id
                       )
                     )
                     and (
                       cardinality(coalesce(p.emails, '{}'::text[])) > 0
                       or p.linkedin_url is not null
                     )
                )
              )::text as with_contacts_7d,
              count(*) filter (
                where exists (
                  select 1
                    from conversations c
                    join messages m
                      on m.workspace_id = c.workspace_id
                     and m.conversation_id = c.id
                   where c.workspace_id = $1
                     and c.origin_signal_id = s.id
                     and m.direction = 'outbound'
                     and m.status in ('draft','queued','deferred','sent','delivered','replied')
                )
              )::text as with_drafts_7d
         from signals s
        where s.workspace_id = $1
          and s.status in ('matched','in_play')
          and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
        group by coalesce(s.kind::text, 'other')
        order by count(*) desc, coalesce(s.kind::text, 'other') asc
        limit 6`,
      [session.workspace_id],
    ),
    pool.query<{
      email_connected: string;
      linkedin_connected: string;
    }>(
      `select
         exists (
           select 1
             from channel_accounts ca
            where ca.workspace_id = $1
              and ca.kind = 'oauth_outlook'
              and ca.status = 'connected'
         )::text as email_connected,
         exists (
           select 1
             from channel_accounts ca
            where ca.workspace_id = $1
              and ca.kind in ('linkedin_oauth','linkedin_session')
              and ca.status = 'connected'
         )::text as linkedin_connected`,
      [session.workspace_id],
    ),
  ]);
  const row = summary.rows[0];
  const emailConnected = channels.rows[0]?.email_connected === "true";
  const linkedInConnected = channels.rows[0]?.linkedin_connected === "true";
  const brief = {
    workspace_id: session.workspace_id,
    generated_at: new Date().toISOString(),
    windows: {
      last_24h: {
        qualified_signals: Number(row?.qualified_signals_24h ?? 0),
        emails_sent: Number(row?.emails_sent_24h ?? 0),
        linkedin_dms_sent: Number(row?.linkedin_dms_sent_24h ?? 0),
        replies: Number(row?.replies_24h ?? 0),
        meetings: Number(row?.meetings_24h ?? 0),
      },
      last_7d: {
        qualified_signals: Number(row?.qualified_signals_7d ?? 0),
        emails_sent: Number(row?.emails_sent_7d ?? 0),
        linkedin_dms_sent: Number(row?.linkedin_dms_sent_7d ?? 0),
        replies: Number(row?.replies_7d ?? 0),
        meetings: Number(row?.meetings_7d ?? 0),
        useful_outcomes: Number(row?.useful_outcomes_7d ?? 0),
      },
    },
    operations: {
      pending_reviews: Number(row?.pending_reviews ?? 0),
      unhealthy_channels: Number(row?.unhealthy_channels ?? 0),
      bounced_24h: Number(row?.bounced_24h ?? 0),
    },
    channel_readiness: {
      email_connected: emailConnected,
      linkedin_connected: linkedInConnected,
      connected_count: Number(emailConnected) + Number(linkedInConnected),
    },
    signal_types: signalTypes.rows.map((signal) => ({
      kind: signal.kind,
      count_24h: Number(signal.count_24h),
      count_7d: Number(signal.count_7d),
      with_contacts_7d: Number(signal.with_contacts_7d),
      with_drafts_7d: Number(signal.with_drafts_7d),
    })),
  };
  return {
    ...brief,
    next_action: operatingBriefNextAction(brief),
  };
}

function operatingBriefNextAction(
  brief: Omit<ProductOperatingBrief, "next_action">,
): ProductOperatingBrief["next_action"] {
  const totalSent7d =
    brief.windows.last_7d.emails_sent +
    brief.windows.last_7d.linkedin_dms_sent;
  if (brief.operations.pending_reviews > 0) {
    return {
      key: "review_drafts",
      label: "Review drafts",
      detail: `${brief.operations.pending_reviews} drafted outreach ${
        brief.operations.pending_reviews === 1 ? "message needs" : "messages need"
      } review before sending.`,
      href: "/dashboard/agent#review-queue",
    };
  }
  if (brief.operations.unhealthy_channels > 0) {
    return {
      key: "repair_channels",
      label: "Fix accounts",
      detail: `${brief.operations.unhealthy_channels} connected ${
        brief.operations.unhealthy_channels === 1 ? "account needs" : "accounts need"
      } attention before the agent can send reliably.`,
      href: "/dashboard/profile#channels",
    };
  }
  if (brief.channel_readiness.connected_count === 0) {
    return {
      key: "connect_accounts",
      label: "Connect accounts",
      detail:
        "Connect Outlook or LinkedIn before qualified signals can become sent outreach.",
      href: "/dashboard/profile#channels",
    };
  }
  if (brief.windows.last_7d.qualified_signals > 0 && totalSent7d === 0) {
    return {
      key: "prepare_outreach",
      label: "Prepare outreach",
      detail:
        "Qualified signals are ready, but no email or LinkedIn outreach has gone out this week.",
      href: "/dashboard/agent#qualified-signals",
    };
  }
  return {
    key: "open_agent",
    label: "Open Agent",
    detail:
      "The agent is running. Review fresh signal mix, sent outreach, and reply evidence before changing targeting.",
    href: "/dashboard/agent",
  };
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
      [
        boot.workspace_id,
        [SIGNAL_TO_EMAIL_PLAY_WORKFLOW, RSS_SIGNAL_INGESTION_WORKFLOW],
      ],
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
      [
        boot.workspace_id,
        [RSS_SIGNAL_INGESTION_WORKFLOW, WORKSPACE_POLL_WORKFLOW],
      ],
    ),
    pool.query<{
      id: string;
      name: string;
      domain: string | null;
      industry: string | null;
      size_bucket: string | null;
      description: string | null;
      properties: Record<string, unknown>;
    }>(
      `select id, name, domain::text as domain, industry, size_bucket, description, properties
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
  const recommendationFeedbackById = recommendationFeedbackState(
    recommendationFeedback.rows,
  );
  const recommendationMutationById = recommendationMutationState(
    recommendationMutations.rows,
  );
  const recommendationOutcomeById = recommendationOutcomeState(
    recommendationOutcomes.rows,
  );
  const recommendationQuality = productRecommendationQualityState(
    recommendationFeedback.rows,
  );
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
    content_reviews: applyRecommendationOutcomeState(
      productExaReviewState(
        exaReviews.rows,
        "content.opportunity.discovered",
        recommendationFeedbackById,
        recommendationMutationById,
      ),
      recommendationOutcomeById,
    ),
    aeo_reviews: applyRecommendationOutcomeState(
      productExaReviewState(
        exaReviews.rows,
        "aeo.audit.completed",
        recommendationFeedbackById,
        recommendationMutationById,
      ),
      recommendationOutcomeById,
    ),
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
      bounce_rate_24h:
        row.bounce_rate_24h == null ? null : Number(row.bounce_rate_24h),
      complaint_rate_24h:
        row.complaint_rate_24h == null ? null : Number(row.complaint_rate_24h),
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
        url: stringStateValue(
          row.config.url ?? row.config.feed_url ?? row.config.rss_url,
        ),
        signal_kind: stringStateValue(
          row.config.kind ?? row.config.signal_kind,
        ),
        poll_interval_minutes:
          pollMs == null ? null : Math.round(pollMs / 60_000),
        last_polled_at: row.last_polled_at?.toISOString() ?? null,
        signal_count: Number(row.signal_count),
        latest_run_status: row.latest_run_status,
        latest_run_created_at: row.latest_run_created_at?.toISOString() ?? null,
        latest_run_error: row.latest_run_error?.message ?? null,
      };
    }),
  };
}

function productProfileState(
  row: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    size_bucket: string | null;
    description: string | null;
    properties: Record<string, unknown>;
  } | null,
): AppState["profile"] {
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
    company_size: row.size_bucket,
    description: row.description,
    value_proposition: stringStateValue(row.properties.value_proposition),
    customer_pain_points: stringStateValue(row.properties.customer_pain_points),
    target_titles: stringStateValue(row.properties.target_titles),
    target_markets: stringStateValue(row.properties.target_markets),
    key_features: stringStateValue(row.properties.key_features),
    social_proof: stringStateValue(row.properties.social_proof),
    signal_keywords: stringStateValue(row.properties.signal_keywords),
    competitor_watchlist: stringStateValue(row.properties.competitor_watchlist),
    linkedin_signal_behaviors: stringStateValue(
      row.properties.linkedin_signal_behaviors,
    ),
    exclusion_rules: stringStateValue(row.properties.exclusion_rules),
    preferred_language: stringStateValue(row.properties.preferred_language),
    outreach_goal: stringStateValue(row.properties.outreach_goal),
    message_tone: stringStateValue(row.properties.message_tone),
    linkedin_company_url: stringStateValue(row.properties.linkedin_company_url),
    auto_enrich_email_addresses:
      booleanStateValue(row.properties.auto_enrich_email_addresses) ?? true,
    prevent_team_contact_duplication:
      booleanStateValue(row.properties.prevent_team_contact_duplication) ?? true,
    exa_summary: stringStateValue(exaProfile?.summary),
    exa_source_domains: arrayStringStateValue(intelligence?.source_domains),
    exa_market_terms: arrayStringStateValue(intelligence?.market_terms),
    exa_positioning_notes: arrayStringStateValue(
      intelligence?.positioning_notes,
    ),
    exa_competitor_mentions: arrayStringStateValue(
      intelligence?.competitor_mentions,
    ),
    exa_audience_terms: arrayStringStateValue(intelligence?.audience_terms),
    exa_proof_points: arrayStringStateValue(intelligence?.proof_points),
    exa_evidence_cards: profileEvidenceCardsStateValue(
      intelligence?.evidence_cards,
    ),
    exa_evidence_source_ids: evidenceIds,
    exa_result_count: numericConfigValue(exaProfile?.result_count) ?? 0,
    exa_enriched_at: stringStateValue(exaProfile?.enriched_at),
  };
}

function productBriefState(
  row: {
    payload: Record<string, unknown>;
    occurred_at: Date;
  } | null,
): AppState["brief"] {
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
      const key =
        eventType === "content.opportunity.discovered"
          ? "opportunities"
          : "gaps";
      const payloadItems = briefItemsStateValue(
        row.payload[key] ?? row.payload.review_items,
      );
      if (payloadItems.length > 0) {
        return payloadItems.flatMap((item) =>
          decorateProductReviewItem(
            row.event_id,
            eventType,
            item,
            feedbackById,
            mutationsById,
          ),
        );
      }
      const evidence = row.evidence[0];
      if (evidence) {
        return decorateProductReviewItem(
          row.event_id,
          eventType,
          {
            title:
              evidence.title ??
              (eventType === "content.opportunity.discovered"
                ? "Content angle to review"
                : "Answer gap to review"),
            detail:
              evidence.snippet ?? stringStateValue(row.payload.summary) ?? "",
            url: evidence.url,
            evidence_source_ids: [evidence.id],
          },
          feedbackById,
          mutationsById,
        );
      }
      const summary = stringStateValue(row.payload.summary);
      return summary
        ? decorateProductReviewItem(
            row.event_id,
            eventType,
            {
              title:
                eventType === "content.opportunity.discovered"
                  ? "Content angle to review"
                  : "Answer gap to review",
              detail: summary,
              evidence_source_ids: arrayStringStateValue(
                row.payload.evidence_source_ids,
              ),
            },
            feedbackById,
            mutationsById,
          )
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

function recommendationOutcomeState(
  rows: Array<{
    review_id: string | null;
    outcome_id: string;
    kind: ProductRecommendationOutcomeKind | string;
    external_ref: string | null;
    occurred_at: Date;
  }>,
): Map<string, ProductRecommendationOutcomeState> {
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
    const outcome = item.review_id
      ? outcomesByReviewId.get(item.review_id)
      : null;
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

function productBriefItemsLatestActivity(
  items: ProductBriefItem[],
): Date | null {
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

function productRecommendationQualityState(
  rows: Array<{
    review_kind: ProductRecommendationKind | string | null;
    decision: ProductRecommendationDecision | string;
    occurred_at: Date;
  }>,
): ProductRecommendationQuality {
  const buckets = defaultRecommendationQuality();
  for (const row of rows) {
    if (row.decision !== "accepted" && row.decision !== "ignored") continue;
    if (
      row.review_kind !== "content_opportunity" &&
      row.review_kind !== "aeo_gap"
    )
      continue;
    applyRecommendationQualityDecision(buckets, row.decision, row.occurred_at);
    applyRecommendationQualityDecision(
      buckets[row.review_kind],
      row.decision,
      row.occurred_at,
    );
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
  bucket.acceptance_rate =
    bucket.total_reviewed > 0
      ? Number((bucket.accepted / bucket.total_reviewed).toFixed(2))
      : null;
}

function recommendationFeedbackState(
  rows: Array<{
    review_id: string;
    review_kind?: ProductRecommendationKind | string | null;
    decision: ProductRecommendationDecision | string;
    note: string | null;
    occurred_at: Date;
  }>,
): Map<string, ProductRecommendationFeedbackState> {
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

function recommendationMutationState(
  rows: Array<{
    review_id: string;
    event_type: "recommendation.updated" | "recommendation.deleted";
    payload: Record<string, unknown>;
    occurred_at: Date;
  }>,
): Map<string, ProductRecommendationMutationState> {
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
        ? payload.item.evidence_source_ids.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    },
  };
}

async function findRecommendationRepForKind(
  pool: Pool,
  workspace_id: string,
  review_kind: ProductRecommendationKind,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id::text as id
       from reps
      where workspace_id = $1
        and status = 'active'
      order by case
                 when $2 = 'content_opportunity' and role = 'content' then 0
                 when $2 = 'aeo_gap' and role = 'researcher' then 0
                 else 1
               end,
               created_at asc
      limit 1`,
    [workspace_id, review_kind],
  );
  return rows[0]?.id ?? null;
}

async function ensureRecommendationDraftTarget(
  pool: Pool,
  workspace_id: string,
): Promise<{ person_id: string; company_id: string | null }> {
  const email = `editorial-review+${workspace_id}@bombsell.invalid`;
  const person = await upsertPerson(pool, workspace_id, {
    full_name: "Editorial Review",
    given_name: "Editorial",
    family_name: "Review",
    title: "Workspace content review",
    emails: [email],
    properties: {
      profile_role: "workspace_editorial_review",
      system_contact: true,
    },
    provenance: {
      source: "product.recommendation.draft",
    },
  });
  return {
    person_id: person.id,
    company_id: person.company_id,
  };
}

function defaultRecommendationDraftChannel(
  review_kind: ProductRecommendationKind,
): ProductRecommendationDraftChannel {
  return review_kind === "content_opportunity" ? "x_post" : "web";
}

function recommendationDraftSubject(
  review_kind: ProductRecommendationKind,
  title: string,
): string {
  return review_kind === "content_opportunity"
    ? `Draft post: ${title}`.slice(0, 180)
    : `Draft answer: ${title}`.slice(0, 180);
}

function recommendationDraftBody(
  review_kind: ProductRecommendationKind,
  item: {
    title: string;
    detail: string;
    url: string | null;
    evidence_source_ids: string[];
  },
): string {
  if (review_kind === "content_opportunity") {
    return [
      item.title,
      "",
      item.detail,
      "",
      item.url ? `Proof: ${item.url}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Question to answer: ${item.title}`,
    "",
    item.detail,
    "",
    item.url ? `Source/proof: ${item.url}` : null,
    "",
    "Draft the clearest answer first, then add supporting proof and schema/page updates.",
  ]
    .filter(Boolean)
    .join("\n");
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
  const { rows } = await engine.pool.query<{
    rep_id: string;
    exemplar_id: string | null;
  }>(
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

function defaultRecommendationOutcomeScore(
  kind: ProductRecommendationOutcomeKind,
): number {
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
  const review_id = productRecommendationReviewId(
    source_event_id,
    review_kind,
    item,
  );
  const mutation = mutationsById.get(review_id);
  if (mutation?.type === "deleted") return [];
  const feedback = feedbackById.get(review_id);
  if (feedback?.decision === "ignored") return [];
  const effectiveItem =
    mutation?.type === "updated"
      ? {
          ...item,
          title: mutation.item.title,
          detail: mutation.item.detail,
          url: mutation.item.url,
          evidence_source_ids:
            mutation.item.evidence_source_ids.length > 0
              ? mutation.item.evidence_source_ids
              : item.evidence_source_ids,
        }
      : item;
  return [
    {
      ...effectiveItem,
      review_id,
      review_kind,
      source_event_id,
      decision: feedback?.decision,
      reviewed_at: feedback?.occurred_at,
      review_note:
        feedback?.note ?? (mutation?.type === "updated" ? mutation.note : null),
    },
  ];
}

function productRecommendationKindForEvent(
  eventType: "content.opportunity.discovered" | "aeo.audit.completed",
): ProductRecommendationKind {
  return eventType === "content.opportunity.discovered"
    ? "content_opportunity"
    : "aeo_gap";
}

function productRecommendationReviewId(
  source_event_id: string,
  review_kind: ProductRecommendationKind,
  item: ProductBriefItem,
): string {
  const digest = createHash("sha256")
    .update(
      stableJson({
        title: item.title,
        detail: item.detail,
        url: item.url ?? null,
        evidence_source_ids: item.evidence_source_ids ?? [],
      }),
    )
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
  if (
    !opts.includeDeleted &&
    mutationsById.get(review_id)?.type === "deleted"
  ) {
    return null;
  }
  return (
    [
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
    ].find((item) => item.review_id === review_id) ?? null
  );
}

function briefItemsStateValue(value: unknown): ProductBriefItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordStateValue(item);
    const title = stringStateValue(record?.title);
    if (!record || !title) return [];
    return [
      {
        title,
        detail: stringStateValue(record.detail) ?? "",
        url: stringStateValue(record.url),
        evidence_source_ids: arrayStringStateValue(record.evidence_source_ids),
      },
    ];
  });
}

function profileEvidenceCardsStateValue(
  value: unknown,
): AppState["profile"] extends infer P
  ? P extends { exa_evidence_cards: infer C }
    ? C
    : never
  : never {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const card = recordStateValue(item);
      const title = stringStateValue(card?.title);
      const url = stringStateValue(card?.url);
      if (!title || !url) return [];
      return [
        {
          title,
          url,
          source_domain: stringStateValue(card?.source_domain),
          snippet: stringStateValue(card?.snippet),
          published_at: stringStateValue(card?.published_at),
        },
      ];
    })
    .slice(0, 8);
}

function recordStateValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayStringStateValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function stringStateValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanStateValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
