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
});

const WorkspaceMemberInvited = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]),
});

// ─────────────────────────────────────────────────────────────────────────────
// Signal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const SignalDiscovered = z.object({
  signal_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  kind: z.enum([
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
  ]).nullable(),
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

const SignalDismissed = z.object({
  signal_id: z.string().uuid(),
  reason: z.string(),
});

const SignalClassificationCompleted = z.object({
  signal_id: z.string().uuid(),
  kind: z.enum([
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
  ]).nullable(),
  disposition: z.enum(["matched", "dismissed"]),
  match_score: z.number().min(0).max(1).nullable(),
  match_reason: z.string(),
  audience_hint: z.record(z.string(), z.unknown()),
  matches: z.array(z.object({
    icp_segment: z.string().uuid(),
    match_score: z.number().min(0).max(1),
    reason: z.string(),
  })),
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

// ─────────────────────────────────────────────────────────────────────────────
// Play / workflow lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const PlayRunStarted = z.object({
  play_id: z.string().uuid(),
  play_run_id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  trigger_event_id: z.string().uuid().nullable(),
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
  origin_signal_id: z.string().uuid().nullable(),
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
});

const MessageSent = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  external_id: z.string().nullable(),
});

const MessageDeferred = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  defer_reason: z.string(),
  retry_after: z.string().datetime().nullable(),
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
});

const ReplyReceived = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  channel: z.string(),
});

const ReplyClassified = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  intent: z.string(),
  confidence: z.number().min(0).max(1),
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
  attributed_rep_id: z.string().uuid().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel accounts
// ─────────────────────────────────────────────────────────────────────────────

const ChannelAccountConnected = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.string(),
});

const ChannelAccountErrored = z.object({
  channel_account_id: z.string().uuid(),
  kind: z.string(),
  error: z.string(),
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
// Memory updates (procedural memory grows from outcomes)
// ─────────────────────────────────────────────────────────────────────────────

const RepMemoryProceduralUpdated = z.object({
  rep_id: z.string().uuid(),
  pattern_key: z.string(),
  delta_score: z.number(),
  win: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const eventRegistry = {
  "workspace.created": WorkspaceCreated,
  "workspace.member.invited": WorkspaceMemberInvited,

  "signal.discovered": SignalDiscovered,
  "signal.ingested": SignalIngested,
  "signal.matched": SignalMatched,
  "signal.dismissed": SignalDismissed,
  "signal.classification.completed": SignalClassificationCompleted,
  "signal.expired": SignalExpired,
  "signal.expiry.requested": SignalExpiryRequested,

  "play.run.started": PlayRunStarted,
  "play.run.completed": PlayRunCompleted,
  "play.run.failed": PlayRunFailed,

  "workflow.step.started": WorkflowStepStarted,
  "workflow.step.completed": WorkflowStepCompleted,
  "workflow.step.failed": WorkflowStepFailed,
  "workflow.run.failed": WorkflowRunFailed,
  "workflow.run.retried": WorkflowRunRetried,

  "draft.proposed": DraftProposed,
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
  "reply.classified": ReplyClassified,

  "approval.requested": ApprovalRequested,
  "approval.decided": ApprovalDecided,

  "outcome.recorded": OutcomeRecorded,

  "channel.account.connected": ChannelAccountConnected,
  "channel.account.errored": ChannelAccountErrored,

  "llm.usage.recorded": LLMUsageRecorded,
  "llm.call.deferred": LLMCallDeferred,

  "rep.memory.procedural.updated": RepMemoryProceduralUpdated,
} as const;

export type EventType = keyof typeof eventRegistry;

export type EventPayload<T extends EventType> = z.infer<
  (typeof eventRegistry)[T]
>;

export function isKnownEventType(t: string): t is EventType {
  return Object.prototype.hasOwnProperty.call(eventRegistry, t);
}
