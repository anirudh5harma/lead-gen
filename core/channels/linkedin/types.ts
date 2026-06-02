import type {
  Channel,
  ChannelConversation,
  ChannelDraft,
  ChannelSendContext,
  ChannelSendResult,
} from "../types.ts";

export type LinkedInChannelName =
  | "linkedin_connection"
  | "linkedin_dm"
  | "linkedin_comment";

export interface LinkedInSessionAccount {
  id: string;
  display_name: string;
  kind: "linkedin_session" | "linkedin_oauth";
  status: "connected" | "needs_reauth" | "rate_limited" | "suspended" | "disconnected";
  daily_cap: number;
  daily_used: number;
}

export interface LinkedInSendEnvelope {
  action: LinkedInChannelName;
  account_id: string;
  from: string;
  target_profile_url: string;
  body: string;
}

export interface LinkedInTransportResult {
  external_id: string;
}

export type LinkedInTransportErrorReason =
  | "rate_limited"
  | "needs_reauth"
  | "suspended"
  | "disconnected"
  | "provider_error_transient"
  | "provider_error_permanent";

export class LinkedInTransportError extends Error {
  readonly reason: LinkedInTransportErrorReason;
  readonly retry_after: string | null;
  readonly detail: string | null;

  constructor(
    reason: LinkedInTransportErrorReason,
    message: string,
    opts: { retry_after?: string | null; detail?: string | null } = {},
  ) {
    super(message);
    this.name = "LinkedInTransportError";
    this.reason = reason;
    this.retry_after = opts.retry_after ?? null;
    this.detail = opts.detail ?? null;
  }
}

export interface LinkedInTransport {
  send(envelope: LinkedInSendEnvelope): Promise<LinkedInTransportResult>;
}

export interface LinkedInChannelOptions {
  action: LinkedInChannelName;
  accounts: LinkedInSessionAccount[];
  transport: LinkedInTransport;
  now?: () => Date;
}

export interface LinkedInChannel extends Channel {
  readonly name: LinkedInChannelName;
}

export type {
  ChannelConversation,
  ChannelDraft,
  ChannelSendContext,
  ChannelSendResult,
};
