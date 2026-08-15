import type { Pool, PoolClient } from "pg";
import { decryptCredentials, encryptCredentials } from "../../../substrate/auth/index.ts";
import type { EventBus } from "../../../substrate/events/index.ts";
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
 * refresh_token grant to Microsoft's token endpoint and publish the encrypted
 * result. The email projector owns channel_accounts state mutation.
 *
 * Tests inject `fetchImpl`; production uses globalThis.fetch.
 */

const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SEND_MAIL_ENDPOINT = "https://graph.microsoft.com/v1.0/me/sendMail";
const SENT_ITEMS_ENDPOINT =
  "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages";
export const BOMBSELL_MESSAGE_ID_HEADER = "x-bombsell-message-id";
const DEFAULT_REFRESH_SCOPE =
  "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadBasic https://graph.microsoft.com/User.Read";

export interface OutlookCredentials {
  access_token: string;
  refresh_token: string;
  scope?: string;
  /** ISO timestamp. */
  expires_at: string;
}

export interface OutlookSenderOptions {
  pool: Pool;
  bus: EventBus;
  /** Microsoft app registration. */
  clientId: string;
  clientSecret: string;
  /** Scopes; default mail-only launch scopes. */
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

export interface OutlookAccessTokenProvider {
  getAccessToken(channel_account_id: string): Promise<string>;
}

export interface OutlookSender extends OutlookAccessTokenProvider {
  send(input: OutlookSendInput): Promise<{
    status: "accepted";
    request_id: string;
  }>;
  confirmSent(input: {
    channel_account_id: string;
    marker: string;
    attempts?: number;
  }): Promise<string | null>;
}

interface ChannelAccountRow {
  workspace_id: string;
  credentials: unknown;
  display_name: string;
  status: string;
}

interface CredentialLifecycleRow {
  id: string;
  event_type:
    | "email.outlook.authorization.received"
    | "email.outlook.credentials.refreshed"
    | "email.outlook.reauthorization.required";
  correlation_id: string | null;
  payload: unknown;
}

interface CredentialSnapshot {
  workspace_id: string;
  credentials: OutlookCredentials;
  origin_event_id: string | null;
  correlation_id: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

interface SendMailErrorBody {
  error?: { code?: string; message?: string };
}

interface GraphSentMessage {
  id?: string;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
}

export async function confirmOutlookSentMessage(input: {
  accessToken: string;
  marker: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
}): Promise<string | null> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const attempts = Math.max(1, Math.min(8, Math.trunc(input.attempts ?? 4)));
  const query = new URLSearchParams({
    "$top": "25",
    "$select": "id,internetMessageId,internetMessageHeaders,sentDateTime",
    "$orderby": "sentDateTime desc",
  });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    try {
      const response = await fetchImpl(`${SENT_ITEMS_ENDPOINT}?${query}`, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        if (response.status === 401 || response.status === 403) {
          throw new OutlookAuthError(
            `Outlook Sent Items authorization failed (${response.status}): ${detail}`,
          );
        }
        throw new OutlookSendError(
          `Outlook Sent Items lookup failed (${response.status}): ${detail}`,
          response.status,
        );
      }
      const body = await response.json() as { value?: GraphSentMessage[] };
      const message = body.value?.find((candidate) =>
        candidate.internetMessageHeaders?.some((header) =>
          header.name?.toLowerCase() === BOMBSELL_MESSAGE_ID_HEADER &&
          header.value === input.marker
        )
      );
      if (message) return message.internetMessageId ?? message.id ?? null;
    } catch (error) {
      if (error instanceof OutlookAuthError || error instanceof OutlookSendError) {
        throw error;
      }
      if (attempt === attempts - 1) throw error;
    }
  }
  return null;
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

export function isOutlookRefreshReauthorizationError(
  status: number,
  body: string,
): boolean {
  if (status !== 400) return false;
  return /invalid_grant|AADSTS50173|AADSTS70008[24]/i.test(body);
}

export function createOutlookSender(opts: OutlookSenderOptions): OutlookSender {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const skew = opts.refreshSkewMs ?? 60_000;
  const scope = opts.scope ?? DEFAULT_REFRESH_SCOPE;

  async function loadCredentials(
    db: Pool | PoolClient,
    channel_account_id: string,
  ): Promise<CredentialSnapshot> {
    const { rows } = await db.query<ChannelAccountRow>(
      `select workspace_id, credentials, display_name, status::text as status
         from channel_accounts
        where id = $1 and kind = 'oauth_outlook'`,
      [channel_account_id],
    );
    const row = rows[0];
    if (!row || !row.credentials) {
      throw new OutlookAuthError(
        `channel_account ${channel_account_id} has no Outlook credentials`,
      );
    }
    const { rows: eventRows } = await db.query<CredentialLifecycleRow>(
      `select id, event_type, correlation_id, payload
         from events
        where workspace_id = $1
          and event_type in (
            'email.outlook.authorization.received',
            'email.outlook.credentials.refreshed',
            'email.outlook.reauthorization.required'
          )
          and payload ->> 'channel_account_id' = $2
        order by occurred_at desc
        limit 1`,
      [row.workspace_id, channel_account_id],
    );
    const latest = eventRows[0];
    if (latest?.event_type === "email.outlook.reauthorization.required") {
      throw new OutlookAuthError(
        `channel_account ${channel_account_id} requires Outlook reauthorization`,
      );
    }
    if (!latest && row.status === "needs_reauth") {
      throw new OutlookAuthError(
        `channel_account ${channel_account_id} requires Outlook reauthorization`,
      );
    }
    const encryptedCredentials =
      latest?.event_type === "email.outlook.authorization.received" ||
      latest?.event_type === "email.outlook.credentials.refreshed"
        ? (latest.payload as { encrypted_credentials: unknown }).encrypted_credentials
        : row.credentials;
    return {
      workspace_id: row.workspace_id,
      credentials: decryptCredentials<OutlookCredentials>(encryptedCredentials, {
        workspace_id: row.workspace_id,
        channel_account_id,
      }),
      origin_event_id: latest?.id ?? null,
      correlation_id: latest?.correlation_id ?? latest?.id ?? null,
    };
  }

  function requiresRefresh(creds: OutlookCredentials): boolean {
    const expiresAt = Date.parse(creds.expires_at);
    return Number.isFinite(expiresAt) && expiresAt - Date.now() <= skew;
  }

  async function publishCredentialsRefreshed(
    channel_account_id: string,
    snapshot: CredentialSnapshot,
    next: OutlookCredentials,
  ): Promise<void> {
    const protectedCredentials = encryptCredentials(next, {
      workspace_id: snapshot.workspace_id,
      channel_account_id,
    });
    await opts.bus.publish({
      workspace_id: snapshot.workspace_id,
      event_type: "email.outlook.credentials.refreshed",
      source: "system",
      producer_ref: "channel:outlook",
      correlation_id: snapshot.correlation_id,
      causation_id: snapshot.origin_event_id,
      idempotency_key: `outlook-refresh:${channel_account_id}:${next.expires_at}`,
      payload: {
        channel_account_id,
        encrypted_credentials: protectedCredentials,
        expires_at: next.expires_at,
      },
    });
  }

  async function refreshIfNeeded(
    channel_account_id: string,
    snapshot: CredentialSnapshot,
  ): Promise<OutlookCredentials> {
    if (!requiresRefresh(snapshot.credentials)) {
      return snapshot.credentials;
    }

    const body = new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: "refresh_token",
      refresh_token: snapshot.credentials.refresh_token,
      scope: snapshot.credentials.scope ?? scope,
    });

    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text();
      // Only revoked / expired refresh-token failures should disturb the user.
      // Other token-endpoint 400s are operator/configuration errors and should
      // remain account errors, not reconnect prompts.
      if (isOutlookRefreshReauthorizationError(response.status, text)) {
        await opts.bus.publish({
          workspace_id: snapshot.workspace_id,
          event_type: "email.outlook.reauthorization.required",
          source: "system",
          producer_ref: "channel:outlook",
          correlation_id: snapshot.correlation_id,
          causation_id: snapshot.origin_event_id,
          idempotency_key:
            `outlook-reauth-required:${channel_account_id}:` +
            `${snapshot.origin_event_id ?? "legacy"}`,
          payload: {
            channel_account_id,
            error: text.slice(0, 300),
          },
        });
      }
      throw new OutlookAuthError(
        `Outlook token refresh failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    const json = (await response.json()) as TokenResponse;
    const refreshed: OutlookCredentials = {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? snapshot.credentials.refresh_token,
      scope: json.scope ?? snapshot.credentials.scope,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    };
    await publishCredentialsRefreshed(channel_account_id, snapshot, refreshed);
    return refreshed;
  }

  async function getAccessToken(channel_account_id: string): Promise<string> {
    const initial = await loadCredentials(opts.pool, channel_account_id);
    if (!requiresRefresh(initial.credentials)) return initial.credentials.access_token;

    const client = await opts.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `outlook-token-refresh:${channel_account_id}`,
      ]);
      const current = await loadCredentials(client, channel_account_id);
      const creds = await refreshIfNeeded(channel_account_id, current);
      await client.query("commit");
      return creds.access_token;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    getAccessToken,

    async confirmSent({ channel_account_id, marker, attempts }) {
      return confirmOutlookSentMessage({
        accessToken: await getAccessToken(channel_account_id),
        marker,
        attempts,
        fetchImpl,
      });
    },

    async send({ channel_account_id, draft }) {
      const accessToken = await getAccessToken(channel_account_id);

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
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (response.status === 202) {
        // 202 is provider acceptance, not evidence that the message reached
        // Sent Items. The durable calling workflow performs confirmation.
        const requestId = response.headers.get("request-id") ?? `outlook-${Date.now()}`;
        return { status: "accepted", request_id: requestId };
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
