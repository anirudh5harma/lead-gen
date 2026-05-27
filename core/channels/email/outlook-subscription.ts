import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { InboundEmail } from "./reply.ts";

/**
 * Microsoft Graph subscription management + Graph Message → InboundEmail
 * conversion. The webhook route at `app/api/webhooks/outlook/route.ts`
 * consumes the parser; the OAuth callback creates the subscription.
 *
 * Subscription lifecycle:
 *   - createOutlookSubscription : POST /subscriptions
 *   - renewOutlookSubscription  : PATCH /subscriptions/{id}
 *   - deleteOutlookSubscription : DELETE /subscriptions/{id}
 *
 * Graph caps subscription lifetime by resource. For /me/messages the
 * documented max is about three days, so a scheduled durable workflow
 * renews it before expiry.
 * The `clientState` we set on creation is echoed back in every change
 * notification — the webhook handler MUST verify it to reject forged
 * payloads.
 *
 * Subscription state lives in `channel_accounts.properties.outlook_subscription`
 * (a JSONB blob); a new table would be over-engineering for a single
 * subscription per account.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface OutlookSubscription {
  id: string;
  resource: string;
  expirationDateTime: string;
  clientState: string;
  notificationUrl: string;
  /**
   * Endpoint Microsoft Graph hits with reauthorizationRequired /
   * subscriptionRemoved / missed lifecycle events. Subscriptions
   * persisted before this field was introduced have it absent — the
   * repair workflow treats absence as "needs migration" and recreates.
   */
  lifecycleNotificationUrl?: string;
}

export interface OutlookSubscriptionRecord extends OutlookSubscription {
  /** Wall-clock time we created/renewed the subscription. */
  recorded_at: string;
}

export interface CreateOutlookSubscriptionOptions {
  pool: Pool;
  workspaceId: string;
  channelAccountId: string;
  accessToken: string;
  notificationUrl: string;
  /**
   * Lifecycle URL. Set to the same Outlook webhook route — Graph
   * differentiates by the presence of `lifecycleEvent` in the payload.
   * Defaults to `notificationUrl` so existing callers opt in
   * automatically when not provided otherwise.
   */
  lifecycleNotificationUrl?: string;
  /** Defaults to 4230 (Graph max for /me/messages). */
  expirationMinutes?: number;
  /** Defaults to "/me/messages". */
  resource?: string;
  fetchImpl?: typeof fetch;
  /** Durable workflow callers project persisted state after emitting an event. */
  persist?: boolean;
}

export interface RenewOutlookSubscriptionOptions {
  pool: Pool;
  workspaceId: string;
  channelAccountId: string;
  accessToken: string;
  expirationMinutes?: number;
  fetchImpl?: typeof fetch;
  /** Durable workflow callers project persisted state after emitting an event. */
  persist?: boolean;
}

export interface DeleteOutlookSubscriptionOptions {
  pool: Pool;
  workspaceId: string;
  channelAccountId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface FetchOutlookMessageOptions {
  accessToken: string;
  messageId: string;
  fetchImpl?: typeof fetch;
}

export class OutlookSubscriptionError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(`${message}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.name = "OutlookSubscriptionError";
  }
}

export async function createOutlookSubscription(
  opts: CreateOutlookSubscriptionOptions,
): Promise<OutlookSubscription> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const expirationMinutes = opts.expirationMinutes ?? 4230;
  const resource = opts.resource ?? "/me/messages";
  const clientState = randomBytes(24).toString("base64url");
  const expirationDateTime = new Date(Date.now() + expirationMinutes * 60_000).toISOString();
  const lifecycleNotificationUrl =
    opts.lifecycleNotificationUrl ?? opts.notificationUrl;

  const response = await fetchImpl(`${GRAPH_BASE}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: opts.notificationUrl,
      lifecycleNotificationUrl,
      resource,
      expirationDateTime,
      clientState,
    }),
  });

  if (!response.ok) {
    throw new OutlookSubscriptionError(
      "Outlook subscription create failed",
      response.status,
      await response.text(),
    );
  }
  const json = (await response.json()) as {
    id: string;
    resource: string;
    expirationDateTime: string;
  };

  const sub: OutlookSubscription = {
    id: json.id,
    resource: json.resource,
    expirationDateTime: json.expirationDateTime,
    clientState,
    notificationUrl: opts.notificationUrl,
    lifecycleNotificationUrl,
  };
  if (opts.persist !== false) {
    await persistOutlookSubscription(opts.pool, opts.workspaceId, opts.channelAccountId, sub);
  }
  return sub;
}

export async function renewOutlookSubscription(
  opts: RenewOutlookSubscriptionOptions,
): Promise<OutlookSubscription> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const expirationMinutes = opts.expirationMinutes ?? 4230;
  const existing = await loadSubscription(opts.pool, opts.workspaceId, opts.channelAccountId);
  if (!existing) {
    throw new OutlookSubscriptionError(
      "no subscription to renew for channel_account",
      404,
      opts.channelAccountId,
    );
  }
  const expirationDateTime = new Date(Date.now() + expirationMinutes * 60_000).toISOString();
  const response = await fetchImpl(`${GRAPH_BASE}/subscriptions/${existing.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expirationDateTime }),
  });
  if (!response.ok) {
    throw new OutlookSubscriptionError(
      "Outlook subscription renew failed",
      response.status,
      await response.text(),
    );
  }
  const json = (await response.json()) as { expirationDateTime: string };
  const updated: OutlookSubscription = {
    ...existing,
    expirationDateTime: json.expirationDateTime,
  };
  if (opts.persist !== false) {
    await persistOutlookSubscription(opts.pool, opts.workspaceId, opts.channelAccountId, updated);
  }
  return updated;
}

export async function deleteOutlookSubscription(
  opts: DeleteOutlookSubscriptionOptions,
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const existing = await loadSubscription(opts.pool, opts.workspaceId, opts.channelAccountId);
  if (!existing) return;
  const response = await fetchImpl(`${GRAPH_BASE}/subscriptions/${existing.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (response.status === 404 || response.ok) {
    await opts.pool.query(
      `update channel_accounts
          set properties = properties - 'outlook_subscription'
        where workspace_id = $1 and id = $2`,
      [opts.workspaceId, opts.channelAccountId],
    );
    return;
  }
  throw new OutlookSubscriptionError(
    "Outlook subscription delete failed",
    response.status,
    await response.text(),
  );
}

export async function loadSubscription(
  pool: Pool,
  workspaceId: string,
  channelAccountId: string,
): Promise<OutlookSubscriptionRecord | null> {
  const { rows } = await pool.query<{
    properties: { outlook_subscription?: OutlookSubscriptionRecord } | null;
  }>(
    `select properties from channel_accounts
      where workspace_id = $1 and id = $2`,
    [workspaceId, channelAccountId],
  );
  return rows[0]?.properties?.outlook_subscription ?? null;
}

export async function persistOutlookSubscription(
  pool: Pool,
  workspaceId: string,
  channelAccountId: string,
  sub: OutlookSubscription,
): Promise<void> {
  const record: OutlookSubscriptionRecord = {
    ...sub,
    recorded_at: new Date().toISOString(),
  };
  await pool.query(
    `update channel_accounts
        set properties = coalesce(properties, '{}'::jsonb) ||
                         jsonb_build_object('outlook_subscription', $3::jsonb)
      where workspace_id = $1 and id = $2`,
    [workspaceId, channelAccountId, JSON.stringify(record)],
  );
}

/**
 * Fetch the full Graph Message for an inbound notification's resource id.
 * The notification carries only routing info; the body lives behind a
 * follow-up GET.
 */
export async function fetchOutlookMessage(
  opts: FetchOutlookMessageOptions,
): Promise<GraphMessage> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${GRAPH_BASE}/me/messages/${opts.messageId}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!response.ok) {
    throw new OutlookSubscriptionError(
      "Outlook fetchMessage failed",
      response.status,
      await response.text(),
    );
  }
  return (await response.json()) as GraphMessage;
}

// ─── Graph Message → InboundEmail ──────────────────────────────────────────

export interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

export interface GraphInternetMessageHeader {
  name: string;
  value: string;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  body?: { contentType: "text" | "html"; content: string };
  internetMessageHeaders?: GraphInternetMessageHeader[];
}

function headerValue(
  headers: GraphInternetMessageHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const hit = headers.find((h) => h.name.toLowerCase() === target);
  return hit?.value;
}

function parseReferencesHeader(value: string | undefined): string[] {
  if (!value) return [];
  // RFC 5322 References is a sequence of msg-id tokens. Extract the angle-bracketed ids.
  return Array.from(value.matchAll(/<([^>]+)>/g), (m) => m[1]);
}

export function graphMessageToInbound(
  message: GraphMessage,
  workspaceId: string,
  channelAccountId: string,
): InboundEmail | null {
  const from = message.from?.emailAddress ?? message.sender?.emailAddress;
  if (!from?.address) return null;

  const body = message.body;
  const isHtml = body?.contentType === "html";
  const bodyText = body?.content ?? message.bodyPreview ?? "";
  const bodyHtml = isHtml ? body?.content : undefined;

  const inReplyTo = stripAngles(
    headerValue(message.internetMessageHeaders, "In-Reply-To"),
  );
  const references = parseReferencesHeader(
    headerValue(message.internetMessageHeaders, "References"),
  );

  return {
    workspace_id: workspaceId,
    external_id: message.internetMessageId ?? message.id,
    external_thread_id: message.conversationId,
    in_reply_to: inReplyTo,
    references,
    from: { email: from.address, name: from.name },
    subject: message.subject ?? "",
    body_text: htmlToText(bodyText, isHtml),
    body_html: bodyHtml,
    received_at: message.receivedDateTime ?? new Date().toISOString(),
    channel_account_id: channelAccountId,
  };
}

function stripAngles(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/<([^>]+)>/);
  return m ? m[1] : s;
}

function htmlToText(content: string, isHtml: boolean): string {
  if (!isHtml) return content;
  // Lightweight: strip tags + collapse whitespace. The full body_html is
  // preserved separately for the UI / for forwarding contexts. The text
  // view is what the intent classifier sees, so a clean approximation is
  // good enough for foundation.
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Webhook notification envelope ─────────────────────────────────────────

export interface OutlookChangeNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime?: string;
  clientState?: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string; "@odata.id"?: string };
  tenantId?: string;
}

export interface OutlookNotificationBatch {
  value: OutlookChangeNotification[];
  validationTokens?: string[];
}

export function isValidClientState(
  notification: OutlookChangeNotification,
  expected: string,
): boolean {
  return Boolean(notification.clientState) && notification.clientState === expected;
}
