import type { BounceEvent } from "./types.ts";
import type { InboundEmail } from "./reply.ts";

/**
 * SNS payload parsers for SES. The webhook route at
 * `app/api/webhooks/ses/route.ts` receives SNS HTTP POSTs in two shapes:
 *
 *   1. SubscriptionConfirmation — Type='SubscriptionConfirmation', SubscribeURL
 *      The route follows the URL once to confirm the subscription.
 *
 *   2. Notification — Type='Notification', Message=<JSON string>
 *      Inner Message has `notificationType`:
 *        - 'Bounce'      → BounceEvent (hard/soft)
 *        - 'Complaint'   → BounceEvent (complaint)
 *        - 'Received'    → InboundEmail (when SES Inbound + SNS action used)
 *
 * Tag-based attribution: outbound emails are sent with SES EmailTags
 * containing `workspace_id` and `message_id` (see
 * adapters/ses.ts → SendEmailCommand input). Bounce/Complaint notifications
 * include those tags, so we can route the event to the right workspace
 * without scanning every message in the DB.
 *
 * SNS signature verification is performed by `sns-verify.ts` before this
 * parser's output reaches any channel handler.
 */

export interface SnsMessageEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn?: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  /** Present on SubscriptionConfirmation; GET it once to confirm. */
  SubscribeURL?: string;
  /** Present on confirmation messages and included in the signed content. */
  Token?: string;
  /** Legacy alias retained for fixture compatibility. */
  UnsubscribeURL?: string;
  /** Present on Notification when SES is configured to add tag values. */
  MessageAttributes?: Record<string, { Type: string; Value: string }>;
}

export type SnsParsedNotification =
  | { kind: "subscription_confirmation"; subscribeUrl: string }
  | { kind: "unsubscribe_confirmation"; unsubscribeUrl: string }
  | { kind: "bounce"; event: BounceEvent }
  | { kind: "complaint"; event: BounceEvent }
  | { kind: "received"; inbound: InboundEmail }
  | { kind: "unsupported"; notificationType: string };

export class SnsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsParseError";
  }
}

export function parseSnsEnvelope(body: unknown): SnsMessageEnvelope {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnsParseError("SNS body is not valid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { Type?: unknown }).Type !== "string"
  ) {
    throw new SnsParseError("SNS body missing required Type field");
  }
  return parsed as SnsMessageEnvelope;
}

/**
 * Dispatch on the envelope's Type + the inner notificationType. Pure
 * function — every input → output is deterministic; the route layer
 * handles I/O (SubscribeURL fetch, handleBounce/handleInboundEmail calls).
 */
export function parseSnsNotification(
  envelope: SnsMessageEnvelope,
  workspaceIdResolver?: (notification: SesNotification) => string | null,
): SnsParsedNotification {
  if (envelope.Type === "SubscriptionConfirmation") {
    if (!envelope.SubscribeURL) {
      throw new SnsParseError("SubscriptionConfirmation missing SubscribeURL");
    }
    return { kind: "subscription_confirmation", subscribeUrl: envelope.SubscribeURL };
  }
  if (envelope.Type === "UnsubscribeConfirmation") {
    return {
      kind: "unsubscribe_confirmation",
      unsubscribeUrl: envelope.SubscribeURL ?? envelope.UnsubscribeURL ?? "",
    };
  }

  const innerText = envelope.Message;
  let inner: SesNotification;
  try {
    inner = JSON.parse(innerText) as SesNotification;
  } catch {
    throw new SnsParseError("SNS Notification.Message is not valid JSON");
  }

  const workspaceId =
    workspaceIdResolver?.(inner) ??
    workspaceIdFromTags(inner) ??
    workspaceIdFromAttributes(envelope);
  if (!workspaceId) {
    throw new SnsParseError(
      "could not resolve workspace_id for SNS notification (no SES tag, no SNS attribute, no resolver)",
    );
  }

  switch (inner.notificationType) {
    case "Bounce":
      return { kind: "bounce", event: toBounceEvent(inner, workspaceId, "bounce") };
    case "Complaint":
      return { kind: "complaint", event: toBounceEvent(inner, workspaceId, "complaint") };
    case "Received":
      return { kind: "received", inbound: toInboundEmail(inner, workspaceId) };
    default: {
      // Exhaustive on the typed union; any new SES notificationType lands here
      // and bubbles up as 'unsupported' so the route still 200s rather than
      // tripping SNS retries.
      const exhaust = inner as { notificationType: string };
      return { kind: "unsupported", notificationType: exhaust.notificationType };
    }
  }
}

// ─── SES notification shapes ───────────────────────────────────────────────

interface SesMail {
  messageId: string;
  source?: string;
  destination?: string[];
  commonHeaders?: {
    from?: string[];
    to?: string[];
    subject?: string;
    messageId?: string;
  };
  headers?: Array<{ name: string; value: string }>;
  tags?: Record<string, string[]>;
}

interface SesBounceNotification {
  notificationType: "Bounce";
  bounce: {
    bounceType: "Undetermined" | "Permanent" | "Transient";
    bounceSubType?: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      diagnosticCode?: string;
      status?: string;
    }>;
    timestamp?: string;
  };
  mail: SesMail;
}

interface SesComplaintNotification {
  notificationType: "Complaint";
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
    timestamp?: string;
  };
  mail: SesMail;
}

interface SesReceivedNotification {
  notificationType: "Received";
  mail: SesMail;
  receipt?: {
    timestamp?: string;
    recipients?: string[];
    spamVerdict?: { status: string };
    virusVerdict?: { status: string };
  };
  /** Present when SES action includes content; base64-encoded raw email. */
  content?: string;
}

export type SesNotification =
  | SesBounceNotification
  | SesComplaintNotification
  | SesReceivedNotification;

// ─── Conversion helpers ────────────────────────────────────────────────────

function workspaceIdFromTags(inner: SesNotification): string | null {
  const tags = inner.mail?.tags;
  const arr = tags?.["workspace_id"];
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

function workspaceIdFromAttributes(env: SnsMessageEnvelope): string | null {
  const attr = env.MessageAttributes?.["workspace_id"];
  return attr?.Value ?? null;
}

function findHeader(headers: SesMail["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const hit = headers.find((h) => h.name.toLowerCase() === target);
  return hit?.value;
}

function stripAngles(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/<([^>]+)>/);
  return m ? m[1] : s;
}

function externalIdFromMail(mail: SesMail): string {
  return mail.commonHeaders?.messageId ?? mail.messageId;
}

function toBounceEvent(
  inner: SesBounceNotification | SesComplaintNotification,
  workspaceId: string,
  kind: "bounce" | "complaint",
): BounceEvent {
  if (kind === "bounce" && inner.notificationType === "Bounce") {
    const b = inner.bounce;
    const bounceType: BounceEvent["bounce_type"] =
      b.bounceType === "Permanent" ? "hard" : "soft";
    const recipient = b.bouncedRecipients[0]?.emailAddress ?? "";
    const detail = b.bouncedRecipients[0]?.diagnosticCode;
    return {
      workspace_id: workspaceId,
      external_id: externalIdFromMail(inner.mail),
      bounce_type: bounceType,
      recipient,
      detail,
    };
  }
  // Complaint
  const c = (inner as SesComplaintNotification).complaint;
  return {
    workspace_id: workspaceId,
    external_id: externalIdFromMail(inner.mail),
    bounce_type: "complaint",
    recipient: c.complainedRecipients[0]?.emailAddress ?? "",
    detail: c.complaintFeedbackType,
  };
}

function toInboundEmail(inner: SesReceivedNotification, workspaceId: string): InboundEmail {
  const mail = inner.mail;
  const fromAddr = mail.commonHeaders?.from?.[0] ?? mail.source ?? "";
  const { email, name } = parseAddress(fromAddr);
  const inReplyTo = stripAngles(findHeader(mail.headers, "In-Reply-To"));
  const refsHeader = findHeader(mail.headers, "References");
  const references = refsHeader
    ? Array.from(refsHeader.matchAll(/<([^>]+)>/g), (m) => m[1])
    : [];

  let body_text = "";
  let body_html: string | undefined;
  if (inner.content) {
    // SES action `S3` or `SNS` may include base64-encoded raw email.
    // Foundation: best-effort decode; full MIME parsing is a follow-up.
    try {
      body_text = Buffer.from(inner.content, "base64").toString("utf8");
    } catch {
      body_text = "";
    }
  }

  return {
    workspace_id: workspaceId,
    external_id: externalIdFromMail(mail),
    in_reply_to: inReplyTo,
    references,
    from: { email, name },
    subject: mail.commonHeaders?.subject ?? "",
    body_text,
    body_html,
    received_at: inner.receipt?.timestamp ?? new Date().toISOString(),
  };
}

function parseAddress(s: string): { email: string; name?: string } {
  // Crude RFC 5322 address parse: "Anne Brown <anne@example.com>"
  const m = s.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) {
    const rawName = (m[1] ?? "").trim();
    return { email: m[2].trim(), name: rawName === "" ? undefined : rawName };
  }
  return { email: s.trim() };
}
