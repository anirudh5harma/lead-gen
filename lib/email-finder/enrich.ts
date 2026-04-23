import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { searchFullEnrichPeople } from './fullenrich'
import { hunterDomainSearch, constructEmailCandidates } from './hunter'
import { verifyEmail, verifyEmailsBatch, isSafeToSend, type ZBStatus } from './zeroBounce'
import { scrapeCompanyPeople } from './firecrawl'
import { rankContactsForUseCase, baseContactScore } from './ranking'

const CACHE_TTL_DAYS = 30
const RETRY_AFTER_DAYS = 7
const PLAN_PRIORITY: Record<string, number> = { max: 0, pro: 1, free: 2 }
const MAX_CONTACTS_PER_COMPANY = 4

type ContactSource = 'fullenrich' | 'hunter' | 'pattern' | 'scrape'

interface CachedContactRow {
  contact_email: string
  contact_name: string | null
  contact_title: string | null
  contact_source: ContactSource
  contact_verified: boolean
  zb_status: ZBStatus | null
  linkedin_url: string | null
  base_score: number
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

interface RoleFallbackCandidate {
  name: string
  title: string
  email: string
  baseScore: number
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
}

export interface EnrichResult {
  contact: EnrichedContact | null
  contacts: EnrichedContact[]
  resolvedDomain: string | null
  fromCache: boolean
}

async function readCache(
  domain: string,
  supabase: SupabaseClient,
): Promise<EnrichedContact[]> {
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('company_contact_candidates')
    .select('contact_email, contact_name, contact_title, contact_source, contact_verified, zb_status, linkedin_url, base_score, enriched_at')
    .eq('domain', domain)
    .gte('enriched_at', cutoff)
    .order('base_score', { ascending: false })
    .order('enriched_at', { ascending: false })
    .limit(12)

  const contacts = ((data ?? []) as CachedContactRow[]).map(row => ({
    email: row.contact_email,
    name: row.contact_name ?? '',
    title: row.contact_title ?? '',
    source: row.contact_source,
    verified: row.contact_verified,
    zb_status: row.zb_status ?? undefined,
    linkedin_url: row.linkedin_url,
    base_score: row.base_score ?? 0,
  }))

  if (contacts.length > 0) return contacts

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
  }]
}

async function writeCache(domain: string, contacts: EnrichedContact[], supabase: SupabaseClient): Promise<void> {
  if (!contacts.length) return
  const now = new Date().toISOString()
  await supabase.from('company_contact_candidates').upsert(
    contacts.map(contact => ({
      domain,
      contact_email: contact.email.toLowerCase(),
      contact_name: contact.name || null,
      contact_title: contact.title || null,
      contact_source: contact.source,
      contact_verified: contact.verified,
      zb_status: contact.zb_status ?? null,
      linkedin_url: contact.linkedin_url ?? null,
      base_score: contact.base_score ?? 0,
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
): Promise<{ contacts: EnrichedContact[]; resolvedDomain: string | null }> {
  const { people, resolvedDomain, hunterPattern } = await collectCandidatePeople(companyName, companyDomain)
  if (!resolvedDomain || people.length === 0) {
    return { contacts: [], resolvedDomain }
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

  const candidateRecords: Array<{ person: CandidatePerson; email: string; source: ContactSource }> = []
  const emailSet = new Set<string>()
  for (const person of rankedPeople) {
    const directEmail = person.directEmail?.toLowerCase() ?? null
    if (directEmail && !emailSet.has(directEmail)) {
      emailSet.add(directEmail)
      candidateRecords.push({ person, email: directEmail, source: person.source })
    }

    if (!person.firstName || !person.lastName) continue
    for (const email of constructEmailCandidates(person.firstName, person.lastName, resolvedDomain, hunterPattern)) {
      const normalized = email.toLowerCase()
      if (emailSet.has(normalized)) continue
      emailSet.add(normalized)
      candidateRecords.push({ person, email: normalized, source: 'pattern' })
    }
  }

  const verificationResults = await verifyEmailsBatch(candidateRecords.map(record => record.email))
  const verificationMap = new Map(verificationResults.map(result => [result.email.toLowerCase(), result]))

  const bestByPerson = new Map<string, EnrichedContact>()
  for (const record of candidateRecords) {
    const verification = verificationMap.get(record.email)
    const safe = verification ? isSafeToSend(verification.status) : true
    if (!safe) continue

    const contact: EnrichedContact = {
      email: record.email,
      name: record.person.name,
      title: record.person.title,
      source: record.source,
      verified: verification?.status === 'valid' || record.source === 'hunter',
      zb_status: verification?.status,
      linkedin_url: record.person.linkedinUrl,
      base_score: record.person.baseScore,
    }

    const personKey = `${record.person.name.toLowerCase()}::${record.person.title.toLowerCase()}`
    const existing = bestByPerson.get(personKey)
    if (!existing || contact.verified || (existing.source === 'pattern' && contact.source !== 'pattern')) {
      bestByPerson.set(personKey, contact)
    }
  }

  const contacts = Array.from(bestByPerson.values())
    .sort((a, b) => (b.base_score ?? 0) - (a.base_score ?? 0))
    .slice(0, 8)

  if (contacts.length < 2) {
    const roleCandidates = buildRoleFallbackCandidates(resolvedDomain)
    const unseenRoleCandidates = roleCandidates.filter(candidate =>
      !candidateRecords.some(record => record.email === candidate.email),
    )
    if (unseenRoleCandidates.length > 0) {
      const roleVerification = await verifyEmailsBatch(unseenRoleCandidates.map(candidate => candidate.email))
      for (const result of roleVerification) {
        if (!isSafeToSend(result.status)) continue
        const candidate = unseenRoleCandidates.find(item => item.email === result.email.toLowerCase())
        if (!candidate) continue
        contacts.push({
          email: candidate.email,
          name: candidate.name,
          title: candidate.title,
          source: 'pattern',
          verified: result.status === 'valid',
          zb_status: result.status,
          base_score: candidate.baseScore,
        })
      }
    }
  }

  contacts.sort((a, b) => (b.base_score ?? 0) - (a.base_score ?? 0))

  return { contacts: contacts.slice(0, 8), resolvedDomain }
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
  if (companyDomain) {
    const cached = await readCache(companyDomain, supabase)
    if (cached.length > 0) {
      const ranked = rankForUser(cached, options?.servicesDescription, options?.signalType, options?.maxContacts)
      return { contact: ranked[0] ?? null, contacts: ranked, resolvedDomain: companyDomain, fromCache: true }
    }
  }

  const { contacts, resolvedDomain } = await resolveContacts(companyName, companyDomain)
  if (contacts.length > 0 && resolvedDomain) {
    await writeCache(resolvedDomain, contacts, supabase)
  }

  const ranked = rankForUser(contacts, options?.servicesDescription, options?.signalType, options?.maxContacts)
  return { contact: ranked[0] ?? null, contacts: ranked, resolvedDomain, fromCache: false }
}

export async function enrichLeadsInBatch(batchSize = 200): Promise<{
  enriched: number
  failed: number
  cached: number
}> {
  const supabase = await createServiceClient()
  const retryAfter = new Date(Date.now() - RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, target_company, company_domain, user_id, relevance_score')
    .is('contact_email', null)
    .neq('status', 'dismissed')
    .or(`contact_enriched_at.is.null,contact_enriched_at.lt.${retryAfter}`)
    .limit(batchSize)

  if (error || !leads?.length) return { enriched: 0, failed: 0, cached: 0 }

  const userIds = [...new Set(leads.map(lead => lead.user_id))]
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, plan')
    .in('user_id', userIds)

  const planMap: Record<string, string> = {}
  for (const profile of profiles ?? []) planMap[profile.user_id] = profile.plan ?? 'free'

  leads.sort((a, b) => {
    const pa = PLAN_PRIORITY[planMap[a.user_id]] ?? 2
    const pb = PLAN_PRIORITY[planMap[b.user_id]] ?? 2
    if (pa !== pb) return pa - pb
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })

  const groups = new Map<string, typeof leads>()
  for (const lead of leads) {
    const key = (lead.company_domain || `name:${lead.target_company.toLowerCase()}`).toLowerCase()
    const group = groups.get(key)
    if (group) group.push(lead)
    else groups.set(key, [lead])
  }

  let enriched = 0
  let failed = 0
  let cached = 0
  const now = new Date().toISOString()

  for (const [, groupLeads] of groups) {
    const firstLead = groupLeads[0]
    const result = await enrichCompany(firstLead.target_company, firstLead.company_domain ?? null, supabase, { maxContacts: 4 })
    if (result.fromCache) cached += groupLeads.length

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

  return { enriched, failed, cached }
}

export async function enrichSingleEmail(email: string): Promise<ZBStatus | null> {
  const zb = await verifyEmail(email)
  return zb?.status ?? null
}
