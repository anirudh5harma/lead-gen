import { z } from "zod";

/**
 * The typed event registry. Every state change in pivot-v2 flows through
 * one of these events. `EventBus.publish()` rejects unknown event_types
 * and validates payload against the schema declared here.
 *
 * Add new events by adding a key here. Don't widen schemas without bumping
 * the bus-level `schema_version` for that event.
 *
 * Vocabulary follows ARCHITECTURE.md: lifecycle verbs in past tense, dotted
 * namespaces by domain (`signal.*`, `play.run.*`, `message.*`, `outcome.*`).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Workspace lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const WorkspaceCreated = z.object({
  workspace_id: z.string().uuid(),
  created_by: z.string().uuid(),
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  owner_role: z.enum(["owner", "admin", "member"]).optional(),
});

const WorkspaceMemberInvited = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]),
});

const WorkspaceMemberAccepted = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]),
});

const WorkspaceActivationRequested = z.object({
  website_url: z.string().url(),
  requested_by: z.string().uuid().nullable().optional(),
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
});

const WorkspaceConfigured = z.object({
  workspace_id: z.string().uuid(),
  settings: z.record(z.string(), z.unknown()),
});

const WorkspaceBillingSubscriptionSynced = z.object({
  workspace_id: z.string().uuid(),
  provider: z.literal("dodo"),
  plan: z.enum(["free", "pro"]),
  status: z.enum(["active", "canceled", "expired", "inactive"]),
  period: z.enum(["monthly", "annual"]).nullable(),
  provider_customer_id: z.string().min(1).nullable().optional(),
  provider_subscription_id: z.string().min(1).nullable().optional(),
  provider_product_id: z.string().min(1).nullable().optional(),
  current_period_start_at: z.string().datetime().nullable().optional(),
  renews_at: z.string().datetime().nullable().optional(),
  canceled_at: z.string().datetime().nullable().optional(),
  webhook_event_type: z.string().min(1),
  raw_status: z.string().min(1).nullable().optional(),
});

const WorkspaceTrialGranted = z.object({
  workspace_id: z.string().uuid(),
  credits_granted: z.number().int().positive(),
  credits_remaining: z.number().int().nonnegative(),
  credits_total: z.number().int().positive(),
});

const WorkspaceTrialLow = z.object({
  workspace_id: z.string().uuid(),
  credits_remaining: z.number().int().nonnegative(),
  credits_total: z.number().int().positive(),
});

const WorkspaceTrialExhausted = z.object({
  workspace_id: z.string().uuid(),
  credits_remaining: z.number().int().min(0).max(0),
  credits_total: z.number().int().positive(),
  credits_exhausted_at: z.string().datetime(),
});

const WorkspaceOutreachFrozen = z.object({
  workspace_id: z.string().uuid(),
  reason: z.enum(["trial_exhausted", "subscription_inactive"]),
  credits_remaining: z.number().int().nonnegative(),
  subscription_status: z.string().min(1),
  frozen_at: z.string().datetime(),
});

const WorkspaceOutreachResumed = z.object({
  workspace_id: z.string().uuid(),
  reason: z.enum(["subscription_activated", "subscription_recovered"]),
  resumed_at: z.string().datetime(),
  resumed_message_count: z.number().int().nonnegative(),
  subscription_status: z.string().min(1),
  renews_at: z.string().datetime().nullable().optional(),
});

const RepConfigured = z.object({
  rep_id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum([
    "sdr",
    "content",
    "replier",
    "researcher",
    "campaign",
    "custom",
  ]),
  status: z.enum(["draft", "active", "paused", "retired"]),
  persona: z.record(z.string(), z.unknown()),
  channels: z.array(z.string()),
  autonomy: z.record(z.string(), z.unknown()),
});

const RepRoleCompleted = z.object({
  rep_id: z.string().uuid(),
  role: z.enum([
    "researcher",
    "writer",
    "sender",
    "replier",
    "planner",
    "judge",
  ]),
  action: z.string().min(1),
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  workflow_run_id: z.string().uuid().nullable().optional(),
  summary: z.string().nullable().optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  completed_at: z.string().datetime().optional(),
});

const WorkspaceIcpConfigured = z.object({
  icp_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  must_haves: z.array(z.record(z.string(), z.unknown())),
  nice_to_haves: z.array(z.string()),
  match_threshold: z.number().min(0).max(1),
  enabled: z.boolean(),
});

const WorkspaceCompanyTracked = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  domain: z.string().nullable(),
  reason: z.string().nullable(),
});

const WorkspaceCompanyProfiled = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  domain: z.string().nullable(),
  website_url: z.string().url(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  profile_source: z.enum(["manual", "firecrawl", "fallback"]).optional(),
});

const WorkspaceProfileDrafted = z.object({
  company_name: z.string().min(1),
  website_url: z.string().url(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  profile_source: z.enum(["firecrawl", "fallback", "manual"]).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
      source_ref: z.string().min(1).nullable().optional(),
    }),
  ),
  needs_review: z.array(z.string()),
});

const IcpDrafted = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  signal_kind: z.enum([
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
  ]),
  match_threshold: z.number().min(0).max(1),
  nice_to_haves: z.array(z.string()),
  inferred_from: z.object({
    website_url: z.string().url(),
    company_name: z.string().min(1),
  }),
  needs_review: z.array(z.string()),
});

const WorkspaceProfileEnriched = z.object({
  company_id: z.string().uuid(),
  company_name: z.string().min(1),
  website_url: z.string().url().nullable(),
  evidence_source_ids: z.array(z.string().uuid()),
  summary: z.string(),
  intelligence: z
    .object({
      source_domains: z.array(z.string()),
      market_terms: z.array(z.string()),
      positioning_notes: z.array(z.string()).optional(),
      competitor_mentions: z.array(z.string()).optional(),
      audience_terms: z.array(z.string()).optional(),
      proof_points: z.array(z.string()).optional(),
      evidence_cards: z.array(
        z.object({
          title: z.string(),
          url: z.string().url(),
          source_domain: z.string().nullable(),
          snippet: z.string().nullable(),
          published_at: z.string().nullable(),
        }),
      ),
    })
    .optional(),
  query_count: z.number().int().nonnegative(),
  result_count: z.number().int().nonnegative(),
  request_ids: z.array(z.string()),
});

const VerticalIntelligencePrimitiveRefs = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  icp_id: z.string().uuid().nullable().optional(),
});

const VerticalIntelligenceSourceRef = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url().nullable().optional(),
});

const VerticalIntelligenceFact = z.object({
  id: z.string().min(1),
  category: z.enum([
    "icp_rule",
    "pain",
    "objection",
    "proof",
    "competitor",
    "trigger",
    "positioning",
    "signal_mapping",
    "skill_performance",
  ]),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().min(1)),
  source_refs: z.array(VerticalIntelligenceSourceRef),
  primitive_refs: VerticalIntelligencePrimitiveRefs,
  last_observed_at: z.string().datetime(),
  included_in_prompt: z.boolean(),
});

const VerticalIntelligenceUpdated = z.object({
  company_id: z.string().uuid(),
  company_name: z.string().min(1),
  vertical: z.string().min(1),
  generated_at: z.string().datetime(),
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  facts: z.array(VerticalIntelligenceFact),
  prompt_context: z.string(),
  evidence_source_ids: z.array(z.string().uuid()),
  redaction_status: z.enum(["source_refs_only"]),
});

const WorkspaceSourceConfigured = z.object({
  source_id: z.string().uuid(),
  source_kind: z.enum([
    "gdelt",
    "hn",
    "product_hunt",
    "rss",
    "job_board",
    "web_monitor",
    "podcast",
    "newsletter",
    "manual",
    "other",
  ]),
  adapter: z.enum([
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
  ]),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  poll_cadence_sec: z.number().int().positive(),
  properties: z.record(z.string(), z.unknown()),
});

const ContactCandidate = z.object({
  rank: z.number().int().positive(),
  person_id: z.string().uuid(),
  full_name: z.string().min(1),
  title: z.string().nullable(),
  score: z.number().min(0).max(1.2),
  reasons: z.array(z.string()),
  emails: z.array(z.string()),
  linkedin_url: z.string().nullable(),
  verification: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
});

const ContactResolved = z.object({
  contact_resolution_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  company_id: z.string().uuid(),
  play_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.enum(["email", "linkedin"]),
  selected_person_id: z.string().uuid(),
  candidates: z.array(ContactCandidate).min(1).max(3),
  provider_order: z.array(z.string()),
});

const ContactResolutionDeferred = z.object({
  contact_resolution_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  company_id: z.string().uuid(),
  play_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.enum(["email", "linkedin"]),
  defer_reason: z.string().min(1),
  provider_name: z.string().min(1).nullable().optional(),
  provider_error: z.string().min(1).nullable().optional(),
  candidate_count: z.number().int().nonnegative(),
  provider_order: z.array(z.string()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Signal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const SignalDiscovered = z.object({
  signal_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  kind: z
    .enum([
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
    ])
    .nullable(),
  title: z.string().min(1),
  content: z.string().nullable(),
  url: z.string().nullable(),
  freshness_at: z.string().datetime(),
  related_company_id: z.string().uuid().nullable(),
  related_person_id: z.string().uuid().nullable(),
  origin_candidate_id: z.string().uuid().nullable(),
  properties: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
  embedding: z.array(z.number()).nullable(),
});

const SignalIngested = z.object({
  signal_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  /** Adapter-declared kind, or null when stage 2 still needs to classify. */
  kind: z.string().nullable(),
  novelty_score: z.number().min(0).max(1).nullable(),
});

const SignalMatched = z.object({
  signal_id: z.string().uuid(),
  match_score: z.number().min(0).max(1),
  icp_segment: z.string().optional(),
});

const SignalMatchingDeferred = z.object({
  workspace_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  defer_reason: z.enum([
    "no_icps",
    "budget",
    "not_found",
    "non_json",
    "filtered",
    "empty_candidates",
    "below_eval_threshold",
    "inconsistent_match_result",
  ]),
});

const SignalCompanyLinked = z.object({
  signal_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  adapter: z.string().min(1),
  company: z.object({
    name: z.string().min(1),
    domain: z.string().nullable(),
    description: z.string().nullable(),
  }),
  hint_source: z.string().min(1),
  confidence: z.enum(["explicit", "derived"]),
});

const SignalDismissed = z.object({
  signal_id: z.string().uuid(),
  reason: z.string(),
});

const SignalDismissalRequested = z.object({
  signal_id: z.string().uuid(),
  reason: z.string(),
});

const PersonFitFeedbackRecorded = z.object({
  person_id: z.string().uuid(),
  decision: z.enum(["fit", "unsure", "not_fit"]),
  note: z.string().nullable().optional(),
  recorded_by: z.string().uuid().nullable().optional(),
  recorded_at: z.string().datetime().optional(),
});

const SignalOutreachGated = z.object({
  signal_id: z.string().uuid(),
  play_id: z.string().uuid(),
  person_id: z.string().uuid(),
  channel: z.string().min(1),
  gate: z.enum(["contact_fit"]),
  decision: z.enum(["not_fit"]),
  reason: z.string().min(1),
  gated_at: z.string().datetime(),
});

const SignalClassificationCompleted = z.object({
  signal_id: z.string().uuid(),
  kind: z
    .enum([
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
    ])
    .nullable(),
  disposition: z.enum(["matched", "dismissed"]),
  match_score: z.number().min(0).max(1).nullable(),
  match_reason: z.string(),
  audience_hint: z.record(z.string(), z.unknown()),
  matches: z.array(
    z.object({
      icp_segment: z.string().uuid(),
      match_score: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

/**
 * A catalog candidate flipped from active to expired (the upstream stopped
 * surfacing its external_id — job filled, press release pulled). Downstream
 * Plays use this to stop referencing stale opportunities; workspace-scoped
 * signals that originated from the candidate are marked 'spent'.
 */
const SignalExpired = z.object({
  signal_id: z.string().uuid(),
  reason: z.string(),
});

/**
 * Internal "this signal needs to expire" event. Producers (TTL sweep,
 * upstream-dropped sweep) emit this with an idempotency_key per signal;
 * the signal expiry projector consumes it, flips the signals row to
 * 'spent', and emits the public `signal.expired`. Keeping the state
 * transition behind the projector preserves event-owned-state and makes
 * the expiry decision replayable from the event log.
 */
const SignalExpiryRequested = z.object({
  signal_id: z.string().uuid(),
  reason: z.string(),
});

const AccountIntentUpdated = z.object({
  company_id: z.string().uuid(),
  normalized_domain: z.string().nullable(),
  composite_score: z.number().nonnegative(),
  live_signal_count: z.number().int().nonnegative(),
  strongest_signal_score: z.number().nonnegative(),
  latest_signal_freshness_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
});

const SignalFeedbackUpdated = z.object({
  source: z.string().min(1),
  signal_kind: z.enum([
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
  ]),
  positive_outcomes: z.number().int().nonnegative(),
  signals_surfaced: z.number().int().nonnegative(),
  learned_modifier: z.number().min(0.5).max(1.5),
  updated_at: z.string().datetime(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Play / workflow lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const PlayRunStarted = z.object({
  play_id: z.string().uuid(),
  play_run_id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  trigger_event_id: z.string().uuid().nullable(),
});

const PlayConfigured = z.object({
  play_id: z.string().uuid(),
  name: z.string().min(1),
  declaration: z.string().min(1),
  compiled: z.record(z.string(), z.unknown()),
  autonomy: z.record(z.string(), z.unknown()),
  default_rep_id: z.string().uuid().nullable(),
  status: z.enum(["draft", "active", "paused", "archived"]),
  version: z.number().int().positive(),
});

const PlayRunCompleted = z.object({
  play_id: z.string().uuid(),
  play_run_id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  output: z.record(z.string(), z.unknown()).optional(),
});

const PlayRunFailed = z.object({
  play_id: z.string().uuid(),
  play_run_id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  error: z.string(),
});

const WorkflowStepStarted = z.object({
  run_id: z.string().uuid(),
  step_id: z.string().uuid(),
  step_name: z.string(),
  attempt: z.number().int().positive(),
});

const WorkflowStepCompleted = z.object({
  run_id: z.string().uuid(),
  step_id: z.string().uuid(),
  step_name: z.string(),
  attempt: z.number().int().positive(),
});

const WorkflowStepFailed = z.object({
  run_id: z.string().uuid(),
  step_id: z.string().uuid(),
  step_name: z.string(),
  attempt: z.number().int().positive(),
  error: z.string(),
});

const WorkflowRunFailed = z.object({
  run_id: z.string().uuid(),
  workflow_name: z.string(),
  error: z.string(),
});

const WorkflowRunRetried = z.object({
  run_id: z.string().uuid(),
  workflow_name: z.string(),
  retry_run_id: z.string().uuid(),
});

const EventDispatchRedriven = z.object({
  event_id: z.string().uuid(),
  redriven_by: z.string().uuid(),
  status: z.literal("pending"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Draft / send pipeline — the hot-path eval lives here.
// `draft.judged` ALWAYS fires before `message.queued` or `message.sent`.
// Sub-threshold drafts emit `draft.rejected` instead.
// ─────────────────────────────────────────────────────────────────────────────

const DraftProposed = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel: z.string(),
  rep_id: z.string().uuid(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  proposed_at: z.string().datetime().optional(),
});

const MessagePersonalized = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid(),
  channel: z.string(),
  rep_id: z.string().uuid(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  personalization_context_markdown: z.string().nullable().optional(),
  skill: z.record(z.string(), z.unknown()).nullable().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  personalized_at: z.string().datetime().optional(),
});

const DraftJudged = z.object({
  message_id: z.string().uuid(),
  eval_score: z.number().min(0).max(1),
  passed: z.boolean(),
  notes: z.record(z.string(), z.unknown()).optional(),
});

const DraftRejected = z.object({
  message_id: z.string().uuid(),
  reason: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversation lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const ConversationOpened = z.object({
  conversation_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  counterparty_person_id: z.string().uuid(),
  counterparty_company_id: z.string().uuid().nullable().optional(),
  origin_signal_id: z.string().uuid().nullable(),
  topic: z.string().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  opened_at: z.string().datetime().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel I/O
// ─────────────────────────────────────────────────────────────────────────────

const EmailBounceReceived = z.object({
  external_id: z.string().min(1),
  recipient: z.string().email(),
  bounce_type: z.enum(["hard", "soft", "complaint"]),
  detail: z.string().optional(),
});

const EmailInboundReceived = z.object({
  external_id: z.string().min(1),
  external_thread_id: z.string().optional(),
  in_reply_to: z.string().optional(),
  references: z.array(z.string()).optional(),
  from: z.object({
    email: z.string().email(),
    name: z.string().optional(),
  }),
  subject: z.string(),
  body_text: z.string(),
  body_html: z.string().optional(),
  received_at: z.string().datetime(),
  channel_account_id: z.string().uuid().optional(),
});

const OutlookNotificationReceived = z.object({
  channel_account_id: z.string().uuid(),
  subscription_id: z.string().min(1),
  resource_id: z.string().min(1),
});

const OutlookAuthorizationReceived = z.object({
  channel_account_id: z.string().uuid(),
  display_name: z.string().min(1),
  daily_cap: z.number().int().min(0),
  encrypted_credentials: z.object({
    encrypted: z.literal(true),
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
  ms_user_id: z.string().min(1),
  mailbox_email: z.string().min(1).nullable().optional(),
});

const OutlookCredentialsRefreshed = z.object({
  channel_account_id: z.string().uuid(),
  encrypted_credentials: z.object({
    encrypted: z.literal(true),
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
  expires_at: z.string().datetime(),
});

const OutlookReauthorizationRequired = z.object({
  channel_account_id: z.string().uuid(),
  error: z.string().min(1),
});

const EmailDomainWarmupUpdated = z.object({
  sending_domain_id: z.string().uuid(),
  domain: z.string().min(1),
  previous_state: z.string(),
  current_state: z.string(),
  previous_daily_cap: z.number().int().min(0),
  current_daily_cap: z.number().int().min(0),
});

const OutlookSubscriptionUpdated = z.object({
  channel_account_id: z.string().uuid(),
  subscription_id: z.string().min(1),
  operation: z.enum(["created", "renewed"]),
  expires_at: z.string().datetime(),
});

const MessageQueued = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  scheduled_at: z.string().datetime().nullable(),
  channel_account_id: z.string().uuid().nullable().optional(),
  reserved_at: z.string().datetime().nullable().optional(),
});

const MessageSent = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  external_id: z.string().nullable(),
  channel_account_id: z.string().uuid().nullable().optional(),
});

const MessageDeferred = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  defer_reason: z.string(),
  retry_after: z.string().datetime().nullable(),
  detail: z.string().nullable().optional(),
  channel_account_id: z.string().uuid().nullable().optional(),
});

const MessageDelivered = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  external_id: z.string().nullable().optional(),
  provider_event_id: z.string().nullable().optional(),
});

const MessageBounced = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  bounce_type: z.enum(["hard", "soft", "complaint"]),
  external_id: z.string().nullable().optional(),
  provider_event_id: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  recipient: z.string().email().nullable().optional(),
  detail: z.string().nullable().optional(),
});

const ReplyReceived = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel: z.string(),
  matched_outbound_message_id: z.string().uuid().nullable().optional(),
  external_id: z.string().min(1).optional(),
  external_thread_id: z.string().nullable().optional(),
  in_reply_to: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  from: z
    .object({
      email: z.string().email(),
      name: z.string().nullable().optional(),
    })
    .optional(),
  subject: z.string().optional(),
  body_text: z.string().optional(),
  body_html: z.string().nullable().optional(),
  received_at: z.string().datetime().optional(),
  channel_account_id: z.string().uuid().nullable().optional(),
});

const ReplyUnmatched = z.object({
  channel: z.string(),
  external_id: z.string().min(1),
  from_email: z.string().email(),
  subject: z.string(),
  received_at: z.string().datetime(),
});

const ReplyClassified = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().nullable().optional(),
  received_at: z.string().datetime().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval gates
// ─────────────────────────────────────────────────────────────────────────────

const ApprovalRequested = z.object({
  approval_id: z.string().uuid(),
  run_id: z.string().uuid(),
  step_id: z.string().uuid().nullable(),
  kind: z.string(),
});

const ApprovalDecided = z.object({
  approval_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "expired"]),
  decided_by: z.string().uuid().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes — the only thing that gates learning & billing.
// ─────────────────────────────────────────────────────────────────────────────

const OutcomeRecorded = z.object({
  outcome_id: z.string().uuid(),
  kind: z.string(),
  score: z.number(),
  conversation_id: z.string().uuid().nullable(),
  attributed_play_id: z.string().uuid().nullable(),
  attributed_play_run_id: z.string().uuid().nullable().optional(),
  attributed_message_id: z.string().uuid().nullable().optional(),
  attributed_signal_id: z.string().uuid().nullable().optional(),
  attributed_rep_id: z.string().uuid().nullable().optional(),
  subject_person_id: z.string().uuid().nullable().optional(),
  subject_company_id: z.string().uuid().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  occurred_at: z.string().datetime().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel accounts
// ─────────────────────────────────────────────────────────────────────────────

const ChannelAccountConnected = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.string(),
  account_display_name: z.string().min(1).optional(),
  provider_account_id: z.string().min(1).optional(),
  provider_event_id: z.string().min(1).optional(),
});

const ChannelAccountConfigured = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.literal("email_domain"),
  display_name: z.string().min(1),
  daily_cap: z.number().int().nonnegative(),
  transport: z.enum(["resend", "dry-run", "unconfigured"]),
});

const CrmDestinationConfigured = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.literal("crm"),
  provider: z.string().min(1),
  display_name: z.string().min(1),
  webhook_url: z.string().url().nullable(),
  sync_mode: z.enum([
    "qualified_contacts",
    "qualified_and_sent",
    "full_loop",
  ]),
  include_sent_outreach: z.boolean(),
  include_replies_meetings: z.boolean(),
});

const CrmHandoffQueued = z.object({
  handoff_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  provider: z.string().min(1),
  sync_mode: z.enum([
    "qualified_contacts",
    "qualified_and_sent",
    "full_loop",
  ]),
  contact_count: z.number().int().nonnegative(),
  signal_count: z.number().int().nonnegative(),
  include_sent_outreach: z.boolean(),
  include_replies_meetings: z.boolean(),
  records: z.array(
    z.object({
      signal_id: z.string().uuid(),
      signal_kind: z.string().min(1),
      signal_title: z.string().min(1),
      match_score: z.number().nullable(),
      match_reason: z.string().nullable(),
      company: z.object({
        company_id: z.string().uuid().nullable(),
        name: z.string().nullable(),
        domain: z.string().nullable(),
        industry: z.string().nullable(),
      }),
      contact: z.object({
        person_id: z.string().uuid(),
        full_name: z.string().min(1),
        title: z.string().nullable(),
        email: z.string().min(1).nullable(),
        email_verified: z.boolean(),
        email_status: z.string().nullable(),
        linkedin_url: z.string().url().nullable(),
        linkedin_ready: z.boolean(),
        contact_fit_decision: z
          .enum(["fit", "unsure", "not_fit"])
          .nullable(),
      }),
      outreach: z
        .object({
          conversation_id: z.string().uuid(),
          message_id: z.string().uuid(),
          channel: z.string().min(1),
          status: z.string().min(1),
          eval_score: z.number().nullable(),
          eval_passed: z.boolean().nullable(),
          sent_at: z.string().datetime().nullable(),
        })
        .nullable(),
      outcomes: z.array(
        z.object({
          outcome_id: z.string().uuid(),
          kind: z.string().min(1),
          score: z.number(),
          occurred_at: z.string().datetime(),
        }),
      ),
    }),
  ),
});

const CrmHandoffWebhookDelivered = z.object({
  handoff_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  provider: z.string().min(1),
  endpoint_host: z.string().min(1).nullable(),
  status_code: z.number().int().min(200).max(299),
  delivered_at: z.string().datetime(),
  contact_count: z.number().int().nonnegative(),
  signal_count: z.number().int().nonnegative(),
});

const CrmHandoffWebhookFailed = z.object({
  handoff_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  provider: z.string().min(1),
  endpoint_host: z.string().min(1).nullable(),
  status_code: z.number().int().min(100).max(599).nullable(),
  error: z.string().min(1),
  retryable: z.boolean(),
  failed_at: z.string().datetime(),
});

const ChannelAccountErrored = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.string(),
  error: z.string(),
  status: z
    .enum([
      "connected",
      "needs_reauth",
      "rate_limited",
      "suspended",
      "disconnected",
    ])
    .nullable()
    .optional(),
  account_display_name: z.string().min(1).optional(),
  provider_account_id: z.string().min(1).optional(),
  provider_event_id: z.string().min(1).optional(),
  provider_incident_id: z.string().min(1).optional(),
  retry_after: z.string().min(1).optional(),
});

const LinkedInAccountAuthorizationReceived = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.enum(["linkedin_session", "linkedin_oauth"]),
  display_name: z.string().min(1),
  provider_account_id: z.string().min(1),
  profile_url: z.string().url().nullable().optional(),
  daily_cap: z.number().int().nonnegative().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const LinkedInConnectionAccepted = z.object({
  channel_account_id: z.string().uuid(),
  provider_account_id: z.string().min(1).optional(),
  provider_event_id: z.string().min(1).optional(),
  external_id: z.string().min(1).optional(),
  person_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid().nullable().optional(),
  profile_url: z.string().url().nullable().optional(),
  accepted_at: z.string().datetime().optional(),
});

const ChannelDomainRecord = z.object({
  record: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.string(),
  status: z.string().nullable().optional(),
  priority: z.number().int().nullable().optional(),
  ttl: z.string().nullable().optional(),
});

const ChannelDomainSnapshot = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  provider: z.string(),
  provider_domain_id: z.string(),
  provider_status: z.string(),
  records: z.array(ChannelDomainRecord),
  region: z.string().nullable().optional(),
});

const ChannelDomainVerificationRequested = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  provider: z.string(),
  provider_domain_id: z.string(),
});

const ChannelDomainDmarcObserved = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  dns_name: z.string(),
  verified: z.boolean(),
  policy: z.enum(["none", "quarantine", "reject"]).nullable(),
  record: z.string().nullable(),
});

const ChannelDomainTrustVerified = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
});

const ChannelDomainWarmupAdvanced = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  warmup_day: z.number().int().positive(),
  current_daily_cap: z.number().int().nonnegative(),
  target_daily_cap: z.number().int().nonnegative(),
  completed: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// LLM cost / rate-limit governance
// ─────────────────────────────────────────────────────────────────────────────

const LLMUsageRecorded = z.object({
  purpose: z.string(),
  model: z.string(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative().nullable(),
});

const LLMCallDeferred = z.object({
  purpose: z.string(),
  reason: z.string(),
  token_cap: z.number().int().nonnegative(),
  used_tokens: z.number().int().nonnegative(),
  requested_tokens: z.number().int().nonnegative(),
  retry_after: z.string().datetime().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Production agent observability
// ─────────────────────────────────────────────────────────────────────────────

const AgentTraceSpanKind = z.enum([
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
]);

const AgentTracePrimitiveRefs = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
});

const AgentTraceRedaction = z.object({
  pii: z.enum(["none", "redacted", "contains_pii"]),
  raw_payload_exported: z.boolean(),
  external_export_allowed: z.boolean(),
});

const AgentTraceSpanRecorded = z.object({
  span_id: z.string().min(1),
  trace_id: z.string().min(1),
  parent_span_id: z.string().min(1).nullable().optional(),
  kind: AgentTraceSpanKind,
  name: z.string().min(1),
  status: z.enum(["ok", "error", "deferred", "blocked"]),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().optional(),
  duration_ms: z.number().nonnegative().nullable().optional(),
  graph_name: z.string().min(1).nullable().optional(),
  node_name: z.string().min(1).nullable().optional(),
  run_id: z.string().min(1).nullable().optional(),
  thread_id: z.string().min(1).nullable().optional(),
  correlation_id: z.string().min(1).nullable().optional(),
  causation_event_id: z.string().min(1).nullable().optional(),
  primitive_refs: AgentTracePrimitiveRefs.optional(),
  model: z.string().min(1).nullable().optional(),
  prompt_tokens: z.number().int().nonnegative().nullable().optional(),
  completion_tokens: z.number().int().nonnegative().nullable().optional(),
  estimated_cost_usd: z.number().nonnegative().nullable().optional(),
  retry_count: z.number().int().nonnegative().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()),
  redaction: AgentTraceRedaction,
  error: z
    .object({
      message: z.string().min(1),
      name: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const AgentTraceExported = z.object({
  export_id: z.string().min(1),
  destination: z.string().min(1),
  trace_id: z.string().min(1).nullable(),
  span_count: z.number().int().nonnegative(),
  redaction: AgentTraceRedaction,
  exported_at: z.string().datetime(),
});

const AgentTraceEvalFailed = z.object({
  eval_case_id: z.string().min(1),
  trace_id: z.string().min(1),
  span_id: z.string().min(1).nullable().optional(),
  failure_kind: z.string().min(1),
  reason: z.string().min(1),
  source_event_id: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared company brain (derived workspace memory over the five primitives)
// ─────────────────────────────────────────────────────────────────────────────

const CompanyBrainBriefType = z.enum([
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

const CompanyBrainConnector = z.object({
  memory_store: z.object({
    enabled: z.boolean(),
    status: z.enum(["disabled", "configured"]),
    detail: z.string().min(1),
  }),
});

const CompanyBrainPrimitiveRefs = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
});

const CompanyBrainCardRef = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "profile",
    "signal",
    "outcome",
    "playbook",
    "semantic_fact",
    "meeting_prep",
  ]),
  title: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  freshness_at: z.string().datetime().nullable(),
  tags: z.array(z.string().min(1)),
  primitive_refs: CompanyBrainPrimitiveRefs,
  source_ref_count: z.number().int().nonnegative(),
});

const CompanyMemoryRecalled = z.object({
  recalled_at: z.string().datetime(),
  task: z.string().min(1),
  brief_type: CompanyBrainBriefType,
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
  card_count: z.number().int().nonnegative(),
  source_ref_count: z.number().int().nonnegative(),
  connector: CompanyBrainConnector,
  primitive_refs: CompanyBrainPrimitiveRefs,
  card_refs: z.array(CompanyBrainCardRef),
  redaction_status: z.enum(["source_refs_only"]),
});

const CompanyBriefUpdated = z.object({
  brief_id: z.string().min(1),
  brief_type: CompanyBrainBriefType,
  updated_at: z.string().datetime(),
  task: z.string().min(1),
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
  markdown: z.string().min(1),
  card_count: z.number().int().nonnegative(),
  source_ref_count: z.number().int().nonnegative(),
  connector: CompanyBrainConnector,
  primitive_refs: CompanyBrainPrimitiveRefs,
  card_refs: z.array(CompanyBrainCardRef),
  redaction_status: z.enum(["source_refs_only"]),
});

// ─────────────────────────────────────────────────────────────────────────────
// Campaign optimization
// ─────────────────────────────────────────────────────────────────────────────

const CampaignStrategyRecommended = z.object({
  recommendation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  min_samples: z.number().int().positive(),
  summary: z.string().min(1),
  variants: z.array(
    z.object({
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
      recommendation: z.enum([
        "double_down",
        "hold",
        "reduce",
        "not_enough_proof",
      ]),
      explanation: z.string().min(1),
    }),
  ),
});

const PlaySkillOptimizationRecommended = z.object({
  recommendation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  min_samples: z.number().int().positive(),
  summary: z.string().min(1),
  recommendations: z.array(
    z.object({
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
      recommendation: z.enum([
        "double_down",
        "hold",
        "reduce",
        "not_enough_proof",
      ]),
      next_action: z.enum([
        "apply_play_gate",
        "review_reduce",
        "keep_learning",
        "no_change",
      ]),
      explanation: z.string().min(1),
      source_variant_keys: z.array(z.string().min(1)),
    }),
  ),
});

const CampaignDispatchSkipped = z.object({
  signal_id: z.string().uuid(),
  play_id: z.string().uuid(),
  play_name: z.string().min(1).nullable().optional(),
  channel: z.string().nullable(),
  skill_key: z.string().min(1),
  skill_version: z.string().min(1).nullable().optional(),
  segment_key: z.string().min(1),
  variant_key: z.string().min(1),
  matched_variant_key: z.string().min(1).nullable().optional(),
  recommendation_id: z.string().uuid().nullable().optional(),
  strategy_generated_at: z.string().datetime().nullable().optional(),
  recommendation: z.enum([
    "double_down",
    "hold",
    "reduce",
    "not_enough_proof",
    "unscored",
  ]),
  allocation_weight: z.number().min(0).max(1),
  reason: z.string().min(1),
  skipped_at: z.string().datetime(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Meeting prep
// ─────────────────────────────────────────────────────────────────────────────

const MeetingPrepProfileContext = z.object({
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

const MeetingPrepSourceRef = z.object({
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

const MeetingPrepThreadTurn = z.object({
  message_id: z.string().min(1),
  direction: z.string().min(1),
  at: z.string().datetime().nullable(),
  intent_class: z.string().nullable(),
  excerpt: z.string().min(1),
});

const MeetingPrepGenerated = z.object({
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
  thread_turns: z.array(MeetingPrepThreadTurn),
  agenda: z.array(z.string().min(1)),
  suggested_questions: z.array(z.string().min(1)),
  suggested_times: z.array(z.string().min(1)),
  availability_status: z.enum(["included", "omitted_no_consent"]),
  availability_reason: z.string().min(1),
  calendar_provider: z.string().nullable(),
  calendar_account_id: z.string().uuid().nullable(),
  calendar_account_display_name: z.string().nullable(),
  profile_context: MeetingPrepProfileContext,
  source_refs: z.array(MeetingPrepSourceRef),
});

const WorkspaceLaunchReadinessChecked = z.object({
  checked_at: z.string().datetime(),
  required_channel: z.enum(["any", "email", "linkedin", "both"]),
  status: z.enum(["ready", "needs_attention", "blocked"]),
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
  checks: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      primitive: z.enum(["Rep", "Signal", "Play", "Conversation"]),
      status: z.enum(["ready", "needs_attention", "blocked"]),
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
    }),
  ),
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});

// ─────────────────────────────────────────────────────────────────────────────
// Public-web intelligence (Exa)
// ─────────────────────────────────────────────────────────────────────────────

const ExaQueryPlan = z.object({
  source: z.literal("procedural_memory"),
  pattern_key: z.string().min(1),
  exemplar_ids: z.array(z.string().uuid()),
  kept_examples: z.array(z.string()),
  skipped_examples: z.array(z.string()),
});

const ExaQueryRequested = z.object({
  query: z.string().min(1),
  original_query: z.string().min(1).optional(),
  query_plan: ExaQueryPlan.optional(),
  intent: z.string().min(1),
  source_id: z.string().uuid().nullable().optional(),
});

const ExaQueryCompleted = z.object({
  query: z.string().min(1),
  original_query: z.string().min(1).optional(),
  query_plan: ExaQueryPlan.optional(),
  intent: z.string().min(1),
  request_id: z.string().nullable(),
  result_count: z.number().int().nonnegative(),
  cache_hit: z.boolean().optional(),
  cache_hit_count: z.number().int().nonnegative().optional(),
  query_hashes: z.array(z.string()).optional(),
  usage_ids: z.array(z.string().uuid()).optional(),
});

const ExaContentsFetched = z.object({
  request_id: z.string().nullable(),
  ids: z.array(z.string()),
  urls: z.array(z.string()),
  result_count: z.number().int().nonnegative(),
  cache_hit: z.boolean().optional(),
});

const ExaEvidenceProjected = z.object({
  query: z.string().min(1),
  original_query: z.string().min(1).optional(),
  query_plan: ExaQueryPlan.optional(),
  intent: z.string().min(1),
  evidence_source_ids: z.array(z.string().uuid()),
  result_count: z.number().int().nonnegative(),
});

const RepResearchCompleted = z.object({
  query: z.string().min(1),
  original_query: z.string().min(1).optional(),
  query_plan: ExaQueryPlan.optional(),
  request_id: z.string().nullable(),
  evidence_source_ids: z.array(z.string().uuid()),
  summary: z.string(),
  result_count: z.number().int().nonnegative(),
  cache_hit: z.boolean().optional(),
  exa_usage_id: z.string().uuid().nullable().optional(),
});

const BriefItem = z.object({
  title: z.string().min(1),
  detail: z.string(),
  url: z.string().url().nullable().optional(),
  evidence_source_ids: z.array(z.string().uuid()).optional(),
});

const AeoAuditCompleted = RepResearchCompleted.extend({
  gaps: z.array(BriefItem).optional(),
  review_items: z.array(BriefItem).optional(),
});

const ContentOpportunityDiscovered = RepResearchCompleted.extend({
  opportunities: z.array(BriefItem).optional(),
  review_items: z.array(BriefItem).optional(),
});

const RepBriefRefreshed = RepResearchCompleted.extend({
  notes: z.array(BriefItem),
  review_items: z.array(BriefItem),
  recent_changes: z.array(BriefItem),
  quiet_exceptions: z.array(BriefItem),
});

const RecommendationReviewed = z.object({
  review_id: z.string().min(1),
  review_kind: z.enum(["content_opportunity", "aeo_gap"]),
  source_event_id: z.string().uuid(),
  decision: z.enum(["accepted", "ignored"]),
  note: z.string().nullable().optional(),
  item: BriefItem,
});

const RecommendationUpdated = z.object({
  review_id: z.string().min(1),
  review_kind: z.enum(["content_opportunity", "aeo_gap"]),
  source_event_id: z.string().uuid(),
  note: z.string().nullable().optional(),
  item: BriefItem,
});

const RecommendationDeleted = z.object({
  review_id: z.string().min(1),
  review_kind: z.enum(["content_opportunity", "aeo_gap"]),
  source_event_id: z.string().uuid(),
  reason: z.string().nullable().optional(),
  item: BriefItem,
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory updates (procedural memory grows from outcomes)
// ─────────────────────────────────────────────────────────────────────────────

const RepMemoryProceduralUpdated = z.object({
  outcome_event_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  pattern_key: z.string(),
  exemplar_ids: z.array(z.string().uuid()).min(1),
  delta_score: z.number(),
  win: z.boolean(),
});

const RepMemoryProceduralSeeded = z.object({
  outcome_event_id: z.string().uuid().optional(),
  exemplar_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  pattern_key: z.string().min(1),
  exemplar: z.record(z.string(), z.unknown()),
  initial_score: z.number().min(0).max(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// External agent surfaces
// ─────────────────────────────────────────────────────────────────────────────

const McpToolCalled = z.object({
  user_id: z.string().uuid(),
  client_id: z.string().nullable(),
  token_fingerprint: z.string().min(8).max(32).nullable(),
  tool_name: z.string().min(1),
  request_id: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.enum(["completed", "errored"]),
  http_status: z.number().int().min(100).max(599),
  latency_ms: z.number().int().nonnegative(),
  mcp_method: z.literal("tools/call"),
});

const AssistantSessionStarted = z.object({
  user_id: z.string().uuid(),
  mode: z.enum(["text", "voice"]),
  call_id: z.string().nullable(),
  output_voice: z.string().min(1),
});

const AssistantToolCalled = z.object({
  user_id: z.string().uuid(),
  tool_name: z.string().min(1),
  call_id: z.string().nullable(),
  request_id: z.string().nullable(),
  status: z.enum(["completed", "confirmation_pending", "errored"]),
  latency_ms: z.number().int().nonnegative(),
  requires_confirmation: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const eventRegistry = {
  "workspace.created": WorkspaceCreated,
  "workspace.member.invited": WorkspaceMemberInvited,
  "workspace.member.accepted": WorkspaceMemberAccepted,
  "workspace.activation.requested": WorkspaceActivationRequested,
  "workspace.configured": WorkspaceConfigured,
  "workspace.billing.subscription.synced": WorkspaceBillingSubscriptionSynced,
  "workspace.trial.granted": WorkspaceTrialGranted,
  "workspace.trial.low": WorkspaceTrialLow,
  "workspace.trial.exhausted": WorkspaceTrialExhausted,
  "workspace.outreach.frozen": WorkspaceOutreachFrozen,
  "workspace.outreach.resumed": WorkspaceOutreachResumed,
  "rep.configured": RepConfigured,
  "rep.role.completed": RepRoleCompleted,
  "workspace.icp.configured": WorkspaceIcpConfigured,
  "workspace.company.tracked": WorkspaceCompanyTracked,
  "workspace.company.profiled": WorkspaceCompanyProfiled,
  "workspace.profile.drafted": WorkspaceProfileDrafted,
  "icp.drafted": IcpDrafted,
  "workspace.profile.enriched": WorkspaceProfileEnriched,
  "vertical.intelligence.updated": VerticalIntelligenceUpdated,
  "workspace.source.configured": WorkspaceSourceConfigured,
  "contact.resolved": ContactResolved,
  "contact.resolution.deferred": ContactResolutionDeferred,

  "signal.discovered": SignalDiscovered,
  "signal.ingested": SignalIngested,
  "signal.matched": SignalMatched,
  "signal.matching.deferred": SignalMatchingDeferred,
  "signal.company.linked": SignalCompanyLinked,
  "signal.dismissed": SignalDismissed,
  "signal.dismissal.requested": SignalDismissalRequested,
  "person.fit_feedback.recorded": PersonFitFeedbackRecorded,
  "signal.outreach.gated": SignalOutreachGated,
  "signal.classification.completed": SignalClassificationCompleted,
  "signal.expired": SignalExpired,
  "signal.expiry.requested": SignalExpiryRequested,
  "account.intent.updated": AccountIntentUpdated,
  "signal.feedback.updated": SignalFeedbackUpdated,

  "play.configured": PlayConfigured,
  "play.run.started": PlayRunStarted,
  "play.run.completed": PlayRunCompleted,
  "play.run.failed": PlayRunFailed,

  "workflow.step.started": WorkflowStepStarted,
  "workflow.step.completed": WorkflowStepCompleted,
  "workflow.step.failed": WorkflowStepFailed,
  "workflow.run.failed": WorkflowRunFailed,
  "workflow.run.retried": WorkflowRunRetried,
  "event.dispatch.redriven": EventDispatchRedriven,

  "draft.proposed": DraftProposed,
  "message.personalized": MessagePersonalized,
  "draft.judged": DraftJudged,
  "draft.rejected": DraftRejected,

  "conversation.opened": ConversationOpened,

  "email.bounce.received": EmailBounceReceived,
  "email.inbound.received": EmailInboundReceived,
  "email.outlook.notification.received": OutlookNotificationReceived,
  "email.outlook.authorization.received": OutlookAuthorizationReceived,
  "email.outlook.credentials.refreshed": OutlookCredentialsRefreshed,
  "email.outlook.reauthorization.required": OutlookReauthorizationRequired,
  "email.domain.warmup.updated": EmailDomainWarmupUpdated,
  "email.outlook.subscription.updated": OutlookSubscriptionUpdated,

  "message.queued": MessageQueued,
  "message.sent": MessageSent,
  "message.deferred": MessageDeferred,
  "message.delivered": MessageDelivered,
  "message.bounced": MessageBounced,

  "reply.received": ReplyReceived,
  "reply.unmatched": ReplyUnmatched,
  "reply.classified": ReplyClassified,

  "approval.requested": ApprovalRequested,
  "approval.decided": ApprovalDecided,

  "outcome.recorded": OutcomeRecorded,

  "channel.account.connected": ChannelAccountConnected,
  "channel.account.configured": ChannelAccountConfigured,
  "crm.destination.configured": CrmDestinationConfigured,
  "crm.handoff.queued": CrmHandoffQueued,
  "crm.handoff.webhook.delivered": CrmHandoffWebhookDelivered,
  "crm.handoff.webhook.failed": CrmHandoffWebhookFailed,
  "channel.account.errored": ChannelAccountErrored,
  "linkedin.account.authorization.received":
    LinkedInAccountAuthorizationReceived,
  "linkedin.connection.accepted": LinkedInConnectionAccepted,
  "channel.domain.provisioned": ChannelDomainSnapshot,
  "channel.domain.verification.requested": ChannelDomainVerificationRequested,
  "channel.domain.status.received": ChannelDomainSnapshot,
  "channel.domain.dmarc.observed": ChannelDomainDmarcObserved,
  "channel.domain.trust.verified": ChannelDomainTrustVerified,
  "channel.domain.warmup.advanced": ChannelDomainWarmupAdvanced,

  "llm.usage.recorded": LLMUsageRecorded,
  "llm.call.deferred": LLMCallDeferred,
  "agent.trace.span.recorded": AgentTraceSpanRecorded,
  "agent.trace.exported": AgentTraceExported,
  "agent.trace.eval_failed": AgentTraceEvalFailed,
  "company.memory.recalled": CompanyMemoryRecalled,
  "company.brief.updated": CompanyBriefUpdated,

  "campaign.strategy.recommended": CampaignStrategyRecommended,
  "play.skill.optimization.recommended": PlaySkillOptimizationRecommended,
  "campaign.dispatch.skipped": CampaignDispatchSkipped,
  "meeting.prep.generated": MeetingPrepGenerated,
  "workspace.launch.readiness.checked": WorkspaceLaunchReadinessChecked,

  "exa.query.requested": ExaQueryRequested,
  "exa.query.completed": ExaQueryCompleted,
  "exa.contents.fetched": ExaContentsFetched,
  "exa.evidence.projected": ExaEvidenceProjected,
  "rep.research.completed": RepResearchCompleted,
  "rep.brief.refreshed": RepBriefRefreshed,
  "aeo.audit.completed": AeoAuditCompleted,
  "content.opportunity.discovered": ContentOpportunityDiscovered,
  "recommendation.reviewed": RecommendationReviewed,
  "recommendation.updated": RecommendationUpdated,
  "recommendation.deleted": RecommendationDeleted,

  "rep.memory.procedural.updated": RepMemoryProceduralUpdated,
  "rep.memory.procedural.seeded": RepMemoryProceduralSeeded,

  "assistant.session.started": AssistantSessionStarted,
  "assistant.tool.called": AssistantToolCalled,
  "mcp.tool.called": McpToolCalled,
} as const;

export type EventType = keyof typeof eventRegistry;

export type EventPayload<T extends EventType> = z.infer<
  (typeof eventRegistry)[T]
>;

export function isKnownEventType(t: string): t is EventType {
  return Object.prototype.hasOwnProperty.call(eventRegistry, t);
}
