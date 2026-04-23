import { retryFetch } from '@/lib/retry'

export interface FullEnrichPerson {
  name: string
  firstName: string
  lastName: string
  title: string
  linkedinUrl: string | null
  companyDomain: string | null
}

const TARGET_TITLES = [
  'CEO',
  'Founder',
  'Co-Founder',
  'COO',
  'CTO',
  'CFO',
  'CRO',
  'CIO',
  'CISO',
  'Chief Revenue Officer',
  'Chief Operating Officer',
  'Chief Technology Officer',
  'Chief Financial Officer',
  'VP Sales',
  'VP of Sales',
  'VP Revenue',
  'VP of Revenue',
  'VP Operations',
  'VP of Operations',
  'VP Engineering',
  'VP of Engineering',
  'Head of Sales',
  'Head of Revenue',
  'Head of Operations',
  'Head of Growth',
  'Head of Engineering',
]

export async function searchFullEnrichPeople(
  companyName: string,
  companyDomain?: string | null,
): Promise<FullEnrichPerson[]> {
  if (!process.env.FULLENRICH_API_KEY) return []

  const filters: Record<string, unknown> = {
    current_position_titles: TARGET_TITLES.map(value => ({
      value,
      exact_match: false,
      exclude: false,
    })),
  }

  if (companyDomain) {
    filters.current_company_domains = [{
      value: companyDomain,
      exact_match: true,
      exclude: false,
    }]
  } else {
    filters.current_company_names = [{
      value: companyName,
      exact_match: true,
      exclude: false,
    }]
  }

  try {
    const res = await retryFetch('https://app.fullenrich.com/api/v2/people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FULLENRICH_API_KEY}`,
      },
      body: JSON.stringify({
        page: 1,
        page_size: 20,
        ...filters,
      }),
    })

    if (!res.ok) return []
    const json = await res.json() as {
      people?: Array<Record<string, unknown>>
      data?: { people?: Array<Record<string, unknown>> }
    }
    const people = json.people ?? json.data?.people ?? []

    return people
      .map(parseFullEnrichPerson)
      .filter((person): person is FullEnrichPerson => Boolean(person))
  } catch (error) {
    console.error('FullEnrich search error:', error)
    return []
  }
}

function parseFullEnrichPerson(person: Record<string, unknown>): FullEnrichPerson | null {
  const employment = person.employment as { current?: Record<string, unknown> } | undefined
  const current = employment?.current ?? {}
  const socialProfiles = person.social_profiles as { linkedin?: { url?: string } } | undefined

  const name = stringValue(person.full_name) || [stringValue(person.first_name), stringValue(person.last_name)].filter(Boolean).join(' ')
  const firstName = stringValue(person.first_name) || name.split(' ')[0] || ''
  const lastName = stringValue(person.last_name) || name.split(' ').slice(1).join(' ')
  const title = stringValue(current.title) || stringValue(person.title)
  if (!name || !title) return null

  return {
    name,
    firstName,
    lastName,
    title,
    linkedinUrl: stringValue(socialProfiles?.linkedin?.url) || null,
    companyDomain: normalizeDomain(stringValue(current.company_domain) || stringValue((current.company as Record<string, unknown> | undefined)?.domain)),
  }
}

function normalizeDomain(raw: string): string | null {
  if (!raw) return null
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return raw.replace(/^www\./, '').trim().toLowerCase() || null
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
