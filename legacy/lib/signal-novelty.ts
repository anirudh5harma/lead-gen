const STOPWORDS = new Set([
  'a', 'an', 'and', 'announces', 'announced', 'appoints', 'appointed', 'company',
  'companies', 'for', 'from', 'funding', 'has', 'have', 'hiring', 'in', 'into',
  'is', 'its', 'launch', 'launches', 'launched', 'new', 'of', 'on', 'or', 'raises',
  'raised', 'raising', 'round', 's', 'said', 'says', 'series', 'startup', 'that',
  'the', 'to', 'with',
])
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|llc|ltd|limited|plc|co|company|group|holdings|technologies|technology)\b\.?/g

export interface SignalNoveltyInput {
  companyName: string
  companyDomain?: string | null
  headline?: string | null
  summary?: string | null
  fundingAmount?: string | null
}

export function buildSignalNoveltyKey(input: SignalNoveltyInput): string {
  const companyKey = normalizeLeadCompanyKey(input.companyName, input.companyDomain)
  const tokens = extractSignalNoveltyTokens(input)
  const signature = tokens.slice(0, 6).join('-') || 'generic'
  return `${companyKey}:${signature}`
}

export function extractSignalNoveltyTokens(input: SignalNoveltyInput): string[] {
  const companyParts = extractCompanyTokens(input.companyName, input.companyDomain)
  const rawText = `${input.summary ?? ''} ${input.summary ?? ''} ${input.headline ?? ''} ${input.fundingAmount ?? ''}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$ ]+/g, ' ')

  const weighted = new Map<string, number>()
  for (const token of rawText.split(/\s+/)) {
    const normalized = normalizeToken(token)
    if (!normalized || STOPWORDS.has(normalized) || companyParts.has(normalized)) continue
    weighted.set(normalized, (weighted.get(normalized) ?? 0) + 1)
  }

  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
}

export function isLikelySameSignalEvent(a: SignalNoveltyInput, b: SignalNoveltyInput): boolean {
  if (normalizeLeadCompanyKey(a.companyName, a.companyDomain) !== normalizeLeadCompanyKey(b.companyName, b.companyDomain)) {
    return false
  }

  const aTokens = extractSignalNoveltyTokens(a)
  const bTokens = extractSignalNoveltyTokens(b)
  if (aTokens.length === 0 || bTokens.length === 0) return false

  const aSet = new Set(aTokens.slice(0, 8))
  const bSet = new Set(bTokens.slice(0, 8))
  let overlap = 0
  for (const token of aSet) {
    if (bSet.has(token)) overlap++
  }

  const union = new Set([...aSet, ...bSet]).size
  const similarity = union > 0 ? overlap / union : 0
  return overlap >= 3 || similarity >= 0.55
}

function extractCompanyTokens(companyName: string, companyDomain?: string | null): Set<string> {
  const tokens = new Set<string>()
  for (const token of companyName.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
    const normalized = normalizeToken(token)
    if (normalized) tokens.add(normalized)
  }

  const domain = companyDomain
    ?.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]

  if (domain) {
    for (const token of domain.split(/[.-]/)) {
      const normalized = normalizeToken(token)
      if (normalized) tokens.add(normalized)
    }
  }

  return tokens
}

function normalizeToken(token: string): string {
  const trimmed = token.trim().replace(/^\$+/, '')
  if (!trimmed || trimmed.length < 3) return ''
  if (/^\d+$/.test(trimmed)) return trimmed

  let value = trimmed
  if (value.endsWith('ies') && value.length > 4) value = `${value.slice(0, -3)}y`
  else if (value.endsWith('ing') && value.length > 5) value = value.slice(0, -3)
  else if (value.endsWith('ed') && value.length > 4) value = value.slice(0, -2)
  else if (value.endsWith('es') && value.length > 4) value = value.slice(0, -2)
  else if (value.endsWith('s') && value.length > 4) value = value.slice(0, -1)

  return value
}

function normalizeLeadCompanyKey(companyName: string, companyDomain?: string | null): string {
  const domain = companyDomain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  if (domain && domain.includes('.')) return `domain:${domain}`

  const name = companyName
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(COMPANY_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return `name:${name || companyName.toLowerCase().trim()}`
}
