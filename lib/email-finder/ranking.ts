export interface RankedContactInput {
  name: string
  title: string
  email: string
  verified: boolean
  source: 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
  linkedinUrl?: string | null
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  revenue: ['sales', 'revenue', 'growth', 'pipeline', 'outbound', 'marketing', 'demand gen', 'lead gen', 'go to market', 'gtm'],
  operations: ['operations', 'workflow', 'automation', 'process', 'support', 'ops', 'fulfillment', 'back office', 'delivery'],
  technical: ['engineering', 'developer', 'software', 'platform', 'product', 'data', 'ai', 'security', 'cyber', 'cloud', 'api', 'devops', 'infrastructure'],
  finance: ['finance', 'accounting', 'billing', 'payments', 'audit', 'fp&a', 'procurement', 'finops'],
  compliance: ['compliance', 'risk', 'privacy', 'governance', 'regulatory', 'security'],
}

export function rankContactsForUseCase<T extends RankedContactInput>(
  contacts: T[],
  servicesDescription?: string | null,
  signalType?: string | null,
): T[] {
  const desc = (servicesDescription ?? '').toLowerCase()
  const preferredCategories = new Map<string, number>()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = keywords.reduce((count, keyword) => count + (desc.includes(keyword) ? 1 : 0), 0)
    if (hits > 0) preferredCategories.set(category, hits)
  }

  return [...contacts]
    .map(contact => ({
      contact,
      score: scoreContact(contact.title, preferredCategories, signalType, contact.verified, contact.source),
    }))
    .sort((a, b) => b.score - a.score || a.contact.title.localeCompare(b.contact.title))
    .map(item => item.contact)
}

export function baseContactScore(title: string): number {
  return scoreTitle(title)
}

function scoreContact(
  title: string,
  preferredCategories: Map<string, number>,
  signalType: string | null | undefined,
  verified: boolean,
  source: RankedContactInput['source'],
): number {
  const categories = inferTitleCategories(title)
  let score = scoreTitle(title)

  for (const [category, hits] of preferredCategories.entries()) {
    if (categories.has(category)) score += 18 + (hits * 8)
  }

  if (signalType === 'funding' && (categories.has('finance') || categories.has('executive') || categories.has('operations'))) score += 12
  if (signalType === 'expansion' && (categories.has('revenue') || categories.has('operations') || categories.has('executive'))) score += 12
  if (signalType === 'acquisition' && (categories.has('operations') || categories.has('technical') || categories.has('executive'))) score += 10
  if (signalType === 'regulation' && (categories.has('compliance') || categories.has('finance') || categories.has('technical'))) score += 12
  if (signalType === 'hiring' && (categories.has('technical') || categories.has('revenue') || categories.has('operations'))) score += 8

  if (verified) score += 10
  if (source === 'hunter') score += 5
  if (source === 'fullenrich') score += 3
  if (source === 'pattern') score -= 2
  if (source === 'scrape') score -= 4

  return score
}

function scoreTitle(title: string): number {
  const normalized = title.toLowerCase()
  if (/\b(founder|co-founder|ceo|chief executive officer)\b/.test(normalized)) return 100
  if (/\b(cfo|coo|cto|cro|cio|ciso|chief )\b/.test(normalized)) return 92
  if (/\b(president|managing director|general manager)\b/.test(normalized)) return 82
  if (/\b(svp|evp|senior vice president|executive vice president)\b/.test(normalized)) return 78
  if (/\b(vp|vice president)\b/.test(normalized)) return 72
  if (/\b(head of|head )\b/.test(normalized)) return 66
  if (/\b(director)\b/.test(normalized)) return 54
  return 40
}

function inferTitleCategories(title: string): Set<string> {
  const normalized = title.toLowerCase()
  const categories = new Set<string>()
  if (/\b(founder|chief|ceo|president|owner)\b/.test(normalized)) categories.add('executive')
  if (/\b(revenue|sales|growth|marketing|go to market|gtm)\b/.test(normalized)) categories.add('revenue')
  if (/\b(operations|operating|ops|strategy)\b/.test(normalized)) categories.add('operations')
  if (/\b(engineering|technology|technical|it|information|product|data)\b/.test(normalized)) categories.add('technical')
  if (/\b(finance|financial|accounting|controller|treasury)\b/.test(normalized)) categories.add('finance')
  if (/\b(compliance|risk|security|privacy|governance|legal)\b/.test(normalized)) categories.add('compliance')
  return categories
}
