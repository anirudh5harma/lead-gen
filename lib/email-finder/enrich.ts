import type { SupabaseClient } from '@supabase/supabase-js'
import { searchApolloContacts } from './apollo'
import { hunterDomainSearch } from './hunter'
import { verifyEmail, verifyEmailsBatch, isSafeToSend, type ZBStatus } from './zeroBounce'
import { createServiceClient } from '@/lib/supabase/server'

const CACHE_TTL_DAYS = 30
const RETRY_AFTER_DAYS = 7
const PLAN_PRIORITY: Record<string, number> = { max: 0, pro: 1, free: 2 }

export interface EnrichedContact {
  email: string
  name: string
  title: string
  source: 'apollo' | 'hunter'
  verified: boolean
  zb_status?: ZBStatus
}

export interface EnrichResult {
  contact: EnrichedContact | null
  resolvedDomain: string | null
  fromCache: boolean
}

// ─── Cache I/O ───────────────────────────────────────────────────────────────

async function readCache(domain: string, supabase: SupabaseClient): Promise<EnrichedContact | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('company_contacts')
    .select('contact_email, contact_name, contact_title, contact_source, contact_verified, zb_status')
    .eq('domain', domain)
    .gte('enriched_at', cutoff)
    .maybeSingle()

  if (!data?.contact_email) return null
  return {
    email: data.contact_email,
    name: data.contact_name ?? '',
    title: data.contact_title ?? '',
    source: data.contact_source as 'apollo' | 'hunter',
    verified: data.contact_verified,
    zb_status: data.zb_status as ZBStatus | undefined,
  }
}

async function writeCache(domain: string, contact: EnrichedContact, supabase: SupabaseClient): Promise<void> {
  await supabase.from('company_contacts').upsert({
    domain,
    contact_email: contact.email,
    contact_name: contact.name || null,
    contact_title: contact.title || null,
    contact_source: contact.source,
    contact_verified: contact.verified,
    zb_status: contact.zb_status ?? null,
    enriched_at: new Date().toISOString(),
  }, { onConflict: 'domain' })
}

// ─── API waterfall ────────────────────────────────────────────────────────────

async function findContactViaApis(
  companyName: string,
  companyDomain: string | null
): Promise<{ contact: EnrichedContact | null; resolvedDomain: string | null }> {
  // Step 1: Apollo — verified contacts only
  const apolloContacts = await searchApolloContacts(companyName, companyDomain)

  // Resolve domain from Apollo response if we didn't have one
  let resolvedDomain = companyDomain
  if (!resolvedDomain && apolloContacts.length > 0) {
    resolvedDomain = apolloContacts.find(c => c.organization_domain)?.organization_domain ?? null
  }

  const apolloWithEmail = apolloContacts.filter(c => c.email)
  if (apolloWithEmail.length > 0) {
    const zb = await verifyEmail(apolloWithEmail[0].email!)
    if (!zb || isSafeToSend(zb.status)) {
      return {
        contact: {
          email: apolloWithEmail[0].email!,
          name: apolloWithEmail[0].name,
          title: apolloWithEmail[0].title,
          source: 'apollo',
          verified: zb?.status === 'valid',
          zb_status: zb?.status,
        },
        resolvedDomain,
      }
    }
  }

  // Step 2: Hunter — batch-verify all high-confidence candidates at once
  if (resolvedDomain) {
    const hunterResult = await hunterDomainSearch(resolvedDomain)
    const candidates = hunterResult.contacts
      .filter(c => c.confidence >= 70)
      .sort((a, b) => b.confidence - a.confidence)

    if (candidates.length > 0) {
      const zbResults = await verifyEmailsBatch(candidates.map(c => c.email))
      const zbMap = new Map(zbResults.map(r => [r.email.toLowerCase(), r]))

      for (const candidate of candidates) {
        const zb = zbMap.get(candidate.email.toLowerCase())
        if (!zb || isSafeToSend(zb.status)) {
          return {
            contact: {
              email: candidate.email,
              name: candidate.name,
              title: candidate.title,
              source: 'hunter',
              verified: zb?.status === 'valid',
              zb_status: zb?.status,
            },
            resolvedDomain,
          }
        }
      }
    }
  }

  return { contact: null, resolvedDomain }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Used by both the cron and the draft route (on-demand fallback).
// Checks the 30-day cache first; calls Apollo+Hunter only on a miss.
export async function enrichCompany(
  companyName: string,
  companyDomain: string | null,
  supabase: SupabaseClient
): Promise<EnrichResult> {
  if (companyDomain) {
    const cached = await readCache(companyDomain, supabase)
    if (cached) return { contact: cached, resolvedDomain: companyDomain, fromCache: true }
  }

  const { contact, resolvedDomain } = await findContactViaApis(companyName, companyDomain)

  if (contact && resolvedDomain) {
    await writeCache(resolvedDomain, contact, supabase)
  }

  return { contact, resolvedDomain, fromCache: false }
}

// ─── Batch cron processor ─────────────────────────────────────────────────────

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

  // Fetch user plans for priority ordering
  const userIds = [...new Set(leads.map(l => l.user_id))]
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, plan')
    .in('user_id', userIds)

  const planMap: Record<string, string> = {}
  for (const p of profiles ?? []) planMap[p.user_id] = p.plan ?? 'free'

  // Sort: max → pro → free, then by relevance_score DESC within each tier
  leads.sort((a, b) => {
    const pa = PLAN_PRIORITY[planMap[a.user_id]] ?? 2
    const pb = PLAN_PRIORITY[planMap[b.user_id]] ?? 2
    if (pa !== pb) return pa - pb
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })

  // Group by domain (cache-efficient: one API call serves all leads for a company)
  // Leads without a domain are grouped by company name
  const domainGroups = new Map<string, typeof leads>()
  const nameGroups  = new Map<string, typeof leads>()

  for (const lead of leads) {
    if (lead.company_domain) {
      const key = lead.company_domain.toLowerCase()
      if (!domainGroups.has(key)) domainGroups.set(key, [])
      domainGroups.get(key)!.push(lead)
    } else {
      const key = lead.target_company.toLowerCase()
      if (!nameGroups.has(key)) nameGroups.set(key, [])
      nameGroups.get(key)!.push(lead)
    }
  }

  let enriched = 0, failed = 0, cached = 0
  const now = new Date().toISOString()

  // ── Domain-keyed groups ───────────────────────────────────────────────────
  for (const [domain, groupLeads] of domainGroups) {
    const { contact, fromCache } = await enrichCompany(
      groupLeads[0].target_company,
      domain,
      supabase
    )

    if (fromCache) cached += groupLeads.length

    if (contact) {
      // Bounce check once per contact, not per lead
      const { data: bounced } = await supabase
        .from('bounced_emails')
        .select('id')
        .eq('email', contact.email.toLowerCase())
        .maybeSingle()

      if (bounced) {
        await supabase.from('leads')
          .update({ contact_enriched_at: now })
          .in('id', groupLeads.map(l => l.id))
        failed += groupLeads.length
      } else {
        // Batch update all leads in this group in one query
        await supabase.from('leads').update({
          contact_email:    contact.email.toLowerCase(),
          contact_name:     contact.name  || null,
          contact_title:    contact.title || null,
          contact_source:   contact.source,
          contact_verified: contact.verified,
          contact_enriched_at: now,
        }).in('id', groupLeads.map(l => l.id))
        enriched += groupLeads.length
      }
    } else {
      await supabase.from('leads')
        .update({ contact_enriched_at: now })
        .in('id', groupLeads.map(l => l.id))
      failed += groupLeads.length
    }
  }

  // ── Domain-less groups ────────────────────────────────────────────────────
  for (const [, groupLeads] of nameGroups) {
    const { contact, resolvedDomain } = await enrichCompany(
      groupLeads[0].target_company,
      null,
      supabase
    )

    const bounced = contact
      ? (await supabase.from('bounced_emails').select('id').eq('email', contact.email.toLowerCase()).maybeSingle()).data
      : null

    const baseUpdate: Record<string, unknown> = { contact_enriched_at: now }
    if (resolvedDomain) baseUpdate.company_domain = resolvedDomain

    if (contact && !bounced) {
      await supabase.from('leads').update({
        ...baseUpdate,
        contact_email:    contact.email.toLowerCase(),
        contact_name:     contact.name  || null,
        contact_title:    contact.title || null,
        contact_source:   contact.source,
        contact_verified: contact.verified,
      }).in('id', groupLeads.map(l => l.id))
      enriched += groupLeads.length
    } else {
      await supabase.from('leads')
        .update(baseUpdate)
        .in('id', groupLeads.map(l => l.id))
      failed += groupLeads.length
    }
  }

  return { enriched, failed, cached }
}
