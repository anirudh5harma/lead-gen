import { retryFetch } from '@/lib/retry'

export interface ApolloContact {
  name: string
  title: string
  email: string | null
  linkedin_url: string | null
  organization_domain: string | null  // extracted from org response — backfills company_domain on leads
}

const TARGET_TITLES = [
  'CTO', 'Chief Technology Officer',
  'CPO', 'Chief Product Officer',
  'CIO', 'Chief Information Officer',
  'CISO', 'Chief Information Security Officer',
  'CFO', 'Chief Financial Officer',
  'VP Engineering', 'VP of Engineering',
  'VP Product', 'VP of Product',
  'Head of Engineering',
  'Head of Product',
  'Director of Engineering',
  'Director of Technology',
]

function extractDomain(raw: string): string | null {
  if (!raw) return null
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export async function searchApolloContacts(
  companyName: string,
  companyDomain?: string | null
): Promise<ApolloContact[]> {
  if (!process.env.APOLLO_API_KEY) return []

  const body: Record<string, unknown> = {
    api_key: process.env.APOLLO_API_KEY,
    per_page: 5,
    page: 1,
    person_titles: TARGET_TITLES,
    contact_email_status: ['verified'],
  }

  if (companyDomain) {
    body.q_organization_domains = [companyDomain]
  } else {
    body.q_organization_name = companyName
  }

  try {
    const res = await retryFetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return []
    const json = await res.json()
    const people: Record<string, unknown>[] = json.people || []

    return people
      .filter(p => p.email)
      .map(p => {
        const org = p.organization as Record<string, unknown> | null
        const rawDomain = String(org?.primary_domain || org?.website_url || '')
        return {
          name: String(p.name || ''),
          title: String(p.title || ''),
          email: p.email ? String(p.email) : null,
          linkedin_url: p.linkedin_url ? String(p.linkedin_url) : null,
          organization_domain: extractDomain(rawDomain),
        }
      })
  } catch (e) {
    console.error('Apollo search error:', e)
    return []
  }
}
