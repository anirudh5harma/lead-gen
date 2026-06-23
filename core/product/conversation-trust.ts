import type { Pool } from "pg";
import {
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
} from "../plays/index.ts";
import { WORKSPACE_MEETING_PREP_WORKFLOW } from "../agents/langgraph/index.ts";
import { getPool } from "../substrate/storage/index.ts";

export interface ConversationTrustConversation {
  id: string;
  status: string;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  counterparty_person_id: string | null;
  counterparty_name: string | null;
  counterparty_emails: string[] | null;
  counterparty_email_status: string | null;
  counterparty_title: string | null;
  counterparty_linkedin_url: string | null;
  counterparty_linkedin_ready: boolean | null;
  counterparty_fit_decision: string | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_description: string | null;
  rep_name: string | null;
  rep_id: string | null;
  rep_role: string | null;
  signal_id: string | null;
  signal_title: string | null;
  signal_kind: string | null;
  signal_content: string | null;
  signal_url: string | null;
}

export interface ConversationTrustMessage {
  id: string;
  channel: string;
  direction: string;
  status: string;
  subject: string | null;
  body: string | null;
  external_id: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  intent_class: string | null;
  intent_confidence: string | null;
  sent_at: Date | null;
  created_at: Date;
  provenance: Record<string, unknown> | null;
  properties: Record<string, unknown> | null;
  eval_notes: Record<string, unknown> | null;
  channel_account_id: string | null;
}

export interface ConversationTrustEvent {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export interface ConversationTrustWorkflowRun {
  id: string;
  workflow_name: string;
  workflow_version: string;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
}

export interface ConversationTrustStep {
  step_name: string;
  step_position: number;
  attempt: number;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
}

export interface ConversationTrustApproval {
  id: string;
  run_id: string;
  kind: string;
  reason: string | null;
  payload: Record<string, unknown>;
  decision: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
}

export interface ConversationTrustOutcome {
  id: string;
  kind: string;
  score: string;
  attributed_message_id: string | null;
  attributed_signal_id: string | null;
  attributed_play_id: string | null;
  attributed_play_run_id: string | null;
  properties: Record<string, unknown>;
  occurred_at: Date;
}

export interface ConversationTrustGateExplanation {
  kind: "judge" | "brand_voice" | "channel" | "deliverability";
  status: "passed" | "blocked" | "deferred" | "sent" | "delivered" | "bounced";
  severity: "ok" | "warn" | "block";
  summary: string;
  detail: string | null;
}

export interface ConversationTrustReplyProof {
  inbound_message_id: string;
  draft_message_id: string | null;
  intent: string | null;
  intent_confidence: string | null;
  draft_status: string | null;
  draft_subject: string | null;
  pattern_key: string | null;
  exemplar_count: number;
  eval_score: string | null;
  eval_passed: boolean | null;
  approval_decision: string | null;
  approval_kind: string | null;
  channel_status: string | null;
  channel_event_type: string | null;
  outcome_kind: string | null;
  outcome_score: string | null;
  gate_explanations: ConversationTrustGateExplanation[];
  summary: string;
}

export interface ConversationTrustTrace {
  conversation: ConversationTrustConversation;
  messages: ConversationTrustMessage[];
  events: ConversationTrustEvent[];
  workflow: {
    run: ConversationTrustWorkflowRun;
    steps: ConversationTrustStep[];
  } | null;
  approvals: ConversationTrustApproval[];
  outcomes: ConversationTrustOutcome[];
  gate_explanations: ConversationTrustGateExplanation[];
  reply_proofs: ConversationTrustReplyProof[];
}

export async function getConversationTrustTrace(
  input: { workspace_id: string; conversation_id: string },
  pool: Pool = getPool(),
): Promise<ConversationTrustTrace | null> {
  const conversation = await loadConversation(pool, input);
  if (!conversation) return null;

  const messages = await loadMessages(pool, input);
  const messageIds = messages.map((message) => message.id);
  const workflow = await loadWorkflowRun(pool, {
    ...input,
    signal_id: conversation.signal_id,
    message_ids: messageIds,
  });

  const [events, approvals, outcomes] = await Promise.all([
    loadEvents(pool, {
      ...input,
      signal_id: conversation.signal_id,
      message_ids: messageIds,
      channel_account_ids: channelAccountIds(messages),
      workflow_run_id: workflow?.run.id ?? null,
    }),
    workflow
      ? loadApprovals(pool, input.workspace_id, workflow.run.id)
      : Promise.resolve([]),
    loadOutcomes(pool, {
      ...input,
      signal_id: conversation.signal_id,
      message_ids: messageIds,
    }),
  ]);

  return {
    conversation,
    messages,
    events,
    workflow,
    approvals,
    outcomes,
    gate_explanations: buildGateExplanations({
      message: latestOutboundMessage(messages),
      events,
    }),
    reply_proofs: buildReplyProofs({ messages, events, approvals, outcomes }),
  };
}

export function buildReplyProofs(input: {
  messages: ConversationTrustMessage[];
  events: ConversationTrustEvent[];
  approvals: ConversationTrustApproval[];
  outcomes: ConversationTrustOutcome[];
}): ConversationTrustReplyProof[] {
  return input.messages
    .filter((message) => message.direction === "inbound" && Boolean(message.intent_class))
    .map((inbound) => {
      const replies = input.messages.filter(
        (message) =>
          message.direction === "outbound" &&
          textField(message.provenance?.inbound_message_id) === inbound.id,
      );
      const draft = replies.at(-1) ?? null;
      const roleEvent = input.events
        .filter(
          (event) =>
            event.event_type === "rep.role.completed" &&
            textField(event.payload?.action) === "draft_email_reply" &&
            textField(recordField(event.payload?.output)?.inbound_message_id) === inbound.id,
        )
        .at(-1);
      const approval = input.approvals
        .filter((item) => {
          const payload = item.payload;
          return (
            textField(payload.inbound_message_id) === inbound.id ||
            (draft ? textField(payload.message_id) === draft.id : false)
          );
        })
        .at(-1);
      const channelEvent = draft
        ? input.events
            .filter(
              (event) =>
                [
                  "message.sent",
                  "message.deferred",
                  "message.delivered",
                  "message.bounced",
                ].includes(event.event_type) &&
                textField(event.payload?.message_id) === draft.id,
            )
            .at(-1)
        : undefined;
      const outcome = input.outcomes
        .filter((item) =>
          draft
            ? item.attributed_message_id === draft.id
            : item.attributed_message_id === inbound.id,
        )
        .at(-1);
      const pattern_key =
        textField(draft?.provenance?.pattern_key) ??
        textField(recordField(roleEvent?.payload?.output)?.pattern_key);
      const exemplar_count = Array.isArray(draft?.provenance?.exemplar_ids)
        ? draft.provenance.exemplar_ids.length
        : numericField(recordField(roleEvent?.payload?.output)?.procedural_exemplar_count) ?? 0;
      const channel_status =
        textField(channelEvent?.payload?.status) ??
        textField(channelEvent?.payload?.defer_reason) ??
        draft?.status ??
        null;
      const gate_explanations = buildGateExplanations({
        message: draft,
        events: input.events,
      });

      return {
        inbound_message_id: inbound.id,
        draft_message_id: draft?.id ?? null,
        intent: inbound.intent_class,
        intent_confidence: inbound.intent_confidence,
        draft_status: draft?.status ?? null,
        draft_subject: draft?.subject ?? null,
        pattern_key,
        exemplar_count,
        eval_score: draft?.eval_score ?? null,
        eval_passed: draft?.eval_passed ?? null,
        approval_decision: approval?.decision ?? null,
        approval_kind: approval?.kind ?? null,
        channel_status,
        channel_event_type: channelEvent?.event_type ?? null,
        outcome_kind: outcome?.kind ?? null,
        outcome_score: outcome?.score ?? null,
        gate_explanations,
        summary: replyProofSummary({
          intent: inbound.intent_class,
          draft,
          approval,
          channelEvent,
          outcome,
        }),
      };
    });
}

export function buildGateExplanations(input: {
  message: ConversationTrustMessage | null;
  events: ConversationTrustEvent[];
}): ConversationTrustGateExplanation[] {
  const message = input.message;
  if (!message) return [];
  const gateEvents = input.events.filter(
    (event) => textField(event.payload?.message_id) === message.id,
  );
  const judgedEvent = gateEvents
    .filter((event) => event.event_type === "draft.judged")
    .at(-1);
  const channelEvent = gateEvents
    .filter((event) =>
      [
        "message.sent",
        "message.deferred",
        "message.delivered",
        "message.bounced",
      ].includes(event.event_type),
    )
    .at(-1);
  const accountEvent = latestChannelAccountError(input.events, message, gateEvents);
  const notes =
    recordField(judgedEvent?.payload?.notes) ??
    message.eval_notes ??
    {};
  const axes = recordField(notes.axes) ?? {};
  const explanations: ConversationTrustGateExplanation[] = [];
  const score =
    numericField(judgedEvent?.payload?.eval_score) ??
    numberFromString(message.eval_score);
  const passed =
    booleanField(judgedEvent?.payload?.passed) ??
    message.eval_passed;

  if (score !== null || passed !== null) {
    explanations.push({
      kind: "judge",
      status: passed === false ? "blocked" : "passed",
      severity: passed === false ? "block" : "ok",
      summary: `Quality judge ${passed === false ? "blocked" : "passed"}${score !== null ? ` at ${score.toFixed(2)}` : ""}`,
      detail: judgeDetail(notes),
    });
  }

  const brandVoice = numericField(axes.brand_voice);
  if (brandVoice !== null) {
    const blocked = brandVoice < 0.55 || (passed === false && mentionsVoice(notes));
    explanations.push({
      kind: "brand_voice",
      status: blocked ? "blocked" : "passed",
      severity: blocked ? "block" : brandVoice < 0.75 ? "warn" : "ok",
      summary: `Brand voice ${blocked ? "blocked" : "passed"} at ${brandVoice.toFixed(2)}`,
      detail: brandVoiceDetail(notes, axes),
    });
  }

  if (channelEvent) {
    explanations.push(channelExplanation(channelEvent));
  }
  if (accountEvent) {
    explanations.push(channelAccountExplanation(accountEvent));
  }

  return explanations;
}

function latestChannelAccountError(
  events: ConversationTrustEvent[],
  message: ConversationTrustMessage,
  gateEvents: ConversationTrustEvent[],
): ConversationTrustEvent | undefined {
  const ids = new Set(
    [
      message.channel_account_id,
      textField(message.properties?.channel_account_id),
      textField(message.provenance?.channel_account_id),
      ...gateEvents.map((event) => textField(event.payload?.channel_account_id)),
    ].filter((id): id is string => Boolean(id)),
  );
  if (ids.size === 0) return undefined;
  return events
    .filter(
      (event) =>
        event.event_type === "channel.account.errored" &&
        ids.has(textField(event.payload?.channel_account_id) ?? ""),
    )
    .at(-1);
}

function latestOutboundMessage(
  messages: ConversationTrustMessage[],
): ConversationTrustMessage | null {
  return [...messages].reverse().find((message) => message.direction === "outbound") ?? null;
}

function judgeDetail(notes: Record<string, unknown>): string | null {
  const critique = textField(notes.critique);
  const suggestions = Array.isArray(notes.suggestions)
    ? notes.suggestions.filter((item): item is string => typeof item === "string")
    : [];
  return [critique, suggestions.length ? `Suggestions: ${suggestions.join("; ")}` : null]
    .filter((piece): piece is string => Boolean(piece))
    .join(" ")
    || null;
}

function mentionsVoice(notes: Record<string, unknown>): boolean {
  const text = [
    textField(notes.critique),
    ...(Array.isArray(notes.suggestions)
      ? notes.suggestions.filter((item): item is string => typeof item === "string")
      : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\bvoice\b|do-not|canonical|hype|samples?/.test(text);
}

function brandVoiceDetail(
  notes: Record<string, unknown>,
  axes: Record<string, unknown>,
): string | null {
  const pieces = [
    axisDetail(axes, "voice_do_not", "do-not"),
    axisDetail(axes, "voice_sample_overlap", "sample match"),
    axisDetail(axes, "voice_low_hype", "low hype"),
    judgeDetail(notes),
  ].filter((piece): piece is string => Boolean(piece));
  return pieces.length ? pieces.join(" · ") : null;
}

function axisDetail(
  axes: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = numericField(axes[key]);
  return value === null ? null : `${label} ${value.toFixed(2)}`;
}

function channelExplanation(
  event: ConversationTrustEvent,
): ConversationTrustGateExplanation {
  if (event.event_type === "message.deferred") {
    const reason = textField(event.payload.defer_reason) ?? "deferred";
    const kind = deliverabilityReasons.has(reason) ? "deliverability" : "channel";
    return {
      kind,
      status: "deferred",
      severity: "warn",
      summary: `${kind === "deliverability" ? "Deliverability" : "Channel"} deferred: ${friendlyDeferReason(reason)}`,
      detail: [
        textField(event.payload.detail),
        textField(event.payload.retry_after)
          ? `Retry after ${textField(event.payload.retry_after)}`
          : null,
      ].filter((piece): piece is string => Boolean(piece)).join(" ") || null,
    };
  }

  if (event.event_type === "message.bounced") {
    return {
      kind: "deliverability",
      status: "bounced",
      severity: "block",
      summary: "Deliverability blocked: message bounced",
      detail: textField(event.payload.reason) ?? textField(event.payload.detail),
    };
  }

  if (event.event_type === "message.delivered") {
    return {
      kind: "channel",
      status: "delivered",
      severity: "ok",
      summary: "Channel delivered",
      detail: textField(event.payload.external_id),
    };
  }

  return {
    kind: "channel",
    status: "sent",
    severity: "ok",
    summary: "Channel sent",
    detail: textField(event.payload.external_id),
  };
}

function channelAccountExplanation(
  event: ConversationTrustEvent,
): ConversationTrustGateExplanation {
  const status = textField(event.payload.status) ?? "errored";
  const blocked = ["needs_reauth", "suspended", "disconnected"].includes(status);
  return {
    kind: "channel",
    status: blocked ? "blocked" : "deferred",
    severity: blocked ? "block" : "warn",
    summary: `Channel account ${friendlyChannelAccountStatus(status)}`,
    detail: [
      textField(event.payload.error),
      textField(event.payload.account_display_name),
      textField(event.payload.provider_incident_id)
        ? `Incident ${textField(event.payload.provider_incident_id)}`
        : null,
      textField(event.payload.provider_event_id)
        ? `Provider event ${textField(event.payload.provider_event_id)}`
        : null,
      textField(event.payload.retry_after)
        ? `Retry after ${textField(event.payload.retry_after)}`
        : null,
      textField(event.payload.channel_account_id)
        ? `Account ${textField(event.payload.channel_account_id)}`
        : null,
    ].filter((piece): piece is string => Boolean(piece)).join(" ") || null,
  };
}

function friendlyChannelAccountStatus(status: string): string {
  const known: Record<string, string> = {
    needs_reauth: "needs reauthorization",
    rate_limited: "is rate-limited",
    suspended: "is suspended",
    disconnected: "is disconnected",
    errored: "reported a provider error",
  };
  return known[status] ?? status.replace(/_/g, " ");
}

const deliverabilityReasons = new Set([
  "deliverability_cap_zero",
  "deliverability_cap_exhausted",
  "daily_cap_reached",
  "frequency_cap_reached",
  "provider_error_transient",
  "provider_error_permanent",
]);

function friendlyDeferReason(reason: string): string {
  const known: Record<string, string> = {
    website_required:
      "the workspace needs a company website and description before sending",
    deliverability_cap_zero: "sending domain is not warmed yet",
    deliverability_cap_exhausted: "today's warmed sending capacity is exhausted",
    daily_cap_reached: "the channel daily cap is reached",
    frequency_cap_reached: "this recipient was contacted too recently",
    missing_linkedin_profile: "the person has no LinkedIn profile on the graph",
    linkedin_account_unavailable: "no LinkedIn sending account is available",
    linkedin_daily_cap_exhausted: "the LinkedIn account daily cap is reached",
    linkedin_needs_reauth: "the LinkedIn account needs reauthorization",
    linkedin_rate_limited: "LinkedIn rate-limited the account",
    linkedin_account_suspended: "the LinkedIn account is suspended",
    linkedin_account_disconnected: "the LinkedIn account is disconnected",
    eval_rejected: "the hot-path judge rejected the draft",
    eval_rejected_after_edit: "the edited draft did not pass the judge",
    reply_research_only: "the Agent is set to research-only for replies",
  };
  return known[reason] ?? reason.replace(/_/g, " ");
}

function replyProofSummary(input: {
  intent: string | null;
  draft: ConversationTrustMessage | null;
  approval: ConversationTrustApproval | undefined;
  channelEvent: ConversationTrustEvent | undefined;
  outcome: ConversationTrustOutcome | undefined;
}): string {
  const pieces = [
    input.intent ? `intent ${input.intent}` : "intent pending",
    input.draft ? `draft ${input.draft.status}` : "draft pending",
    input.draft?.eval_score
      ? `judge ${Number(input.draft.eval_score).toFixed(2)}`
      : null,
    input.approval ? `approval ${input.approval.decision}` : "approval not requested",
    input.channelEvent
      ? input.channelEvent.event_type.replace("message.", "")
      : input.draft?.status ?? null,
    input.outcome ? `outcome ${input.outcome.kind.replace(/_/g, " ")}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return pieces.join(" -> ");
}

function recordField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFromString(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function loadConversation(
  pool: Pool,
  input: { workspace_id: string; conversation_id: string },
): Promise<ConversationTrustConversation | null> {
  const { rows } = await pool.query<ConversationTrustConversation>(
    `select c.id, c.status::text as status, c.topic, c.started_at, c.last_activity_at,
            p.id as counterparty_person_id,
            p.full_name as counterparty_name,
            p.emails::text[] as counterparty_emails,
            coalesce(
              email_status.status,
              case
                when coalesce(cardinality(p.emails), 0) > 0 then 'found'
                else 'missing'
              end
            ) as counterparty_email_status,
            p.title as counterparty_title,
            p.linkedin_url as counterparty_linkedin_url,
            (p.linkedin_url is not null and length(trim(p.linkedin_url)) > 0) as counterparty_linkedin_ready,
            p.properties #>> '{contact_fit,decision}' as counterparty_fit_decision,
            co.id as company_id,
            co.name as company_name,
            co.domain::text as company_domain,
            co.industry as company_industry,
            co.description as company_description,
            r.name as rep_name,
            r.id as rep_id,
            r.role::text as rep_role,
            s.id as signal_id,
            s.title as signal_title,
            s.kind::text as signal_kind,
            s.content as signal_content,
            s.url as signal_url
       from conversations c
       left join graph_persons p
         on p.id = c.counterparty_person_id
        and p.workspace_id = c.workspace_id
       left join lateral (
         select case
                  when ev.meta->>'verified' = 'true'
                    or lower(coalesce(ev.meta->>'status', '')) in ('valid','verified','deliverable')
                    then 'verified'
                  when lower(coalesce(ev.meta->>'status', '')) in ('invalid','undeliverable','bounced')
                    then 'invalid'
                  else 'found'
                end as status
           from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
          where p.emails is not null
            and lower(ev.email) = lower(p.emails[1])
          limit 1
       ) email_status on true
       left join graph_companies co
         on co.id = c.counterparty_company_id
        and co.workspace_id = c.workspace_id
       left join reps r
         on r.id = c.rep_id
        and r.workspace_id = c.workspace_id
       left join signals s
         on s.id = c.origin_signal_id
        and s.workspace_id = c.workspace_id
      where c.workspace_id = $1 and c.id = $2`,
    [input.workspace_id, input.conversation_id],
  );
  return rows[0] ?? null;
}

async function loadMessages(
  pool: Pool,
  input: { workspace_id: string; conversation_id: string },
): Promise<ConversationTrustMessage[]> {
  const { rows } = await pool.query<ConversationTrustMessage>(
    `select id, channel::text as channel, direction::text as direction, status::text as status,
            subject, body, external_id,
            eval_score::text as eval_score, eval_passed,
            intent_class, intent_confidence::text as intent_confidence,
            sent_at, created_at, provenance, properties, eval_notes,
            channel_account_id::text as channel_account_id
       from messages
      where workspace_id = $1 and conversation_id = $2
      order by coalesce(sent_at, created_at) asc`,
    [input.workspace_id, input.conversation_id],
  );
  return rows;
}

async function loadWorkflowRun(
  pool: Pool,
  input: {
    workspace_id: string;
    conversation_id: string;
    signal_id: string | null;
    message_ids: string[];
  },
): Promise<{ run: ConversationTrustWorkflowRun; steps: ConversationTrustStep[] } | null> {
  const { rows: runs } = await pool.query<ConversationTrustWorkflowRun>(
    `select wr.id, wr.workflow_name, wr.workflow_version, wr.status::text as status,
            wr.started_at, wr.ended_at
       from workflow_runs wr
      where wr.workspace_id = $1
        and wr.workflow_name = any($2::text[])
        and (
          ($3::text is not null and wr.input::jsonb->>'signal_id' = $3)
          or wr.input::jsonb->>'conversation_id' = $4
          or wr.input::jsonb->>'inbound_message_id' = any($5::text[])
          or wr.output::jsonb->>'conversation_id' = $4
          or wr.output::jsonb->>'inbound_message_id' = any($5::text[])
          or wr.output::jsonb->>'message_id' = any($5::text[])
        )
      order by wr.created_at desc
      limit 1`,
    [
      input.workspace_id,
      [
        SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
        SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
        REPLY_TO_EMAIL_PLAY_WORKFLOW,
        WORKSPACE_MEETING_PREP_WORKFLOW,
      ],
      input.signal_id,
      input.conversation_id,
      input.message_ids,
    ],
  );
  const run = runs[0];
  if (!run) return null;
  const { rows: steps } = await pool.query<ConversationTrustStep>(
    `select step_name, step_position, attempt, status::text as status, started_at, ended_at
       from workflow_steps
      where workspace_id = $1 and run_id = $2
      order by step_position asc, attempt asc`,
    [input.workspace_id, run.id],
  );
  return { run, steps };
}

async function loadEvents(
  pool: Pool,
  input: {
    workspace_id: string;
    conversation_id: string;
    signal_id: string | null;
    message_ids: string[];
    channel_account_ids: string[];
    workflow_run_id: string | null;
  },
): Promise<ConversationTrustEvent[]> {
  const { rows } = await pool.query<ConversationTrustEvent>(
    `select id, event_type, source, payload, occurred_at
       from events
      where workspace_id = $1
        and (
          payload->>'conversation_id' = $2
          or payload->>'message_id' = any($3::text[])
          or payload->>'inbound_message_id' = any($3::text[])
          or payload->>'attributed_message_id' = any($3::text[])
          or payload->>'matched_outbound_message_id' = any($3::text[])
          or payload#>>'{provenance,inbound_message_id}' = any($3::text[])
          or payload#>>'{output,inbound_message_id}' = any($3::text[])
          or payload->>'channel_account_id' = any($6::text[])
          or (
            $4::text is not null
            and (
              payload->>'signal_id' = $4
              or payload->>'attributed_signal_id' = $4
              or payload->>'origin_signal_id' = $4
            )
          )
          or (
            $5::text is not null
            and (
              payload->>'run_id' = $5
              or payload->>'workflow_run_id' = $5
            )
          )
        )
      order by occurred_at asc
      limit 240`,
    [
      input.workspace_id,
      input.conversation_id,
      input.message_ids,
      input.signal_id,
      input.workflow_run_id,
      input.channel_account_ids,
    ],
  );
  return rows;
}

function channelAccountIds(messages: ConversationTrustMessage[]): string[] {
  return [
    ...new Set(
      messages
        .flatMap((message) => [
          message.channel_account_id,
          textField(message.properties?.channel_account_id),
          textField(message.provenance?.channel_account_id),
        ])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

async function loadApprovals(
  pool: Pool,
  workspaceId: string,
  runId: string,
): Promise<ConversationTrustApproval[]> {
  const { rows } = await pool.query<ConversationTrustApproval>(
    `select id, run_id, kind, reason, payload, decision::text as decision,
            decided_by, decided_at, decision_note, created_at
       from workflow_approvals
      where workspace_id = $1 and run_id = $2
      order by created_at asc`,
    [workspaceId, runId],
  );
  return rows;
}

async function loadOutcomes(
  pool: Pool,
  input: {
    workspace_id: string;
    conversation_id: string;
    signal_id: string | null;
    message_ids: string[];
  },
): Promise<ConversationTrustOutcome[]> {
  const { rows } = await pool.query<ConversationTrustOutcome>(
    `select id, kind::text as kind, score::text as score,
            attributed_message_id, attributed_signal_id, attributed_play_id,
            attributed_play_run_id, properties, occurred_at
       from outcomes
      where workspace_id = $1
        and (
          conversation_id = $2
          or attributed_message_id::text = any($3::text[])
          or ($4::text is not null and attributed_signal_id::text = $4)
        )
      order by occurred_at asc`,
    [
      input.workspace_id,
      input.conversation_id,
      input.message_ids,
      input.signal_id,
    ],
  );
  return rows;
}
