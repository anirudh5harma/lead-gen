import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { searchFullEnrichPeople } from './fullenrich'
import { hunterDomainSearch, constructEmailCandidates } from './hunter'
import { verifyEmail, verifyEmailsBatch, isSafeToSend, type ZBStatus } from './zeroBounce'
import { scrapeCompanyPeople } from './firecrawl'
import { apolloFindAndEnrichPeople } from '../apollo'
import { rankContactsForUseCase, baseContactScore } from './ranking'
import {
  compareCachedContactRows,
  isCandidateSafeWithoutVerification,
  shouldShortCircuitEnrichmentFailure,
} from './enrich-helpers'
import { cleanPersonName, emailContainsProfessionalSuffix } from '../person-normalization'
import { normalizeLeadCompanyKey } from '../lead-dedupe'
import { normalizeLeadFeedSnapshot } from '../lead-sources'
import {
  buildApolloPersonTitles,
  contactTitleMatchesRoles,
  type ContactRoleKey,
} from '../contact-targeting'

const CACHE_TTL_DAYS = 30
const VERIFIED_SEND_CACHE_TTL_DAYS = 7
const VALIDATION_CACHE_TTL_DAYS = 90
const RETRY_AFTER_DAYS = 21
const MAX_CONTACTS_PER_COMPANY = 3
const TARGET_SAFE_CONTACTS = 3
const MIN_SAFE_CONTACTS = 1
const MAX_DIRECT_CANDIDATES = 5
const MAX_PATTERN_PEOPLE = 3
const MAX_PATTERNS_PER_PERSON = 2
const MAX_ROLE_FALLBACKS = 3
const MIN_DIRECT_EMAILS_BEFORE_SKIPPING_FULLENRICH = 2
const VALIDATION_MULTIPLIER_DIRECT = 2
const VALIDATION_MULTIPLIER_PATTERN = 2
const VALIDATION_MULTIPLIER_ROLE = 1
const CONTACT_PROVIDER_MODE_DEFAULT = 'apollo_fullenrich'

type ContactSource = 'apollo' | 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
type ResolutionMethod = 'direct' | 'pattern' | 'role'

interface CachedContactRow {
  contact_email: string
  contact_name: string | null
  contact_title: string | null
  contact_source: ContactSource
  contact_verified: boolean
  zb_status: ZBStatus | null
  linkedin_url: string | null
  base_score: number
  resolution_method: ResolutionMethod | null
  enriched_at: string
}

interface CandidatePerson {
  name: string
  title: string
  firstName: string
  lastName: string
  directEmail: string | null
  linkedinUrl: string | null
  source: ContactSource
  baseScore: number
}

interface ContactCandidateRecord {
  identityKey: string
  name: string
  title: string
  email: string
  source: ContactSource
  baseScore: number
  linkedinUrl: string | null
  resolutionMethod: ResolutionMethod
  directSource?: CandidatePerson['source'] | null
}

interface RoleFallbackCandidate {
  name: string
  title: string
  email: string
  baseScore: number
}

interface ContactResolutionResult {
  contacts: EnrichedContact[]
  resolvedDomain: string | null
  metrics: EnrichMetrics
}

interface ValidationCacheRow {
  email: string
  status: ZBStatus
  sub_status: string | null
  free_email: boolean | null
  mx_found: boolean | null
  did_you_mean: string | null
  verified_at: string
}

interface CompanyEnrichmentCacheRow {
  company_key: string
  input_domain: string | null
  resolved_domain: string | null
  last_succeeded_at: string | null
  last_failed_at: string | null
}

export interface EnrichedContact {
  email: string
  name: string
  title: string
  source: ContactSource
  verified: boolean
  zb_status?: ZBStatus
  linkedin_url?: string | null
  base_score?: number
  resolution_method?: ResolutionMethod
  enriched_at?: string
}

export interface EnrichMetrics {
  zb_validations_requested: number
  zb_cache_hits: number
  contacts_selected: number
  contact_mix: Record<ResolutionMethod, number>
  negative_cache_hit: boolean
}

export interface EnrichResult {
  contact: EnrichedContact | null
  contacts: EnrichedContact[]
  resolvedDomain: string | null
  fromCache: boolean
  metrics: EnrichMetrics
}

const inFlightContactResolution = new Map<string, Promise<ContactResolutionResult>>()

async function readCache(
  domain: string | null,
  companyKey: string,
  supabase: SupabaseClient,
): Promise<EnrichedContact[]> {
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const queries = [
    domain
      ? supabase
          .from('company_contact_candidates')
          .select('contact_email, contact_name, contact_title, contact_source, contact_verified, zb_status, linkedin_url, base_score, resolution_method, enriched_at')
          .eq('domain', domain)
          .gte('enriched_at', cutoff)
          .order('base_score', { ascending: false })
          .order('enriched_at', { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
    supabase
      .from('company_contact_candidates')
      .select('contact_email, contact_name, contact_title, contact_source, contact_verified, zb_status, linkedin_url, base_score, resolution_method, enriched_at')
      .eq('company_key', companyKey)
      .gte('enriched_at', cutoff)
      .order('base_score', { ascending: false })
      .order('enriched_at', { ascending: false })
      .limit(12),
  ]

  const results = await Promise.all(queries)
  const mergedRows = dedupeCachedContacts(
    results.flatMap(result => (result.data ?? []) as CachedContactRow[]),
  )

  const contacts = mergedRows
    .filter(row => !emailContainsProfessionalSuffix(row.contact_email, row.contact_name))
    .map(row => ({
    email: row.contact_email,
    name: cleanPersonName(row.contact_name) || (row.contact_name ?? ''),
    title: row.contact_title ?? '',
    source: row.contact_source,
    verified: row.contact_verified,
    zb_status: row.zb_status ?? undefined,
    linkedin_url: row.linkedin_url,
    base_score: row.base_score ?? 0,
    resolution_method: row.resolution_method ?? 'pattern',
    enriched_at: row.enriched_at,
  }))

  if (contacts.length > 0) return contacts

  if (!domain) return []

  const { data: legacy } = await supabase
    .from('company_contacts')
    .select('contact_email, contact_name, contact_title, contact_source, contact_verified, zb_status')
    .eq('domain', domain)
    .gte('enriched_at', cutoff)
    .maybeSingle()

  if (!legacy?.contact_email) return []
  if (emailContainsProfessionalSuffix(legacy.contact_email, legacy.contact_name)) return []
  return [{
    email: legacy.contact_email,
    name: cleanPersonName(legacy.contact_name) || (legacy.contact_name ?? ''),
    title: legacy.contact_title ?? '',
    source: legacy.contact_source as ContactSource,
    verified: legacy.contact_verified,
    zb_status: legacy.zb_status as ZBStatus | undefined,
    base_score: 0,
    resolution_method: legacy.contact_verified ? 'direct' : 'pattern',
    enriched_at: new Date().toISOString(),
  }]
}

async function writeCache(
  domain: string,
  companyKey: string,
  contacts: EnrichedContact[],
  supabase: SupabaseClient,
): Promise<void> {
  if (!contacts.length) return
  const now = new Date().toISOString()
  await supabase.from('company_contact_candidates').upsert(
    contacts.map(contact => ({
      domain,
      company_key: companyKey,
      contact_email: contact.email.toLowerCase(),
      contact_name: cleanPersonName(contact.name) || null,
      contact_title: contact.title || null,
      contact_source: contact.source,
      contact_verified: contact.verified,
      zb_status: contact.zb_status ?? null,
      linkedin_url: contact.linkedin_url ?? null,
      base_score: contact.base_score ?? 0,
      resolution_method: contact.resolution_method ?? null,
      enriched_at: now,
    })),
    { onConflict: 'domain,contact_email' },
  )
}

function rankForUser(
  contacts: EnrichedContact[],
  servicesDescription?: string | null,
  signalType?: string | null,
  maxContacts = MAX_CONTACTS_PER_COMPANY,
): EnrichedContact[] {
  return rankContactsForUseCase(contacts, servicesDescription, signalType).slice(0, maxContacts)
}

function filterContactsByRolePreference(
  contacts: EnrichedContact[],
  targetRoles?: ContactRoleKey[],
): EnrichedContact[] {
  if (!targetRoles || targetRoles.length === 0) return contacts
  const filtered = contacts.filter(contact => contactTitleMatchesRoles(contact.title, targetRoles))
  return filtered.length > 0 ? filtered : contacts
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = cleanPersonName(fullName).split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

function extractMostCommonDomain(people: Array<{ companyDomain?: string | null; organizationDomain?: string | null }>): string | null {
  const counts = new Map<string, number>()
  for (const person of people) {
    const domain = person.companyDomain || person.organizationDomain
    if (domain) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  let bestDomain: string | null = null
  let bestCount = 0
  for (const [domain, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestDomain = domain
    }
  }
  return bestDomain
}

function dedupePeople(people: CandidatePerson[]): CandidatePerson[] {
  const merged = new Map<string, CandidatePerson>()
  for (const person of people) {
    const key = (person.linkedinUrl?.toLowerCase() || `${person.name.toLowerCase()}::${person.title.toLowerCase()}`).trim()
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, person)
      continue
    }
    merged.set(key, {
      ...existing,
      directEmail: existing.directEmail || person.directEmail,
      linkedinUrl: existing.linkedinUrl || person.linkedinUrl,
      source: existing.directEmail ? existing.source : person.directEmail ? person.source : existing.source,
      baseScore: Math.max(existing.baseScore, person.baseScore),
    })
  }
  return Array.from(merged.values())
}

function dedupeCachedContacts(rows: CachedContactRow[]): CachedContactRow[] {
  const merged = new Map<string, CachedContactRow>()
  for (const row of rows) {
    const key = row.contact_email.toLowerCase()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, row)
      continue
    }
    if (compareCachedContactRows(row, existing) > 0) {
      merged.set(key, row)
    }
  }
  return [...merged.values()]
}

function buildEmptyMetrics(): EnrichMetrics {
  return {
    zb_validations_requested: 0,
    zb_cache_hits: 0,
    contacts_selected: 0,
    contact_mix: { direct: 0, pattern: 0, role: 0 },
    negative_cache_hit: false,
  }
}

function isFreshVerifiedContact(contact: EnrichedContact): boolean {
  if (!contact.verified) return false
  if (!contact.enriched_at) return false
  const cutoff = Date.now() - VERIFIED_SEND_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  return Date.parse(contact.enriched_at) >= cutoff
}

async function readCompanyEnrichmentCache(
  companyKey: string,
  supabase: SupabaseClient,
): Promise<CompanyEnrichmentCacheRow | null> {
  const { data } = await supabase
    .from('company_enrichment_cache')
    .select('company_key, input_domain, resolved_domain, last_succeeded_at, last_failed_at')
    .eq('company_key', companyKey)
    .maybeSingle()

  return (data as CompanyEnrichmentCacheRow | null) ?? null
}

async function writeCompanyEnrichmentCache(
  params: {
    companyKey: string
    companyName: string
    inputDomain: string | null
    resolvedDomain: string | null
    contactCount: number
    zbValidationsUsed: number
    previousLastSucceededAt?: string | null
  },
  supabase: SupabaseClient,
): Promise<void> {
  const now = new Date().toISOString()
  await supabase
    .from('company_enrichment_cache')
    .upsert({
      company_key: params.companyKey,
      company_name: params.companyName,
      input_domain: params.inputDomain,
      resolved_domain: params.resolvedDomain,
      last_attempted_at: now,
      last_succeeded_at: params.contactCount > 0 ? now : params.previousLastSucceededAt ?? null,
      last_failed_at: params.contactCount === 0 ? now : null,
      last_contact_count: params.contactCount,
      zb_validations_used: params.zbValidationsUsed,
    }, { onConflict: 'company_key' })
}

async function readValidationCache(
  emails: string[],
  supabase: SupabaseClient,
  maxAgeDays = VALIDATION_CACHE_TTL_DAYS,
): Promise<Map<string, ValidationCacheRow>> {
  const normalized = [...new Set(emails.map(email => email.toLowerCase()))]
  if (normalized.length === 0) return new Map()

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('email_validation_cache')
    .select('email, status, sub_status, free_email, mx_found, did_you_mean, verified_at')
    .in('email', normalized)
    .gte('verified_at', cutoff)

  return new Map(((data ?? []) as ValidationCacheRow[]).map(row => [row.email.toLowerCase(), row]))
}

async function writeValidationCache(
  results: Array<{
    email: string
    status: ZBStatus
    sub_status?: string | null
    free_email?: boolean | null
    mx_found?: boolean | null
    did_you_mean?: string | null
  }>,
  supabase: SupabaseClient,
): Promise<void> {
  if (results.length === 0) return
  const now = new Date().toISOString()
  await supabase
    .from('email_validation_cache')
    .upsert(results.map(result => ({
      email: result.email.toLowerCase(),
      status: result.status,
      sub_status: result.sub_status ?? null,
      free_email: result.free_email ?? null,
      mx_found: result.mx_found ?? null,
      did_you_mean: result.did_you_mean ?? null,
      verified_at: now,
    })), { onConflict: 'email' })
}

async function verifyEmailsWithCache(
  emails: string[],
  supabase: SupabaseClient,
): Promise<{
  results: Map<string, ValidationCacheRow>
  billedCount: number
  cacheHits: number
}> {
  const normalized = [...new Set(emails.map(email => email.toLowerCase()))]
  const cached = await readValidationCache(normalized, supabase)
  const uncached = normalized.filter(email => !cached.has(email))

  if (uncached.length === 0) {
    return {
      results: cached,
      billedCount: 0,
      cacheHits: normalized.length,
    }
  }

  const fresh = await verifyEmailsBatch(uncached)
  await writeValidationCache(fresh, supabase)

  for (const result of fresh) {
    cached.set(result.email.toLowerCase(), {
      email: result.email.toLowerCase(),
      status: result.status,
      sub_status: result.sub_status ?? null,
      free_email: null,
      mx_found: null,
      did_you_mean: null,
      verified_at: new Date().toISOString(),
    })
  }

  return {
    results: cached,
    billedCount: uncached.length,
    cacheHits: normalized.length - uncached.length,
  }
}

async function collectCandidatePeople(
  companyName: string,
  companyDomain: string | null,
  options?: {
    targetRoles?: ContactRoleKey[]
    maxApolloCandidates?: number
  },
): Promise<{ resolvedDomain: string | null; people: CandidatePerson[]; hunterPattern: string | null }> {
  const providerMode = (process.env.CONTACT_PROVIDER_MODE || CONTACT_PROVIDER_MODE_DEFAULT).toLowerCase()
  const fullEnrichEnabled = process.env.FULLENRICH_ENABLED !== 'false' && (
    providerMode === 'apollo_fullenrich' || providerMode === 'all'
  )
  const hunterEnabled = process.env.HUNTER_ENABLED !== 'false' && (
    providerMode === 'apollo_hunter' || providerMode === 'all'
  )
  const apolloPersonTitles = buildApolloPersonTitles(options?.targetRoles)
  const maxApolloCandidates = Math.max(6, Math.min(options?.maxApolloCandidates ?? 9, 15))

  // Stage 1: cheaper/high-confidence sources first.
  const [apolloPeople, scrapedPeople, hunterResult] = await Promise.all([
    companyDomain
      ? apolloFindAndEnrichPeople(companyDomain, {
          selectedRoles: options?.targetRoles,
          personTitles: apolloPersonTitles,
          maxEnrichCandidates: maxApolloCandidates,
        })
      : Promise.resolve([]),
    companyDomain ? scrapeCompanyPeople(companyDomain) : Promise.resolve([]),
    (companyDomain && hunterEnabled)
      ? hunterDomainSearch(companyDomain)
      : Promise.resolve({ emailPattern: null, contacts: [] }),
  ])

  const apolloDirectEmailCount = apolloPeople.reduce((count, person) => (
    count + (typeof person.email === 'string' && person.email.trim() ? 1 : 0)
  ), 0)

  // Stage 2: call FullEnrich only when primary sources look thin.
  const shouldUseFullEnrich = fullEnrichEnabled && (
    apolloPeople.length === 0 || apolloDirectEmailCount < MIN_DIRECT_EMAILS_BEFORE_SKIPPING_FULLENRICH
  )
  const fullEnrichPeople = shouldUseFullEnrich
    ? await searchFullEnrichPeople(companyName, companyDomain)
    : []

  let resolvedDomain = companyDomain
  if (!resolvedDomain) {
    resolvedDomain = extractMostCommonDomain(apolloPeople) || extractMostCommonDomain(fullEnrichPeople)
  }

  // Use Apollo as primary source. If Apollo is sparse, enrich with FullEnrich.
  const primaryPeople = apolloPeople.length > 0
    ? apolloPeople.concat(fullEnrichPeople)
    : fullEnrichPeople

  const people: CandidatePerson[] = [
    ...primaryPeople.map(person => ({
      name: cleanPersonName(person.name) || person.name,
      title: person.title,
      firstName: splitName(person.name).firstName || person.firstName,
      lastName: splitName(person.name).lastName || person.lastName,
      directEmail: 'email' in person ? (person.email ?? null) : null,
      linkedinUrl: person.linkedinUrl ?? null,
      source: ('email' in person ? 'apollo' : 'fullenrich') as ContactSource,
      baseScore: baseContactScore(person.title) + ('email' in person && person.email ? 5 : 0),
    })),
    ...scrapedPeople.map(person => {
      const split = splitName(person.name)
      return {
        name: cleanPersonName(person.name) || person.name,
        title: person.title,
        firstName: split.firstName,
        lastName: split.lastName,
        directEmail: person.email ?? null,
        linkedinUrl: null,
        source: 'scrape' as const,
        baseScore: baseContactScore(person.title),
      }
    }),
    ...hunterResult.contacts.map(contact => {
      const split = splitName(contact.name)
      return {
        name: cleanPersonName(contact.name) || contact.name,
        title: contact.title,
        firstName: split.firstName,
        lastName: split.lastName,
        directEmail: contact.email,
        linkedinUrl: null,
        source: 'hunter' as const,
        baseScore: baseContactScore(contact.title) + Math.min(10, Math.round(contact.confidence / 10)),
      }
    }),
  ]

  return {
    resolvedDomain,
    people: dedupePeople(people).filter(person => person.name && person.title),
    hunterPattern: hunterResult.emailPattern,
  }
}

async function resolveContacts(
  companyName: string,
  companyDomain: string | null,
  supabase: SupabaseClient,
  options?: {
    targetSafeContacts?: number
    minSafeContacts?: number
    targetRoles?: ContactRoleKey[]
  },
): Promise<ContactResolutionResult> {
  const targetSafeContacts = Math.max(1, Math.min(6, Math.round(options?.targetSafeContacts ?? TARGET_SAFE_CONTACTS)))
  const { people, resolvedDomain, hunterPattern } = await collectCandidatePeople(companyName, companyDomain, {
    targetRoles: options?.targetRoles,
    maxApolloCandidates: Math.max(targetSafeContacts * 3, 6),
  })
  if (!resolvedDomain || people.length === 0) {
    return { contacts: [], resolvedDomain, metrics: buildEmptyMetrics() }
  }

  const minSafeContacts = Math.max(1, Math.min(targetSafeContacts, Math.round(options?.minSafeContacts ?? MIN_SAFE_CONTACTS)))

  const rankedPeople = rankContactsForUseCase(
    people.map(person => ({
      name: person.name,
      title: person.title,
      email: person.directEmail ?? `${person.name}-${person.title}`,
      verified: person.source === 'hunter',
      source: person.source,
      linkedinUrl: person.linkedinUrl,
    })),
    null,
    null,
  ).map(item => people.find(person => person.name === item.name && person.title === item.title)!).slice(0, 8)

  const metrics = buildEmptyMetrics()
  const selectedByIdentity = new Map<string, EnrichedContact>()
  const usedEmails = new Set<string>()

  const directCandidates: ContactCandidateRecord[] = rankedPeople
    .filter(person => person.directEmail)
    .slice(0, MAX_DIRECT_CANDIDATES)
    .map(person => ({
      identityKey: `${person.name.toLowerCase()}::${person.title.toLowerCase()}`,
      name: person.name,
      title: person.title,
      email: person.directEmail!.toLowerCase(),
      source: person.source,
      baseScore: person.baseScore,
      linkedinUrl: person.linkedinUrl,
      resolutionMethod: 'direct',
      directSource: person.source,
    }))

  await applyValidationStage(directCandidates, selectedByIdentity, usedEmails, supabase, metrics, {
    targetSafeContacts,
    stageType: 'direct',
  })

  if (selectedByIdentity.size < targetSafeContacts) {
    const patternCandidates: ContactCandidateRecord[] = []
    for (const person of rankedPeople.filter(person => !person.directEmail).slice(0, MAX_PATTERN_PEOPLE)) {
      if (!person.firstName || !person.lastName) continue
      const candidates = constructEmailCandidates(person.firstName, person.lastName, resolvedDomain, hunterPattern)
        .slice(0, MAX_PATTERNS_PER_PERSON)
      for (const email of candidates) {
        patternCandidates.push({
          identityKey: `${person.name.toLowerCase()}::${person.title.toLowerCase()}`,
          name: person.name,
          title: person.title,
          email: email.toLowerCase(),
          source: 'pattern',
          baseScore: person.baseScore,
          linkedinUrl: person.linkedinUrl,
          resolutionMethod: 'pattern',
          directSource: null,
        })
      }
    }
    await applyValidationStage(patternCandidates, selectedByIdentity, usedEmails, supabase, metrics, {
      targetSafeContacts,
      stageType: 'pattern',
    })
  }

  if (selectedByIdentity.size < minSafeContacts) {
    const roleCandidates: ContactCandidateRecord[] = buildRoleFallbackCandidates(resolvedDomain)
      .slice(0, MAX_ROLE_FALLBACKS)
      .map(candidate => ({
        identityKey: candidate.email.toLowerCase(),
        name: candidate.name,
        title: candidate.title,
        email: candidate.email.toLowerCase(),
        source: 'pattern',
        baseScore: candidate.baseScore,
        linkedinUrl: null,
        resolutionMethod: 'role',
        directSource: null,
      }))
    await applyValidationStage(roleCandidates, selectedByIdentity, usedEmails, supabase, metrics, {
      targetSafeContacts,
      stageType: 'role',
    })
  }

  const contacts = Array.from(selectedByIdentity.values())
    .filter(contact => !emailContainsProfessionalSuffix(contact.email, contact.name))
    .sort((a, b) => (b.base_score ?? 0) - (a.base_score ?? 0))
    .slice(0, 8)

  metrics.contacts_selected = contacts.length
  for (const contact of contacts) {
    const method = contact.resolution_method ?? 'pattern'
    metrics.contact_mix[method]++
  }

  return { contacts, resolvedDomain, metrics }
}

function buildRoleFallbackCandidates(domain: string): RoleFallbackCandidate[] {
  const unique = new Map<string, RoleFallbackCandidate>()
  const candidates: Array<[string, string, string, number]> = [
    ['Founder', 'Founder', `founder@${domain}`, 88],
    ['CEO', 'Chief Executive Officer', `ceo@${domain}`, 90],
    ['Sales Team', 'Sales Leadership', `sales@${domain}`, 82],
    ['Revenue Team', 'Revenue Leadership', `revenue@${domain}`, 80],
    ['Growth Team', 'Growth Leadership', `growth@${domain}`, 76],
    ['Operations Team', 'Operations Leadership', `ops@${domain}`, 78],
    ['Operations Team', 'Operations Leadership', `operations@${domain}`, 78],
    ['Team', 'Company Leadership', `hello@${domain}`, 60],
    ['Team', 'Company Leadership', `contact@${domain}`, 58],
    ['Team', 'Company Leadership', `info@${domain}`, 56],
  ]

  for (const [name, title, email, baseScore] of candidates) {
    unique.set(email, { name, title, email, baseScore })
  }

  return Array.from(unique.values())
}

async function resolveContactsWithInFlightDedupe(input: {
  companyKey: string
  companyName: string
  companyDomain: string | null
  supabase: SupabaseClient
  targetSafeContacts: number
  minSafeContacts: number
  targetRoles?: ContactRoleKey[]
  forceRefresh: boolean
}): Promise<ContactResolutionResult> {
  const dedupeKey = [
    input.companyKey,
    input.companyDomain ?? '',
    input.forceRefresh ? 'force' : 'cached',
    input.targetSafeContacts,
    input.minSafeContacts,
    (input.targetRoles ?? []).join(','),
  ].join('|')

  const inFlight = inFlightContactResolution.get(dedupeKey)
  if (inFlight) return inFlight

  const task = resolveContacts(
    input.companyName,
    input.companyDomain,
    input.supabase,
    {
      targetSafeContacts: input.targetSafeContacts,
      minSafeContacts: input.minSafeContacts,
      targetRoles: input.targetRoles,
    },
  ).finally(() => {
    inFlightContactResolution.delete(dedupeKey)
  })

  inFlightContactResolution.set(dedupeKey, task)
  return task
}

export async function enrichCompany(
  companyName: string,
  companyDomain: string | null,
  supabase: SupabaseClient,
  options?: {
    servicesDescription?: string | null
    signalType?: string | null
    maxContacts?: number
    forceRefresh?: boolean
    requireVerified?: boolean
    targetRoles?: ContactRoleKey[]
  },
): Promise<EnrichResult> {
  const companyKey = normalizeLeadCompanyKey(companyName, companyDomain)
  const enrichmentCache = await readCompanyEnrichmentCache(companyKey, supabase)
  const cacheDomain = companyDomain ?? enrichmentCache?.resolved_domain ?? null
  const cachedContacts = await readCache(cacheDomain, companyKey, supabase)

  const requireVerified = options?.requireVerified === true
  const usableCachedContacts = requireVerified
    ? cachedContacts.filter(contact => contact.verified && isFreshVerifiedContact(contact))
    : cachedContacts

  if (!options?.forceRefresh && usableCachedContacts.length > 0) {
    const filtered = filterContactsByRolePreference(usableCachedContacts, options?.targetRoles)
    const ranked = rankForUser(filtered, options?.servicesDescription, options?.signalType, options?.maxContacts)
    const metrics = buildEmptyMetrics()
    metrics.contacts_selected = ranked.length
    for (const contact of ranked) {
      metrics.contact_mix[contact.resolution_method ?? 'pattern']++
    }
    return { contact: ranked[0] ?? null, contacts: ranked, resolvedDomain: cacheDomain, fromCache: true, metrics }
  }

  if (!options?.forceRefresh && shouldShortCircuitEnrichmentFailure({ cache: enrichmentCache, companyDomain })) {
    const metrics = buildEmptyMetrics()
    metrics.negative_cache_hit = true
    return { contact: null, contacts: [], resolvedDomain: cacheDomain, fromCache: true, metrics }
  }

  const targetSafeContacts = Math.max(1, Math.min(options?.maxContacts ?? TARGET_SAFE_CONTACTS, TARGET_SAFE_CONTACTS))
  const { contacts, resolvedDomain, metrics } = await resolveContactsWithInFlightDedupe({
    companyKey,
    companyName,
    companyDomain: cacheDomain,
    supabase,
    targetSafeContacts,
    minSafeContacts: MIN_SAFE_CONTACTS,
    targetRoles: options?.targetRoles,
    forceRefresh: options?.forceRefresh === true,
  })
  if (contacts.length > 0 && resolvedDomain) {
    await writeCache(resolvedDomain, companyKey, contacts, supabase)
  }
  await writeCompanyEnrichmentCache({
    companyKey,
    companyName,
    inputDomain: companyDomain,
    resolvedDomain,
    contactCount: contacts.length,
    zbValidationsUsed: metrics.zb_validations_requested,
    previousLastSucceededAt: enrichmentCache?.last_succeeded_at ?? null,
  }, supabase)

  const selectableContacts = requireVerified ? contacts.filter(contact => contact.verified) : contacts
  const filtered = filterContactsByRolePreference(selectableContacts, options?.targetRoles)
  const ranked = rankForUser(filtered, options?.servicesDescription, options?.signalType, options?.maxContacts)
  metrics.contacts_selected = ranked.length
  return { contact: ranked[0] ?? null, contacts: ranked, resolvedDomain, fromCache: false, metrics }
}

export async function enrichLeadsInBatch(batchSize = 200): Promise<{
  enriched: number
  failed: number
  cached: number
  companies_processed: number
  zb_validations_requested: number
  zb_cache_hits: number
  zb_validations_per_enriched_lead: number
  cache_hit_rate: number
  contact_mix: {
    direct: number
    pattern: number
    role: number
    direct_pct: number
    pattern_pct: number
    role_pct: number
  }
}> {
  const supabase = await createServiceClient()
  const retryAfter = new Date(Date.now() - RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const verificationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, target_company, company_domain, user_id, relevance_score, contact_email, contact_verified, contact_verified_at, feed_snapshot')
    .eq('is_unlocked', true)
    .neq('status', 'dismissed')
    .or(`contact_email.is.null,contact_enriched_at.is.null,contact_enriched_at.lt.${retryAfter},contact_verified_at.is.null,contact_verified_at.lt.${verificationCutoff}`)
    .limit(batchSize)

  if (error || !leads?.length) {
    return {
      enriched: 0,
      failed: 0,
      cached: 0,
      companies_processed: 0,
      zb_validations_requested: 0,
      zb_cache_hits: 0,
      zb_validations_per_enriched_lead: 0,
      cache_hit_rate: 0,
      contact_mix: {
        direct: 0,
        pattern: 0,
        role: 0,
        direct_pct: 0,
        pattern_pct: 0,
        role_pct: 0,
      },
    }
  }

  leads.sort((a, b) => {
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })

  const groups = new Map<string, typeof leads>()
  for (const lead of leads) {
    const key = normalizeLeadCompanyKey(lead.target_company, lead.company_domain)
    const group = groups.get(key)
    if (group) group.push(lead)
    else groups.set(key, [lead])
  }

  let enriched = 0
  let failed = 0
  let cached = 0
  let cachedCompanies = 0
  let zbValidationsRequested = 0
  let zbCacheHits = 0
  const contactMix = { direct: 0, pattern: 0, role: 0 }
  const now = new Date().toISOString()

  const groupList = Array.from(groups.values())
  await runWithConcurrency(groupList, 4, async groupLeads => {
    const firstLead = groupLeads[0]
    const result = await enrichCompany(firstLead.target_company, firstLead.company_domain ?? null, supabase, { maxContacts: 3 })
    if (result.fromCache) {
      cached += groupLeads.length
      cachedCompanies++
    }
    zbValidationsRequested += result.metrics.zb_validations_requested
    zbCacheHits += result.metrics.zb_cache_hits
    contactMix.direct += result.metrics.contact_mix.direct
    contactMix.pattern += result.metrics.contact_mix.pattern
    contactMix.role += result.metrics.contact_mix.role

    const baseUpdate: Record<string, unknown> = { contact_enriched_at: now }
    if (result.resolvedDomain) baseUpdate.company_domain = result.resolvedDomain

    if (result.contacts.length > 0) {
      await Promise.all(groupLeads.map(async lead => {
        const signal = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)
        const topContact = rankForUser(result.contacts, null, signal?.signal_type ?? null, 1)[0] ?? result.contact
        if (!topContact) {
          await supabase.from('leads').update(baseUpdate).eq('id', lead.id)
          failed++
          return
        }
        await supabase.from('leads').update({
          ...baseUpdate,
          contact_email: topContact.email.toLowerCase(),
          contact_name: topContact.name || null,
          contact_title: topContact.title || null,
          contact_source: topContact.source,
          contact_verified: topContact.verified,
          contact_verified_at: topContact.verified ? now : null,
          contact_verification_status: topContact.zb_status ?? null,
          last_contact_verification_error: topContact.verified ? null : 'contact_not_verified',
        }).eq('id', lead.id)
        enriched++
      }))
    } else {
      await supabase.from('leads').update(baseUpdate).in('id', groupLeads.map(lead => lead.id))
      failed += groupLeads.length
    }
  })

  const contactMixTotal = contactMix.direct + contactMix.pattern + contactMix.role

  return {
    enriched,
    failed,
    cached,
    companies_processed: groups.size,
    zb_validations_requested: zbValidationsRequested,
    zb_cache_hits: zbCacheHits,
    zb_validations_per_enriched_lead: enriched > 0 ? Number((zbValidationsRequested / enriched).toFixed(2)) : 0,
    cache_hit_rate: groups.size > 0 ? Number((cachedCompanies / groups.size).toFixed(2)) : 0,
    contact_mix: {
      direct: contactMix.direct,
      pattern: contactMix.pattern,
      role: contactMix.role,
      direct_pct: contactMixTotal > 0 ? Number((contactMix.direct / contactMixTotal).toFixed(2)) : 0,
      pattern_pct: contactMixTotal > 0 ? Number((contactMix.pattern / contactMixTotal).toFixed(2)) : 0,
      role_pct: contactMixTotal > 0 ? Number((contactMix.role / contactMixTotal).toFixed(2)) : 0,
    },
  }
}

export async function enrichSingleEmail(
  email: string,
  options?: { maxCacheAgeDays?: number },
): Promise<{ status: ZBStatus; verifiedAt: string } | null> {
  const supabase = await createServiceClient()
  const cached = await readValidationCache([email], supabase, options?.maxCacheAgeDays)
  const existing = cached.get(email.toLowerCase())
  if (existing) return { status: existing.status, verifiedAt: existing.verified_at }

  const zb = await verifyEmail(email)
  if (zb) {
    await writeValidationCache([zb], supabase)
  }
  return zb ? { status: zb.status, verifiedAt: new Date().toISOString() } : null
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) continue
      await worker(item)
    }
  })
  await Promise.all(workers)
}

async function applyValidationStage(
  candidates: ContactCandidateRecord[],
  selectedByIdentity: Map<string, EnrichedContact>,
  usedEmails: Set<string>,
  supabase: SupabaseClient,
  metrics: EnrichMetrics,
  options: {
    targetSafeContacts: number
    stageType: 'direct' | 'pattern' | 'role'
  },
): Promise<void> {
  const rawStageCandidates = candidates.filter(candidate => (
    !usedEmails.has(candidate.email) &&
    !selectedByIdentity.has(candidate.identityKey) &&
    !emailContainsProfessionalSuffix(candidate.email, candidate.name)
  ))
  if (rawStageCandidates.length === 0) return

  const remaining = Math.max(1, options.targetSafeContacts - selectedByIdentity.size)
  const multiplier = options.stageType === 'direct'
    ? VALIDATION_MULTIPLIER_DIRECT
    : options.stageType === 'pattern'
      ? VALIDATION_MULTIPLIER_PATTERN
      : VALIDATION_MULTIPLIER_ROLE
  const validationBudget = Math.max(remaining, remaining * multiplier)
  const stageCandidates = rawStageCandidates.slice(0, validationBudget)

  const { results, billedCount, cacheHits } = await verifyEmailsWithCache(
    stageCandidates.map(candidate => candidate.email),
    supabase,
  )
  metrics.zb_validations_requested += billedCount
  metrics.zb_cache_hits += cacheHits

  const zeroBounceEnabled = Boolean(process.env.ZEROBOUNCE_API_KEY)

  for (const candidate of stageCandidates) {
    if (selectedByIdentity.size >= options.targetSafeContacts && candidate.resolutionMethod !== 'role') break

    const verification = results.get(candidate.email)
    const safe = verification
      ? isSafeToSend(verification.status)
      : isCandidateSafeWithoutVerification({
          zeroBounceEnabled,
          resolutionMethod: candidate.resolutionMethod,
        })
    if (!safe) continue

    const contact: EnrichedContact = {
      email: candidate.email,
      name: candidate.name,
      title: candidate.title,
      source: candidate.source,
      verified: verification?.status === 'valid' || (!verification && candidate.directSource === 'hunter'),
      zb_status: verification?.status,
      linkedin_url: candidate.linkedinUrl,
      base_score: candidate.baseScore,
      resolution_method: candidate.resolutionMethod,
    }

    selectedByIdentity.set(candidate.identityKey, contact)
    usedEmails.add(candidate.email)
  }
}
