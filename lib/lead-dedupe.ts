const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|llc|ltd|limited|plc|co|company|group|holdings|technologies|technology)\b\.?/g

export function normalizeLeadCompanyKey(companyName: string, companyDomain?: string | null): string {
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

export function leadDedupeBucket(date = new Date()): string {
  return String(Math.floor(date.getTime() / WEEK_MS))
}

export function buildLeadDedupeKey(params: {
  companyName: string
  companyDomain?: string | null
  signalType: string
  date?: Date
}): string {
  return [
    normalizeLeadCompanyKey(params.companyName, params.companyDomain),
    params.signalType.toLowerCase(),
    leadDedupeBucket(params.date),
  ].join(':')
}
