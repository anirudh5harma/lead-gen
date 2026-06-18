import { z } from "zod";
import { registerTool } from "../agents/tools/registry.ts";
import type { ToolContext } from "../agents/tools/types.ts";
import { getPool } from "../substrate/storage/index.ts";
import {
  approveWorkflowApproval,
  configureActivationSetup,
  configureDefaultSignalAggregator,
  configureIcpSegment,
  configureRep,
  configureSignalEmailPlay,
  configureSignalLinkedInPlay,
  configureExaOpenWebSignalSource,
  configureWorkspaceCompanyProfile,
  configureWorkspaceEmailAccount,
  configureWorkspaceSignalSource,
  discoverSignalFromSource,
  dispatchWorkspaceSourcePollsOnce,
  dispatchSignalPlaysOnce,
  enrichWorkspaceProfileWithExa,
  evaluateProductDraft,
  generateProductMeetingPrep,
  getLinkedInAccountConnectIntent,
  getProductOperatingBrief,
  getProductLaunchReadiness,
  getOutlookCalendarConnectIntent,
  getProductOutlookCalendarAvailability,
  getOutlookAccountConnectIntent,
  getAppState,
  listDeadLetteredEventDispatches,
  matchWorkspaceSignal,
  optimizeProductCampaignStrategy,
  optimizeProductPlaySkills,
  personalizeProductMessage,
  researchWorkspaceWithExa,
  redriveDeadLetteredEventDispatch,
  recordProductCampaignOutcome,
  runWorkspaceCompanyBrainBrief,
  refreshWorkspaceVerticalIntelligence,
  retryFailedWorkflowRun,
  runProductContactWaterfall,
  runWorkspaceActivationSetup,
  runWorkspaceProfileIcpDraft,
  runWorkspaceSignalIngestion,
  runWorkspaceSignalMatching,
  runWorkspaceSignalAggregatorOnce,
  startSendingDomainOperation,
  startWorkspaceBriefRefreshWithExa,
  startWorkspaceExaResearchWorkflow,
  submitManualSignal,
  trackCompanyForWorkspace,
  triageProductReply,
  type ProductWorkspaceSession,
} from "./app.ts";
import { getWorkspaceAgentObservabilitySummary } from "./agent-observability.ts";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "./company-profile.ts";
import { getWorkspaceCompanyBrain } from "./company-brain.ts";
import { getWorkspaceAgentContext } from "./context.ts";
import { getConversationTrustTrace } from "./conversation-trust.ts";
import {
  loadQualifiedSignalWorkbench,
  type QualifiedSignalOutreachDraft,
} from "./qualified-signals.ts";
import {
  registerBombsellAliasTools,
  _resetBombsellAliasToolsRegistration,
} from "./bombsell-tools.ts";
import { checkProductReadiness } from "./health.ts";
import {
  createSelectedOutreachSkill,
  listOutreachSkills,
} from "../agents/skills/outreach.ts";

const SignalKindSchema = z.enum([
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
]);

const ApprovalSchema = z.enum([
  "none",
  "approve_first",
  "always",
  "research_only",
]);
const ExaResearchIntentSchema = z.enum([
  "rep_research",
  "brief_refresh",
  "draft_grounding",
]);
const CampaignOutcomeKindSchema = z.enum([
  "positive_reply",
  "meeting_booked",
  "opportunity_created",
  "deal_won",
  "engagement_lift",
  "unsubscribe",
  "bounce",
  "do_not_contact",
]);
const CampaignStrategyRecommendationSchema = z.enum([
  "double_down",
  "hold",
  "reduce",
  "not_enough_proof",
]);
const CompanyBrainBriefTypeSchema = z.enum([
  "workspace",
  "icp",
  "account",
  "campaign",
  "decision_log",
  "customer_ask_log",
  "objection_bank",
  "proof_bank",
  "vertical_playbook",
]);
const CampaignStrategyVariantSchema = z.object({
  variant_key: z.string().min(1),
  play_id: z.string().uuid(),
  play_name: z.string().min(1),
  rep_id: z.string().uuid().nullable(),
  rep_name: z.string().nullable(),
  channel: z.string().nullable(),
  skill_key: z.string().min(1),
  pattern_key: z.string().min(1),
  segment_key: z.string().min(1),
  sample_count: z.number().int().nonnegative(),
  outcome_count: z.number().int().nonnegative(),
  reply_outcomes: z.number().int().nonnegative(),
  positive_outcomes: z.number().int().nonnegative(),
  negative_outcomes: z.number().int().nonnegative(),
  meeting_outcomes: z.number().int().nonnegative(),
  reply_rate: z.number().min(0).max(1),
  positive_outcome_rate: z.number().min(0).max(1),
  meeting_rate: z.number().min(0).max(1),
  negative_outcome_rate: z.number().min(0).max(1),
  utility_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  allocation_weight: z.number().min(0).max(1),
  recommendation: CampaignStrategyRecommendationSchema,
  explanation: z.string().min(1),
});
const SkillOptimizerNextActionSchema = z.enum([
  "apply_play_gate",
  "review_reduce",
  "keep_learning",
  "no_change",
]);
const SkillOptimizationRecommendationSchema = z.object({
  skill_key: z.string().min(1),
  pattern_key: z.string().min(1),
  channel: z.string().nullable(),
  segment_key: z.string().min(1),
  rep_id: z.string().uuid().nullable(),
  rep_name: z.string().nullable(),
  sample_count: z.number().int().nonnegative(),
  outcome_count: z.number().int().nonnegative(),
  reply_outcomes: z.number().int().nonnegative(),
  positive_outcomes: z.number().int().nonnegative(),
  negative_outcomes: z.number().int().nonnegative(),
  meeting_outcomes: z.number().int().nonnegative(),
  reply_rate: z.number().min(0).max(1),
  positive_outcome_rate: z.number().min(0).max(1),
  meeting_rate: z.number().min(0).max(1),
  negative_outcome_rate: z.number().min(0).max(1),
  memory_win_count: z.number().int().nonnegative(),
  memory_loss_count: z.number().int().nonnegative(),
  memory_delta_score: z.number(),
  utility_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  allocation_weight: z.number().min(0).max(1),
  recommendation: CampaignStrategyRecommendationSchema,
  next_action: SkillOptimizerNextActionSchema,
  explanation: z.string().min(1),
  source_variant_keys: z.array(z.string().min(1)),
});
const LinkedInActionSchema = z.enum([
  "linkedin_connection",
  "linkedin_dm",
  "linkedin_comment",
]);
const OutreachSkillChannelSchema = z.enum([
  "email",
  "linkedin_connection",
  "linkedin_dm",
  "linkedin_inmail",
  "linkedin_comment",
  "x_dm",
]);
const OutreachSkillStageSchema = z.enum(["cold_open", "reply"]);
const OutreachSkillSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(["signal", "counterparty", "workspace", "memory", "outcome"]),
  required: z.boolean(),
  instruction: z.string().min(1),
});
const OutreachSkillSchema = z.object({
  skill_key: z.string().min(1),
  version: z.string().min(1),
  channel: OutreachSkillChannelSchema,
  stage: OutreachSkillStageSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  framework: z.array(z.string().min(1)),
  slots: z.array(OutreachSkillSlotSchema),
  constraints: z.array(z.string().min(1)),
  judge_focus: z.array(z.string().min(1)),
  selection: z.object({
    priority: z.number(),
    signal_kinds: z.array(z.string()).optional(),
    intents: z.array(z.string()).optional(),
    actions: z.array(OutreachSkillChannelSchema).optional(),
    seniority_regex: z.string().optional(),
    fallback: z.boolean().optional(),
  }),
});
const SelectedOutreachSkillSchema = OutreachSkillSchema.omit({
  selection: true,
}).extend({
  pattern_key: z.string().min(1),
  slot_values: z.record(z.string(), z.string()),
});
const VerticalIntelligenceFactCategorySchema = z.enum([
  "icp_rule",
  "pain",
  "objection",
  "proof",
  "competitor",
  "trigger",
  "positioning",
  "signal_mapping",
  "skill_performance",
]);
const VerticalIntelligencePrimitiveRefsSchema = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  icp_id: z.string().uuid().nullable().optional(),
});
const VerticalIntelligenceSourceRefSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url().nullable().optional(),
});
const VerticalIntelligenceFactSchema = z.object({
  id: z.string().min(1),
  category: VerticalIntelligenceFactCategorySchema,
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().min(1)),
  source_refs: z.array(VerticalIntelligenceSourceRefSchema),
  primitive_refs: VerticalIntelligencePrimitiveRefsSchema,
  last_observed_at: z.string().datetime(),
  included_in_prompt: z.boolean(),
});
const VerticalIntelligencePackSchema = z.object({
  workspace_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_name: z.string().min(1),
  vertical: z.string().min(1),
  generated_at: z.string().datetime(),
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  facts: z.array(VerticalIntelligenceFactSchema),
  prompt_context: z.string(),
  evidence_source_ids: z.array(z.string().uuid()),
  redaction_status: z.literal("source_refs_only"),
});
const RepRoleSchema = z.enum([
  "sdr",
  "replier",
  "researcher",
  "campaign",
  "custom",
]);
const SourceAdapterSchema = z.enum([
  "rss",
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "sec_edgar",
  "google_news",
  "hn_front",
  "hn_whos_hiring",
  "product_hunt",
  "reddit",
  "exa",
  "x_search",
  "webhook",
]);

const WorkspaceResultSchema = z.object({
  workspace_id: z.string().uuid(),
});
const OperatingBriefWindowSchema = z.object({
  qualified_signals: z.number().int().nonnegative(),
  emails_sent: z.number().int().nonnegative(),
  linkedin_touches_sent: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  meetings: z.number().int().nonnegative(),
});
const OperatingBriefSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  windows: z.object({
    last_24h: OperatingBriefWindowSchema,
    last_7d: OperatingBriefWindowSchema.extend({
      useful_outcomes: z.number().int().nonnegative(),
    }),
  }),
  operations: z.object({
    pending_reviews: z.number().int().nonnegative(),
    unhealthy_channels: z.number().int().nonnegative(),
    bounced_24h: z.number().int().nonnegative(),
  }),
  channel_readiness: z.object({
    email_connected: z.boolean(),
    linkedin_connected: z.boolean(),
    connected_count: z.number().int().min(0).max(2),
  }),
  signal_types: z.array(
    z.object({
      kind: z.string().min(1),
      count_24h: z.number().int().nonnegative(),
      count_7d: z.number().int().nonnegative(),
      with_contacts_7d: z.number().int().nonnegative(),
      with_drafts_7d: z.number().int().nonnegative(),
    }),
  ),
  next_action: z.object({
    key: z.enum([
      "review_drafts",
      "repair_channels",
      "connect_accounts",
      "prepare_outreach",
      "open_agent",
    ]),
    label: z.string().min(1),
    detail: z.string().min(1),
    href: z.string().min(1),
  }),
});
const MessagePersonalizationOutputSchema = WorkspaceResultSchema.extend({
  conversation_id: z.string().uuid().nullable(),
  message_id: z.string().uuid(),
  channel: OutreachSkillChannelSchema,
  rep_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  person_id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  subject: z.string().nullable(),
  body: z.string().min(1),
  pattern_key: z.string().min(1),
  seed_pattern_key: z.string().nullable(),
  skill_key: z.string().min(1),
  skill_version: z.string().min(1),
  exemplar_ids: z.array(z.string()),
  procedural_exemplar_count: z.number().int().nonnegative(),
  personalization_context_markdown: z.string().min(1),
  provenance: z.record(z.string(), z.unknown()),
  llm_used: z.boolean(),
  next_action: z.literal("run_eval_gate"),
});
const EvalArtifactKindSchema = z.enum([
  "draft",
  "plan",
  "post",
  "reply",
  "other",
]);
const DraftEvalSkillContextSchema = z.object({
  skill_key: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  framework: z.array(z.string().min(1)),
  judge_focus: z.array(z.string().min(1)),
  slot_values: z.record(z.string(), z.string()).optional(),
  pattern_key: z.string().min(1).optional(),
  seed_pattern_key: z.string().nullable().optional(),
});
const DraftEvalInputSchema = z.object({
  message_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.string().min(1),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  artifact_kind: EvalArtifactKindSchema.optional(),
  signal_summary: z.string().nullable().optional(),
  counterparty_summary: z.string().nullable().optional(),
  personalization_context_markdown: z.string().nullable().optional(),
  workspace_context_markdown: z.string().nullable().optional(),
  outreach_skill: DraftEvalSkillContextSchema.nullable().optional(),
});
const DraftEvalOutputSchema = WorkspaceResultSchema.extend({
  message_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.string().min(1),
  decision: z.enum(["pass", "reject"]),
  eval_score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  passed: z.boolean(),
  notes: z.record(z.string(), z.unknown()),
  judged_event_id: z.string().uuid(),
  rejected_event_id: z.string().uuid().nullable(),
  rejection_reason: z.string().nullable(),
  next_action: z.enum(["continue_to_play_gate", "revise_draft"]),
});
const ReplyTriageIntentSchema = z.enum([
  "positive",
  "meeting_intent",
  "negative",
  "neutral",
  "ooo",
  "unsubscribe",
  "do_not_contact",
  "spam",
]);
const ReplyTriageNextActionSchema = z.enum([
  "generate_meeting_prep",
  "draft_reply",
  "block_contact",
  "stop",
  "review_unmatched",
]);
const ReplyTriageOutputSchema = WorkspaceResultSchema.extend({
  channel: z.literal("email"),
  matched_conversation_id: z.string().uuid().nullable(),
  inbound_message_id: z.string().uuid().nullable(),
  intent: ReplyTriageIntentSchema.nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  outcome_id: z.string().uuid().nullable(),
  next_action: ReplyTriageNextActionSchema,
});
const LaunchReadinessStatusSchema = z.enum([
  "ready",
  "needs_attention",
  "blocked",
]);
const LaunchReadinessRequiredChannelSchema = z.enum([
  "any",
  "email",
  "linkedin",
  "both",
]);
const LaunchReadinessCheckSchema = z.object({
  id: z.enum([
    "workspace_profile",
    "icp",
    "rep",
    "signal_sources",
    "plays",
    "outlook",
    "linkedin",
    "outreach_channel",
  ]),
  label: z.string().min(1),
  primitive: z.enum(["Rep", "Signal", "Play", "Conversation"]),
  status: LaunchReadinessStatusSchema,
  required: z.boolean(),
  detail: z.string().min(1),
  count: z.number().int().nonnegative(),
  action: z
    .object({
      label: z.string().min(1),
      tools: z.array(z.string().min(1)),
      surface: z.string().min(1),
    })
    .nullable(),
});
const LaunchReadinessSchema = WorkspaceResultSchema.extend({
  checked_at: z.string().datetime(),
  required_channel: LaunchReadinessRequiredChannelSchema,
  status: LaunchReadinessStatusSchema,
  launch_ready: z.boolean(),
  next_action: z.enum([
    "start_outreach",
    "configure_profile",
    "configure_icp",
    "configure_rep",
    "configure_sources",
    "configure_play",
    "connect_outlook",
    "connect_linkedin",
    "repair_channel",
  ]),
  checks: z.array(LaunchReadinessCheckSchema),
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
const ContactWaterfallChannelSchema = z.enum(["email", "linkedin"]);
const ContactCandidateSchema = z.object({
  person_id: z.string().uuid(),
  full_name: z.string().min(1),
  title: z.string().nullable(),
  company_id: z.string().uuid().nullable(),
  emails: z.array(z.string()),
  linkedin_url: z.string().nullable(),
  score: z.number(),
  reasons: z.array(z.string()),
  verification: z.object({
    email_status: z.string().nullable().optional(),
    email_verified: z.boolean().optional(),
    linkedin_ready: z.boolean().optional(),
  }),
  provenance: z.record(z.string(), z.unknown()),
});
const ContactWaterfallResultSchema = WorkspaceResultSchema.extend({
  workflow_name: z.literal("contact.resolve_for_signal.v1"),
  workflow_run_id: z.string().min(1),
  workflow_status: z.enum([
    "pending",
    "running",
    "awaiting_approval",
    "awaiting_event",
    "completed",
    "failed",
    "cancelled",
  ]),
  decision: z.enum(["started", "resolved", "deferred"]),
  contact_resolution_id: z.string().uuid().nullable(),
  candidates: z.array(ContactCandidateSchema),
  selected_person_id: z.string().uuid().nullable(),
  defer_reason: z.string().nullable(),
});
const QualifiedSignalContactSchema = z.object({
  rank: z.number().int().nonnegative(),
  person_id: z.string().min(1),
  full_name: z.string().min(1),
  title: z.string().nullable(),
  score: z.number(),
  contact_fit_decision: z.enum(["fit", "unsure", "not_fit"]).nullable(),
  reasons: z.array(z.string()),
  email_count: z.number().int().nonnegative(),
  linkedin_url: z.string().nullable(),
  verification: z.object({
    email_verified: z.boolean().nullable().optional(),
    email_status: z.string().nullable().optional(),
    linkedin_ready: z.boolean().nullable().optional(),
  }),
  provenance: z.record(z.string(), z.unknown()),
});
const QualifiedSignalDraftSchema = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel: z.string().min(1),
  status: z.string().min(1),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  eval_score: z.number().nullable(),
  eval_passed: z.boolean().nullable(),
  external_id: z.string().nullable(),
  scheduled_at: z.string().datetime().nullable(),
  sent_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  latest_channel_event_type: z.string().nullable(),
  latest_channel_event_at: z.string().datetime().nullable(),
  defer_reason: z.string().nullable(),
  defer_detail: z.string().nullable(),
  pending_approval_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
const QualifiedSignalWorkbenchSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  stats: z.object({
    qualified: z.number().int().nonnegative(),
    with_verified_contacts: z.number().int().nonnegative(),
    with_outreach_draft: z.number().int().nonnegative(),
    with_email_draft: z.number().int().nonnegative(),
    ready_for_review: z.number().int().nonnegative(),
    blocked_by_fit: z.number().int().nonnegative(),
  }),
  signals: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.string().min(1),
      status: z.string().min(1),
      title: z.string().min(1),
      content: z.string().nullable(),
      url: z.string().nullable(),
      match_score: z.number().nullable(),
      match_reason: z.string().nullable(),
      freshness_at: z.string().datetime(),
      ingested_at: z.string().datetime(),
      matched_at: z.string().datetime().nullable(),
      company: z.object({
        id: z.string().uuid().nullable(),
        name: z.string().nullable(),
        domain: z.string().nullable(),
        industry: z.string().nullable(),
        description: z.string().nullable(),
      }),
      contacts: z.array(QualifiedSignalContactSchema),
      contact_source: z.enum(["resolution", "graph", "none"]),
      contact_channel: z.string().nullable(),
      contact_defer_reason: z.string().nullable(),
      outreach_draft: QualifiedSignalDraftSchema.nullable(),
      email_draft: QualifiedSignalDraftSchema.nullable(),
    }),
  ),
});
const MeetingPrepProfileContextSchema = z.object({
  user: z.object({
    user_id: z.string().min(1).nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: z.string().nullable(),
  }),
  prospect: z.object({
    person_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    title: z.string().nullable(),
    linkedin_url: z.string().nullable(),
  }),
  company: z.object({
    company_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    domain: z.string().nullable(),
    industry: z.string().nullable(),
    description: z.string().nullable(),
  }),
  rep: z.object({
    rep_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    role: z.string().nullable(),
  }),
});
const MeetingPrepSourceRefSchema = z.object({
  type: z.enum([
    "conversation",
    "message",
    "signal",
    "outcome",
    "person",
    "company",
    "rep",
    "user",
  ]),
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url().nullable().optional(),
});
const MeetingPrepThreadTurnSchema = z.object({
  message_id: z.string().min(1),
  direction: z.string().min(1),
  at: z.string().datetime().nullable(),
  intent_class: z.string().nullable(),
  excerpt: z.string().min(1),
});
const MeetingPrepNoteSchema = WorkspaceResultSchema.extend({
  meeting_prep_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  status: z.enum(["ready", "blocked"]),
  next_action: z.enum([
    "prepare_meeting",
    "ask_for_times",
    "wait_for_reply",
    "do_not_follow_up",
  ]),
  summary: z.string().min(1),
  thread_summary: z.string().min(1),
  thread_turns: z.array(MeetingPrepThreadTurnSchema),
  agenda: z.array(z.string().min(1)),
  suggested_questions: z.array(z.string().min(1)),
  suggested_times: z.array(z.string().min(1)),
  availability_status: z.enum(["included", "omitted_no_consent"]),
  availability_reason: z.string().min(1),
  calendar_provider: z.string().nullable(),
  calendar_account_id: z.string().uuid().nullable(),
  calendar_account_display_name: z.string().nullable(),
  profile_context: MeetingPrepProfileContextSchema,
  source_refs: z.array(MeetingPrepSourceRefSchema),
});
const OutlookCalendarAvailabilitySchema = z.object({
  consented: z.boolean(),
  provider: z.literal("outlook"),
  channel_account_id: z.string().uuid().nullable(),
  account_display_name: z.string().nullable(),
  suggested_times: z.array(z.string()),
  reason: z.enum([
    "calendar_included",
    "calendar_not_configured",
    "no_connected_calendar",
    "calendar_permission_missing",
    "calendar_needs_reauth",
    "calendar_provider_error",
    "no_free_slots",
  ]),
});
const ProductReadinessStatusSchema = z.enum(["ok", "degraded", "unconfigured"]);
const ProductReadinessSchema = z.object({
  service: z.literal("bombsell-product"),
  status: ProductReadinessStatusSchema,
  ready: z.boolean(),
  checked_at: z.string().datetime(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: ProductReadinessStatusSchema,
      detail: z.string().optional(),
    }),
  ),
});
const DeadLetteredDispatchSchema = z.object({
  event_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  event_type: z.string(),
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  dead_lettered_at: z.string().datetime(),
  source: z.string(),
  producer_ref: z.string().nullable(),
});
const AgentTraceStatusSchema = z.enum(["ok", "error", "deferred", "blocked"]);
const AgentTracePrimitiveRefsSchema = z.object({
  rep_id: z.string().nullable().optional(),
  signal_id: z.string().nullable().optional(),
  play_id: z.string().nullable().optional(),
  play_run_id: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
  message_id: z.string().nullable().optional(),
  outcome_id: z.string().nullable().optional(),
  company_id: z.string().nullable().optional(),
  person_id: z.string().nullable().optional(),
});
const AgentTraceSpanSummarySchema = z.object({
  span_id: z.string().min(1),
  parent_span_id: z.string().min(1).nullable(),
  kind: z.enum([
    "agent.run",
    "langgraph.node",
    "llm.call",
    "tool.call",
    "memory.read",
    "memory.write",
    "eval.judge",
    "workflow.step",
    "channel.send",
    "contact.waterfall.step",
    "approval.interrupt",
    "campaign.optimizer.decision",
  ]),
  name: z.string().min(1),
  status: AgentTraceStatusSchema,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  duration_ms: z.number().nonnegative().nullable(),
  graph_name: z.string().nullable(),
  node_name: z.string().nullable(),
  run_id: z.string().nullable(),
  thread_id: z.string().nullable(),
  model: z.string().nullable(),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  estimated_cost_usd: z.number().nonnegative().nullable(),
  retry_count: z.number().int().nonnegative().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  error: z
    .object({
      message: z.string().min(1),
      name: z.string().nullable(),
    })
    .nullable(),
});
const AgentObservabilitySummarySchema = z.object({
  workspace_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  lookback_hours: z.number().int().positive(),
  trace_id: z.string().nullable(),
  trace_count: z.number().int().nonnegative(),
  span_count: z.number().int().nonnegative(),
  error_span_count: z.number().int().nonnegative(),
  blocked_span_count: z.number().int().nonnegative(),
  deferred_span_count: z.number().int().nonnegative(),
  eval_failure_count: z.number().int().nonnegative(),
  total_prompt_tokens: z.number().int().nonnegative(),
  total_completion_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
  redaction: z.object({
    pii_redacted_trace_count: z.number().int().nonnegative(),
    external_export_count: z.number().int().nonnegative(),
    raw_export_blocked: z.boolean(),
  }),
  traces: z.array(
    z.object({
      trace_id: z.string().min(1),
      status: AgentTraceStatusSchema,
      first_seen_at: z.string().datetime(),
      last_seen_at: z.string().datetime(),
      duration_ms: z.number().nonnegative().nullable(),
      span_count: z.number().int().nonnegative(),
      error_span_count: z.number().int().nonnegative(),
      blocked_span_count: z.number().int().nonnegative(),
      deferred_span_count: z.number().int().nonnegative(),
      eval_failure_count: z.number().int().nonnegative(),
      graph_names: z.array(z.string()),
      node_names: z.array(z.string()),
      model_names: z.array(z.string()),
      total_prompt_tokens: z.number().int().nonnegative(),
      total_completion_tokens: z.number().int().nonnegative(),
      estimated_cost_usd: z.number().nonnegative(),
      primitive_refs: AgentTracePrimitiveRefsSchema,
      latest_error: z
        .object({
          message: z.string().min(1),
          name: z.string().nullable(),
        })
        .nullable(),
      export_destinations: z.array(z.string()),
      redaction: z.object({
        pii: z.enum(["none", "redacted", "contains_pii"]),
        external_export_allowed: z.boolean(),
        raw_payload_exported: z.boolean(),
      }),
      spans: z.array(AgentTraceSpanSummarySchema),
    }),
  ),
  eval_failures: z.array(
    z.object({
      eval_case_id: z.string().min(1),
      trace_id: z.string().min(1),
      span_id: z.string().min(1).nullable(),
      failure_kind: z.string().min(1),
      reason: z.string().min(1),
      source_event_id: z.string().nullable(),
      created_at: z.string().datetime(),
    }),
  ),
});

let registered = false;

function sessionFromContext(ctx: ToolContext): ProductWorkspaceSession {
  if (!ctx.user_id) {
    throw new Error(
      "Authenticated user context is required for product tools.",
    );
  }
  return { workspace_id: ctx.workspace_id, user_id: ctx.user_id };
}

export function registerProductTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: "product.state.get",
    description:
      "Read the workspace product state behind Brief, Profile, and Agent: qualified signals, verified contacts, outreach, replies, meetings, approvals, sources, account health, and event trace.",
    kind: "read",
    input: z.object({}),
    output: z.unknown(),
    async handler(_input, ctx) {
      return getAppState(undefined, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.brief.get",
    description:
      "Read the current operating Brief for agent clients: last-day and last-week qualified signals, signal types, sent email/LinkedIn outreach, replies, meetings, channel readiness, pending reviews, and the next action.",
    kind: "read",
    input: z.object({}),
    output: OperatingBriefSchema,
    async handler(_input, ctx) {
      return getProductOperatingBrief(undefined, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.context.get",
    description:
      "Read prompt-ready dynamic workspace context for the Agent: profile, ICP, connected accounts, qualified signals, verified contacts, outreach, replies, meetings, gates, and recovery state.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      workspace_id: z.string().uuid(),
      generated_at: z.string().datetime(),
      markdown: z.string(),
      counts: z.object({
        reps: z.number().int().nonnegative(),
        icps: z.number().int().nonnegative(),
        plays: z.number().int().nonnegative(),
        sources: z.number().int().nonnegative(),
        pending_approvals: z.number().int().nonnegative(),
        recent_signals: z.number().int().nonnegative(),
        recent_conversations: z.number().int().nonnegative(),
        recent_outcomes: z.number().int().nonnegative(),
        company_brain_cards: z.number().int().nonnegative(),
      }),
    }),
    async handler(_input, ctx) {
      return getWorkspaceAgentContext(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.qualified_signals.list",
    description:
      "List the Agent workbench of qualified Signals with verified/contact-ready people, LinkedIn readiness, latest judged outreach draft, pending approval, and contact defer reason.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(100).optional(),
    }),
    output: QualifiedSignalWorkbenchSchema,
    async handler(input, ctx) {
      const session = sessionFromContext(ctx);
      const workbench = await loadQualifiedSignalWorkbench(
        getPool(),
        session.workspace_id,
        { limit: input.limit },
      );
      return {
        workspace_id: session.workspace_id,
        generated_at: new Date().toISOString(),
        stats: workbench.stats,
        signals: workbench.signals.map((signal) => ({
          ...signal,
          freshness_at: signal.freshness_at.toISOString(),
          ingested_at: signal.ingested_at.toISOString(),
          matched_at: signal.matched_at?.toISOString() ?? null,
          contacts: signal.contacts.map((contact) => ({
            rank: contact.rank,
            person_id: contact.person_id,
            full_name: contact.full_name,
            title: contact.title,
            score: contact.score,
            contact_fit_decision: contact.contact_fit_decision,
            reasons: contact.reasons,
            email_count: contact.emails.length,
            linkedin_url: contact.linkedin_url,
            verification: contact.verification,
            provenance: contact.provenance,
          })),
          outreach_draft: isoQualifiedSignalDraft(signal.outreach_draft),
          email_draft: isoQualifiedSignalDraft(signal.email_draft),
        })),
      };
    },
  });

  registerTool({
    name: "product.company_brain.recall",
    description:
      "Read the workspace-scoped shared company brain: profile facts, high-intent signals, outcomes, meeting prep, outreach memory, semantic facts, source refs, and optional Memory Store connector status.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      workspace_id: z.string().uuid(),
      generated_at: z.string().datetime(),
      connector: z.object({
        memory_store: z.object({
          enabled: z.boolean(),
          status: z.enum(["disabled", "configured"]),
          detail: z.string(),
        }),
      }),
      cards: z.array(
        z.object({
          id: z.string(),
          kind: z.enum([
            "profile",
            "signal",
            "outcome",
            "playbook",
            "semantic_fact",
            "meeting_prep",
          ]),
          title: z.string(),
          summary: z.string(),
          confidence: z.number().nullable(),
          freshness_at: z.string().datetime().nullable(),
          tags: z.array(z.string()),
          primitive_refs: z.object({
            rep_id: z.string().nullable().optional(),
            signal_id: z.string().nullable().optional(),
            conversation_id: z.string().nullable().optional(),
            message_id: z.string().nullable().optional(),
            outcome_id: z.string().nullable().optional(),
            company_id: z.string().nullable().optional(),
            person_id: z.string().nullable().optional(),
          }),
          source_refs: z
            .array(
              z.object({
                type: z.string(),
                id: z.string(),
                label: z.string(),
                url: z.string().nullable().optional(),
              }),
            )
            .min(1),
        }),
      ),
    }),
    async handler(_input, ctx) {
      return getWorkspaceCompanyBrain(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.company_brain.brief.refresh",
    description:
      "Start the durable shared company-brain brief workflow. It recalls source-backed workspace memory and emits company.brief.updated for workspace, ICP, account, campaign, decision, ask, objection, proof, or vertical playbook context.",
    kind: "write",
    input: z.object({
      brief_type: CompanyBrainBriefTypeSchema.optional(),
      task: z.string().min(1).optional(),
      rep_id: z.string().uuid().nullable().optional(),
      signal_id: z.string().uuid().nullable().optional(),
      play_id: z.string().uuid().nullable().optional(),
      play_run_id: z.string().uuid().nullable().optional(),
      conversation_id: z.string().uuid().nullable().optional(),
      message_id: z.string().uuid().nullable().optional(),
      outcome_id: z.string().uuid().nullable().optional(),
      company_id: z.string().uuid().nullable().optional(),
      person_id: z.string().uuid().nullable().optional(),
      idempotency_nonce: z.string().min(1).nullable().optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_name: z.literal("workspace.company_brain.brief"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      const { wait, timeout_ms, ...workflowInput } = input;
      return runWorkspaceCompanyBrainBrief(
        workflowInput,
        sessionFromContext(ctx),
        { wait, timeoutMs: timeout_ms },
      );
    },
  });

  registerTool({
    name: "product.vertical_intelligence.refresh",
    description:
      "Refresh graph-backed vertical intelligence for signal matching, outreach writing, judge context, and meeting prep by emitting vertical.intelligence.updated.",
    kind: "write",
    input: z.object({
      company_id: z.string().uuid().nullable().optional(),
    }),
    output: VerticalIntelligencePackSchema,
    async handler(input, ctx) {
      return refreshWorkspaceVerticalIntelligence(
        input,
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.readiness.get",
    description:
      "Read the product runtime readiness shown in Health: environment, provider configuration, durable substrate, database, schema tables, and migrations.",
    kind: "read",
    input: z.object({}),
    output: ProductReadinessSchema,
    async handler(_input, ctx) {
      sessionFromContext(ctx);
      return checkProductReadiness();
    },
  });

  registerTool({
    name: "product.launch.readiness.get",
    description:
      "Read the workspace launch gate for autonomous outreach: Profile, buyer fit, signal sources, outreach rules, Outlook reply sync, LinkedIn health, blockers, warnings, and next action.",
    kind: "read",
    input: z.object({
      required_channel: LaunchReadinessRequiredChannelSchema.optional(),
    }),
    output: LaunchReadinessSchema,
    async handler(input, ctx) {
      return getProductLaunchReadiness(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.agent_observability.summary.get",
    description:
      "Read a redacted, event-sourced summary of recent agent traces: LangGraph nodes, LLM/tool spans, model cost, primitive refs, exports, and failed eval candidates.",
    kind: "read",
    input: z.object({
      trace_id: z.string().min(1).nullable().optional(),
      lookback_hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .optional(),
      limit: z.number().int().min(1).max(100).optional(),
      span_limit: z.number().int().min(1).max(50).optional(),
    }),
    output: AgentObservabilitySummarySchema,
    async handler(input, ctx) {
      return getWorkspaceAgentObservabilitySummary(
        input,
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.contact.waterfall.resolve",
    description:
      "Run the official graph-first contact resolution waterfall for a qualified signal before outreach: graph cache, provider discovery, email verification, ranked candidates, or a typed defer.",
    kind: "write",
    input: z.object({
      signal_id: z.string().uuid(),
      company_id: z.string().uuid(),
      play_id: z.string().uuid(),
      rep_id: z.string().uuid(),
      channel: ContactWaterfallChannelSchema,
      limit: z.number().int().min(1).max(3).optional(),
      repair_key: z.string().min(1).max(64).nullable().optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
    }),
    output: ContactWaterfallResultSchema,
    async handler(input, ctx) {
      return runProductContactWaterfall(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.conversation.trust.get",
    description:
      "Read the user-facing proof trace for one outreach thread: signal, verified contact, messages, judge output, approval gate, workflow steps, send/defer events, replies, and meetings.",
    kind: "read",
    input: z.object({ conversation_id: z.string().uuid() }),
    output: z.unknown(),
    async handler(input, ctx) {
      return getConversationTrustTrace({
        workspace_id: ctx.workspace_id,
        conversation_id: input.conversation_id,
      });
    },
  });

  registerTool({
    name: "product.meeting.prep.generate",
    description:
      "Generate a source-referenced meeting prep note for one Conversation. Availability is omitted unless calendar consent exists.",
    kind: "write",
    input: z.object({
      conversation_id: z.string().uuid(),
    }),
    output: MeetingPrepNoteSchema,
    async handler(input, ctx) {
      return generateProductMeetingPrep(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.company.website_profile.extract",
    description:
      "Extract a company profile from a public website with Firecrawl and the product LLM. Returns profile data; it does not write workspace state.",
    kind: "external",
    input: z.object({
      website_url: z.string().min(1),
      company_hint: z.string().optional(),
      allowed_industries: z.array(z.string().min(1)).optional(),
    }),
    output: z
      .object({
        company_name: z.string().nullable(),
        website_url: z.string(),
        industry: z.string().nullable(),
        description: z.string().nullable(),
      })
      .nullable(),
    async handler(input) {
      const websiteUrl = normalizeCompanyWebsiteUrl(input.website_url);
      if (!websiteUrl) throw new Error("valid website_url required");
      return analyzeCompanyWebsite({
        websiteUrl,
        companyHint: input.company_hint,
        allowedIndustries: input.allowed_industries,
      });
    },
  });

  registerTool({
    name: "product.profile_icp.draft",
    description:
      "Run the durable LangGraph Profile and buyer-fit draft step from a website URL. Emits workspace.profile.drafted and icp.drafted; it does not configure Agent persona, outreach rules, sources, channels, or sends.",
    kind: "write",
    input: z.object({
      website_url: z.string().min(1),
      company_hint: z.string().optional(),
      allowed_industries: z.array(z.string().min(1)).optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_name: z.literal("workspace.profile.icp"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      const { wait, timeout_ms, ...workflowInput } = input;
      return runWorkspaceProfileIcpDraft(
        workflowInput,
        sessionFromContext(ctx),
        { wait, timeoutMs: timeout_ms },
      );
    },
  });

  registerTool({
    name: "product.activation.setup.run",
    description:
      "Run the durable website-to-setup LangGraph workflow. It drafts Profile and buyer fit, configures the Agent persona and email/LinkedIn outreach rules, configures low-cost default signal sources, returns Outlook/LinkedIn connection gates, and then starts initial signal ingestion after activation completes. It never matches leads or sends outreach.",
    kind: "write",
    input: z.object({
      website_url: z.string().min(1),
      company_hint: z.string().optional(),
      industry_hint: z.string().optional(),
      description_hint: z.string().optional(),
      customer_pain_points: z.string().optional(),
      target_titles: z.string().optional(),
      target_markets: z.string().optional(),
      key_features: z.string().optional(),
      social_proof: z.string().optional(),
      signal_keywords: z.string().optional(),
      competitor_watchlist: z.string().optional(),
      exclusion_rules: z.string().optional(),
      preferred_language: z.string().optional(),
      outreach_goal: z.string().optional(),
      message_tone: z.string().optional(),
      allowed_industries: z.array(z.string().min(1)).optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_name: z.literal("workspace.activation.setup"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
      initial_signal_ingestion: z
        .object({
          workflow_name: z.literal("workspace.signal.ingestion"),
          workflow_run_id: z.string(),
          output: z.unknown().nullable(),
        })
        .nullable()
        .optional(),
    }),
    async handler(input, ctx) {
      const { wait, timeout_ms, ...workflowInput } = input;
      const session = sessionFromContext(ctx);
      const activation = await runWorkspaceActivationSetup(
        workflowInput,
        session,
        { wait, timeoutMs: timeout_ms },
      );
      if (wait === false) {
        return {
          ...activation,
          initial_signal_ingestion: null,
        };
      }
      const initial_signal_ingestion = await runWorkspaceSignalIngestion(
        { limit: 4 },
        session,
        { wait: false },
      );
      return {
        ...activation,
        initial_signal_ingestion: {
          workflow_name: initial_signal_ingestion.workflow_name,
          workflow_run_id: initial_signal_ingestion.workflow_run_id,
          output: initial_signal_ingestion.output,
        },
      };
    },
  });

  registerTool({
    name: "product.company.profile.configure",
    description:
      "Store the workspace company profile as graph memory by emitting workspace.company.profiled and projecting it.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      website_url: z.string().min(1),
      industry: z.string().optional(),
      description: z.string().optional(),
      customer_pain_points: z.string().optional(),
      target_titles: z.string().optional(),
      target_markets: z.string().optional(),
      key_features: z.string().optional(),
      social_proof: z.string().optional(),
      signal_keywords: z.string().optional(),
      competitor_watchlist: z.string().optional(),
      exclusion_rules: z.string().optional(),
      preferred_language: z.string().optional(),
      outreach_goal: z.string().optional(),
      message_tone: z.string().optional(),
      profile_source: z.enum(["manual", "firecrawl", "fallback"]).optional(),
    }),
    output: WorkspaceResultSchema.extend({ company_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureWorkspaceCompanyProfile(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.profile.enrich",
    description:
      "Enrich the workspace Profile with Exa public-web evidence, projecting results into graph sources and updating company memory through a typed event.",
    kind: "write",
    input: z.object({
      company_id: z.string().uuid().optional(),
      company_name: z.string().min(1),
      website_url: z.string().optional(),
      industry: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      max_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      company_id: z.string().uuid(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return enrichWorkspaceProfileWithExa(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.brief.refresh",
    description:
      "Start the durable Exa-backed Brief refresh. It gathers fresh public-web evidence, projects it into the graph, and emits the Agent-ready brief refresh event.",
    kind: "write",
    input: z.object({
      query: z.string().min(1).optional(),
      num_results: z.number().int().positive().max(12).optional(),
      include_text: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_run_id: z.string(),
      workflow_name: z.string(),
    }),
    async handler(input, ctx) {
      return startWorkspaceBriefRefreshWithExa(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.rep.research",
    description:
      "Let the Agent research the public web with Exa and store evidence in the graph for future qualification and outreach context.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
      include_text: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "rep_research" },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.exa.research_workflow.start",
    description:
      "Start a durable Exa research workflow for Agent research, Brief refresh, or draft grounding when asynchronous checkpointed execution is preferred.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      intent: ExaResearchIntentSchema.default("rep_research"),
      num_results: z.number().int().positive().max(25).optional(),
      include_text: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_run_id: z.string(),
      workflow_name: z.string(),
    }),
    async handler(input, ctx) {
      return startWorkspaceExaResearchWorkflow(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.draft.ground",
    description:
      "Use Exa to gather factual evidence for a draft before writer/judge steps use it.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "draft_grounding", include_text: true },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.rep.configure",
    description:
      "Create or update the workspace Agent persona with voice, KPIs, channels, and per-channel autonomy.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      role: RepRoleSchema.optional(),
      voice: z.string().min(1),
      story: z.string().optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
      do_not: z.array(z.string()).optional(),
      samples: z.array(z.string()).optional(),
    }),
    output: WorkspaceResultSchema.extend({ rep_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureRep(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.icp.configure",
    description:
      "Create or update an ICP segment used by signal qualification and outreach matching.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      signal_kind: SignalKindSchema,
      match_threshold: z.number().min(0).max(1).optional(),
      nice_to_haves: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({ icp_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureIcpSegment(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.signal_email.configure",
    description:
      "Create or update the signal-to-email outreach rules. Internally this compiles to the durable Play workflow with research, draft, judge, approval, contact resolution, and send steps.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      signal_kind: SignalKindSchema,
      icp_name: z.string().optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({ play_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureSignalEmailPlay(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.signal_linkedin.configure",
    description:
      "Create or update the signal-to-LinkedIn outreach rules. Internally this compiles to the durable Play workflow with research, draft, judge, approval, verified profile resolution, and native LinkedIn send steps.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      signal_kind: SignalKindSchema,
      icp_name: z.string().optional(),
      action: LinkedInActionSchema.optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({ play_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureSignalLinkedInPlay(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.skills.list",
    description:
      "List versioned outreach writing skills for email, LinkedIn, and reply drafting, including framework slots, constraints, and judge focus.",
    kind: "read",
    input: z.object({
      channel: OutreachSkillChannelSchema.optional(),
      stage: OutreachSkillStageSchema.optional(),
      signal_kind: SignalKindSchema.optional(),
      intent: z.string().optional(),
      action: OutreachSkillChannelSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({
      skills: z.array(OutreachSkillSchema),
    }),
    async handler(input, ctx) {
      const session = sessionFromContext(ctx);
      return {
        workspace_id: session.workspace_id,
        skills: listOutreachSkills(input),
      };
    },
  });

  registerTool({
    name: "product.play.skills.select",
    description:
      "Preview the outreach writing skill selected for a channel, stage, signal, or reply intent before writer/judge execution.",
    kind: "read",
    input: z.object({
      channel: OutreachSkillChannelSchema,
      stage: OutreachSkillStageSchema,
      signal_kind: SignalKindSchema.optional(),
      intent: z.string().optional(),
      action: OutreachSkillChannelSchema.optional(),
      person_title: z.string().nullable().optional(),
      base_pattern_key: z.string().min(1).optional(),
      slot_values: z.record(z.string(), z.unknown()).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      skill: SelectedOutreachSkillSchema,
    }),
    async handler(input, ctx) {
      const session = sessionFromContext(ctx);
      return {
        workspace_id: session.workspace_id,
        skill: createSelectedOutreachSkill({
          channel: input.channel,
          stage: input.stage,
          signal_kind: input.signal_kind,
          intent: input.intent,
          action: input.action,
          person_title: input.person_title,
          base_pattern_key:
            input.base_pattern_key ??
            `preview:${input.channel}|stage:${input.stage}`,
          slot_values: input.slot_values,
        }),
      };
    },
  });

  registerTool({
    name: "product.message.personalize",
    description:
      "Personalize an outbound message from Agent persona, qualified signal, prospect, graph context, vertical intelligence, and the selected outreach writing skill; emits message.personalized and returns the draft for eval gating.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      signal_id: z.string().uuid(),
      person_id: z.string().uuid(),
      company_id: z.string().uuid().nullable().optional(),
      channel: OutreachSkillChannelSchema.optional(),
      stage: OutreachSkillStageSchema.optional(),
      play_id: z.string().uuid().nullable().optional(),
      play_run_id: z.string().uuid().nullable().optional(),
      conversation_id: z.string().uuid().nullable().optional(),
      message_id: z.string().uuid().nullable().optional(),
      use_llm: z.boolean().optional(),
    }),
    output: MessagePersonalizationOutputSchema,
    async handler(input, ctx) {
      return personalizeProductMessage(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.draft.eval.gate",
    description:
      "Run the hot-path judge on a draft and emit draft.judged plus draft.rejected when the draft must not reach an outreach channel.",
    kind: "write",
    input: DraftEvalInputSchema,
    output: DraftEvalOutputSchema,
    async handler(input, ctx) {
      return evaluateProductDraft(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.reply.triage",
    description:
      "Triage an inbound email reply through the official outreach-thread matcher, Agent reply role, reply.classified event, and reply/meeting learning path.",
    kind: "write",
    input: z.object({
      channel: z.literal("email").optional(),
      external_id: z.string().min(1),
      external_thread_id: z.string().nullable().optional(),
      in_reply_to: z.string().nullable().optional(),
      references: z.array(z.string()).optional(),
      from_email: z.string().email(),
      from_name: z.string().nullable().optional(),
      subject: z.string().min(1),
      body_text: z.string().min(1),
      body_html: z.string().nullable().optional(),
      received_at: z.string().datetime(),
      channel_account_id: z.string().uuid().nullable().optional(),
      ingress_event_id: z.string().uuid().nullable().optional(),
    }),
    output: ReplyTriageOutputSchema,
    async handler(input, ctx) {
      return triageProductReply(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.email_account.configure",
    description:
      "Configure the optional workspace owned-domain email account surface and emit channel.account.configured.",
    kind: "write",
    input: z.object({
      display_name: z.string().min(1),
      daily_cap: z.number().int().nonnegative(),
    }),
    output: WorkspaceResultSchema.extend({
      channel_account_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      return configureWorkspaceEmailAccount(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.outlook_account.connect_url.get",
    description:
      "Return the workspace-scoped Outlook OAuth URL. Opening this URL connects the customer's Microsoft 365 mailbox and projects it as an oauth_outlook channel account.",
    kind: "read",
    input: z.object({}),
    output: WorkspaceResultSchema.extend({
      connect_url: z.string().min(1),
      provider_configured: z.boolean(),
    }),
    async handler(_input, ctx) {
      return getOutlookAccountConnectIntent(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.outlook_calendar.connect_url.get",
    description:
      "Return the explicit Outlook calendar-consent URL for meeting prep availability. Opening it upgrades/reuses the connected Microsoft account and does not send outreach.",
    kind: "read",
    input: z.object({}),
    output: WorkspaceResultSchema.extend({
      connect_url: z.string().min(1),
      provider_configured: z.boolean(),
      scope: z.literal("Calendars.ReadBasic"),
    }),
    async handler(_input, ctx) {
      return getOutlookCalendarConnectIntent(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.outlook_calendar.availability.get",
    description:
      "Read Outlook free/busy availability for meeting prep when calendar consent exists; returns an actionable reason when it is missing.",
    kind: "read",
    input: z.object({}),
    output: OutlookCalendarAvailabilitySchema,
    async handler(_input, ctx) {
      return getProductOutlookCalendarAvailability(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.linkedin_account.connect_url.get",
    description:
      "Return the workspace-scoped LinkedIn provider authorization URL. Opening this URL starts human OAuth/session handoff; the callback emits typed channel account events.",
    kind: "read",
    input: z.object({}),
    output: WorkspaceResultSchema.extend({
      connect_url: z.string().min(1),
      provider_configured: z.boolean(),
    }),
    async handler(_input, ctx) {
      return getLinkedInAccountConnectIntent(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.company.track",
    description:
      "Track a company in the workspace graph for catalog ingestion and signal matching.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      domain: z.string().optional(),
      industry: z.string().optional(),
      size_bucket: z.string().optional(),
      greenhouse_id: z.string().optional(),
      lever_id: z.string().optional(),
      ashby_id: z.string().optional(),
      workable_id: z.string().optional(),
      career_rss_url: z.string().optional(),
      reason: z.string().optional(),
    }),
    output: WorkspaceResultSchema.extend({ company_id: z.string().uuid() }),
    async handler(input, ctx) {
      return trackCompanyForWorkspace(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.source.configure",
    description:
      "Configure a workspace signal source adapter. Ingestion itself runs through the durable workspace poll workflow.",
    kind: "write",
    input: z.object({
      adapter: SourceAdapterSchema,
      name: z.string().min(1),
      provider: z.string().optional(),
      board_slug: z.string().optional(),
      company_name: z.string().optional(),
      company_domain: z.string().optional(),
      website_url: z.string().optional(),
      industry: z.string().optional(),
      size_bucket: z.string().optional(),
      sec_cik: z.string().optional(),
      source_tier: z.string().optional(),
      source_authority: z.number().min(0).max(1).optional(),
      source_reason: z.string().optional(),
      url: z.string().optional(),
      query: z.string().optional(),
      subreddit: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
      max_daily_items: z.number().int().positive().optional(),
      max_daily_calls: z.number().int().positive().optional(),
      monthly_spend_cap_usd: z.number().positive().optional(),
      poll_interval_minutes: z.number().int().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      rep_id: z.string(),
      play_id: z.string(),
      channel_account_id: z.string(),
      source_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return configureWorkspaceSignalSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.activation.configure",
    description:
      "Shortcut for the setup screen: compose Agent persona, buyer fit, signal-to-email outreach rules, optional email account, tracked company, and optional source. Primitive tools remain available for each step.",
    kind: "write",
    input: z.object({
      rep: z.object({
        name: z.string().min(1),
        role: RepRoleSchema.optional(),
        voice: z.string().min(1),
        story: z.string().optional(),
        daily_cap: z.number().int().nonnegative().optional(),
        approval: ApprovalSchema.optional(),
      }),
      icp: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        signal_kind: SignalKindSchema,
        match_threshold: z.number().min(0).max(1).optional(),
        nice_to_haves: z.array(z.string()).optional(),
      }),
      play: z
        .object({
          name: z.string().optional(),
          description: z.string().optional(),
          daily_cap: z.number().int().nonnegative().optional(),
          approval: ApprovalSchema.optional(),
        })
        .optional(),
      email: z
        .object({
          display_name: z.string().min(1),
          daily_cap: z.number().int().nonnegative(),
        })
        .optional(),
      company: z
        .object({
          name: z.string().min(1),
          domain: z.string().optional(),
          industry: z.string().optional(),
          size_bucket: z.string().optional(),
          greenhouse_id: z.string().optional(),
          lever_id: z.string().optional(),
          ashby_id: z.string().optional(),
          workable_id: z.string().optional(),
          career_rss_url: z.string().optional(),
          reason: z.string().optional(),
        })
        .optional(),
      source: z
        .object({
          name: z.string().min(1),
          url: z.string().min(1),
          signal_kind: SignalKindSchema,
          poll_interval_minutes: z.number().int().positive().optional(),
        })
        .optional(),
    }),
    output: WorkspaceResultSchema.extend({
      rep_id: z.string().uuid(),
      icp_id: z.string().uuid(),
      play_id: z.string().uuid(),
      channel_account_id: z.string().uuid().optional(),
      tracked_company_id: z.string().uuid().optional(),
      source_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return configureActivationSetup(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.sources.default_aggregator.configure",
    description:
      "Configure the default free Signal source mix for a profiled company: official website/ATS sources when discoverable, plus Google News, HN, and Product Hunt.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      website_url: z.string().optional(),
      industry: z.string().optional(),
      description: z.string().optional(),
      signal_keywords: z.string().optional(),
      competitor_watchlist: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({
      source_count: z.number().int().nonnegative(),
    }),
    async handler(input, ctx) {
      return configureDefaultSignalAggregator(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signal.discover_open_web",
    description:
      "Configure an Exa open-web Signal source. The durable workspace poll workflow owns fetching, budgets, dedupe, projection, and signal.discovered publication.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      source_name: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
      max_daily_items: z.number().int().positive().optional(),
      max_daily_calls: z.number().int().positive().optional(),
      monthly_spend_cap_usd: z.number().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      source_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      return configureExaOpenWebSignalSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.campaign.outcome.record",
    description:
      "Record a real reply, meeting, or learning result for an attributed outreach run, feeding it back into procedural memory.",
    kind: "write",
    input: z.object({
      play_run_id: z.string().uuid(),
      kind: CampaignOutcomeKindSchema,
      score: z.number().min(0).max(1).optional(),
      occurred_at: z.string().datetime().optional(),
      external_ref: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      play_run_id: z.string().uuid(),
      outcome_id: z.string().uuid(),
      kind: CampaignOutcomeKindSchema,
      attributed_rep_id: z.string().uuid().nullable(),
      pattern_key: z.string().min(1),
      exemplar_ids: z.array(z.string().uuid()),
    }),
    async handler(input, ctx) {
      return recordProductCampaignOutcome(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.campaign.strategy.optimize",
    description:
      "Score outreach rule variants from attributable replies, meetings, and learning results, then emit a conservative campaign.strategy.recommended event for double-down, hold, reduce, or exploration decisions.",
    kind: "write",
    input: z.object({
      lookback_days: z.number().int().positive().max(180).optional(),
      min_samples: z.number().int().positive().max(50).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      recommendation_id: z.string().uuid(),
      generated_at: z.string().datetime(),
      min_samples: z.number().int().positive(),
      summary: z.string().min(1),
      variants: z.array(CampaignStrategyVariantSchema),
    }),
    async handler(input, ctx) {
      return optimizeProductCampaignStrategy(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.skills.optimize",
    description:
      "Score outreach writing skills from reply and meeting outcomes plus procedural memory, then emit advisory play.skill.optimization.recommended recommendations without mutating outreach rules.",
    kind: "write",
    input: z.object({
      lookback_days: z.number().int().positive().max(180).optional(),
      min_samples: z.number().int().positive().max(50).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      recommendation_id: z.string().uuid(),
      generated_at: z.string().datetime(),
      min_samples: z.number().int().positive(),
      summary: z.string().min(1),
      recommendations: z.array(SkillOptimizationRecommendationSchema),
    }),
    async handler(input, ctx) {
      return optimizeProductPlaySkills(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.sources.poll.start",
    description:
      "Start due workspace source poll workflows without resuming local workflow runs or projecting events. This is the primitive used by the Signal ingestion graph.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      dispatched: z.number().int().nonnegative(),
    }),
    async handler(input, ctx) {
      const session = sessionFromContext(ctx);
      const dispatched = await dispatchWorkspaceSourcePollsOnce(
        { limit: input.limit },
        session,
      );
      return {
        workspace_id: session.workspace_id,
        dispatched,
      };
    },
  });

  registerTool({
    name: "product.signal.ingestion.run",
    description:
      "Start the stateful LangGraph Signal ingestion step. It launches due source poll workflows through product.sources.poll.start and does not match leads or send outreach.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
      idempotency_nonce: z.string().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_name: z.literal("workspace.signal.ingestion"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      const { wait, timeout_ms, ...workflowInput } = input;
      return runWorkspaceSignalIngestion(
        workflowInput,
        sessionFromContext(ctx),
        { wait, timeoutMs: timeout_ms },
      );
    },
  });

  registerTool({
    name: "product.signal.matching.run",
    description:
      "Start the stateful LangGraph Signal matching step for one ingested Signal. It scores against Profile/ICP through product.signal.match, emits classification events, and does not send outreach.",
    kind: "write",
    input: z.object({
      signal_id: z.string().uuid(),
      thread_id: z.string().optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_name: z.literal("workspace.signal.matching"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      const { wait, timeout_ms, ...workflowInput } = input;
      return runWorkspaceSignalMatching(
        workflowInput,
        sessionFromContext(ctx),
        {
          wait,
          timeoutMs: timeout_ms,
          correlationId: ctx.correlation_id,
          causationEventId: ctx.causation_id,
        },
      );
    },
  });

  registerTool({
    name: "product.sources.aggregate.run",
    description:
      "Start due workspace source poll workflows and, in local Postgres mode, resume/project the run once for immediate feedback.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
      lease_ms: z.number().int().positive().optional(),
      lease_owner: z.string().optional(),
    }),
    output: z.object({
      dispatched: z.number().int().nonnegative(),
      resumed: z.number().int().nonnegative(),
      projected: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      return runWorkspaceSignalAggregatorOnce(
        {
          limit: input.limit,
          leaseMs: input.lease_ms,
          leaseOwner: input.lease_owner,
        },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.signal.discover",
    description:
      "Push a source-backed Signal into the evented aggregator path immediately. This is the push/webhook counterpart to source polling and emits signal.discovered.",
    kind: "write",
    input: z.object({
      source_id: z.string().uuid(),
      external_id: z.string().min(1),
      title: z.string().min(1),
      content: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      signal_kind: SignalKindSchema.optional(),
      freshness_at: z.string().datetime().optional(),
      structured: z.record(z.string(), z.unknown()).optional(),
      provenance: z.record(z.string(), z.unknown()).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      outcome: z.enum([
        "created",
        "skipped:dedup",
        "skipped:must_haves",
        "skipped:budget",
      ]),
      signal_id: z.string().uuid().optional(),
      event_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return discoverSignalFromSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signal.submit",
    description:
      "Submit a manual signal into the evented ingestion path. Matching and Agent outreach dispatch remain separate capabilities.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      company_domain: z.string().optional(),
      person_name: z.string().min(1),
      person_email: z.string().email(),
      signal_title: z.string().min(1),
      signal_content: z.string().min(1),
      signal_url: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      icp_segment: z.string().optional(),
      approval: ApprovalSchema.default("none"),
      match_score: z.number().min(0).max(1).optional(),
      simulate_outcome_kind: z
        .enum(["positive_reply", "meeting_booked"])
        .nullable()
        .optional(),
    }),
    output: WorkspaceResultSchema.extend({ signal_id: z.string().uuid() }),
    async handler(input, ctx) {
      return submitManualSignal(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signal.match",
    description:
      "Classify one ingested Signal against enabled ICP segments and emit the typed classification event that projects signal.matched or signal.dismissed.",
    kind: "write",
    input: z.object({
      signal_id: z.string().uuid(),
    }),
    output: WorkspaceResultSchema.extend({
      signal_id: z.string().uuid(),
      status: z.enum(["matched", "dismissed", "skipped"]),
      kind: SignalKindSchema.nullable(),
      matched_icp_ids: z.array(z.string().uuid()),
      match_score: z.number().min(0).max(1).nullable(),
      match_reason: z.string().nullable(),
      matches: z.array(
        z.object({
          icp_segment: z.string().uuid(),
          match_score: z.number().min(0).max(1),
          reason: z.string(),
        }),
      ),
      skip_reason: z
        .enum(["no_icps", "budget", "not_found", "non_json", "filtered"])
        .nullable(),
    }),
    async handler(input, ctx) {
      return matchWorkspaceSignal(input, sessionFromContext(ctx), {
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        producerRef: "tool:product.signal.match",
      });
    },
  });

  registerTool({
    name: "product.signals.dispatch_plays",
    description:
      "Dispatch durable Agent outreach workflows for matched signals that do not already have a workflow run.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: z.object({ dispatched: z.number().int().nonnegative() }),
    async handler(input, ctx) {
      return {
        dispatched: await dispatchSignalPlaysOnce(
          { limit: input.limit },
          sessionFromContext(ctx),
        ),
      };
    },
  });

  registerTool({
    name: "product.approval.decide",
    description:
      "Approve or reject a pending workflow approval gate. Approved sends still pass through the channel/eval/deliverability state machine.",
    kind: "write",
    input: z.object({
      approval_id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await approveWorkflowApproval(
        input.approval_id,
        input.decision,
        sessionFromContext(ctx),
        input.note,
      );
      return { ok: true as const };
    },
  });

  registerTool({
    name: "product.workflow.retry",
    description:
      "Retry a failed durable workflow run without mutating domain state directly.",
    kind: "write",
    input: z.object({ run_id: z.string().uuid() }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await retryFailedWorkflowRun(input.run_id, sessionFromContext(ctx));
      return { ok: true as const };
    },
  });

  registerTool({
    name: "product.event_dispatch.dead_letters.list",
    description:
      "List dead-lettered event-bus deliveries for the active workspace so agents can inspect the same Health recovery queue users see before redriving.",
    kind: "read",
    input: z.object({
      limit: z.number().int().positive().max(500).optional(),
    }),
    output: z.object({
      dead_letters: z.array(DeadLetteredDispatchSchema),
    }),
    async handler(input, ctx) {
      return {
        dead_letters: await listDeadLetteredEventDispatches(
          sessionFromContext(ctx),
          { limit: input.limit },
        ),
      };
    },
  });

  registerTool({
    name: "product.event_dispatch.redrive",
    description:
      "Redrive one dead-lettered event-bus delivery for the active workspace by resetting its NATS dispatch row to pending.",
    kind: "write",
    input: z.object({ event_id: z.string().uuid() }),
    output: z.object({ redriven: z.boolean() }),
    async handler(input, ctx) {
      return {
        redriven: await redriveDeadLetteredEventDispatch(
          input.event_id,
          sessionFromContext(ctx),
        ),
      };
    },
  });

  registerTool({
    name: "product.sending_domain.operate",
    description:
      "Start a durable sending-domain operation: provision, verify, or refresh provider/domain trust state.",
    kind: "write",
    input: z.object({
      operation: z.enum(["provision", "verify", "refresh"]),
    }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await startSendingDomainOperation(
        input.operation,
        sessionFromContext(ctx),
      );
      return { ok: true as const };
    },
  });

  registerBombsellAliasTools();
}

export function _resetProductToolsRegistration(): void {
  registered = false;
  _resetBombsellAliasToolsRegistration();
}

function isoQualifiedSignalDraft(
  draft: QualifiedSignalOutreachDraft | null,
): z.infer<typeof QualifiedSignalDraftSchema> | null {
  if (!draft) return null;
  return {
    ...draft,
    scheduled_at: draft.scheduled_at?.toISOString() ?? null,
    sent_at: draft.sent_at?.toISOString() ?? null,
    delivered_at: draft.delivered_at?.toISOString() ?? null,
    latest_channel_event_at: draft.latest_channel_event_at?.toISOString() ?? null,
    created_at: draft.created_at.toISOString(),
  };
}
