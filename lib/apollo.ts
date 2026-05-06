export interface ApolloCompany {
  name: string
  domain: string
  industry?: string
  employee_count?: number
  annual_revenue?: number
  location?: string
  linkedin_url?: string
}

export interface ApolloPerson {
  name: string
  firstName: string
  lastName: string
  title: string
  email?: string | null
  linkedinUrl?: string | null
  organizationDomain?: string | null
}

const APOLLO_TARGET_TITLES = [
  'CEO', 'Founder', 'Co-Founder', 'COO', 'CTO', 'CFO', 'CRO', 'CIO', 'CISO',
  'Chief Revenue Officer', 'Chief Operating Officer', 'Chief Technology Officer', 'Chief Financial Officer',
  'VP Sales', 'VP of Sales', 'VP Revenue', 'VP of Revenue',
  'VP Operations', 'VP of Operations', 'VP Engineering', 'VP of Engineering',
  'Head of Sales', 'Head of Revenue', 'Head of Operations', 'Head of Growth', 'Head of Engineering',
]

/**
 * Step 1: Search for people at a company domain using Apollo.
 * Returns names and titles (no emails — Apollo search doesn't return contact info).
 *
 * Uses /v1/mixed_people/api_search endpoint.
 * Does NOT consume credits on paid plans (search is free, enrichment costs credits).
 */
export async function apolloPeopleSearch(domain: string): Promise<ApolloPerson[]> {
  if (!process.env.APOLLO_API_KEY) return []

  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        person_titles: APOLLO_TARGET_TITLES,
        page: 1,
        per_page: 25,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      if (errText.includes('API_INACCESSIBLE')) {
        console.log('[apollo] people search unavailable on current plan. Will fall back to FullEnrich.')
        return []
      }
      console.error('[apollo] people search error:', res.status, errText)
      return []
    }

    const json = await res.json() as {
      people?: Array<Record<string, unknown>>
    }

    const people = json.people ?? []
    return people.map(parseApolloSearchPerson).filter((p): p is ApolloPerson => Boolean(p))
  } catch (error) {
    console.error('[apollo] people search error:', error)
    return []
  }
}

/**
 * Step 2: Enrich people with emails using Apollo bulk match.
 * Pass person IDs or name+domain combos. Returns emails when found.
 *
 * Uses /v1/people/bulk_match endpoint.
 * Consumes credits on paid plans.
 */
export async function apolloBulkEnrichPeople(
  inputs: Array<{ id?: string; firstName?: string; lastName?: string; domain?: string }>,
): Promise<ApolloPerson[]> {
  if (!process.env.APOLLO_API_KEY || inputs.length === 0) return []

  try {
    const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify({
        details: inputs.map(input => ({
          ...(input.id ? { id: input.id } : {}),
          ...(input.firstName ? { first_name: input.firstName } : {}),
          ...(input.lastName ? { last_name: input.lastName } : {}),
          ...(input.domain ? { domain: input.domain } : {}),
        })),
        reveal_personal_emails: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      if (errText.includes('API_INACCESSIBLE')) {
        console.log('[apollo] bulk enrich unavailable on current plan.')
        return []
      }
      console.error('[apollo] bulk enrich error:', res.status, errText)
      return []
    }

    const json = await res.json() as {
      matches?: Array<Record<string, unknown>>
    }

    const matches = json.matches ?? []
    return matches.map(parseApolloEnrichedPerson).filter((p): p is ApolloPerson => Boolean(p))
  } catch (error) {
    console.error('[apollo] bulk enrich error:', error)
    return []
  }
}

/**
 * Two-step Apollo workflow:
 * 1. Search for people at the company
 * 2. Bulk enrich to get emails
 *
 * Falls back gracefully if either step fails or plan doesn't support it.
 */
export async function apolloFindAndEnrichPeople(domain: string): Promise<ApolloPerson[]> {
  // Step 1: Search
  const searched = await apolloPeopleSearch(domain)
  if (searched.length === 0) return []

  // Step 2: Enrich with emails
  // Prioritize enriching people who have Apollo IDs; fall back to name+domain
  const enrichInputs = searched.map(person => ({
    firstName: person.firstName,
    lastName: person.lastName,
    domain,
  }))

  const enriched = await apolloBulkEnrichPeople(enrichInputs)

  // Merge search results with enriched emails
  const enrichedByName = new Map<string, ApolloPerson>()
  for (const person of enriched) {
    const key = `${person.firstName.toLowerCase()}::${person.lastName.toLowerCase()}::${person.title.toLowerCase()}`
    enrichedByName.set(key, person)
  }

  return searched.map(person => {
    const key = `${person.firstName.toLowerCase()}::${person.lastName.toLowerCase()}::${person.title.toLowerCase()}`
    const match = enrichedByName.get(key)
    if (match?.email) {
      return { ...person, email: match.email }
    }
    return person
  })
}

function parseApolloSearchPerson(person: Record<string, unknown>): ApolloPerson | null {
  const name = stringValue(person.name)
  const title = stringValue(person.title)
  if (!name || !title) return null

  const firstName = stringValue(person.first_name) || name.split(' ')[0] || ''
  const lastName = stringValue(person.last_name) || name.split(' ').slice(1).join(' ')

  const org = person.organization as Record<string, unknown> | undefined
  const organizationDomain = stringValue(org?.primary_domain) || stringValue(org?.domain)

  return {
    name,
    firstName,
    lastName,
    title,
    email: null,
    linkedinUrl: stringValue(person.linkedin_url) || null,
    organizationDomain: organizationDomain || null,
  }
}

function parseApolloEnrichedPerson(person: Record<string, unknown>): ApolloPerson | null {
  const name = stringValue(person.name)
  const title = stringValue(person.title)
  if (!name || !title) return null

  const firstName = stringValue(person.first_name) || name.split(' ')[0] || ''
  const lastName = stringValue(person.last_name) || name.split(' ').slice(1).join(' ')

  const email = stringValue(person.email)
  const linkedinUrl = stringValue(person.linkedin_url)

  const org = person.organization as Record<string, unknown> | undefined
  const organizationDomain = stringValue(org?.primary_domain) || stringValue(org?.domain)

  return {
    name,
    firstName,
    lastName,
    title,
    email: email || null,
    linkedinUrl: linkedinUrl || null,
    organizationDomain: organizationDomain || null,
  }
}

/**
 * Enrich a company domain using Apollo.io API.
 * Returns company data for verification/filter matching.
 *
 * Uses /v1/organizations/enrich endpoint.
 * Free tier: 50 API credits/month.
 * Paid: $49/mo for thousands of credits.
 */
export async function apolloCompanyEnrich(domain: string): Promise<ApolloCompany | null> {
  if (!process.env.APOLLO_API_KEY) return null

  try {
    const res = await fetch('https://api.apollo.io/api/v1/organizations/enrich', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
    })

    if (!res.ok) {
      if (res.status === 404) return null
      console.error('[apollo] enrich error:', res.status, await res.text().catch(() => ''))
      return null
    }

    const json = await res.json() as {
      organization?: {
        name?: string
        domain?: string
        industry?: string
        estimated_num_employees?: number
        annual_revenue_printed?: string
        city?: string
        state?: string
        country?: string
        linkedin_url?: string
      }
    }

    const org = json.organization
    if (!org?.name) return null

    return {
      name: org.name,
      domain: org.domain || domain,
      industry: org.industry,
      employee_count: org.estimated_num_employees,
      annual_revenue: parseRevenue(org.annual_revenue_printed),
      location: [org.city, org.state, org.country].filter(Boolean).join(', ') || undefined,
      linkedin_url: org.linkedin_url,
    }
  } catch (error) {
    console.error('[apollo] company enrich error:', error)
    return null
  }
}

function parseRevenue(value?: string | null): number | undefined {
  if (!value) return undefined
  const match = value.match(/\$?([\d.]+)\s*(million|billion|m|bn|b)?/i)
  if (!match) return undefined
  const num = Number(match[1])
  const unit = (match[2] || '').toLowerCase()
  if (unit.startsWith('b')) return Math.round(num * 1000000000)
  if (unit.startsWith('m')) return Math.round(num * 1000000)
  return Math.round(num)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Check if an Apollo-enriched company matches the user's explore filters.
 */
export function apolloCompanyMatchesFilters(
  company: ApolloCompany,
  filters: {
    industry?: string
    region?: string
    revenue?: string
    employee_count?: string
  },
): { matches: boolean; reason: string | null } {
  // Industry filter
  if (filters.industry && company.industry) {
    const filterIndustry = filters.industry.toLowerCase()
    const companyIndustry = company.industry.toLowerCase()
    if (!companyIndustry.includes(filterIndustry) && !filterIndustry.includes(companyIndustry)) {
      return { matches: false, reason: `Industry mismatch: ${company.industry} != ${filters.industry}` }
    }
  }

  // Region filter
  if (filters.region && company.location) {
    const filterRegion = filters.region.toLowerCase()
    const companyLocation = company.location.toLowerCase()
    if (!companyLocation.includes(filterRegion)) {
      return { matches: false, reason: `Region mismatch: ${company.location} != ${filters.region}` }
    }
  }

  // Employee count filter
  if (filters.employee_count && company.employee_count) {
    const count = company.employee_count
    const filter = filters.employee_count.toLowerCase()

    if (filter.includes('1-10') && (count < 1 || count > 10)) {
      return { matches: false, reason: `Employee count ${count} outside range 1-10` }
    }
    if (filter.includes('11-50') && (count < 11 || count > 50)) {
      return { matches: false, reason: `Employee count ${count} outside range 11-50` }
    }
    if (filter.includes('51-200') && (count < 51 || count > 200)) {
      return { matches: false, reason: `Employee count ${count} outside range 51-200` }
    }
    if (filter.includes('201-500') && (count < 201 || count > 500)) {
      return { matches: false, reason: `Employee count ${count} outside range 201-500` }
    }
    if (filter.includes('501-1000') && (count < 501 || count > 1000)) {
      return { matches: false, reason: `Employee count ${count} outside range 501-1000` }
    }
    if (filter.includes('1000+') && count < 1000) {
      return { matches: false, reason: `Employee count ${count} below 1000` }
    }
  }

  // Revenue filter
  if (filters.revenue && company.annual_revenue) {
    const revenue = company.annual_revenue
    const filter = filters.revenue.toLowerCase()

    if (filter.includes('1m') && revenue < 1000000) {
      return { matches: false, reason: `Revenue $${revenue} below $1M` }
    }
    if (filter.includes('10m') && revenue < 10000000) {
      return { matches: false, reason: `Revenue $${revenue} below $10M` }
    }
    if (filter.includes('100m') && revenue < 100000000) {
      return { matches: false, reason: `Revenue $${revenue} below $100M` }
    }
  }

  return { matches: true, reason: null }
}
