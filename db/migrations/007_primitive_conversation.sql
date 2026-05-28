-- 007_primitive_conversation.sql
-- Conversation primitive: a durable thread across one or many channels with
-- one counterparty. The atom of CRM in pivot-v2.
--
-- A Conversation is owned by a Rep (rep_id) and is anchored to a Person
-- (counterparty_person_id). Messages are channel-typed and can span email,
-- LinkedIn, X, voice, video, etc., all under the same conversation.

create type conversation_status as enum (
  'open',
  'awaiting_them',
  'awaiting_us',
  'paused',
  'closed_positive',
  'closed_negative',
  'closed_no_response'
);

create type message_channel as enum (
  'email',
  'linkedin_dm',
  'linkedin_inmail',
  'linkedin_connection',
  'linkedin_comment',
  'x_dm',
  'x_post',
  'x_reply',
  'voice',
  'video',
  'web',
  'other'
);

create type message_direction as enum ('outbound', 'inbound');

create type message_status as enum (
  'draft',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'replied',
  'failed',
  'deferred'             -- channel deferred for warmup / cap / safety reasons
);

-- Conversations --------------------------------------------------------------

create table conversations (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,

  rep_id                   uuid not null,                            -- FK added in 008_primitive_rep.sql
  counterparty_person_id   uuid not null references graph_persons(id) on delete cascade,
  counterparty_company_id  uuid references graph_companies(id) on delete set null,

  status                   conversation_status not null default 'open',

  -- The signal that started this conversation, when applicable.
  origin_signal_id         uuid references signals(id) on delete set null,

  -- Subject / topic. Helps cross-channel continuity ("re: your TechCrunch coverage").
  topic                    text,

  started_at               timestamptz not null default now(),
  last_activity_at         timestamptz not null default now(),
  closed_at                timestamptz,

  properties               jsonb not null default '{}'::jsonb
);

create index conversations_workspace_status_idx
  on conversations (workspace_id, status, last_activity_at desc);

create index conversations_workspace_rep_idx
  on conversations (workspace_id, rep_id, last_activity_at desc);

create index conversations_workspace_person_idx
  on conversations (workspace_id, counterparty_person_id);

-- Messages -------------------------------------------------------------------

create table messages (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  conversation_id   uuid not null references conversations(id) on delete cascade,

  channel           message_channel not null,
  direction         message_direction not null,
  status            message_status not null default 'draft',

  subject           text,
  body              text,
  body_html         text,

  -- External identifiers from the channel (Gmail message-id, LinkedIn URN, etc.).
  external_id       text,
  external_thread_id text,

  -- The channel account that produced (outbound) or received (inbound) this
  -- message. FK added in 011_channel_accounts.sql.
  channel_account_id uuid,

  -- Eval gate output (hot-path judge). Sub-threshold drafts never reach the channel.
  eval_score        numeric(5,4),
  eval_passed       boolean,
  eval_notes        jsonb,

  -- For inbound: classification result (positive / negative / neutral / oof / unsubscribe).
  intent_class      text,
  intent_confidence numeric(5,4),

  scheduled_at      timestamptz,
  sent_at           timestamptz,
  delivered_at      timestamptz,
  replied_at        timestamptz,

  properties        jsonb not null default '{}'::jsonb,
  provenance        jsonb not null default '{}'::jsonb,

  embedding         vector(1536),
  embedded_at       timestamptz,

  created_at        timestamptz not null default now()
);

create index messages_workspace_conversation_idx
  on messages (workspace_id, conversation_id, created_at);

create index messages_workspace_status_idx
  on messages (workspace_id, status, created_at desc);

create index messages_external_id_idx
  on messages (workspace_id, channel, external_id)
  where external_id is not null;

create index messages_external_thread_idx
  on messages (workspace_id, channel, external_thread_id)
  where external_thread_id is not null;

create index messages_embedding_idx
  on messages using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
