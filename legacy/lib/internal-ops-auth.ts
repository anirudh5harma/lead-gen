export function getInternalOpsAllowedEmails(): string[] {
  return (process.env.INTERNAL_OPS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isInternalOpsEmailAllowed(email?: string | null): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return getInternalOpsAllowedEmails().includes(normalized)
}

export function isInternalOpsBearerToken(token?: string | null): boolean {
  if (!token) return false
  const trimmed = token.trim()
  if (!trimmed) return false
  return trimmed === process.env.INTERNAL_OPS_SECRET || trimmed === process.env.CRON_SECRET
}

export function extractBearerToken(headerValue?: string | null): string | null {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}
