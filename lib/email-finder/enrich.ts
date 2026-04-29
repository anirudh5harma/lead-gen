import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { searchFullEnrichPeople } from './fullenrich'
import { hunterDomainSearch, constructEmailCandidates } from './hunter'
import { verifyEmail, verifyEmailsBatch, isSafeToSend, type ZBStatus } from './zeroBounce'
import { scrapeCompanyPeople } from './firecrawl'
import { rankContactsForUseCase, baseContactScore } from './ranking'
import {
  compareCachedContactRows,
  isCandidateSafeWithoutVerification,
  shouldShortCircuitEnrichmentFailure,
} from './enrich-helpers'
import { normalizeLeadCompanyKey } from '../lead-dedupe'

const CACHE_TTL_DAYS = 30
const VALIDATION_CACHE_TTL_DAYS = 90
const RETRY_AFTER_DAYS = 21
const MAX_CONTACTS_PER_COMPANY = 4
const TARGET_SAFE_CONTACTS = 3
const MIN_SAFE_CONTACTS = 2
const MAX_DIRECT_CANDIDATES = 6
const MAX_PATTERN_PEOPLE = 3
const MAX_PATTERNS_PER_PERSON = 2
const MAX_ROLE_FALLBACKS = 3

type ContactSource = 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
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

  const contacts = mergedRows.map(row => ({
    email: row.contact_email,
    name: row.contact_name ?? '',
    title: row.contact_title ?? '',
    source: row.contact_source,
    verified: row.contact_verified,
    zb_status: row.zb_status ?? undefined,
    linkedin_url: row.linkedin_url,
    base_score: row.base_score ?? 0,
    resolution_method: row.resolution_method ?? 'pattern',
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
  return [{
    email: legacy.contact_email,
    name: legacy.contact_name ?? '',
    title: legacy.contact_title ?? '',
    source: legacy.contact_source as ContactSource,
    verified: legacy.contact_verified,
    zb_status: legacy.zb_status as ZBStatus | undefined,
    base_score: 0,
    resolution_method: legacy.contact_verified ? 'direct' : 'pattern',
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
      contact_name: contact.name || null,
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

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
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
): Promise<Map<string, ValidationCacheRow>> {
  const normalized = [...new Set(emails.map(email => email.toLowerCase()))]
  if (normalized.length === 0) return new Map()

  const cutoff = new Date(Date.now() - VALIDATION_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
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
): Promise<{ resolvedDomain: string | null; people: CandidatePerson[]; hunterPattern: string | null }> {
  const [fullEnrichPeople, scrapedPeople, hunterResult] = await Promise.all([
    searchFullEnrichPeople(companyName, companyDomain),
    companyDomain ? scrapeCompanyPeople(companyDomain) : Promise.resolve([]),
    companyDomain ? hunterDomainSearch(companyDomain) : Promise.resolve({ emailPattern: null, contacts: [] }),
  ])

  let resolvedDomain = companyDomain
  if (!resolvedDomain) {
    resolvedDomain = fullEnrichPeople.find(person => person.companyDomain)?.companyDomain ?? null
  }

  const people: CandidatePerson[] = [
    ...fullEnrichPeople.map(person => ({
      name: person.name,
      title: person.title,
      firstName: person.firstName,
      lastName: person.lastName,
      directEmail: null,
      linkedinUrl: person.linkedinUrl,
      source: 'fullenrich' as const,
      baseScore: baseContactScore(person.title),
    })),
    ...scrapedPeople.map(person => {
      const split = splitName(person.name)
      return {
        name: person.name,
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
        name: contact.name,
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
): Promise<{ contacts: EnrichedContact[]; resolvedDomain: string | null; metrics: EnrichMetrics }> {
  const { people, resolvedDomain, hunterPattern } = await collectCandidatePeople(companyName, companyDomain)
  if (!resolvedDomain || people.length === 0) {
    return { contacts: [], resolvedDomain, metrics: buildEmptyMetrics() }
  }

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

  await applyValidationStage(directCandidates, selectedByIdentity, usedEmails, supabase, metrics)

  if (selectedByIdentity.size < TARGET_SAFE_CONTACTS) {
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
    await applyValidationStage(patternCandidates, selectedByIdentity, usedEmails, supabase, metrics)
  }

  if (selectedByIdentity.size < MIN_SAFE_CONTACTS) {
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
    await applyValidationStage(roleCandidates, selectedByIdentity, usedEmails, supabase, metrics)
  }

  const contacts = Array.from(selectedByIdentity.values())
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

export async function enrichCompany(
  companyName: string,
  companyDomain: string | null,
  supabase: SupabaseClient,
  options?: {
    servicesDescription?: string | null
    signalType?: string | null
    maxContacts?: number
  },
): Promise<EnrichResult> {
  const companyKey = normalizeLeadCompanyKey(companyName, companyDomain)
  const enrichmentCache = await readCompanyEnrichmentCache(companyKey, supabase)
  const cacheDomain = companyDomain ?? enrichmentCache?.resolved_domain ?? null
  const cachedContacts = await readCache(cacheDomain, companyKey, supabase)

  if (cachedContacts.length > 0) {
    const ranked = rankForUser(cachedContacts, options?.servicesDescription, options?.signalType, options?.maxContacts)
    const metrics = buildEmptyMetrics()
    metrics.contacts_selected = ranked.length
    for (const contact of ranked) {
      metrics.contact_mix[contact.resolution_method ?? 'pattern']++
    }
    return { contact: ranked[0] ?? null, contacts: ranked, resolvedDomain: cacheDomain, fromCache: true, metrics }
  }

  if (shouldShortCircuitEnrichmentFailure({ cache: enrichmentCache, companyDomain })) {
    const metrics = buildEmptyMetrics()
    metrics.negative_cache_hit = true
    return { contact: null, contacts: [], resolvedDomain: cacheDomain, fromCache: true, metrics }
  }

  const { contacts, resolvedDomain, metrics } = await resolveContacts(companyName, cacheDomain, supabase)
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

  const ranked = rankForUser(contacts, options?.servicesDescription, options?.signalType, options?.maxContacts)
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

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, target_company, company_domain, user_id, relevance_score')
    .is('contact_email', null)
    .eq('is_unlocked', true)
    .neq('status', 'dismissed')
    .or(`contact_enriched_at.is.null,contact_enriched_at.lt.${retryAfter}`)
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

  for (const [, groupLeads] of groups) {
    const firstLead = groupLeads[0]
    const result = await enrichCompany(firstLead.target_company, firstLead.company_domain ?? null, supabase, { maxContacts: 4 })
    if (result.fromCache) {
      cached += groupLeads.length
      cachedCompanies++
    }
    zbValidationsRequested += result.metrics.zb_validations_requested
    zbCacheHits += result.metrics.zb_cache_hits
    contactMix.direct += result.metrics.contact_mix.direct
    contactMix.pattern += result.metrics.contact_mix.pattern
    contactMix.role += result.metrics.contact_mix.role

    const topContact = result.contact
    const baseUpdate: Record<string, unknown> = { contact_enriched_at: now }
    if (result.resolvedDomain) baseUpdate.company_domain = result.resolvedDomain

    if (topContact) {
      await supabase.from('leads').update({
        ...baseUpdate,
        contact_email: topContact.email.toLowerCase(),
        contact_name: topContact.name || null,
        contact_title: topContact.title || null,
        contact_source: topContact.source,
        contact_verified: topContact.verified,
      }).in('id', groupLeads.map(lead => lead.id))
      enriched += groupLeads.length
    } else {
      await supabase.from('leads').update(baseUpdate).in('id', groupLeads.map(lead => lead.id))
      failed += groupLeads.length
    }
  }

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

export async function enrichSingleEmail(email: string): Promise<ZBStatus | null> {
  const supabase = await createServiceClient()
  const cached = await readValidationCache([email], supabase)
  const existing = cached.get(email.toLowerCase())
  if (existing) return existing.status

  const zb = await verifyEmail(email)
  if (zb) {
    await writeValidationCache([zb], supabase)
  }
  return zb?.status ?? null
}

async function applyValidationStage(
  candidates: ContactCandidateRecord[],
  selectedByIdentity: Map<string, EnrichedContact>,
  usedEmails: Set<string>,
  supabase: SupabaseClient,
  metrics: EnrichMetrics,
): Promise<void> {
  const stageCandidates = candidates.filter(candidate => (
    !usedEmails.has(candidate.email) &&
    !selectedByIdentity.has(candidate.identityKey)
  ))
  if (stageCandidates.length === 0) return

  const { results, billedCount, cacheHits } = await verifyEmailsWithCache(
    stageCandidates.map(candidate => candidate.email),
    supabase,
  )
  metrics.zb_validations_requested += billedCount
  metrics.zb_cache_hits += cacheHits

  const zeroBounceEnabled = Boolean(process.env.ZEROBOUNCE_API_KEY)

  for (const candidate of stageCandidates) {
    if (selectedByIdentity.size >= TARGET_SAFE_CONTACTS && candidate.resolutionMethod !== 'role') break

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
