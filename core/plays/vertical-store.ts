import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GraphCompany, GraphPerson } from "../graph/types.ts";
import type {
  Conversation,
  Message,
  Outcome,
  Rep,
  Signal,
} from "../primitives/index.ts";
import type {
  EventBus,
  EventPayload,
  PublishedEvent,
  Subscription,
} from "../substrate/events/index.ts";

export interface VerticalSliceStoreSeed {
  reps: Rep[];
  signals: Signal[];
  persons: GraphPerson[];
  companies?: GraphCompany[];
}

type Awaitable<T> = T | Promise<T>;

export interface CreateConversationInput {
  workspace_id: string;
  rep_id: string;
  counterparty_person_id: string;
  counterparty_company_id?: string | null;
  origin_signal_id?: string | null;
  topic?: string | null;
}

export interface CreateDraftMessageInput {
  workspace_id: string;
  conversation_id: string;
  subject: string | null;
  body: string;
  provenance?: Record<string, unknown>;
}

export interface CountPlayChannelMessagesInput {
  workspace_id: string;
  play_id: string;
  channel: Message["channel"];
  statuses: Message["status"][];
  since?: Date | null;
}

export interface VerticalSliceStore {
  getRep(id: string): Awaitable<Rep | null>;
  getSignal(id: string): Awaitable<Signal | null>;
  getPerson(id: string): Awaitable<GraphPerson | null>;
  getCompany(id: string | null | undefined): Awaitable<GraphCompany | null>;
  getMessage(id: string): Awaitable<Message | null>;
  upsertCompany?(input: GraphCompany): Awaitable<GraphCompany>;
  upsertPerson?(input: GraphPerson): Awaitable<GraphPerson>;
  upsertSignal?(input: Signal): Awaitable<Signal>;
  createConversation(input: CreateConversationInput): Awaitable<Conversation>;
  createDraftMessage(input: CreateDraftMessageInput): Awaitable<Message>;
  updateDraftMessage?(
    message_id: string,
    input: { subject: string | null; body: string; properties?: Record<string, unknown> },
  ): Awaitable<Message>;
  countPlayChannelMessages(input: CountPlayChannelMessagesInput): Awaitable<number>;
  snapshot(): Awaitable<{
    conversations: Conversation[];
    messages: Message[];
    outcomes: Outcome[];
  }>;
}

type MessageLifecycleEvent =
  | PublishedEvent<EventPayload<"draft.judged">>
  | PublishedEvent<EventPayload<"draft.rejected">>
  | PublishedEvent<EventPayload<"message.queued">>
  | PublishedEvent<EventPayload<"message.sent">>
  | PublishedEvent<EventPayload<"message.deferred">>;
type OutcomeLifecycleEvent = PublishedEvent<EventPayload<"outcome.recorded">>;

export interface InMemoryVerticalSliceStore extends VerticalSliceStore {
  projectMessageLifecycleEvent(event: MessageLifecycleEvent): Message | null;
  projectOutcomeLifecycleEvent(event: OutcomeLifecycleEvent): Outcome | null;
}

const TERMINAL_SEND_STATUSES = new Set<Message["status"]>([
  "delivered",
  "bounced",
  "replied",
]);

function shouldKeepCurrentStatus(
  current: Message["status"],
  preserving: readonly Message["status"][],
): boolean {
  return preserving.includes(current);
}

export function createInMemoryVerticalSliceStore(
  seed: VerticalSliceStoreSeed,
): InMemoryVerticalSliceStore {
  const reps = new Map(seed.reps.map((row) => [row.id, row]));
  const signals = new Map(seed.signals.map((row) => [row.id, row]));
  const persons = new Map(seed.persons.map((row) => [row.id, row]));
  const companies = new Map((seed.companies ?? []).map((row) => [row.id, row]));
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const outcomes = new Map<string, Outcome>();

  return {
    getRep: (id) => reps.get(id) ?? null,
    getSignal: (id) => signals.get(id) ?? null,
    getPerson: (id) => persons.get(id) ?? null,
    getCompany: (id) => (id ? companies.get(id) ?? null : null),
    getMessage: (id) => messages.get(id) ?? null,

    upsertCompany(input) {
      companies.set(input.id, input);
      return input;
    },

    upsertPerson(input) {
      persons.set(input.id, input);
      return input;
    },

    upsertSignal(input) {
      signals.set(input.id, input);
      return input;
    },

    createConversation(input) {
      const now = new Date().toISOString();
      const row: Conversation = {
        id: randomUUID(),
        workspace_id: input.workspace_id,
        rep_id: input.rep_id,
        counterparty_person_id: input.counterparty_person_id,
        counterparty_company_id: input.counterparty_company_id ?? null,
        status: "open",
        origin_signal_id: input.origin_signal_id ?? null,
        topic: input.topic ?? null,
        started_at: now,
        last_activity_at: now,
        closed_at: null,
        properties: {},
      };
      conversations.set(row.id, row);
      return row;
    },

    createDraftMessage(input) {
      const now = new Date().toISOString();
      const row: Message = {
        id: randomUUID(),
        workspace_id: input.workspace_id,
        conversation_id: input.conversation_id,
        channel: "email",
        direction: "outbound",
        status: "draft",
        subject: input.subject,
        body: input.body,
        body_html: null,
        external_id: null,
        external_thread_id: null,
        channel_account_id: null,
        eval_score: null,
        eval_passed: null,
        eval_notes: null,
        intent_class: null,
        intent_confidence: null,
        scheduled_at: null,
        sent_at: null,
        delivered_at: null,
        replied_at: null,
        properties: {},
        provenance: input.provenance ?? {},
        created_at: now,
      };
      messages.set(row.id, row);
      return row;
    },

    updateDraftMessage(message_id, input) {
      const row = messages.get(message_id);
      if (!row) throw new Error(`Message not found: ${message_id}`);
      row.subject = input.subject;
      row.body = input.body;
      row.properties = { ...row.properties, ...(input.properties ?? {}) };
      return row;
    },

    countPlayChannelMessages(input) {
      const sinceMs = input.since?.getTime() ?? null;
      return Array.from(messages.values()).filter((message) => {
        if (message.workspace_id !== input.workspace_id) return false;
        if (message.channel !== input.channel) return false;
        if (!input.statuses.includes(message.status)) return false;
        if (message.provenance.play_id !== input.play_id) return false;
        if (sinceMs && new Date(message.created_at).getTime() < sinceMs) return false;
        return true;
      }).length;
    },

    snapshot() {
      return {
        conversations: Array.from(conversations.values()),
        messages: Array.from(messages.values()),
        outcomes: Array.from(outcomes.values()),
      };
    },

    projectMessageLifecycleEvent(event) {
      const basePayload = event.payload as { message_id: string; channel?: string };
      const row = messages.get(basePayload.message_id);
      if (!row || row.workspace_id !== event.workspace_id) return null;
      if (row.direction !== "outbound") return null;

      if (event.event_type === "draft.judged") {
        const payload = event.payload as EventPayload<"draft.judged">;
        row.eval_score = payload.eval_score;
        row.eval_passed = payload.passed;
        row.eval_notes = { ...(row.eval_notes ?? {}), ...(payload.notes ?? {}) };
        row.properties = {
          ...row.properties,
          draft_judged_event_id: event.id,
        };
        return row;
      }

      if (event.event_type === "draft.rejected") {
        const payload = event.payload as EventPayload<"draft.rejected">;
        const notes = {
          draft_rejection_reason: payload.reason,
          draft_rejected_event_id: event.id,
        };
        row.eval_notes = { ...(row.eval_notes ?? {}), ...notes };
        row.properties = { ...row.properties, ...notes };
        return row;
      }

      if (row.channel !== basePayload.channel) return null;

      if (event.event_type === "message.queued") {
        const payload = event.payload as EventPayload<"message.queued">;
        if (!shouldKeepCurrentStatus(row.status, ["sent", ...TERMINAL_SEND_STATUSES])) {
          row.status = "queued";
        }
        row.channel_account_id = payload.channel_account_id ?? row.channel_account_id;
        row.scheduled_at = row.scheduled_at ?? payload.scheduled_at ?? event.occurred_at;
        row.properties = {
          ...row.properties,
          queued_event_id: event.id,
          ...(payload.reserved_at ? { send_reserved_at: payload.reserved_at } : {}),
        };
        return row;
      }

      if (event.event_type === "message.sent") {
        const payload = event.payload as EventPayload<"message.sent">;
        if (!shouldKeepCurrentStatus(row.status, [...TERMINAL_SEND_STATUSES])) {
          row.status = "sent";
        }
        row.external_id = payload.external_id ?? row.external_id;
        row.channel_account_id = payload.channel_account_id ?? row.channel_account_id;
        row.sent_at = row.sent_at ?? event.occurred_at;
        row.properties = {
          ...row.properties,
          sent_event_id: event.id,
          send_external_id: payload.external_id,
        };
        return row;
      }

      const payload = event.payload as EventPayload<"message.deferred">;
      if (!shouldKeepCurrentStatus(row.status, ["sent", ...TERMINAL_SEND_STATUSES])) {
        row.status = "deferred";
      }
      const notes = {
        defer_reason: payload.defer_reason,
        defer_detail: payload.detail ?? null,
        defer_event_id: event.id,
      };
      row.eval_notes = { ...(row.eval_notes ?? {}), ...notes };
      row.properties = { ...row.properties, ...notes };
      return row;
    },

    projectOutcomeLifecycleEvent(event) {
      const payload = event.payload;
      const existing = outcomes.get(payload.outcome_id);
      const row: Outcome = {
        id: payload.outcome_id,
        workspace_id: event.workspace_id,
        kind: payload.kind as Outcome["kind"],
        score: payload.score,
        conversation_id: payload.conversation_id,
        attributed_message_id: payload.attributed_message_id ?? null,
        attributed_signal_id: payload.attributed_signal_id ?? null,
        attributed_play_id: payload.attributed_play_id,
        attributed_play_run_id: payload.attributed_play_run_id ?? null,
        attributed_rep_id: payload.attributed_rep_id ?? null,
        subject_person_id: payload.subject_person_id ?? null,
        subject_company_id: payload.subject_company_id ?? null,
        properties: { ...(existing?.properties ?? {}), ...(payload.properties ?? {}) },
        provenance: {
          ...(existing?.provenance ?? {}),
          ...(payload.provenance ?? {}),
          outcome_event_id: event.id,
        },
        occurred_at: payload.occurred_at ?? event.occurred_at,
        recorded_at: existing?.recorded_at ?? event.occurred_at,
      };
      outcomes.set(row.id, row);
      return row;
    },
  };
}

export async function wireInMemoryVerticalSliceMessageLifecycleProjection(
  store: InMemoryVerticalSliceStore,
  bus: EventBus,
): Promise<Subscription[]> {
  return Promise.all([
    bus.subscribe("draft.judged", (event) => {
      store.projectMessageLifecycleEvent(event);
    }),
    bus.subscribe("draft.rejected", (event) => {
      store.projectMessageLifecycleEvent(event);
    }),
    bus.subscribe("message.queued", (event) => {
      store.projectMessageLifecycleEvent(event);
    }),
    bus.subscribe("message.sent", (event) => {
      store.projectMessageLifecycleEvent(event);
    }),
    bus.subscribe("message.deferred", (event) => {
      store.projectMessageLifecycleEvent(event);
    }),
    bus.subscribe("outcome.recorded", (event) => {
      store.projectOutcomeLifecycleEvent(event);
    }),
  ]);
}

interface RepRow {
  id: string;
  workspace_id: string;
  name: string;
  role: Rep["role"];
  status: Rep["status"];
  persona: Rep["persona"];
  channels: string[];
  autonomy: Rep["autonomy"];
  created_at: Date;
  updated_at: Date;
}

interface CompanyRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  description: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PersonRow {
  id: string;
  workspace_id: string;
  full_name: string;
  given_name: string | null;
  family_name: string | null;
  title: string | null;
  company_id: string | null;
  emails: string[];
  phones: string[];
  linkedin_url: string | null;
  x_handle: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SignalRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
  kind: Signal["kind"];
  title: string;
  content: string | null;
  url: string | null;
  novelty_key: string | null;
  novelty_score: string | null;
  freshness_at: Date;
  audience_hint: Signal["audience_hint"];
  match_score: string | null;
  match_reason: string | null;
  related_company_id: string | null;
  related_person_id: string | null;
  status: Signal["status"];
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  ingested_at: Date;
}

interface ConversationRow {
  id: string;
  workspace_id: string;
  rep_id: string;
  counterparty_person_id: string;
  counterparty_company_id: string | null;
  status: Conversation["status"];
  origin_signal_id: string | null;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  closed_at: Date | null;
  properties: Record<string, unknown>;
}

interface MessageRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  channel: Message["channel"];
  direction: Message["direction"];
  status: Message["status"];
  subject: string | null;
  body: string | null;
  body_html: string | null;
  external_id: string | null;
  external_thread_id: string | null;
  channel_account_id: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  eval_notes: Record<string, unknown> | null;
  intent_class: string | null;
  intent_confidence: string | null;
  scheduled_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  replied_at: Date | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: Date;
}

interface OutcomeRow {
  id: string;
  workspace_id: string;
  kind: Outcome["kind"];
  score: string;
  conversation_id: string | null;
  attributed_message_id: string | null;
  attributed_signal_id: string | null;
  attributed_play_id: string | null;
  attributed_play_run_id: string | null;
  attributed_rep_id: string | null;
  subject_person_id: string | null;
  subject_company_id: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  occurred_at: Date;
  recorded_at: Date;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function repFromRow(row: RepRow): Rep {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function companyFromRow(row: CompanyRow): GraphCompany {
  return {
    ...row,
    embedded_at: iso(row.embedded_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function personFromRow(row: PersonRow): GraphPerson {
  return {
    ...row,
    emails: row.emails ?? [],
    phones: row.phones ?? [],
    embedded_at: iso(row.embedded_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function signalFromRow(row: SignalRow): Signal {
  return {
    ...row,
    novelty_score: row.novelty_score == null ? null : Number(row.novelty_score),
    match_score: row.match_score == null ? null : Number(row.match_score),
    freshness_at: row.freshness_at.toISOString(),
    ingested_at: row.ingested_at.toISOString(),
  };
}

function conversationFromRow(row: ConversationRow): Conversation {
  return {
    ...row,
    started_at: row.started_at.toISOString(),
    last_activity_at: row.last_activity_at.toISOString(),
    closed_at: iso(row.closed_at),
  };
}

function messageFromRow(row: MessageRow): Message {
  return {
    ...row,
    eval_score: row.eval_score == null ? null : Number(row.eval_score),
    intent_confidence:
      row.intent_confidence == null ? null : Number(row.intent_confidence),
    scheduled_at: iso(row.scheduled_at),
    sent_at: iso(row.sent_at),
    delivered_at: iso(row.delivered_at),
    replied_at: iso(row.replied_at),
    created_at: row.created_at.toISOString(),
  };
}

function outcomeFromRow(row: OutcomeRow): Outcome {
  return {
    ...row,
    score: Number(row.score),
    occurred_at: row.occurred_at.toISOString(),
    recorded_at: row.recorded_at.toISOString(),
  };
}

export function createPostgresVerticalSliceStore(pool: Pool): VerticalSliceStore {
  return {
    async getRep(id) {
      const { rows } = await pool.query<RepRow>(
        `select id, workspace_id, name, role, status, persona, channels, autonomy,
                created_at, updated_at
           from reps where id = $1`,
        [id],
      );
      return rows[0] ? repFromRow(rows[0]) : null;
    },

    async getSignal(id) {
      const { rows } = await pool.query<SignalRow>(
        `select id, workspace_id, source_id, kind, title, content, url,
                novelty_key, novelty_score::text as novelty_score,
                freshness_at, audience_hint, match_score::text as match_score,
                match_reason, related_company_id, related_person_id, status,
                properties, provenance, ingested_at
           from signals where id = $1`,
        [id],
      );
      return rows[0] ? signalFromRow(rows[0]) : null;
    },

    async getPerson(id) {
      const { rows } = await pool.query<PersonRow>(
        `select id, workspace_id, full_name, given_name, family_name, title,
                company_id, emails, phones, linkedin_url, x_handle, properties,
                provenance, embedded_at, created_at, updated_at
           from graph_persons where id = $1`,
        [id],
      );
      return rows[0] ? personFromRow(rows[0]) : null;
    },

    async getCompany(id) {
      if (!id) return null;
      const { rows } = await pool.query<CompanyRow>(
        `select id, workspace_id, name, domain::text as domain, industry,
                size_bucket, description, properties, provenance, embedded_at,
                created_at, updated_at
           from graph_companies where id = $1`,
        [id],
      );
      return rows[0] ? companyFromRow(rows[0]) : null;
    },

    async getMessage(id) {
      const { rows } = await pool.query<MessageRow>(
        `select id, workspace_id, conversation_id, channel, direction, status,
                subject, body, body_html, external_id, external_thread_id,
                channel_account_id, eval_score::text as eval_score, eval_passed,
                eval_notes, intent_class, intent_confidence::text as intent_confidence,
                scheduled_at, sent_at, delivered_at, replied_at, properties,
                provenance, created_at
           from messages
          where id = $1`,
        [id],
      );
      return rows[0] ? messageFromRow(rows[0]) : null;
    },

    async upsertCompany(input) {
      const { rows } = await pool.query<CompanyRow>(
        `insert into graph_companies (
           id, workspace_id, name, domain, industry, size_bucket, description,
           properties, provenance, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
         on conflict (workspace_id, domain) where domain is not null
         do update set
           name = excluded.name,
           industry = coalesce(excluded.industry, graph_companies.industry),
           size_bucket = coalesce(excluded.size_bucket, graph_companies.size_bucket),
           description = coalesce(excluded.description, graph_companies.description),
           properties = graph_companies.properties || excluded.properties,
           provenance = excluded.provenance,
           updated_at = excluded.updated_at
         returning id, workspace_id, name, domain::text as domain, industry,
                   size_bucket, description, properties, provenance, embedded_at,
                   created_at, updated_at`,
        [
          input.id,
          input.workspace_id,
          input.name,
          input.domain,
          input.industry,
          input.size_bucket,
          input.description,
          JSON.stringify(input.properties),
          JSON.stringify(input.provenance),
          input.created_at,
          input.updated_at,
        ],
      );
      return companyFromRow(rows[0]!);
    },

    async upsertPerson(input) {
      const existing = await pool.query<{ id: string }>(
        `select id from graph_persons
          where workspace_id = $1
            and (
              id = $2
              or (cardinality($3::citext[]) > 0 and emails && $3::citext[])
              or ($4::uuid is not null and company_id = $4 and lower(full_name) = lower($5))
            )
          order by created_at asc
          limit 1`,
        [input.workspace_id, input.id, input.emails, input.company_id, input.full_name],
      );
      if (existing.rows[0]) {
        const { rows } = await pool.query<PersonRow>(
          `update graph_persons set
             full_name = $2,
             given_name = coalesce($3, given_name),
             family_name = coalesce($4, family_name),
             title = coalesce($5, title),
             company_id = coalesce($6, company_id),
             emails = (
               select coalesce(array_agg(distinct e), array[]::citext[])
                 from unnest(graph_persons.emails || $7::citext[]) as e
             ),
             phones = (
               select coalesce(array_agg(distinct p), array[]::text[])
                 from unnest(graph_persons.phones || $8::text[]) as p
             ),
             linkedin_url = coalesce($9, linkedin_url),
             x_handle = coalesce($10, x_handle),
             properties = properties || $11::jsonb,
             provenance = $12::jsonb,
             updated_at = $13
           where id = $1
         returning id, workspace_id, full_name, given_name, family_name, title,
                   company_id, emails::text[] as emails, phones, linkedin_url,
                   x_handle::text as x_handle, properties, provenance,
                   embedded_at, created_at, updated_at`,
          [
            existing.rows[0].id,
            input.full_name,
            input.given_name,
            input.family_name,
            input.title,
            input.company_id,
            input.emails,
            input.phones,
            input.linkedin_url,
            input.x_handle,
            JSON.stringify(input.properties),
            JSON.stringify(input.provenance),
            input.updated_at,
          ],
        );
        return personFromRow(rows[0]!);
      }

      const { rows } = await pool.query<PersonRow>(
        `insert into graph_persons (
           id, workspace_id, full_name, given_name, family_name, title,
           company_id, emails, phones, linkedin_url, x_handle, properties,
           provenance, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8::citext[], $9::text[], $10, $11,
           $12::jsonb, $13::jsonb, $14, $15
         )
         on conflict (id) do update set
           full_name = excluded.full_name,
           given_name = excluded.given_name,
           family_name = excluded.family_name,
           title = excluded.title,
           company_id = excluded.company_id,
           emails = excluded.emails,
           phones = excluded.phones,
           linkedin_url = excluded.linkedin_url,
           x_handle = excluded.x_handle,
           properties = excluded.properties,
           provenance = excluded.provenance,
           updated_at = excluded.updated_at
         returning id, workspace_id, full_name, given_name, family_name, title,
                   company_id, emails::text[] as emails, phones, linkedin_url,
                   x_handle::text as x_handle, properties, provenance,
                   embedded_at, created_at, updated_at`,
        [
          input.id,
          input.workspace_id,
          input.full_name,
          input.given_name,
          input.family_name,
          input.title,
          input.company_id,
          input.emails,
          input.phones,
          input.linkedin_url,
          input.x_handle,
          JSON.stringify(input.properties),
          JSON.stringify(input.provenance),
          input.created_at,
          input.updated_at,
        ],
      );
      return personFromRow(rows[0]!);
    },

    async upsertSignal(input) {
      const { rows } = await pool.query<SignalRow>(
        `insert into signals (
           id, workspace_id, source_id, kind, title, content, url, novelty_key,
           novelty_score, freshness_at, audience_hint, match_score, match_reason,
           related_company_id, related_person_id, status, properties, provenance,
           ingested_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
           $14, $15, $16, $17::jsonb, $18::jsonb, $19
         )
         on conflict (id) do update set
           title = excluded.title,
           content = excluded.content,
           novelty_score = excluded.novelty_score,
           audience_hint = excluded.audience_hint,
           match_score = excluded.match_score,
           match_reason = excluded.match_reason,
           related_company_id = excluded.related_company_id,
           related_person_id = excluded.related_person_id,
           status = excluded.status,
           properties = excluded.properties,
           provenance = excluded.provenance
         returning id, workspace_id, source_id, kind, title, content, url,
                   novelty_key, novelty_score::text as novelty_score,
                   freshness_at, audience_hint, match_score::text as match_score,
                   match_reason, related_company_id, related_person_id, status,
                   properties, provenance, ingested_at`,
        [
          input.id,
          input.workspace_id,
          input.source_id,
          input.kind,
          input.title,
          input.content,
          input.url,
          input.novelty_key,
          input.novelty_score,
          input.freshness_at,
          JSON.stringify(input.audience_hint),
          input.match_score,
          input.match_reason,
          input.related_company_id,
          input.related_person_id,
          input.status,
          JSON.stringify(input.properties),
          JSON.stringify(input.provenance),
          input.ingested_at,
        ],
      );
      return signalFromRow(rows[0]!);
    },

    async createConversation(input) {
      const { rows } = await pool.query<ConversationRow>(
        `insert into conversations (
           workspace_id, rep_id, counterparty_person_id, counterparty_company_id,
           origin_signal_id, topic, status, properties
         ) values ($1, $2, $3, $4, $5, $6, 'open', '{}'::jsonb)
         returning id, workspace_id, rep_id, counterparty_person_id,
                   counterparty_company_id, status, origin_signal_id, topic,
                   started_at, last_activity_at, closed_at, properties`,
        [
          input.workspace_id,
          input.rep_id,
          input.counterparty_person_id,
          input.counterparty_company_id ?? null,
          input.origin_signal_id ?? null,
          input.topic ?? null,
        ],
      );
      return conversationFromRow(rows[0]!);
    },

    async createDraftMessage(input) {
      const { rows } = await pool.query<MessageRow>(
        `insert into messages (
           workspace_id, conversation_id, channel, direction, status, subject,
           body, provenance, properties
         ) values ($1, $2, 'email', 'outbound', 'draft', $3, $4, $5::jsonb, '{}'::jsonb)
         returning id, workspace_id, conversation_id, channel, direction, status,
                   subject, body, body_html, external_id, external_thread_id,
                   channel_account_id, eval_score::text as eval_score, eval_passed,
                   eval_notes, intent_class, intent_confidence::text as intent_confidence,
                   scheduled_at, sent_at, delivered_at, replied_at, properties,
                   provenance, created_at`,
        [
          input.workspace_id,
          input.conversation_id,
          input.subject,
          input.body,
          JSON.stringify(input.provenance ?? {}),
        ],
      );
      return messageFromRow(rows[0]!);
    },

    async updateDraftMessage(message_id, input) {
      const { rows } = await pool.query<MessageRow>(
        `update messages
            set subject = $2,
                body = $3,
                properties = properties || $4::jsonb
          where id = $1 and status = 'draft'
        returning id, workspace_id, conversation_id, channel, direction, status,
                  subject, body, body_html, external_id, external_thread_id,
                  channel_account_id, eval_score::text as eval_score, eval_passed,
                  eval_notes, intent_class, intent_confidence::text as intent_confidence,
                  scheduled_at, sent_at, delivered_at, replied_at, properties,
                  provenance, created_at`,
        [
          message_id,
          input.subject,
          input.body,
          JSON.stringify(input.properties ?? {}),
        ],
      );
      if (!rows[0]) throw new Error(`Message not found: ${message_id}`);
      return messageFromRow(rows[0]);
    },

    async countPlayChannelMessages(input) {
      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count
           from messages
          where workspace_id = $1
            and channel = $2
            and direction = 'outbound'
            and status = any($3::message_status[])
            and provenance->>'play_id' = $4
            and ($5::timestamptz is null or created_at >= $5)`,
        [
          input.workspace_id,
          input.channel,
          input.statuses,
          input.play_id,
          input.since ?? null,
        ],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async snapshot() {
      const [conv, msg, out] = await Promise.all([
        pool.query<ConversationRow>(
          `select id, workspace_id, rep_id, counterparty_person_id,
                  counterparty_company_id, status, origin_signal_id, topic,
                  started_at, last_activity_at, closed_at, properties
             from conversations order by started_at desc limit 50`,
        ),
        pool.query<MessageRow>(
          `select id, workspace_id, conversation_id, channel, direction, status,
                  subject, body, body_html, external_id, external_thread_id,
                  channel_account_id, eval_score::text as eval_score, eval_passed,
                  eval_notes, intent_class, intent_confidence::text as intent_confidence,
                  scheduled_at, sent_at, delivered_at, replied_at, properties,
                  provenance, created_at
             from messages order by created_at desc limit 50`,
        ),
        pool.query<OutcomeRow>(
          `select id, workspace_id, kind, score::text as score, conversation_id,
                  attributed_message_id, attributed_signal_id, attributed_play_id,
                  attributed_play_run_id, attributed_rep_id, subject_person_id,
                  subject_company_id, properties, provenance, occurred_at, recorded_at
             from outcomes order by recorded_at desc limit 50`,
        ),
      ]);
      return {
        conversations: conv.rows.map(conversationFromRow),
        messages: msg.rows.map(messageFromRow),
        outcomes: out.rows.map(outcomeFromRow),
      };
    },
  };
}
