import type { Pool } from "pg";
import {
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
  SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
} from "../plays/index.ts";
import { getPool } from "../substrate/storage/index.ts";

export interface ConversationTrustConversation {
  id: string;
  status: string;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  counterparty_name: string | null;
  counterparty_emails: string[] | null;
  company_name: string | null;
  rep_name: string | null;
  rep_id: string | null;
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

  return { conversation, messages, events, workflow, approvals, outcomes };
}

async function loadConversation(
  pool: Pool,
  input: { workspace_id: string; conversation_id: string },
): Promise<ConversationTrustConversation | null> {
  const { rows } = await pool.query<ConversationTrustConversation>(
    `select c.id, c.status::text as status, c.topic, c.started_at, c.last_activity_at,
            p.full_name as counterparty_name,
            p.emails::text[] as counterparty_emails,
            co.name as company_name,
            r.name as rep_name,
            r.id as rep_id,
            s.id as signal_id,
            s.title as signal_title,
            s.kind::text as signal_kind,
            s.content as signal_content,
            s.url as signal_url
       from conversations c
       left join graph_persons p
         on p.id = c.counterparty_person_id
        and p.workspace_id = c.workspace_id
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
            sent_at, created_at, provenance, properties, eval_notes
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
          or wr.output::jsonb->>'conversation_id' = $4
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
          or payload->>'attributed_message_id' = any($3::text[])
          or payload->>'matched_outbound_message_id' = any($3::text[])
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
    ],
  );
  return rows;
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
