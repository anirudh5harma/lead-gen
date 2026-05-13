import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchRSSItems, fetchRSSFromUrl, RSS_QUERIES, PRESS_RELEASE_FEEDS, type RSSItem } from '@/lib/rss'
import { extractSignal } from '@/lib/deepseek'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { fetchJobBoard } from '@/lib/job-boards'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import {
  fetchCompanyOwnedItems,
  fetchConfiguredRssItems,
  fetchCuratedInternetItems,
  fetchGdeltItems,
  fetchHackerNewsItems,
  fetchMonitoredCompanyNewsItems,
  fetchProductHuntItems,
} from '@/lib/signal-sources'
import {
  fetchMonitoredCompaniesForPolling,
  markMonitoredCompaniesPolled,
  markMonitoredCompanySignalsByKey,
  syncMonitoredAccountsFromWorkspaceSources,
} from '@/lib/monitored-accounts'
import { buildSignalNoveltyKey, isLikelySameSignalEvent } from '@/lib/signal-novelty'
import { cheapJunkFilter, classifySourceType, estimateSourceCost, stableCandidateHash, type JunkFilterOutput } from '@/lib/signal-filter'
import { SourceLedger, recordSourceRunMetrics } from '@/lib/source-ledger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const QUERY_BATCH_SIZE = 5
const MAX_CANDIDATES_PER_RUN = 260
const PROCESS_BATCH_SIZE = 5
const EXTRACT_TIMEOUT_MS = 12_000
const MONITORED_COMPANY_LIMIT = 220
const JOB_BOARD_COMPANY_LIMIT = 160
const JOB_BOARD_BATCH_SIZE = 16
const MATCH_TRIGGER_TIMEOUT_MS = 150_000
const DELIVERY_TRIGGER_TIMEOUT_MS = 90_000

const EVENT_KEYWORDS: Record<string, RegExp> = {
  funding: /\b(raise[sd]?|funding|financing|series [a-z]|seed round|venture capital|investment)\b/i,
  acquisition: /\b(acquisition|acquire[sd]?|merger|buyout|deal)\b/i,
  expansion: /\b(expansion|expand(?:s|ed|ing)?|launch(?:es|ed)?|new product|platform|partnership|integration|new office|new market|opens in|entered)\b/i,
  regulation: /\b(regulation|regulatory|compliance|sec|finra|fda|law|mandate|fined|settlement|certification|data breach|security incident|lawsuit|investigation)\b/i,
  hiring: /\b(hire[sd]?|appoint(?:ed)?|joins?|joined|chief|cto|cfo|cpo|ciso|cmo|cro|vp|vice president)\b/i,
}

const HIGH_SIGNAL_PATTERNS = [
  { type: 'funding', pattern: /\b(raise|raises|raised|raising|secure[sd]?|closed|closes)\b.{0,80}\b(series [a-z]|seed|pre-seed|funding|financing|investment|round)\b/i },
  { type: 'acquisition', pattern: /\b(acquire[sd]?|buyout|merger|merges with|to acquire)\b/i },
  { type: 'expansion', pattern: /\b(expands? into|launch(?:es|ed)? (?:in|new|a|an|the|product|platform|tool|app|feature)|opens? (?:a|its) .*office|enters? .*market|new office|new market|partnership|integration)\b/i },
  { type: 'expansion', pattern: /\b(rfp|request for proposal|selects? .*vendor|awards? .*contract|signs? .*contract|implementation|digital transformation|cloud migration)\b/i },
  { type: 'regulation', pattern: /\b(fined|settlement|regulatory approval|sec charges|fda approval|compliance mandate|data breach|security incident|lawsuit|investigation|soc 2|iso 27001)\b/i },
  { type: 'hiring', pattern: /\b(appoint(?:ed|s)?|hires?|hired|joins?|joined)\b.{0,80}\b(ceo|cto|cfo|cpo|ciso|cmo|cro|chief|vp|vice president|head of)\b/i },
]

const NAMED_COMPANY_PATTERN = /\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3}\b/

interface ShortlistResult {
  dedupedCount: number
  rejectedCount: number
  items: CandidateWorkItem[]
  rejected: CandidateWorkItem[]
}

interface CandidateWorkItem {
  fingerprint: string
  item: RSSItem
  rank: number
  shortlistReason: string
  junkFilter: JunkFilterOutput
  rawPayloadHash: string
  candidateId?: string
  extractStatus?: string
}

type RecentSignalRow = {
  id: string
  novelty_key?: string | null
  headline: string
  summary: string | null
  company_name: string
  company_domain?: string | null
  funding_amount?: string | null
  source_name?: string | null
  corroborating_source_count?: number | string | null
  cluster_score?: number | string | null
}

type SignalSchemaState = {
  clusterMetadataAvailable: boolean
}

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  return runPoll(request)
}

export async function POST(request: Request) {
  return runPoll(request)
}

async function runPoll(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'poll_signals')
  const runStartedAt = new Date().toISOString()
  const sourceLedger = new SourceLedger()
  try {
  let inserted = 0
  let skipped = 0
  const stats = {
    fetched_google: 0,
    fetched_press: 0,
    fetched_gdelt: 0,
    fetched_hacker_news: 0,
    fetched_product_hunt: 0,
    fetched_curated_internet: 0,
    fetched_configured_rss: 0,
    fetched_company_owned: 0,
    fetched_company_news: 0,
    deduped_candidates: 0,
    rejected_candidates: 0,
    shortlisted: 0,
    extract_success: 0,
    extract_null: 0,
    extract_timeouts: 0,
    extract_errors: 0,
    duplicates: 0,
    embed_errors: 0,
    insert_errors: 0,
    job_board_checked: 0,
    job_board_inserted: 0,
    monitored_accounts_seeded: 0,
    monitored_accounts_selected: 0,
    previously_processed: 0,
  }
  const insertedCompanies: Array<{ name: string; domain: string | null }> = []
  const signalSchemaState: SignalSchemaState = { clusterMetadataAvailable: true }

  // ── 1. Collect all RSS items ──────────────────────────────────────

  // Google News (keyword queries, 5 at a time)
  const googleItems: RSSItem[] = []
  for (let i = 0; i < RSS_QUERIES.length; i += QUERY_BATCH_SIZE) {
    const batch = RSS_QUERIES.slice(i, i + QUERY_BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(q => fetchRSSItems(q)))
    for (const r of results) {
      if (r.status === 'fulfilled') googleItems.push(...r.value)
    }
  }

  // Press release feeds (PRNewswire, BusinessWire, GlobeNewswire) — all in parallel
  const prResults = await Promise.allSettled(
    PRESS_RELEASE_FEEDS.map(f => fetchRSSFromUrl(f.url, f.source))
  )
  const prItems: RSSItem[] = []
  for (const r of prResults) {
    if (r.status === 'fulfilled') prItems.push(...r.value)
  }

  const monitorSync = await syncMonitoredAccountsFromWorkspaceSources(supabase)
  stats.monitored_accounts_seeded = monitorSync.seeded

  const monitoredCompanies = await fetchMonitoredCompaniesForPolling(supabase, MONITORED_COMPANY_LIMIT)
  stats.monitored_accounts_selected = monitoredCompanies.length

  const [gdeltResult, hackerNewsResult, productHuntResult, curatedInternetResult, configuredRssResult, companyOwnedResult, companyNewsResult] = await Promise.allSettled([
    fetchGdeltItems(),
    fetchHackerNewsItems(),
    fetchProductHuntItems(),
    fetchCuratedInternetItems(),
    fetchConfiguredRssItems(),
    fetchCompanyOwnedItems(monitoredCompanies),
    fetchMonitoredCompanyNewsItems(monitoredCompanies),
  ])
  const gdeltItems = gdeltResult.status === 'fulfilled' ? gdeltResult.value : []
  const hackerNewsItems = hackerNewsResult.status === 'fulfilled' ? hackerNewsResult.value : []
  const productHuntItems = productHuntResult.status === 'fulfilled' ? productHuntResult.value : []
  const curatedInternetItems = curatedInternetResult.status === 'fulfilled' ? curatedInternetResult.value : []
  const configuredRssItems = configuredRssResult.status === 'fulfilled' ? configuredRssResult.value : []
  const companyOwnedItems = companyOwnedResult.status === 'fulfilled' ? companyOwnedResult.value : []
  const companyNewsItems = companyNewsResult.status === 'fulfilled' ? companyNewsResult.value : []

  const allItems = [
    ...googleItems,
    ...prItems,
    ...gdeltItems,
    ...hackerNewsItems,
    ...productHuntItems,
    ...curatedInternetItems,
    ...configuredRssItems,
    ...companyOwnedItems,
    ...companyNewsItems,
  ]
  for (const item of allItems) {
    sourceLedger.addFetched(item.source, 1)
  }
  stats.fetched_google = googleItems.length
  stats.fetched_press = prItems.length
  stats.fetched_gdelt = gdeltItems.length
  stats.fetched_hacker_news = hackerNewsItems.length
  stats.fetched_product_hunt = productHuntItems.length
  stats.fetched_curated_internet = curatedInternetItems.length
  stats.fetched_configured_rss = configuredRssItems.length
  stats.fetched_company_owned = companyOwnedItems.length
  stats.fetched_company_news = companyNewsItems.length
  console.log(
    `Poll: ${googleItems.length} Google News, ${prItems.length} press, ${gdeltItems.length} GDELT, ` +
    `${hackerNewsItems.length} HN, ${productHuntItems.length} Product Hunt, ${curatedInternetItems.length} curated web, ` +
    `${configuredRssItems.length} configured RSS, ${companyOwnedItems.length} owned feed items, ` +
    `${companyNewsItems.length} monitored company news items`
  )

  if (monitoredCompanies.length > 0) {
    await markMonitoredCompaniesPolled(supabase, monitoredCompanies)
  }

  // ── 2. Process each RSS item ──────────────────────────────────────
  const candidates = shortlistItems(allItems)
  stats.deduped_candidates = candidates.dedupedCount
  stats.rejected_candidates = candidates.rejectedCount
  stats.shortlisted = candidates.items.length
  for (const candidate of [...candidates.items, ...candidates.rejected]) {
    sourceLedger.addRawCandidate(candidate.item.source)
    sourceLedger.addFilterResult(candidate.item.source, candidate.junkFilter.pass)
  }
  console.log(`[poll-signals] shortlisted ${candidates.items.length}/${candidates.dedupedCount} candidates`)

  const persistedCandidates = await Promise.all(
    candidates.items.map(candidate => upsertSignalCandidate(supabase, candidate, true))
  )

  await Promise.all(
    candidates.rejected.map(candidate => upsertSignalCandidate(supabase, candidate, false))
  )

  const candidatesToProcess = persistedCandidates.filter(candidate => {
    if (['inserted', 'duplicate', 'extract_null', 'embed_error'].includes(candidate.extractStatus ?? 'pending')) {
      stats.previously_processed++
      skipped++
      return false
    }
    return true
  })

  for (let i = 0; i < candidatesToProcess.length; i += PROCESS_BATCH_SIZE) {
    const batch = candidatesToProcess.slice(i, i + PROCESS_BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(async candidate => ({
      candidate,
      outcome: await processItem(candidate, supabase, signalSchemaState),
    })))
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { candidate, outcome } = result.value
        sourceLedger.addExtractionOutcome(candidate.item.source, mapOutcomeToLedger(outcome.status))
        switch (outcome.status) {
          case 'inserted':
            inserted++
            stats.extract_success++
            insertedCompanies.push({
              name: outcome.companyName,
              domain: outcome.companyDomain ?? null,
            })
            break
          case 'duplicate':
            stats.extract_success++
            stats.duplicates++
            skipped++
            break
          case 'extract_null':
            stats.extract_null++
            skipped++
            break
          case 'extract_timeout':
            stats.extract_timeouts++
            skipped++
            break
          case 'extract_error':
            stats.extract_errors++
            skipped++
            break
          case 'embed_error':
            stats.extract_success++
            stats.embed_errors++
            skipped++
            break
          case 'insert_error':
            stats.extract_success++
            stats.insert_errors++
            skipped++
            break
        }
      } else {
        stats.extract_errors++
        skipped++
        console.error('[poll-signals] batch worker failed:', result.reason)
      }
    }
  }

  // ── 3. Job board monitoring ──────────────────────────────────────
  //
  // For each watchlisted or recently discovered company, check Lever/Greenhouse.
  // If they have 5+ open roles, create a hiring signal (once per 7 days).

  const jobBoardCompanies = monitoredCompanies.slice(0, JOB_BOARD_COMPANY_LIMIT)
  if (jobBoardCompanies.length) {
    stats.job_board_checked = jobBoardCompanies.length
    sourceLedger.addFetched('job_board', jobBoardCompanies.length)
    const jobBoardInserted: string[] = []

    for (let i = 0; i < jobBoardCompanies.length; i += JOB_BOARD_BATCH_SIZE) {
      const batch = jobBoardCompanies.slice(i, i + JOB_BOARD_BATCH_SIZE)
      const jobBoardResults = await Promise.allSettled(
        batch.map(async entry => {
          // Only check if no hiring signal exists in the last 7 days.
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const { data: recentHiringSignal } = await supabase
            .from('signals')
            .select('id')
            .eq('company_name', entry.name)
            .eq('signal_type', 'hiring')
            .eq('source_name', 'job_board')
            .gte('published_at', sevenDaysAgo)
            .maybeSingle()

          if (recentHiringSignal) return null

          const result = await fetchJobBoard(entry.name, entry.domain)
          if (!result || (result.jobCount < 5 && result.seniorRoles.length === 0)) return null

          const seniorTitles = result.seniorRoles.map(r => r.title).join(', ')
          const summary = result.seniorRoles.length > 0
            ? `${entry.name} is actively hiring ${result.jobCount} roles including senior positions: ${seniorTitles.slice(0, 150)}.`
            : `${entry.name} has ${result.jobCount} open positions on ${result.platform}, signaling growth and potential new buying mandates.`
          const headline = `${entry.name} is actively hiring - ${result.jobCount} open roles on ${result.platform}`
          const noveltyKey = buildSignalNoveltyKey({
            companyName: entry.name,
            companyDomain: entry.domain,
            headline,
            summary,
          })
          const clusterScore = computeEventClusterScore({
            corroboratingSourceCount: 1,
            sourceType: 'jobs',
            filterScore: 80,
          })

          const embedding = await embed(`${entry.name} hiring ${summary}`)

          const baseInsertPayload = {
            company_name:     entry.name,
            company_domain:   entry.domain,
            signal_type:      'hiring',
            headline,
            summary,
            novelty_key:      noveltyKey,
            event_cluster_key: noveltyKey,
            corroborating_source_count: 1,
            cluster_score:    clusterScore,
            source_type:      'jobs',
            source_url:       null,
            source_name:      'job_board',
            published_at:     new Date().toISOString(),
            signal_embedding: toVectorLiteral(embedding),
          }
          const { error } = await insertSignalWithClusterFallback(
            supabase,
            baseInsertPayload,
            signalSchemaState,
            'retrying job board insert without cluster metadata',
          )

          if (error) {
            console.error('[poll-signals] job board insert error:', error.message)
            return null
          }

          inserted++
          sourceLedger.addExtractionOutcome('job_board', 'inserted')
          stats.job_board_inserted++
          insertedCompanies.push({
            name: entry.name,
            domain: entry.domain ?? null,
          })
          return entry.name
        })
      )

      jobBoardInserted.push(
        ...jobBoardResults
          .filter(r => r.status === 'fulfilled' && r.value !== null)
          .map(r => (r as PromiseFulfilledResult<string>).value)
      )
    }

    if (jobBoardInserted.length) {
      console.log(`Job board signals: ${jobBoardInserted.join(', ')}`)
    }
  }

  // ── 4. Kick off lead matching ─────────────────────────────────────
  let matchTriggered = false
  let matchResult: DownstreamTriggerResult | null = null
  let deliveryTriggered = false
  let deliveryResult: DownstreamTriggerResult | null = null
  if (inserted > 0) {
    await markMonitoredCompanySignalsByKey(supabase, insertedCompanies)
    matchTriggered = true
    matchResult = await triggerDownstreamCron(request.url, '/api/leads/match', MATCH_TRIGGER_TIMEOUT_MS)

    if (matchResult.ok) {
      deliveryTriggered = true
      deliveryResult = await triggerDownstreamCron(request.url, '/api/cron/deliver-leads', DELIVERY_TRIGGER_TIMEOUT_MS)
    }
  }

  const payload = {
    inserted,
    skipped,
    stats,
    source_metrics: sourceLedger.values(),
    match_triggered: matchTriggered,
    match_result: matchResult,
    delivery_triggered: deliveryTriggered,
    delivery_result: deliveryResult,
  }
  console.log('[poll-signals] stats', { inserted, skipped, ...stats, match_triggered: matchTriggered })
  await recordSourceRunMetrics(supabase, {
    cronRunId: runId,
    metrics: sourceLedger.values(),
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
  })
  await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
  return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    console.error('[poll-signals]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

interface DownstreamTriggerResult {
  ok: boolean
  status?: number
  error?: string
  body?: unknown
}

async function triggerDownstreamCron(
  requestUrl: string,
  path: string,
  timeoutMs: number,
): Promise<DownstreamTriggerResult> {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, error: 'CRON_SECRET is not configured' }

  const url = new URL(path, requestUrl)
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      console.error(`[poll-signals] downstream ${path} failed:`, response.status, body)
    }
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[poll-signals] downstream ${path} trigger error:`, message)
    return { ok: false, error: message }
  }
}

function shortlistItems(allItems: RSSItem[]): ShortlistResult {
  const seen = new Set<string>()
  const deduped: CandidateWorkItem[] = []
  const rejected: CandidateWorkItem[] = []

  for (const item of allItems) {
    // Skip articles older than 7 days
    if (item.pubDate) {
      const age = Date.now() - new Date(item.pubDate).getTime()
      if (age > 7 * 24 * 60 * 60 * 1000) continue
    }

    const dedupeKey = item.link || `${item.source}:${item.title}`.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const junkFilter = cheapJunkFilter(item)
    const rawPayloadHash = stableCandidateHash(item)

    const combinedText = `${item.title} ${item.description}`
    const text = combinedText.toLowerCase()
    const hasNamedCompany = NAMED_COMPANY_PATTERN.test(item.title)
    const matchedHighSignal = HIGH_SIGNAL_PATTERNS.some(({ pattern }) => pattern.test(combinedText))
    const keywordHits = Object.values(EVENT_KEYWORDS).reduce((count, pattern) => (
      count + (pattern.test(text) ? 1 : 0)
    ), 0)
    const isPressRelease = item.source === 'prnewswire' || item.source === 'businesswire' || item.source === 'globenewswire'
    const isOwnedSource = item.source === 'company_owned'
    const isLaunchSource = item.source === 'hacker_news' || item.source === 'product_hunt'
    const isBroadNewsSource = item.source === 'gdelt'
    const isMonitoredNewsSource = item.source === 'google_news_company'

    const baseCandidate = {
      fingerprint: dedupeKey,
      item,
      junkFilter,
      rawPayloadHash,
    }

    if (!junkFilter.pass) {
      rejected.push({
        ...baseCandidate,
        rank: junkFilter.score,
        shortlistReason: junkFilter.reason,
      })
      continue
    }

    if (!hasNamedCompany) {
      rejected.push({
        ...baseCandidate,
        rank: junkFilter.score,
        shortlistReason: 'no_named_company',
      })
      continue
    }

    if (
      !matchedHighSignal &&
      !isPressRelease &&
      !((isOwnedSource || isMonitoredNewsSource || isLaunchSource) && keywordHits > 0)
    ) {
      rejected.push({
        ...baseCandidate,
        rank: junkFilter.score,
        shortlistReason: 'no_high_signal_pattern',
      })
      continue
    }

    let sourceBoost = 1
    if (isPressRelease) sourceBoost = 4
    if (isOwnedSource) sourceBoost = 5
    if (isMonitoredNewsSource) sourceBoost = 4
    if (isLaunchSource) sourceBoost = 3
    if (isBroadNewsSource) sourceBoost = 2
    const recencyBoost = item.pubDate
      ? Math.max(0, 48 - Math.floor((Date.now() - new Date(item.pubDate).getTime()) / (60 * 60 * 1000)))
      : 0

    deduped.push({
      ...baseCandidate,
      rank: keywordHits * 5 + sourceBoost + Math.min(recencyBoost, 12) + (matchedHighSignal ? 8 : 0),
      shortlistReason: matchedHighSignal ? 'high_signal_pattern' : 'press_release_priority',
    })
  }

  deduped.sort((a, b) => b.rank - a.rank)
  return {
    dedupedCount: deduped.length + rejected.length,
    rejectedCount: rejected.length,
    items: deduped.slice(0, MAX_CANDIDATES_PER_RUN),
    rejected: rejected.slice(0, MAX_CANDIDATES_PER_RUN),
  }
}

async function upsertSignalCandidate(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  candidate: CandidateWorkItem,
  shouldProcess: boolean,
): Promise<CandidateWorkItem> {
  const basePayload = {
    fingerprint: candidate.fingerprint,
    title: candidate.item.title,
    description: candidate.item.description,
    source_url: candidate.item.link || null,
    source_name: candidate.item.source,
    published_at: candidate.item.pubDate ? new Date(candidate.item.pubDate).toISOString() : null,
    shortlist_score: candidate.rank,
    shortlist_reason: candidate.shortlistReason,
    ...(shouldProcess ? {} : {
      extract_status: 'extract_null',
      processed_at: new Date().toISOString(),
    }),
    last_seen_at: new Date().toISOString(),
  }
  const auditPayload = {
    source_type: candidate.junkFilter.source_type,
    raw_payload_hash: candidate.rawPayloadHash,
    entity_hints: candidate.junkFilter.entity_hints,
    junk_filter_output: candidate.junkFilter,
    filter_decision: candidate.junkFilter.decision,
    filter_score: candidate.junkFilter.score,
    rejection_reason: shouldProcess ? null : candidate.shortlistReason,
    estimated_cost_usd: estimateSourceCost(candidate.item.source),
  }

  let result = await upsertSignalCandidatePayload(supabase, {
    ...basePayload,
    ...auditPayload,
  })

  if (isSignalCandidateSchemaCacheError(result.error)) {
    console.warn('[poll-signals] signal_candidates audit columns unavailable; retrying candidate upsert without audit metadata')
    result = await upsertSignalCandidatePayload(supabase, basePayload)
  }

  const { data, error } = result
  if (error) {
    console.error('[poll-signals] signal_candidates upsert error:', error.message)
  }
  const row = data as { id?: string; extract_status?: string } | null
  return {
    ...candidate,
    candidateId: row?.id,
    extractStatus: row?.extract_status ?? (shouldProcess ? 'pending' : 'extract_null'),
  }
}

function upsertSignalCandidatePayload(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: Record<string, unknown>,
) {
  return supabase
    .from('signal_candidates')
    .upsert(payload, { onConflict: 'fingerprint' })
    .select('id, extract_status')
    .single()
}

function isSignalCandidateSchemaCacheError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204'
    || /schema cache|could not find .* column/i.test(error.message ?? '')
}

function isSchemaCacheError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204'
    || /schema cache|could not find .* column/i.test(error.message ?? '')
}

function stripSignalClusterMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const fallbackPayload = { ...payload }
  delete fallbackPayload.event_cluster_key
  delete fallbackPayload.corroborating_source_count
  delete fallbackPayload.cluster_score
  delete fallbackPayload.source_type
  return fallbackPayload
}

async function insertSignalWithClusterFallback(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: Record<string, unknown>,
  schemaState: SignalSchemaState,
  fallbackReason: string,
): Promise<{ error: { message: string; code?: string } | null }> {
  const insertPayload = schemaState.clusterMetadataAvailable
    ? payload
    : stripSignalClusterMetadata(payload)
  let { error } = await supabase.from('signals').insert(insertPayload)

  if (schemaState.clusterMetadataAvailable && isSchemaCacheError(error)) {
    schemaState.clusterMetadataAvailable = false
    console.warn(`[poll-signals] signals cluster columns unavailable in schema cache; ${fallbackReason}`)
    const fallbackInsert = await supabase.from('signals').insert(stripSignalClusterMetadata(payload))
    error = fallbackInsert.error
  }

  return { error }
}

type ProcessOutcome =
  | { status: 'inserted'; companyName: string; companyDomain: string | null }
  | { status: 'duplicate' }
  | { status: 'extract_null' }
  | { status: 'extract_timeout' }
  | { status: 'extract_error' }
  | { status: 'embed_error' }
  | { status: 'insert_error' }

async function processItem(
  candidate: CandidateWorkItem,
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  schemaState: SignalSchemaState,
): Promise<ProcessOutcome> {
  const { item, candidateId } = candidate
  if (item.link) {
    const { data: existingByUrl } = await supabase
      .from('signals')
      .select('id')
      .eq('source_url', item.link)
      .maybeSingle()

    if (existingByUrl) {
      await updateCandidateStatus(supabase, candidateId, {
        extract_status: 'duplicate',
        created_signal_id: existingByUrl.id,
      })
      return { status: 'duplicate' }
    }
  }

  let signal
  try {
    signal = await extractSignal(item.title, item.description, EXTRACT_TIMEOUT_MS)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('aborted')) {
      console.error('[poll-signals] extract timeout:', item.title)
      await updateCandidateStatus(supabase, candidateId, { extract_status: 'extract_timeout' })
      return { status: 'extract_timeout' }
    }
    console.error('[poll-signals] extractSignal error:', message)
    await updateCandidateStatus(supabase, candidateId, { extract_status: 'extract_error' })
    return { status: 'extract_error' }
  }

  if (!signal) {
    await updateCandidateStatus(supabase, candidateId, { extract_status: 'extract_null' })
    return { status: 'extract_null' }
  }

  const pubDate = item.pubDate
    ? new Date(item.pubDate).toISOString()
    : new Date().toISOString()
  const noveltyKey = buildSignalNoveltyKey({
    companyName: signal.company_name,
    companyDomain: signal.company_domain,
    headline: item.title,
    summary: signal.summary,
    fundingAmount: signal.funding_amount,
  })
  const noveltyWindowStart = new Date(new Date(pubDate).getTime() - (72 * 60 * 60 * 1000)).toISOString()

  const recentSignalColumns = schemaState.clusterMetadataAvailable
    ? 'id, novelty_key, headline, summary, company_name, company_domain, funding_amount, source_name, corroborating_source_count, cluster_score'
    : 'id, novelty_key, headline, summary, company_name, company_domain, funding_amount, source_name'
  const recentSignalsQuery = supabase
    .from('signals')
    .select(recentSignalColumns)
    .gte('published_at', noveltyWindowStart)
    .order('published_at', { ascending: false })
    .limit(12)

  const recentSignalsResult = signal.company_domain
    ? await recentSignalsQuery.eq('company_domain', signal.company_domain)
    : await recentSignalsQuery.eq('company_name', signal.company_name)
  let recentSignals = recentSignalsResult.data as RecentSignalRow[] | null

  if (isSchemaCacheError(recentSignalsResult.error)) {
    schemaState.clusterMetadataAvailable = false
    console.warn('[poll-signals] signals cluster columns unavailable in schema cache; retrying duplicate lookup without cluster metadata')
    const fallbackRecentSignalsQuery = supabase
      .from('signals')
      .select('id, novelty_key, headline, summary, company_name, company_domain, funding_amount, source_name')
      .gte('published_at', noveltyWindowStart)
      .order('published_at', { ascending: false })
      .limit(12)

    const fallbackRecentSignalsResult = signal.company_domain
      ? await fallbackRecentSignalsQuery.eq('company_domain', signal.company_domain)
      : await fallbackRecentSignalsQuery.eq('company_name', signal.company_name)
    recentSignals = fallbackRecentSignalsResult.data as RecentSignalRow[] | null
  }

  const duplicateSignal = (recentSignals ?? []).find(existing =>
    (existing.novelty_key && existing.novelty_key === noveltyKey) ||
    isLikelySameSignalEvent(
      {
        companyName: signal.company_name,
        companyDomain: signal.company_domain,
        headline: item.title,
        summary: signal.summary,
        fundingAmount: signal.funding_amount,
      },
      {
        companyName: existing.company_name,
        companyDomain: existing.company_domain,
        headline: existing.headline,
        summary: existing.summary,
        fundingAmount: existing.funding_amount,
      },
    )
  )

  if (duplicateSignal) {
    await updateDuplicateClusterSignal(supabase, duplicateSignal, schemaState, {
      noveltyKey,
      sourceName: item.source,
      sourceType: candidate.junkFilter.source_type,
      filterScore: candidate.junkFilter.score,
      recentSignals: recentSignals ?? [],
    })
    await updateCandidateStatus(supabase, candidateId, {
      extract_status: 'duplicate',
      extract_confidence: signal.confidence,
      extracted_signal: signal,
      created_signal_id: duplicateSignal.id,
    })
    return { status: 'duplicate' }
  }

  const corroboratingSourceCount = computeCorroboratingSourceCount(recentSignals ?? [], item.source)
  const clusterScore = computeEventClusterScore({
    corroboratingSourceCount,
    sourceType: candidate.junkFilter.source_type,
    filterScore: candidate.junkFilter.score,
  })

  let embedding: number[]
  try {
    const embeddingText = `${signal.company_name} ${signal.signal_type} ${signal.summary}`
    embedding = await embed(embeddingText)
  } catch (e) {
    console.error('[poll-signals] embed error:', e instanceof Error ? e.message : String(e))
    await updateCandidateStatus(supabase, candidateId, {
      extract_status: 'embed_error',
      extract_confidence: signal.confidence,
      extracted_signal: signal,
    })
    return { status: 'embed_error' }
  }

  const baseInsertPayload = {
    company_name:     signal.company_name,
    company_domain:   signal.company_domain,
    signal_type:      signal.signal_type,
    headline:         item.title,
    summary:          signal.summary,
    funding_amount:   signal.funding_amount,
    novelty_key:      noveltyKey,
    event_cluster_key: noveltyKey,
    corroborating_source_count: corroboratingSourceCount,
    cluster_score:    clusterScore,
    source_type:      candidate.junkFilter.source_type,
    source_url:       item.link,
    source_name:      item.source,
    published_at:     pubDate,
    signal_embedding: toVectorLiteral(embedding),
  }
  const { error } = await insertSignalWithClusterFallback(
    supabase,
    baseInsertPayload,
    schemaState,
    'retrying insert without cluster metadata',
  )

  if (error) {
    if (error.code === '23505' || error.message.includes('signals_source_url_idx')) {
      const { data: existingByUrl } = item.link
        ? await supabase
            .from('signals')
            .select('id')
            .eq('source_url', item.link)
            .maybeSingle()
        : { data: null }

      await updateCandidateStatus(supabase, candidateId, {
        extract_status: 'duplicate',
        extract_confidence: signal.confidence,
        extracted_signal: signal,
        created_signal_id: existingByUrl?.id ?? null,
      })
      return { status: 'duplicate' }
    }

    console.error('[poll-signals] signal insert error:', error.message)
    await updateCandidateStatus(supabase, candidateId, {
      extract_status: 'insert_error',
      extract_confidence: signal.confidence,
      extracted_signal: signal,
    })
    return { status: 'insert_error' }
  }

  const insertedSignal = item.link
    ? await supabase
        .from('signals')
        .select('id')
        .eq('source_url', item.link)
        .maybeSingle()
    : await supabase
        .from('signals')
        .select('id')
        .eq('novelty_key', noveltyKey)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle()

  await updateCandidateStatus(supabase, candidateId, {
    extract_status: 'inserted',
    extract_confidence: signal.confidence,
    extracted_signal: signal,
    created_signal_id: insertedSignal.data?.id ?? null,
  })

  return {
    status: 'inserted',
    companyName: signal.company_name,
    companyDomain: signal.company_domain ?? null,
  }
}

function mapOutcomeToLedger(status: ProcessOutcome['status']): 'success' | 'null' | 'error' | 'duplicate' | 'inserted' {
  if (status === 'inserted') return 'inserted'
  if (status === 'duplicate') return 'duplicate'
  if (status === 'extract_null') return 'null'
  return 'error'
}

function computeCorroboratingSourceCount(
  recentSignals: Array<{ source_name?: string | null; novelty_key?: string | null }>,
  currentSource: string,
): number {
  const sources = new Set<string>()
  if (currentSource) sources.add(currentSource)
  for (const signal of recentSignals) {
    if (signal.source_name) sources.add(signal.source_name)
  }
  return Math.max(1, sources.size)
}

function computeEventClusterScore(params: {
  corroboratingSourceCount: number
  sourceType: ReturnType<typeof classifySourceType>
  filterScore: number
}): number {
  const sourceTypeBoost: Record<ReturnType<typeof classifySourceType>, number> = {
    owned: 16,
    press: 12,
    jobs: 10,
    launch: 8,
    community: 5,
    news: 4,
    social: 3,
    crm: 14,
    unknown: 0,
  }
  const corroborationBoost = Math.min(28, Math.max(0, params.corroboratingSourceCount - 1) * 14)
  const score = params.filterScore * 0.56 + sourceTypeBoost[params.sourceType] + corroborationBoost
  return Math.max(0, Math.min(100, Math.round(score)))
}

async function updateDuplicateClusterSignal(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  duplicateSignal: {
    id?: string | null
    source_name?: string | null
    corroborating_source_count?: number | string | null
    cluster_score?: number | string | null
  },
  schemaState: SignalSchemaState,
  input: {
    noveltyKey: string
    sourceName: string
    sourceType: ReturnType<typeof classifySourceType>
    filterScore: number
    recentSignals: Array<{ source_name?: string | null; novelty_key?: string | null }>
  },
): Promise<void> {
  if (!duplicateSignal.id) return
  if (!schemaState.clusterMetadataAvailable) return
  const corroboratingSourceCount = Math.max(
    Number(duplicateSignal.corroborating_source_count ?? 1),
    computeCorroboratingSourceCount(input.recentSignals, input.sourceName),
  )
  const clusterScore = Math.max(
    Number(duplicateSignal.cluster_score ?? 0),
    computeEventClusterScore({
      corroboratingSourceCount,
      sourceType: input.sourceType,
      filterScore: input.filterScore,
    }),
  )

  let { error } = await supabase
    .from('signals')
    .update({
      event_cluster_key: input.noveltyKey,
      corroborating_source_count: corroboratingSourceCount,
      cluster_score: clusterScore,
    })
    .eq('id', duplicateSignal.id)

  if (isSchemaCacheError(error)) {
    console.warn('[poll-signals] signals cluster columns unavailable in schema cache; skipping duplicate cluster metadata update')
    schemaState.clusterMetadataAvailable = false
    error = null
  }

  if (error) {
    console.error('[poll-signals] duplicate cluster update error:', error.message)
  }
}

async function updateCandidateStatus(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  candidateId: string | undefined,
  updates: Record<string, unknown>,
) {
  if (!candidateId) return
  const { error } = await supabase
    .from('signal_candidates')
    .update({ ...updates, processed_at: new Date().toISOString() })
    .eq('id', candidateId)
  if (error) {
    console.error('[poll-signals] signal_candidates update error:', error.message)
  }
}
