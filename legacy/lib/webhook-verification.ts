/**
 * Webhook signature verification using HMAC-SHA256.
 * External agents sign payloads with a shared secret; Bombsell verifies on receipt.
 */

import { createHash } from 'crypto'

const WEBHOOK_SECRET = process.env['AGENT_WEBHOOK_SECRET'] ?? 'bombsell-dev-agent-webhook-secret'
const ALGORITHM = 'sha256'

/**
 * Verify an HMAC-SHA256 signature on a webhook payload.
 * @param payload  Raw request body string
 * @param signature  The x-bombsell-signature header value (hex-encoded)
 * @param timestamp  The x-bombsell-timestamp header value (milliseconds as string)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  const secret = process.env['AGENT_WEBHOOK_SECRET'] ?? WEBHOOK_SECRET
  const encoded = new TextEncoder().encode(secret + timestamp + payload)
  const hash = createHash(ALGORITHM).update(encoded).digest('hex')
  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(hash, signature)
}

/**
 * Create an HMAC-SHA256 signature for a webhook payload.
 * Used when Bombsell dispatches tasks to external agents.
 */
export function signWebhookPayload(
  payload: string,
  timestamp: string,
  secret?: string,
): string {
  const key = secret ?? process.env['AGENT_WEBHOOK_SECRET'] ?? WEBHOOK_SECRET
  const encoded = new TextEncoder().encode(key + timestamp + payload)
  return createHash(ALGORITHM).update(encoded).digest('hex')
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
