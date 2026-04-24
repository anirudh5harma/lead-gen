import type { SupabaseClient } from '@supabase/supabase-js'

export interface MonitoredCompanySeed {
  userId: string
  clientId: string
  companyName: string
  companyDomain?: string | null
  websiteUrl?: string | null
  source: 'watchlist' | 'lead' | 'queue'
  sourceTimestamp?: string | null
  priorityBoost?: number
}

export interface CompanySeed {
  clientId: string
  name: string
  domain: string | null
  websiteUrl: string | null
  priorityScore: number
  isWatchlist: boolean
}

interface AggregatedSeed {
  userId: string
  clientId: string
  companyName: string
  companyDomain: string | null
  websiteUrl: string | null
  companyKey: string
  seedSources: Set<string>
  isWatchlist: boolean
  priorityScore: number
  lastLeadAt: string | null
  lastQueueMatchAt: string | null
}

const SOURCE_BASE_PRIORITY: Record<MonitoredCompanySeed['source'], number> = {
  watchlist: 140,
  lead: 70,
  queue: 45,
}

const STALE_WINDOW_DAYS = 90
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|llc|ltd|limited|plc|co|company|group|holdings|technologies|technology)\b\.?/g

export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./, '')
    return hostname.includes('.') ? hostname : null
  } catch {
    return null
  }
}

export function buildMonitoredAccountKey(params: {
  companyName: string
  companyDomain?: string | null
  websiteUrl?: string | null
}): string {
  const normalizedWebsite = normalizeWebsiteUrl(params.websiteUrl)
  const domain = normalizeDomain(params.companyDomain) ?? normalizeDomain(normalizedWebsite)
  return normalizeCompanyKey(params.companyName, domain)
}

export function computeMonitoredAccountPriority(seed: MonitoredCompanySeed): number {
  const base = SOURCE_BASE_PRIORITY[seed.source]
  const timestamp = seed.sourceTimestamp ? new Date(seed.sourceTimestamp) : null
  const ageDays = timestamp
    ? Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / (24 * 60 * 60 * 1000)))
    : 30
  const recencyBoost = Math.max(0, 30 - ageDays)
  const domainBoost = normalizeDomain(seed.companyDomain) || normalizeWebsiteUrl(seed.websiteUrl) ? 10 : 0
  return base + recencyBoost + domainBoost + (seed.priorityBoost ?? 0)
}

export function aggregateMonitoredAccountSeeds(seeds: MonitoredCompanySeed[]): AggregatedSeed[] {
  const aggregated = new Map<string, AggregatedSeed>()

  for (const seed of seeds) {
    const companyName = seed.companyName.trim()
    if (!companyName) continue

    const websiteUrl = normalizeWebsiteUrl(seed.websiteUrl) ?? null
    const companyDomain = normalizeDomain(seed.companyDomain) ?? normalizeDomain(websiteUrl) ?? null
    const companyKey = buildMonitoredAccountKey({
      companyName,
      companyDomain,
      websiteUrl,
    })
    const mapKey = `${seed.clientId}:${companyKey}`

    const existing = aggregated.get(mapKey)
    const priority = computeMonitoredAccountPriority(seed)
    if (!existing) {
      aggregated.set(mapKey, {
        userId: seed.userId,
        clientId: seed.clientId,
        companyName,
        companyDomain,
        websiteUrl,
        companyKey,
        seedSources: new Set([seed.source]),
        isWatchlist: seed.source === 'watchlist',
        priorityScore: priority,
        lastLeadAt: seed.source === 'lead' ? seed.sourceTimestamp ?? null : null,
        lastQueueMatchAt: seed.source === 'queue' ? seed.sourceTimestamp ?? null : null,
      })
      continue
    }

    existing.seedSources.add(seed.source)
    existing.isWatchlist = existing.isWatchlist || seed.source === 'watchlist'
    existing.priorityScore = Math.max(existing.priorityScore, priority)
    if (!existing.companyDomain && companyDomain) existing.companyDomain = companyDomain
    if (!existing.websiteUrl && websiteUrl) existing.websiteUrl = websiteUrl

    if (seed.source === 'lead' && seed.sourceTimestamp) {
      existing.lastLeadAt = maxIsoTimestamp(existing.lastLeadAt, seed.sourceTimestamp)
    }
    if (seed.source === 'queue' && seed.sourceTimestamp) {
      existing.lastQueueMatchAt = maxIsoTimestamp(existing.lastQueueMatchAt, seed.sourceTimestamp)
    }
  }

  return [...aggregated.values()]
}

export async function upsertMonitoredAccountSeeds(
  supabase: SupabaseClient,
  seeds: MonitoredCompanySeed[],
): Promise<number> {
  const aggregated = aggregateMonitoredAccountSeeds(seeds)
  if (aggregated.length === 0) return 0

  const nowIso = new Date().toISOString()
  const payload = aggregated.map(seed => ({
    user_id: seed.userId,
    client_id: seed.clientId,
    company_name: seed.companyName,
    company_domain: seed.companyDomain,
    website_url: seed.websiteUrl,
    company_key: seed.companyKey,
    seed_sources: [...seed.seedSources].sort(),
    is_watchlist: seed.isWatchlist,
    priority_score: seed.priorityScore,
    last_seeded_at: nowIso,
    last_lead_at: seed.lastLeadAt,
    last_queue_match_at: seed.lastQueueMatchAt,
  }))

  const { error } = await supabase
    .from('monitored_accounts')
    .upsert(payload, { onConflict: 'client_id,company_key' })

  if (error) {
    throw new Error(error.message)
  }

  return payload.length
}

export async function syncMonitoredAccountsFromWorkspaceSources(
  supabase: SupabaseClient,
): Promise<{ seeded: number; clients: number }> {
  const activeCutoff = new Date(Date.now() - STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: clients }, { data: watchlist }, { data: leads }, { data: queueRows }] = await Promise.all([
    supabase
      .from('client_accounts')
      .select('id')
      .eq('is_archived', false),
    supabase
      .from('watchlist_companies')
      .select('user_id, client_id, company_name, company_domain, created_at')
      .not('client_id', 'is', null),
    supabase
      .from('leads')
      .select('user_id, client_id, target_company, company_domain, created_at, status')
      .not('client_id', 'is', null)
      .gte('created_at', activeCutoff),
    supabase
      .from('lead_delivery_queue')
      .select('user_id, client_id, target_company, company_domain, queued_at, delivered_at, relevance_score, queue_status')
      .gte('queued_at', activeCutoff),
  ])

  const activeClientIds = new Set((clients ?? []).map(client => client.id))
  const seeds: MonitoredCompanySeed[] = []

  for (const row of (watchlist ?? [])) {
    if (!row.client_id || !activeClientIds.has(row.client_id)) continue
    seeds.push({
      userId: row.user_id,
      clientId: row.client_id,
      companyName: row.company_name,
      companyDomain: row.company_domain,
      source: 'watchlist',
      sourceTimestamp: row.created_at,
      priorityBoost: 20,
    })
  }

  for (const row of (leads ?? [])) {
    if (!row.client_id || !activeClientIds.has(row.client_id)) continue
    seeds.push({
      userId: row.user_id,
      clientId: row.client_id,
      companyName: row.target_company,
      companyDomain: row.company_domain,
      source: 'lead',
      sourceTimestamp: row.created_at,
      priorityBoost: row.status === 'sent' || row.status === 'replied' || row.status === 'booked' ? 25 : 0,
    })
  }

  for (const row of (queueRows ?? [])) {
    if (!row.client_id || !activeClientIds.has(row.client_id)) continue
    seeds.push({
      userId: row.user_id,
      clientId: row.client_id,
      companyName: row.target_company,
      companyDomain: row.company_domain,
      source: 'queue',
      sourceTimestamp: row.delivered_at ?? row.queued_at,
      priorityBoost: Math.max(0, Math.round((row.relevance_score ?? 0) * 2) + (row.queue_status === 'delivered' ? 10 : 0)),
    })
  }

  const seeded = await upsertMonitoredAccountSeeds(supabase, seeds)
  return { seeded, clients: activeClientIds.size }
}

export async function fetchMonitoredCompaniesForPolling(
  supabase: SupabaseClient,
  limit: number,
): Promise<CompanySeed[]> {
  const activeCutoff = new Date(Date.now() - STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('monitored_accounts')
    .select('client_id, company_name, company_domain, website_url, priority_score, is_watchlist, last_polled_at, last_seeded_at')
    .or(`is_watchlist.eq.true,last_seeded_at.gte.${activeCutoff}`)
    .order('is_watchlist', { ascending: false })
    .order('priority_score', { ascending: false })
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map(row => ({
    clientId: row.client_id,
    name: row.company_name,
    domain: row.company_domain ?? null,
    websiteUrl: row.website_url ?? null,
    priorityScore: row.priority_score ?? 0,
    isWatchlist: row.is_watchlist ?? false,
  }))
}

export async function markMonitoredCompaniesPolled(
  supabase: SupabaseClient,
  companies: Array<Pick<CompanySeed, 'clientId' | 'name' | 'domain'>>,
): Promise<void> {
  if (companies.length === 0) return
  const nowIso = new Date().toISOString()
  for (const company of companies) {
    const companyKey = buildMonitoredAccountKey({
      companyName: company.name,
      companyDomain: company.domain,
    })
    const { error } = await supabase
      .from('monitored_accounts')
      .update({ last_polled_at: nowIso })
      .eq('client_id', company.clientId)
      .eq('company_key', companyKey)

    if (error) {
      console.error('[monitored-accounts] mark polled error:', error.message)
    }
  }
}

export async function markMonitoredCompaniesSignaled(
  supabase: SupabaseClient,
  companies: Array<{ clientId?: string | null; name: string; domain?: string | null }>,
): Promise<void> {
  if (companies.length === 0) return
  const nowIso = new Date().toISOString()
  const pairs = companies
    .filter(company => company.clientId)
    .map(company => ({
      clientId: company.clientId as string,
      companyKey: buildMonitoredAccountKey({
        companyName: company.name,
        companyDomain: company.domain,
      }),
    }))

  if (pairs.length === 0) return

  for (const pair of pairs) {
    const { error } = await supabase
      .from('monitored_accounts')
      .update({ last_signal_at: nowIso, last_polled_at: nowIso })
      .eq('client_id', pair.clientId)
      .eq('company_key', pair.companyKey)

    if (error) {
      console.error('[monitored-accounts] mark signaled error:', error.message)
    }
  }
}

export async function markMonitoredCompanySignalsByKey(
  supabase: SupabaseClient,
  companies: Array<{ name: string; domain?: string | null }>,
): Promise<void> {
  if (companies.length === 0) return

  const keys = [...new Set(companies.map(company => buildMonitoredAccountKey({
    companyName: company.name,
    companyDomain: company.domain,
  })))]

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('monitored_accounts')
    .update({ last_signal_at: nowIso, last_polled_at: nowIso })
    .in('company_key', keys)

  if (error) {
    console.error('[monitored-accounts] mark global signaled error:', error.message)
  }
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname.includes('.') || url.hostname === 'localhost') return null
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function normalizeCompanyKey(companyName: string, companyDomain?: string | null): string {
  const domain = companyDomain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  if (domain && domain.includes('.')) return `domain:${domain}`

  const name = companyName
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(COMPANY_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return `name:${name || companyName.toLowerCase().trim()}`
}
