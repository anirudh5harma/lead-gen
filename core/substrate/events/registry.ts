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

const SignalIngested = z.object({
  signal_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  kind: z.string(),
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
// Channel I/O
// ─────────────────────────────────────────────────────────────────────────────

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
});

const MessageBounced = z.object({
  message_id: z.string().uuid(),
  channel: z.string(),
  bounce_type: z.enum(["hard", "soft", "complaint"]),
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

  "signal.ingested": SignalIngested,
  "signal.matched": SignalMatched,
  "signal.dismissed": SignalDismissed,

  "play.run.started": PlayRunStarted,
  "play.run.completed": PlayRunCompleted,
  "play.run.failed": PlayRunFailed,

  "workflow.step.started": WorkflowStepStarted,
  "workflow.step.completed": WorkflowStepCompleted,
  "workflow.step.failed": WorkflowStepFailed,

  "draft.proposed": DraftProposed,
  "draft.judged": DraftJudged,
  "draft.rejected": DraftRejected,

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

  "rep.memory.procedural.updated": RepMemoryProceduralUpdated,
} as const;

export type EventType = keyof typeof eventRegistry;

export type EventPayload<T extends EventType> = z.infer<
  (typeof eventRegistry)[T]
>;

export function isKnownEventType(t: string): t is EventType {
  return Object.prototype.hasOwnProperty.call(eventRegistry, t);
}
