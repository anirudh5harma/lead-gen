import { sanitizeHeaderValue } from '@/lib/email-safety'

export function normalizeMessageId(value: string | null | undefined): string | null {
  const safe = value ? sanitizeHeaderValue(value) : ''
  const normalized = safe.replace(/^<+|>+$/g, '').trim()
  return normalized || null
}

export function messageIdHeader(value: string | null | undefined): string | null {
  const normalized = normalizeMessageId(value)
  return normalized ? `<${normalized}>` : null
}
