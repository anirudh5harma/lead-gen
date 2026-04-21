import { retryFetch } from '@/lib/retry'

export interface HunterContact {
  name: string
  title: string
  email: string
  confidence: number // 0-100
}

export interface HunterDomainResult {
  emailPattern: string | null   // e.g. "{first}.{last}"
  contacts: HunterContact[]
}

/**
 * Hunter.io domain search.
 * Free tier: 25 searches/month. Starter: $34/mo for 500.
 *
 * Returns the email format pattern + known employee emails at the domain.
 */
export async function hunterDomainSearch(domain: string): Promise<HunterDomainResult> {
  if (!process.env.HUNTER_API_KEY) return { emailPattern: null, contacts: [] }

  try {
    const url = new URL('https://api.hunter.io/v2/domain-search')
    url.searchParams.set('domain', domain)
    url.searchParams.set('api_key', process.env.HUNTER_API_KEY)
    url.searchParams.set('limit', '10')

    const res = await retryFetch(url.toString())
    if (!res.ok) return { emailPattern: null, contacts: [] }

    const json = await res.json()
    const data = json.data || {}

    const pattern = data.pattern || null
    const emails: HunterContact[] = (data.emails || [])
      .filter((e: Record<string, unknown>) => e.value)
      .map((e: Record<string, unknown>) => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(' '),
        title: String(e.position || ''),
        email: String(e.value),
        confidence: Number(e.confidence || 50),
      }))

    return { emailPattern: pattern, contacts: emails }
  } catch (e) {
    console.error('Hunter domain search error:', e)
    return { emailPattern: null, contacts: [] }
  }
}

/**
 * Constructs candidate email addresses given a person's name and a domain,
 * using all common patterns.
 */
export function constructEmailCandidates(
  firstName: string,
  lastName: string,
  domain: string,
  knownPattern?: string | null
): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '')
  if (!f || !l) return []

  const candidates = new Set<string>()

  // If Hunter gave us the pattern, prioritize it
  if (knownPattern) {
    const patternEmail = knownPattern
      .replace('{first}', f)
      .replace('{last}', l)
      .replace('{f}', f[0])
      .replace('{l}', l[0])
    candidates.add(`${patternEmail}@${domain}`)
  }

  // Always try common patterns as fallbacks
  candidates.add(`${f}@${domain}`)
  candidates.add(`${f}.${l}@${domain}`)
  candidates.add(`${f}${l}@${domain}`)
  candidates.add(`${f[0]}${l}@${domain}`)
  candidates.add(`${f[0]}.${l}@${domain}`)

  return Array.from(candidates)
}
