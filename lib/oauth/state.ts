import { createHmac, timingSafeEqual } from 'node:crypto'

const STATE_TTL_MS = 10 * 60 * 1000

export function createOAuthState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url')
  const signature = sign(payload)
  return `${payload}.${signature}`
}

export function verifyOAuthState(state: string): string | null {
  const [payload, signature] = state.split('.')
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      userId?: unknown
      ts?: unknown
    }
    if (typeof decoded.userId !== 'string' || typeof decoded.ts !== 'number') return null
    if (Date.now() - decoded.ts > STATE_TTL_MS) return null
    return decoded.userId
  } catch {
    return null
  }
}

function sign(payload: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? '')
    .update(payload)
    .digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes)
}
