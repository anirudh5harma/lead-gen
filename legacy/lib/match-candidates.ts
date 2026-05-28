export interface MatchSignalCandidate {
  id: string
  company_name: string
  company_domain?: string | null
  novelty_key?: string | null
  signal_type: string
  summary?: string | null
  headline?: string | null
  published_at?: string | null
  source_name?: string | null
  cluster_score?: number | null
  corroborating_source_count?: number | null
}

export interface ProfileCandidateInput {
  signal: MatchSignalCandidate
  similarity?: number | null
  keywordMatched?: boolean
  isWatchlisted?: boolean
}

export interface ProfileCandidate extends ProfileCandidateInput {
  rank: number
}

const SOURCE_PRIORITY: Record<string, number> = {
  company_owned: 26,
  job_board: 22,
  prnewswire: 16,
  businesswire: 16,
  globenewswire: 14,
  product_hunt: 10,
  hacker_news: 8,
  finsmes: 12,
  techcrunch_startups: 10,
  techcrunch_enterprise: 9,
  securityweek: 9,
  the_hacker_news: 9,
  sec_press: 9,
  eu_startups: 8,
  venturebeat_ai: 8,
  siliconangle: 7,
  google_news_company: 8,
  gdelt: 6,
  google_news: 4,
}

export function signalTextMatchesKeywords(
  signal: MatchSignalCandidate,
  keywords: string[],
): boolean {
  if (keywords.length === 0) return false
  const signalText = `${signal.company_name} ${signal.signal_type} ${signal.summary ?? ''} ${signal.headline ?? ''}`.toLowerCase()
  return keywords.some(keyword => signalText.includes(keyword.toLowerCase()))
}

export function scoreProfileCandidate(input: ProfileCandidateInput): number {
  const recencyHours = input.signal.published_at
    ? Math.max(0, Math.floor((Date.now() - new Date(input.signal.published_at).getTime()) / (60 * 60 * 1000)))
    : 72
  const recencyScore = Math.max(0, 48 - recencyHours)
  const sourceScore = SOURCE_PRIORITY[input.signal.source_name ?? ''] ?? 2
  const clusterScore = Math.max(0, Math.min(40, Math.round((input.signal.cluster_score ?? 0) * 0.4)))
  const corroborationScore = Math.max(0, Math.min(24, ((input.signal.corroborating_source_count ?? 1) - 1) * 12))
  const watchlistScore = input.isWatchlisted ? 1000 : 0
  const keywordScore = input.keywordMatched ? 120 : 0
  const similarityScore = typeof input.similarity === 'number'
    ? Math.round(input.similarity * 100)
    : 0

  return watchlistScore + keywordScore + similarityScore + recencyScore + sourceScore + clusterScore + corroborationScore
}

export function mergeProfileCandidates(
  inputs: ProfileCandidateInput[],
  limit: number,
): ProfileCandidate[] {
  const merged = new Map<string, ProfileCandidate>()

  for (const input of inputs) {
    const existing = merged.get(input.signal.id)
    const rank = scoreProfileCandidate(input)
    if (!existing) {
      merged.set(input.signal.id, {
        ...input,
        similarity: input.similarity ?? null,
        keywordMatched: Boolean(input.keywordMatched),
        isWatchlisted: Boolean(input.isWatchlisted),
        rank,
      })
      continue
    }

    existing.rank = Math.max(existing.rank, rank)
    existing.isWatchlisted = existing.isWatchlisted || Boolean(input.isWatchlisted)
    existing.keywordMatched = existing.keywordMatched || Boolean(input.keywordMatched)
    if (typeof input.similarity === 'number') {
      existing.similarity = Math.max(existing.similarity ?? 0, input.similarity)
    }
  }

  return [...merged.values()]
    .sort((a, b) => {
      const aPublished = a.signal.published_at ? new Date(a.signal.published_at).getTime() : 0
      const bPublished = b.signal.published_at ? new Date(b.signal.published_at).getTime() : 0
      return b.rank - a.rank || bPublished - aPublished
    })
    .slice(0, limit)
}
