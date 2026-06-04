/**
 * Email channel types. Per ARCHITECTURE.md "Channels", every channel
 * exposes a single contract:
 *
 *   send(conversation, draft) -> MessageId | DeferReason
 *
 * The email channel has two sub-channels with VERY different reputation
 * games:
 *
 *   - owned_domain : optional workspace-owned managed domains. Warmup state
 *                    machine, SPF/DKIM/DMARC, per-domain volume curves,
 *                    bounce/complaint feedback. SES is only one possible
 *                    adapter, not the launch-critical path.
 *
 *   - oauth_outlook : the user's Outlook / Microsoft 365 inbox via OAuth
 *                     + Microsoft Graph. High-touch / founder-led sends
 *                     only, capped tight to protect the user's reputation.
 *
 * Gmail is intentionally not supported (ARCHITECTURE.md). Transactional
 * email (receipts, lifecycle, password reset) is a separate concern in
 * `transactional.ts` and is NOT a channel a Rep can call — different
 * reputation, different code path.
 */

import type { Channel } from "../types.ts";

export type EmailSubChannel = "owned_domain" | "oauth_outlook";

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailDraft {
  to: EmailAddress;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body_text: string;
  body_html?: string;
  reply_to?: EmailAddress;
  /** For threading replies (RFC 5322 In-Reply-To header). */
  in_reply_to?: string;
  /** For threading replies (RFC 5322 References header). */
  references?: string[];
  /** Additional headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
}

/**
 * Typed reasons for a send to be deferred rather than sent. Every defer
 * lands on the bus as a `message.deferred` event so workflows can react
 * (park, retry, escalate, swap channel).
 */
export type DeferReason =
  | "not_judged"
  | "judge_failed"
  | "daily_cap_reached"
  | "domain_frozen"
  | "domain_not_ready"
  | "domain_warmup_too_early"
  | "frequency_cap_reached"
  | "account_disconnected"
  | "account_rate_limited"
  | "missing_credentials"
  | "provider_error_transient"
  | "provider_error_permanent";

export type SendResult =
  | {
      status: "sent";
      message_id: string;
      external_id: string;
      sub_channel: EmailSubChannel;
    }
  | {
      status: "deferred";
      message_id: string;
      reason: DeferReason;
      detail?: string;
      retry_after?: string; // ISO timestamp
    };

export interface SendOptions {
  workspace_id: string;
  rep_id: string;
  conversation_id: string;
  /** Pre-created `messages` row id. Must already have a judged + passed eval. */
  message_id: string;
  /** Selected by upstream policy. Must match the sub_channel. */
  channel_account_id: string;
  sub_channel: EmailSubChannel;
  draft: EmailDraft;
  /** For owned_domain only: the sending domain to use. */
  sending_domain_id?: string;
}

export interface BounceEvent {
  workspace_id: string;
  external_id: string;
  bounce_type: "hard" | "soft" | "complaint";
  recipient: string;
  detail?: string;
}

export type EmailChannel = Channel;

export interface EmailTransportResult {
  external_id: string;
}

export interface EmailSendEnvelope {
  from: string;
  to: string;
  subject: string;
  body: string;
  account_id: string;
  idempotency_key: string;
}

export interface EmailTransport {
  send(envelope: EmailSendEnvelope): Promise<EmailTransportResult>;
}

export interface EmailChannelAccount {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number;
  daily_used: number;
}

export interface EmailChannelOptions {
  accounts: EmailChannelAccount[];
  transport: EmailTransport;
  now?: () => Date;
}
