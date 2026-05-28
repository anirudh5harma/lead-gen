export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '')
  const host = withoutProtocol.split('/')[0]?.replace(/^www\./, '') ?? ''
  if (!host || !host.includes('.') || host === 'localhost') return null
  return host
}

export function normalizeEntityName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

export function accountKey(params: { name: string; domain?: string | null }): string {
  const domain = normalizeDomain(params.domain)
  if (domain) return `domain:${domain}`

  const normalizedName = normalizeEntityName(params.name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `name:${normalizedName || 'unknown'}`
}

export function personKey(params: { email?: string | null; name?: string | null; accountId?: string | null }): string {
  const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : ''
  if (email) return `email:${email}`

  const name = normalizeEntityName(params.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `name:${params.accountId ?? 'global'}:${name || 'unknown'}`
}

export function signalKey(params: {
  leadId?: string | null
  sourceUrl?: string | null
  headline?: string | null
  accountKey: string
}): string {
  if (params.leadId) return `lead:${params.leadId}`
  const sourceUrl = typeof params.sourceUrl === 'string' ? params.sourceUrl.trim().toLowerCase() : ''
  if (sourceUrl) return `url:${sourceUrl}`

  const headline = normalizeEntityName(params.headline)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)

  return `headline:${params.accountKey}:${headline || 'unknown'}`
}

export function bodyPreview(value: string, max = 420): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}
