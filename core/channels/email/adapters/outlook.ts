import type { Pool } from "pg";
import type { EmailDraft } from "../types.ts";

/**
 * Outlook / Microsoft 365 adapter. The user connects their inbox via
 * OAuth (Microsoft Identity v2 endpoint); we store refresh + access tokens
 * encrypted in `channel_accounts.credentials`. Sends go through
 * Microsoft Graph: POST https://graph.microsoft.com/v1.0/me/sendMail.
 *
 * High-touch use only. Daily cap enforced by `caps.ts`, NOT by this
 * adapter — the adapter is a thin send.
 *
 * Gmail is intentionally not supported (ARCHITECTURE.md).
 *
 * Token refresh: when access_token is expired (or close to it), POST the
 * refresh_token grant to Microsoft's token endpoint, persist the new
 * tokens back into channel_accounts.credentials, then send.
 *
 * Tests inject `fetchImpl`; production uses globalThis.fetch.
 */

const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SEND_MAIL_ENDPOINT = "https://graph.microsoft.com/v1.0/me/sendMail";

export interface OutlookCredentials {
  access_token: string;
  refresh_token: string;
  /** ISO timestamp. */
  expires_at: string;
}

export interface OutlookSenderOptions {
  pool: Pool;
  /** Microsoft app registration. */
  clientId: string;
  clientSecret: string;
  /** Scopes; default 'https://graph.microsoft.com/.default offline_access'. */
  scope?: string;
  /** Skew (ms) — refresh tokens that expire within this. Default 60_000. */
  refreshSkewMs?: number;
  /** Inject a fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface OutlookSendInput {
  channel_account_id: string;
  draft: EmailDraft;
}

export interface OutlookSender {
  send(input: OutlookSendInput): Promise<{ external_id: string }>;
}

interface ChannelAccountRow {
  credentials: OutlookCredentials | null;
  display_name: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface SendMailErrorBody {
  error?: { code?: string; message?: string };
}

function addressBlock(addr: { email: string; name?: string }) {
  return {
    emailAddress: {
      address: addr.email,
      name: addr.name,
    },
  };
}

export class OutlookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlookAuthError";
  }
}

export class OutlookSendError extends Error {
  readonly status: number;
  readonly graphCode?: string;
  constructor(message: string, status: number, graphCode?: string) {
    super(message);
    this.name = "OutlookSendError";
    this.status = status;
    this.graphCode = graphCode;
  }
}

export function createOutlookSender(opts: OutlookSenderOptions): OutlookSender {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const skew = opts.refreshSkewMs ?? 60_000;
  const scope = opts.scope ?? "https://graph.microsoft.com/.default offline_access";

  async function loadCredentials(channel_account_id: string): Promise<OutlookCredentials> {
    const { rows } = await opts.pool.query<ChannelAccountRow>(
      `select credentials, display_name from channel_accounts
        where id = $1 and kind = 'oauth_outlook'`,
      [channel_account_id],
    );
    const row = rows[0];
    if (!row || !row.credentials) {
      throw new OutlookAuthError(
        `channel_account ${channel_account_id} has no Outlook credentials`,
      );
    }
    return row.credentials;
  }

  async function persistCredentials(
    channel_account_id: string,
    next: OutlookCredentials,
  ): Promise<void> {
    await opts.pool.query(
      `update channel_accounts
          set credentials = $2::jsonb,
              status = 'connected',
              last_error = null
        where id = $1`,
      [channel_account_id, JSON.stringify(next)],
    );
  }

  async function refreshIfNeeded(
    channel_account_id: string,
    creds: OutlookCredentials,
  ): Promise<OutlookCredentials> {
    const expiresAt = Date.parse(creds.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > skew) {
      return creds;
    }

    const body = new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
      scope,
    });

    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text();
      // 400 from the token endpoint with `invalid_grant` means the user
      // revoked access or the refresh token expired. Mark the account
      // disconnected so the channel surfaces a clear DeferReason.
      if (response.status === 400) {
        await opts.pool.query(
          `update channel_accounts
              set status = 'needs_reauth',
                  last_error = $2::jsonb
            where id = $1`,
          [channel_account_id, JSON.stringify({ message: text })],
        );
      }
      throw new OutlookAuthError(
        `Outlook token refresh failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    const json = (await response.json()) as TokenResponse;
    const refreshed: OutlookCredentials = {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? creds.refresh_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    };
    await persistCredentials(channel_account_id, refreshed);
    return refreshed;
  }

  return {
    async send({ channel_account_id, draft }): Promise<{ external_id: string }> {
      const initial = await loadCredentials(channel_account_id);
      const creds = await refreshIfNeeded(channel_account_id, initial);

      const message = {
        message: {
          subject: draft.subject,
          body: {
            contentType: draft.body_html ? "HTML" : "Text",
            content: draft.body_html ?? draft.body_text,
          },
          toRecipients: [addressBlock(draft.to)],
          ccRecipients: draft.cc?.map(addressBlock),
          bccRecipients: draft.bcc?.map(addressBlock),
          replyTo: draft.reply_to ? [addressBlock(draft.reply_to)] : undefined,
          internetMessageHeaders: draft.headers
            ? Object.entries(draft.headers).map(([name, value]) => ({
                name,
                value,
              }))
            : undefined,
        },
        saveToSentItems: true,
      };

      const response = await fetchImpl(SEND_MAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (response.status === 202) {
        // Graph's sendMail returns 202 Accepted with no body. The Graph
        // API does not surface the resulting message id synchronously; we
        // synthesise one from the request id header so the message has a
        // stable external_id for the conversation thread.
        const requestId = response.headers.get("request-id") ?? `outlook-${Date.now()}`;
        return { external_id: requestId };
      }

      const text = await response.text();
      let graphCode: string | undefined;
      try {
        graphCode = (JSON.parse(text) as SendMailErrorBody).error?.code;
      } catch {
        /* not JSON */
      }
      throw new OutlookSendError(
        `Outlook sendMail failed (${response.status}): ${text.slice(0, 300)}`,
        response.status,
        graphCode,
      );
    },
  };
}
