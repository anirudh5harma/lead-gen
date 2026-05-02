import type { RSSItem } from './rss'

export type SourceType =
  | 'owned'
  | 'news'
  | 'press'
  | 'jobs'
  | 'community'
  | 'launch'
  | 'social'
  | 'crm'
  | 'unknown'

export type JunkFilterDecision =
  | 'company_event'
  | 'person_event'
  | 'market_noise'
  | 'duplicate'
  | 'low_confidence'
  | 'blocked_source'

export interface JunkFilterOutput {
  decision: JunkFilterDecision
  pass: boolean
  score: number
  reason: string
  source_type: SourceType
  entity_hints: {
    company_names: string[]
    domains: string[]
  }
}

const COMPANY_PATTERN = /\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3}\b/g
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi

const COMPANY_EVENT_PATTERNS = [
  /\b(raise[sd]?|raising|funding|financing|series [a-z]|seed round|investment)\b/i,
  /\b(acquire[sd]?|acquisition|merger|buyout|deal)\b/i,
  /\b(expands?|launch(?:es|ed)?|new product|platform|partnership|integration|new office|new market|rfp|request for proposal|selects? .*vendor|awards? .*contract|signs? .*contract|implementation|migration)\b/i,
  /\b(fined|settlement|regulatory approval|compliance|data breach|security incident|lawsuit|investigation|soc 2|iso 27001|certification)\b/i,
  /\b(hiring|open roles|appoint(?:s|ed)?|hires?|joins?|chief|cto|cfo|cpo|ciso|cmo|cro|vp)\b/i,
]

const MARKET_NOISE_PATTERNS = [
  /\b(stock market|shares|price target|analyst rating|market size|forecast|research report)\b/i,
  /\b(top \d+|best \d+|roundup|listicle|opinion|column|podcast recap)\b/i,
  /\b(how to|guide to|what is|explained|ultimate guide)\b/i,
]

const BLOCKED_SOURCE_PATTERNS = [
  /\b(coupon|promo code|casino|betting|adult|torrent)\b/i,
]

const SOURCE_TYPE_BY_NAME: Record<string, SourceType> = {
  company_owned: 'owned',
  job_board: 'jobs',
  prnewswire: 'press',
  businesswire: 'press',
  globenewswire: 'press',
  product_hunt: 'launch',
  hacker_news: 'community',
  google_news_company: 'news',
  google_news: 'news',
  gdelt: 'news',
  techcrunch_startups: 'news',
  techcrunch_enterprise: 'news',
  venturebeat_ai: 'news',
  siliconangle: 'news',
  finsmes: 'press',
  eu_startups: 'news',
  securityweek: 'news',
  the_hacker_news: 'news',
  sec_press: 'news',
  crm_import: 'crm',
}

const SOURCE_BASE_SCORE: Record<SourceType, number> = {
  owned: 22,
  press: 18,
  jobs: 16,
  launch: 14,
  community: 8,
  news: 6,
  social: 4,
  crm: 18,
  unknown: 0,
}

export function classifySourceType(sourceName?: string | null): SourceType {
  const normalized = sourceName?.trim().toLowerCase() ?? ''
  if (!normalized) return 'unknown'
  if (normalized.includes('linkedin') || normalized === 'x' || normalized.includes('twitter')) return 'social'
  return SOURCE_TYPE_BY_NAME[normalized] ?? 'unknown'
}

export function cheapJunkFilter(item: Pick<RSSItem, 'title' | 'description' | 'link' | 'source'>): JunkFilterOutput {
  const text = `${item.title ?? ''} ${item.description ?? ''}`
  const sourceType = classifySourceType(item.source)
  const companyNames = extractCompanyHints(item.title ?? '')
  const domains = extractDomainHints(`${item.link ?? ''} ${item.description ?? ''}`)

  if (BLOCKED_SOURCE_PATTERNS.some(pattern => pattern.test(text))) {
    return output('blocked_source', false, 0, 'Blocked source/topic pattern.', sourceType, companyNames, domains)
  }

  const eventHits = COMPANY_EVENT_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
  const marketNoiseHits = MARKET_NOISE_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
  const hasEntity = companyNames.length > 0 || domains.length > 0
  const score = Math.max(0, Math.min(100, SOURCE_BASE_SCORE[sourceType] + eventHits * 24 + (hasEntity ? 18 : 0) - marketNoiseHits * 26))

  if (marketNoiseHits > 0 && eventHits === 0) {
    return output('market_noise', false, score, 'Looks like market commentary or educational content, not a company event.', sourceType, companyNames, domains)
  }

  if (!hasEntity) {
    return output('low_confidence', false, score, 'No company or domain hint was visible before extraction.', sourceType, companyNames, domains)
  }

  if (eventHits === 0 && sourceType !== 'press' && sourceType !== 'owned') {
    return output('low_confidence', false, score, 'No strong buying-signal pattern was visible before extraction.', sourceType, companyNames, domains)
  }

  const personOnly = /\b(appoint(?:s|ed)?|hires?|joins?|joined)\b/i.test(text) && !/\b(company|startup|launch|funding|acquisition|expansion)\b/i.test(text)
  if (personOnly) {
    return output('person_event', score >= 44, score, 'Executive/personnel event with a named entity.', sourceType, companyNames, domains)
  }

  return output('company_event', score >= 44, score, 'Company event pattern passed cheap filter.', sourceType, companyNames, domains)
}

export function stableCandidateHash(item: Pick<RSSItem, 'title' | 'description' | 'link' | 'source'>): string {
  return stableKey(`${item.source ?? ''}:${item.link ?? ''}:${item.title ?? ''}:${item.description ?? ''}`)
}

export function estimateSourceCost(sourceName?: string | null): number {
  const sourceType = classifySourceType(sourceName)
  if (sourceType === 'social') return 0.004
  if (sourceType === 'news') return 0.0004
  if (sourceType === 'launch' || sourceType === 'community') return 0.0002
  if (sourceType === 'owned') return 0.0003
  return 0.0001
}

function output(
  decision: JunkFilterDecision,
  pass: boolean,
  score: number,
  reason: string,
  sourceType: SourceType,
  companyNames: string[],
  domains: string[],
): JunkFilterOutput {
  return {
    decision,
    pass,
    score: Math.round(score),
    reason,
    source_type: sourceType,
    entity_hints: {
      company_names: companyNames.slice(0, 5),
      domains: domains.slice(0, 5),
    },
  }
}

function extractCompanyHints(title: string): string[] {
  const seen = new Set<string>()
  for (const match of title.matchAll(COMPANY_PATTERN)) {
    const value = match[0].trim()
    if (value.length < 3 || /^(The|A|An|New|This|That|How|Why|What|CEO|CFO|CTO|VP)$/.test(value)) continue
    seen.add(value)
  }
  return [...seen]
}

function extractDomainHints(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(DOMAIN_PATTERN)) {
    const value = match[0].toLowerCase().replace(/^www\./, '')
    if (value.includes('.')) seen.add(value)
  }
  return [...seen]
}

function stableKey(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
