const FEEDBACK_LOOKBACK_DAYS = 120
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|llc|ltd|limited|plc|co|company|group|holdings|technologies|technology)\b\.?/g

export interface FeedbackLeadRow {
  client_id: string | null
  target_company: string
  company_domain?: string | null
  status: string
  is_unlocked?: boolean | null
  created_at?: string | null
  unlocked_at?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  signals?: { signal_type?: string | null; source_name?: string | null } | Array<{ signal_type?: string | null; source_name?: string | null }> | null
}

export interface FeedbackMaps {
  company: Map<string, number>
  signalType: Map<string, number>
  source: Map<string, number>
}

export interface FeedbackCandidate {
  clientId: string
  companyName: string
  companyDomain?: string | null
  signalType?: string | null
  sourceName?: string | null
}

export function getFeedbackWindowStart(date = new Date()): string {
  return new Date(date.getTime() - FEEDBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export function buildFeedbackMaps(rows: FeedbackLeadRow[]): FeedbackMaps {
  const company = new Map<string, number>()
  const signalType = new Map<string, number>()
  const source = new Map<string, number>()

  for (const row of rows) {
    if (!row.client_id) continue
    const signal = Array.isArray(row.signals) ? row.signals[0] ?? null : row.signals
    const score = computeLeadFeedbackScore(row)
    if (score === 0) continue

    const companyKey = `${row.client_id}:${normalizeCompanyKey(row.target_company, row.company_domain)}`
    company.set(companyKey, (company.get(companyKey) ?? 0) + score)

    const signalTypeValue = signal?.signal_type?.trim().toLowerCase()
    if (signalTypeValue) {
      const typeKey = `${row.client_id}:${signalTypeValue}`
      signalType.set(typeKey, (signalType.get(typeKey) ?? 0) + score)
    }

    const sourceValue = signal?.source_name?.trim().toLowerCase()
    if (sourceValue) {
      const sourceKey = `${row.client_id}:${sourceValue}`
      source.set(sourceKey, (source.get(sourceKey) ?? 0) + score)
    }
  }

  return { company, signalType, source }
}

export function computeCandidateFeedbackBoost(
  maps: FeedbackMaps,
  candidate: FeedbackCandidate,
): number {
  const companyKey = `${candidate.clientId}:${normalizeCompanyKey(candidate.companyName, candidate.companyDomain)}`
  const signalTypeKey = candidate.signalType?.trim().toLowerCase()
    ? `${candidate.clientId}:${candidate.signalType.trim().toLowerCase()}`
    : null
  const sourceKey = candidate.sourceName?.trim().toLowerCase()
    ? `${candidate.clientId}:${candidate.sourceName.trim().toLowerCase()}`
    : null

  const companyScore = dampFeedback(maps.company.get(companyKey) ?? 0, 10)
  const signalTypeScore = signalTypeKey ? dampFeedback(maps.signalType.get(signalTypeKey) ?? 0, 6) : 0
  const sourceScore = sourceKey ? dampFeedback(maps.source.get(sourceKey) ?? 0, 4) : 0

  return clamp(companyScore + signalTypeScore + sourceScore, -45, 90)
}

export function sortQueueRowsByFeedback<T extends {
  client_id: string
  target_company: string
  company_domain?: string | null
  source_name?: string | null
  priority_score: number
  signals?: { signal_type?: string | null } | Array<{ signal_type?: string | null }> | null
}>(
  rows: T[],
  maps: FeedbackMaps,
): Array<T & { feedbackBoost: number; adjustedPriority: number }> {
  return rows
    .map(row => {
      const signal = Array.isArray(row.signals) ? row.signals[0] ?? null : row.signals
      const feedbackBoost = computeCandidateFeedbackBoost(maps, {
        clientId: row.client_id,
        companyName: row.target_company,
        companyDomain: row.company_domain,
        signalType: signal?.signal_type ?? null,
        sourceName: row.source_name ?? null,
      })
      return {
        ...row,
        feedbackBoost,
        adjustedPriority: row.priority_score + feedbackBoost,
      }
    })
    .sort((a, b) => b.adjustedPriority - a.adjustedPriority || b.priority_score - a.priority_score)
}

export function computeLeadFeedbackScore(row: FeedbackLeadRow): number {
  const status = row.status
  const isUnlocked = row.is_unlocked === true
  const ageMs = Date.now() - new Date(
    row.booked_at ??
    row.replied_at ??
    row.sent_at ??
    row.unlocked_at ??
    row.created_at ??
    Date.now()
  ).getTime()
  const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)))
  const recencyMultiplier = Math.max(0.35, 1 - (ageDays / 180))

  let base = 0
  if (status === 'dismissed') base = -8
  else if (status === 'booked') base = 24
  else if (status === 'replied') base = 16
  else if (status === 'sent') base = 8
  else if (status === 'drafted') base = 3
  else if (isUnlocked) base = 1

  return base === 0 ? 0 : base * recencyMultiplier
}

function dampFeedback(value: number, multiplier: number): number {
  if (value === 0) return 0
  return Math.sign(value) * Math.sqrt(Math.abs(value)) * multiplier
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeCompanyKey(companyName: string, companyDomain?: string | null): string {
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
