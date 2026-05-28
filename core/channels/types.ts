import type { EventBus } from "../substrate/events/index.ts";

export interface ChannelConversation {
  id: string;
  workspace_id: string;
  rep_id: string;
  counterparty_person_id: string;
  counterparty_email?: string | null;
  counterparty_linkedin_url?: string | null;
  topic?: string | null;
}

export interface ChannelDraft {
  message_id: string;
  channel: string;
  subject?: string | null;
  body: string;
  eval_passed: boolean;
  eval_score?: number | null;
}

export interface ChannelSendContext {
  workspace_id: string;
  bus: EventBus;
  correlation_id?: string | null;
  producer_ref?: string | null;
}

export interface ChannelSendSuccess {
  status: "sent" | "queued";
  message_id: string;
  external_id: string | null;
}

export interface ChannelSendDeferred {
  status: "deferred";
  message_id: string;
  defer_reason: string;
  retry_after: string | null;
}

export type ChannelSendResult = ChannelSendSuccess | ChannelSendDeferred;

export interface Channel {
  readonly name: string;
  send(
    conversation: ChannelConversation,
    draft: ChannelDraft,
    ctx: ChannelSendContext,
  ): Promise<ChannelSendResult>;
}
