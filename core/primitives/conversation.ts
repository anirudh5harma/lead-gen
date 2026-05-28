import { z } from "zod";

/**
 * Conversation — a durable thread across one or many channels with one
 * counterparty. The atom of CRM in pivot-v2. One of the five primitives.
 * See ARCHITECTURE.md and db/migrations/007_primitive_conversation.sql.
 */

export const ConversationStatus = z.enum([
  "open",
  "awaiting_them",
  "awaiting_us",
  "paused",
  "closed_positive",
  "closed_negative",
  "closed_no_response",
]);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

export const MessageChannel = z.enum([
  "email",
  "linkedin_dm",
  "linkedin_inmail",
  "linkedin_connection",
  "linkedin_comment",
  "x_dm",
  "x_post",
  "x_reply",
  "voice",
  "video",
  "web",
  "other",
]);
export type MessageChannel = z.infer<typeof MessageChannel>;

export const MessageDirection = z.enum(["outbound", "inbound"]);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const MessageStatus = z.enum([
  "draft",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "replied",
  "failed",
  "deferred",
]);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const Conversation = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  counterparty_person_id: z.string().uuid(),
  counterparty_company_id: z.string().uuid().nullable(),
  status: ConversationStatus,
  origin_signal_id: z.string().uuid().nullable(),
  topic: z.string().nullable(),
  started_at: z.string().datetime(),
  last_activity_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type Conversation = z.infer<typeof Conversation>;

export const Message = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  channel: MessageChannel,
  direction: MessageDirection,
  status: MessageStatus,
  subject: z.string().nullable(),
  body: z.string().nullable(),
  body_html: z.string().nullable(),
  external_id: z.string().nullable(),
  external_thread_id: z.string().nullable(),
  channel_account_id: z.string().uuid().nullable(),
  eval_score: z.number().min(0).max(1).nullable(),
  eval_passed: z.boolean().nullable(),
  eval_notes: z.record(z.string(), z.unknown()).nullable(),
  intent_class: z.string().nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  scheduled_at: z.string().datetime().nullable(),
  sent_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  replied_at: z.string().datetime().nullable(),
  properties: z.record(z.string(), z.unknown()).default({}),
  provenance: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});
export type Message = z.infer<typeof Message>;
