import crypto from 'crypto'

export interface GuardrailAttestation {
  type: string
  passed: boolean
  evidence: Record<string, unknown>
}

export interface AuditPayload {
  transactionId: string
  agentId: string
  tool: string
  action: string
  timestamp: string
  cost: number
  verdict: string
  guardrails: GuardrailAttestation[]
}

const ATTESTATION_SECRET = process.env.AGENT_ATTESTATION_SECRET ?? 'bombsell-a2a-default-secret-change-in-prod'

export function generateAuditHash(payload: AuditPayload): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return crypto.createHmac('sha256', ATTESTATION_SECRET).update(canonical).digest('hex')
}

export function verifyAuditHash(payload: AuditPayload, hash: string): boolean {
  return generateAuditHash(payload) === hash
}

export function signWebhookPayload(payload: Record<string, unknown>, secret: string): string {
  const canonical = JSON.stringify(payload)
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex')
}

export function verifyWebhookSignature(payload: Record<string, unknown>, signature: string, secret: string): boolean {
  return signWebhookPayload(payload, secret) === signature
}

export function createAttestation(
  type: string,
  passed: boolean,
  evidence: Record<string, unknown> = {},
): GuardrailAttestation {
  return { type, passed, evidence }
}

export const GUARDRAIL_TYPES = {
  CONTACT_VERIFIED: 'contact_verified',
  UNSUBSCRIBE_CHECKED: 'unsubscribe_checked',
  BOUNCE_SAFE: 'bounce_safe',
  TIMING_APPROPRIATE: 'timing_appropriate',
  ICP_MATCHED: 'icp_matched',
  DAILY_CAP_RESPECTED: 'daily_cap_respected',
  SPAM_SCORE_SAFE: 'spam_score_safe',
} as const
