import { buildApolloPersonTitles, type ContactRoleKey } from './contact-targeting.ts'

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

export interface ApolloOrganizationSearchParams {
  query?: string | null
  page?: number
  perPage?: number
  industry?: string | null
  region?: string | string[] | null
  employeeRange?: string | null
  revenueMin?: number | null
  revenueMax?: number | null
  latestFundingMin?: number | null
  latestFundingMax?: number | null
  latestFundingDateMin?: string | null
  latestFundingDateMax?: string | null
  jobTitles?: string[] | null
  minOpenJobs?: number | null
  maxOpenJobs?: number | null
  jobPostedDateMin?: string | null
  jobPostedDateMax?: string | null
}

/**
 * Step 1: Search for people at a company domain using Apollo.
 * Returns names and titles (no emails — Apollo search doesn't return contact info).
 *
 * Uses /v1/mixed_people/api_search endpoint.
 * Does NOT consume credits on paid plans (search is free, enrichment costs credits).
 */
export async function apolloPeopleSearch(
  domain: string,
  options?: {
    personTitles?: string[]
    perPage?: number
  },
): Promise<ApolloPerson[]> {
  if (!process.env.APOLLO_API_KEY) return []
  const personTitles = options?.personTitles && options.personTitles.length > 0
    ? options.personTitles
    : buildApolloPersonTitles()
  const perPage = Math.max(5, Math.min(options?.perPage ?? 12, 25))

  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        person_titles: personTitles,
        page: 1,
        per_page: perPage,
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
export async function apolloFindAndEnrichPeople(
  domain: string,
  options?: {
    selectedRoles?: ContactRoleKey[]
    personTitles?: string[]
    maxEnrichCandidates?: number
  },
): Promise<ApolloPerson[]> {
  const personTitles = options?.personTitles ?? buildApolloPersonTitles(options?.selectedRoles)
  const maxEnrichCandidates = Math.max(3, Math.min(options?.maxEnrichCandidates ?? 9, 15))
  // Step 1: Search
  const searched = await apolloPeopleSearch(domain, {
    personTitles,
    perPage: maxEnrichCandidates,
  })
  if (searched.length === 0) return []

  // Step 2: Enrich with emails
  // Prioritize enriching people who have Apollo IDs; fall back to name+domain
  const enrichInputs = searched.slice(0, maxEnrichCandidates).map(person => ({
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

/**
 * Search organizations in Apollo.
 * Uses /v1/mixed_companies/search.
 * This endpoint consumes credits.
 */
export async function apolloOrganizationSearch(params: ApolloOrganizationSearchParams): Promise<ApolloCompany[]> {
  if (!process.env.APOLLO_API_KEY) return []

  const query = typeof params.query === 'string' ? params.query.trim() : ''
  const page = Math.max(1, Math.min(params.page ?? 1, 500))
  const perPage = Math.max(5, Math.min(params.perPage ?? 25, 100))

  const requestBody: Record<string, unknown> = {
    page,
    per_page: perPage,
  }
  if (query) {
    requestBody.q_organization_name = query
  }

  if (params.industry?.trim()) {
    requestBody.q_organization_keyword_tags = [params.industry.trim()]
  }
  if (typeof params.region === 'string' && params.region.trim()) {
    requestBody.organization_locations = [params.region.trim()]
  } else if (Array.isArray(params.region)) {
    const locations = params.region.map(value => value.trim()).filter(Boolean).slice(0, 8)
    if (locations.length > 0) {
      requestBody.organization_locations = locations
    }
  }
  if (params.employeeRange?.trim()) {
    requestBody.organization_num_employees_ranges = [params.employeeRange.trim()]
  }
  if (typeof params.revenueMin === 'number' && Number.isFinite(params.revenueMin) && params.revenueMin > 0) {
    requestBody['revenue_range[min]'] = Math.round(params.revenueMin)
  }
  if (typeof params.revenueMax === 'number' && Number.isFinite(params.revenueMax) && params.revenueMax > 0) {
    requestBody['revenue_range[max]'] = Math.round(params.revenueMax)
  }
  if (typeof params.latestFundingMin === 'number' && Number.isFinite(params.latestFundingMin) && params.latestFundingMin > 0) {
    requestBody['latest_funding_amount_range[min]'] = Math.round(params.latestFundingMin)
  }
  if (typeof params.latestFundingMax === 'number' && Number.isFinite(params.latestFundingMax) && params.latestFundingMax > 0) {
    requestBody['latest_funding_amount_range[max]'] = Math.round(params.latestFundingMax)
  }
  if (typeof params.latestFundingDateMin === 'string' && params.latestFundingDateMin.trim()) {
    requestBody['latest_funding_date_range[min]'] = params.latestFundingDateMin.trim()
  }
  if (typeof params.latestFundingDateMax === 'string' && params.latestFundingDateMax.trim()) {
    requestBody['latest_funding_date_range[max]'] = params.latestFundingDateMax.trim()
  }
  if (Array.isArray(params.jobTitles) && params.jobTitles.length > 0) {
    requestBody.q_organization_job_titles = params.jobTitles.slice(0, 8)
  }
  if (typeof params.minOpenJobs === 'number' && Number.isFinite(params.minOpenJobs) && params.minOpenJobs >= 0) {
    requestBody['organization_num_jobs_range[min]'] = Math.round(params.minOpenJobs)
  }
  if (typeof params.maxOpenJobs === 'number' && Number.isFinite(params.maxOpenJobs) && params.maxOpenJobs >= 0) {
    requestBody['organization_num_jobs_range[max]'] = Math.round(params.maxOpenJobs)
  }
  if (typeof params.jobPostedDateMin === 'string' && params.jobPostedDateMin.trim()) {
    requestBody['organization_job_posted_at_range[min]'] = params.jobPostedDateMin.trim()
  }
  if (typeof params.jobPostedDateMax === 'string' && params.jobPostedDateMax.trim()) {
    requestBody['organization_job_posted_at_range[max]'] = params.jobPostedDateMax.trim()
  }

  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      if (errText.includes('API_INACCESSIBLE')) {
        console.log('[apollo] organization search unavailable on current plan.')
        return []
      }
      console.error('[apollo] organization search error:', res.status, errText)
      return []
    }

    const json = await res.json() as {
      organizations?: Array<Record<string, unknown>>
      companies?: Array<Record<string, unknown>>
      accounts?: Array<Record<string, unknown>>
    }

    const raw = json.organizations ?? json.companies ?? json.accounts ?? []
    const deduped = new Map<string, ApolloCompany>()
    for (const row of raw) {
      const parsed = parseApolloSearchOrganization(row)
      if (!parsed) continue
      const key = (parsed.domain || parsed.name).toLowerCase()
      if (!deduped.has(key)) deduped.set(key, parsed)
    }
    return [...deduped.values()]
  } catch (error) {
    console.error('[apollo] organization search error:', error)
    return []
  }
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
    const url = new URL('https://api.apollo.io/api/v1/organizations/enrich')
    url.searchParams.set('domain', domain)

    const res = await fetch(url.toString(), {
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

function parseApolloSearchOrganization(row: Record<string, unknown>): ApolloCompany | null {
  const name = stringValue(row.name) || stringValue(row.organization_name)
  if (!name) return null

  const domain = (
    stringValue(row.primary_domain) ||
    stringValue(row.website_url).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') ||
    ''
  ).toLowerCase()

  const employeeCountRaw = row.estimated_num_employees
  const employeeCount = typeof employeeCountRaw === 'number'
    ? Math.max(0, Math.round(employeeCountRaw))
    : undefined

  const city = stringValue(row.city)
  const state = stringValue(row.state)
  const country = stringValue(row.country)
  const location = [city, state, country].filter(Boolean).join(', ') || undefined

  return {
    name,
    domain,
    industry: stringValue(row.industry) || undefined,
    employee_count: employeeCount,
    annual_revenue: parseRevenue(stringValue(row.annual_revenue_printed)) ?? undefined,
    location,
    linkedin_url: stringValue(row.linkedin_url) || undefined,
  }
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
    const filterRegion = filters.region.toLowerCase().trim()
    const companyLocation = company.location.toLowerCase()
    const aliases = regionAliases(filterRegion)
    if (!aliases.some(alias => companyLocation.includes(alias))) {
      return { matches: false, reason: `Region mismatch: ${company.location} != ${filters.region}` }
    }
  }

  // Employee count filter
  if (filters.employee_count && company.employee_count) {
    const count = company.employee_count
    const employeeRange = employeeRangeForFilter(filters.employee_count)
    if (employeeRange) {
      if (employeeRange.min !== null && count < employeeRange.min) {
        return { matches: false, reason: `Employee count ${count} below ${employeeRange.min}` }
      }
      if (employeeRange.max !== null && count > employeeRange.max) {
        return { matches: false, reason: `Employee count ${count} above ${employeeRange.max}` }
      }
    }
  }

  // Revenue filter
  if (filters.revenue && company.annual_revenue) {
    const revenue = company.annual_revenue
    const revenueRange = revenueRangeForFilter(filters.revenue)
    if (revenueRange) {
      if (revenueRange.min !== null && revenue < revenueRange.min) {
        return { matches: false, reason: `Revenue $${revenue} below ${revenueRange.min}` }
      }
      if (revenueRange.max !== null && revenue > revenueRange.max) {
        return { matches: false, reason: `Revenue $${revenue} above ${revenueRange.max}` }
      }
    }
  }

  return { matches: true, reason: null }
}

function employeeRangeForFilter(value: string): { min: number | null; max: number | null } | null {
  switch (value.trim()) {
    case '1-10':
      return { min: 1, max: 10 }
    case '11-50':
      return { min: 11, max: 50 }
    case '51-200':
      return { min: 51, max: 200 }
    case '201-500':
      return { min: 201, max: 500 }
    case '501-1000':
      return { min: 501, max: 1000 }
    case '1001-5000':
      return { min: 1001, max: 5000 }
    case '5000+':
      return { min: 5000, max: null }
    default:
      return null
  }
}

function revenueRangeForFilter(value: string): { min: number | null; max: number | null } | null {
  switch (value.trim()) {
    case 'Under $1M':
      return { min: null, max: 1_000_000 }
    case '$1M-$10M':
      return { min: 1_000_000, max: 10_000_000 }
    case '$10M-$50M':
      return { min: 10_000_000, max: 50_000_000 }
    case '$50M-$250M':
      return { min: 50_000_000, max: 250_000_000 }
    case '$250M+':
      return { min: 250_000_000, max: null }
    default:
      return null
  }
}

function regionAliases(filterRegion: string): string[] {
  switch (filterRegion) {
    case 'united states':
      return ['united states', 'usa', 'us']
    case 'north america':
      return ['north america', 'united states', 'usa', 'canada', 'mexico']
    case 'united kingdom':
      return ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland']
    case 'europe':
      return ['europe', 'germany', 'france', 'spain', 'italy', 'netherlands', 'sweden', 'norway', 'denmark', 'ireland', 'switzerland', 'austria', 'portugal']
    case 'india':
      return ['india']
    case 'asia pacific':
      return ['asia pacific', 'apac', 'india', 'singapore', 'australia', 'new zealand', 'japan', 'korea', 'hong kong']
    case 'middle east':
      return ['middle east', 'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'bahrain', 'oman', 'kuwait', 'israel']
    case 'global english-speaking markets':
      return ['united states', 'usa', 'united kingdom', 'uk', 'canada', 'australia', 'new zealand', 'ireland', 'singapore']
    default:
      return [filterRegion]
  }
}
