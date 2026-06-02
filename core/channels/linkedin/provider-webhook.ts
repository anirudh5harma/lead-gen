import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const LinkedInProviderWebhook = z.object({
  event: z.enum([
    "connected",
    "credentials_refreshed",
    "reauthorization_required",
    "rate_limited",
    "suspended",
    "disconnected",
    "errored",
  ]),
  channel_account_id: z.string().uuid().optional(),
  provider_account_id: z.string().min(1).optional(),
  account_display_name: z.string().min(1).optional(),
  provider_event_id: z.string().min(1).optional(),
  provider_incident_id: z.string().min(1).optional(),
  retry_after: z.string().min(1).optional(),
  error: z.string().optional(),
  idempotency_key: z.string().min(1).optional(),
  occurred_at: z.string().optional(),
});

export type LinkedInProviderWebhookPayload = z.infer<typeof LinkedInProviderWebhook>;

export function verifyLinkedInProviderSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const received = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function providerStatus(
  event: LinkedInProviderWebhookPayload["event"],
): "needs_reauth" | "rate_limited" | "suspended" | "disconnected" | null {
  if (event === "reauthorization_required") return "needs_reauth";
  if (event === "rate_limited") return "rate_limited";
  if (event === "suspended") return "suspended";
  if (event === "disconnected") return "disconnected";
  if (event === "errored") return null;
  return null;
}

export function providerErrorMessage(
  payload: LinkedInProviderWebhookPayload,
): string {
  if (payload.error) return payload.error;
  if (payload.event === "reauthorization_required") {
    return "LinkedIn provider requires account reauthorization.";
  }
  return `LinkedIn provider lifecycle event: ${payload.event}`;
}

export function lifecycleIdempotencyKey(
  payload: LinkedInProviderWebhookPayload,
  channelAccountId: string,
): string {
  return [
    "linkedin-provider",
    channelAccountId,
    payload.event,
    payload.idempotency_key ??
      payload.provider_event_id ??
      payload.provider_incident_id ??
      payload.occurred_at ??
      "latest",
  ].join(":");
}
