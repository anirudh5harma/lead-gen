import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchRSSItems, fetchRSSFromUrl, RSS_QUERIES, PRESS_RELEASE_FEEDS, type RSSItem } from '@/lib/rss'
import { extractSignal } from '@/lib/claude'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { fetchJobBoard } from '@/lib/job-boards'

const QUERY_BATCH_SIZE = 5
const MAX_CANDIDATES_PER_RUN = 60
const PROCESS_BATCH_SIZE = 4
const EXTRACT_TIMEOUT_MS = 12_000
const MAX_EXTRACT_NULL_LOGS = 8
const MAX_SHORTLIST_LOGS = 8

const EVENT_KEYWORDS: Record<string, RegExp> = {
  funding: /\b(raise[sd]?|funding|financing|series [a-z]|seed round|venture capital|investment)\b/i,
  acquisition: /\b(acquisition|acquire[sd]?|merger|buyout|deal)\b/i,
  expansion: /\b(expansion|expand(?:s|ed|ing)?|launch(?:ed)?|new office|new market|opens in|entered)\b/i,
  regulation: /\b(regulation|regulatory|compliance|sec|finra|fda|law|mandate)\b/i,
  hiring: /\b(hire[sd]?|appoint(?:ed)?|joins?|joined|chief|cto|cfo|cpo|ciso|cmo|cro|vp|vice president)\b/i,
}

const HIGH_SIGNAL_PATTERNS = [
  { type: 'funding', pattern: /\b(raised|raises|secure[sd]?|closed|closes)\b.{0,80}\b(series [a-z]|seed|funding|financing|investment)\b/i },
  { type: 'acquisition', pattern: /\b(acquire[sd]?|buyout|merger|merges with|to acquire)\b/i },
  { type: 'expansion', pattern: /\b(expands? into|launch(?:es|ed)? in|opens? (?:a|its) .*office|enters? .*market|new office|new market)\b/i },
  { type: 'hiring', pattern: /\b(appoint(?:ed|s)?|hires?|hired|joins?|joined)\b.{0,80}\b(ceo|cto|cfo|cpo|ciso|cmo|cro|chief|vp|vice president|head of)\b/i },
]

const NAMED_COMPANY_PATTERN = /\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3}\b/

interface ShortlistResult {
  dedupedCount: number
  items: RSSItem[]
  sampledRejected: Array<{ title: string; source: string; reason: string }>
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
  let inserted = 0
  let skipped = 0
  const stats = {
    fetched_google: 0,
    fetched_press: 0,
    deduped_candidates: 0,
    shortlisted: 0,
    extract_success: 0,
    extract_null: 0,
    extract_timeouts: 0,
    extract_errors: 0,
    duplicates: 0,
    embed_errors: 0,
    insert_errors: 0,
    watchlist_inserted: 0,
  }

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

  const allItems = [...googleItems, ...prItems]
  stats.fetched_google = googleItems.length
  stats.fetched_press = prItems.length
  console.log(`Poll: ${googleItems.length} Google News items, ${prItems.length} press release items`)

  // ── 2. Process each RSS item ──────────────────────────────────────
  const candidates = shortlistItems(allItems)
  stats.deduped_candidates = candidates.dedupedCount
  stats.shortlisted = candidates.items.length
  console.log(`[poll-signals] shortlisted ${candidates.items.length}/${candidates.dedupedCount} candidates`)
  if (candidates.sampledRejected.length) {
    console.log('[poll-signals] shortlist rejected samples', candidates.sampledRejected)
  }

  for (let i = 0; i < candidates.items.length; i += PROCESS_BATCH_SIZE) {
    const batch = candidates.items.slice(i, i + PROCESS_BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(item => processItem(item, supabase)))
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const outcome = result.value
        switch (outcome.status) {
          case 'inserted':
            inserted++
            stats.extract_success++
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

  // ── 3. Watchlist job board monitoring ────────────────────────────
  //
  // For each watchlisted company, check Lever/Greenhouse.
  // If they have 5+ open roles, create a hiring signal (once per 7 days).

  const { data: watchlistEntries } = await supabase
    .from('watchlist_companies')
    .select('company_name, company_domain')

  if (watchlistEntries?.length) {
    const watchlistResults = await Promise.allSettled(
      watchlistEntries.map(async entry => {
        // Only check if no hiring signal exists in the last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: recentHiringSignal } = await supabase
          .from('signals')
          .select('id')
          .eq('company_name', entry.company_name)
          .eq('signal_type', 'hiring')
          .eq('source_name', 'job_board')
          .gte('published_at', sevenDaysAgo)
          .maybeSingle()

        if (recentHiringSignal) return null

        const result = await fetchJobBoard(entry.company_name, entry.company_domain)
        if (!result || result.jobCount < 5) return null

        const seniorTitles = result.seniorRoles.map(r => r.title).join(', ')
        const summary = result.seniorRoles.length > 0
          ? `${entry.company_name} is actively hiring ${result.jobCount} roles including senior positions: ${seniorTitles.slice(0, 150)}.`
          : `${entry.company_name} has ${result.jobCount} open positions on ${result.platform}, signaling growth and potential new buying mandates.`

        const embedding = await embed(`${entry.company_name} hiring ${summary}`)

        const { error } = await supabase.from('signals').insert({
          company_name:     entry.company_name,
          company_domain:   entry.company_domain,
          signal_type:      'hiring',
          headline:         `${entry.company_name} is actively hiring - ${result.jobCount} open roles on ${result.platform}`,
          summary,
          source_url:       null,
          source_name:      'job_board',
          published_at:     new Date().toISOString(),
          signal_embedding: toVectorLiteral(embedding),
        })

        if (error) {
          console.error('[poll-signals] watchlist insert error:', error.message)
          return null
        }

        inserted++
        stats.watchlist_inserted++
        return entry.company_name
      })
    )

    const watchlistInserted = watchlistResults
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<string>).value)

    if (watchlistInserted.length) {
      console.log(`Watchlist job signals: ${watchlistInserted.join(', ')}`)
    }
  }

  // ── 4. Kick off lead matching ─────────────────────────────────────
  if (inserted > 0) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/leads/match`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }).catch(err => {
      console.error('[poll-signals] lead match trigger failed:', err)
    })
  }

  console.log('[poll-signals] stats', { inserted, skipped, ...stats })
  return NextResponse.json({ inserted, skipped, stats })
}

function shortlistItems(allItems: RSSItem[]): ShortlistResult {
  const seen = new Set<string>()
  const deduped: Array<{ item: RSSItem; rank: number }> = []
  const sampledRejected: Array<{ title: string; source: string; reason: string }> = []

  for (const item of allItems) {
    // Skip articles older than 7 days
    if (item.pubDate) {
      const age = Date.now() - new Date(item.pubDate).getTime()
      if (age > 7 * 24 * 60 * 60 * 1000) continue
    }

    const dedupeKey = item.link || `${item.source}:${item.title}`.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const combinedText = `${item.title} ${item.description}`
    const text = combinedText.toLowerCase()
    const hasNamedCompany = NAMED_COMPANY_PATTERN.test(item.title)
    const matchedHighSignal = HIGH_SIGNAL_PATTERNS.some(({ pattern }) => pattern.test(combinedText))
    const isPressRelease = item.source === 'prnewswire' || item.source === 'businesswire' || item.source === 'globenewswire'

    if (!hasNamedCompany) {
      if (sampledRejected.length < MAX_SHORTLIST_LOGS) {
        sampledRejected.push({ title: item.title, source: item.source, reason: 'no_named_company' })
      }
      continue
    }

    if (!matchedHighSignal && !isPressRelease) {
      if (sampledRejected.length < MAX_SHORTLIST_LOGS) {
        sampledRejected.push({ title: item.title, source: item.source, reason: 'weak_event_pattern' })
      }
      continue
    }

    const keywordHits = Object.values(EVENT_KEYWORDS).reduce((count, pattern) => (
      count + (pattern.test(text) ? 1 : 0)
    ), 0)
    const sourceBoost =
      isPressRelease
        ? 4
        : 1
    const recencyBoost = item.pubDate
      ? Math.max(0, 48 - Math.floor((Date.now() - new Date(item.pubDate).getTime()) / (60 * 60 * 1000)))
      : 0

    deduped.push({
      item,
      rank: keywordHits * 5 + sourceBoost + Math.min(recencyBoost, 12) + (matchedHighSignal ? 8 : 0),
    })
  }

  deduped.sort((a, b) => b.rank - a.rank)
  return {
    dedupedCount: deduped.length,
    items: deduped.slice(0, MAX_CANDIDATES_PER_RUN).map(entry => entry.item),
    sampledRejected,
  }
}

type ProcessOutcome =
  | { status: 'inserted' }
  | { status: 'duplicate' }
  | { status: 'extract_null' }
  | { status: 'extract_timeout' }
  | { status: 'extract_error' }
  | { status: 'embed_error' }
  | { status: 'insert_error' }

async function processItem(
  item: RSSItem,
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<ProcessOutcome> {
  let signal
  try {
    signal = await extractSignal(item.title, item.description, EXTRACT_TIMEOUT_MS)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('aborted')) {
      console.error('[poll-signals] extract timeout:', item.title)
      return { status: 'extract_timeout' }
    }
    console.error('[poll-signals] extractSignal error:', message)
    return { status: 'extract_error' }
  }

  if (!signal) {
    logExtractNullSample(item)
    return { status: 'extract_null' }
  }

  const pubDate = item.pubDate
    ? new Date(item.pubDate).toISOString()
    : new Date().toISOString()
  const dateOnly = pubDate.split('T')[0]

  const { data: existing } = await supabase
    .from('signals')
    .select('id')
    .eq('company_name', signal.company_name)
    .eq('signal_type', signal.signal_type)
    .gte('published_at', `${dateOnly}T00:00:00Z`)
    .lte('published_at', `${dateOnly}T23:59:59Z`)
    .maybeSingle()

  if (existing) return { status: 'duplicate' }

  let embedding: number[]
  try {
    const embeddingText = `${signal.company_name} ${signal.signal_type} ${signal.summary}`
    embedding = await embed(embeddingText)
  } catch (e) {
    console.error('[poll-signals] embed error:', e instanceof Error ? e.message : String(e))
    return { status: 'embed_error' }
  }

  const { error } = await supabase.from('signals').insert({
    company_name:     signal.company_name,
    company_domain:   signal.company_domain,
    signal_type:      signal.signal_type,
    headline:         item.title,
    summary:          signal.summary,
    funding_amount:   signal.funding_amount,
    source_url:       item.link,
    source_name:      item.source,
    published_at:     pubDate,
    signal_embedding: toVectorLiteral(embedding),
  })

  if (error) {
    console.error('[poll-signals] signal insert error:', error.message)
    return { status: 'insert_error' }
  }

  return { status: 'inserted' }
}

const extractNullSamples: Array<{ title: string; source: string; snippet: string }> = []

function logExtractNullSample(item: RSSItem) {
  if (extractNullSamples.length >= MAX_EXTRACT_NULL_LOGS) return
  const sample = {
    title: item.title,
    source: item.source,
    snippet: item.description.slice(0, 180),
  }
  extractNullSamples.push(sample)
  console.log('[poll-signals] extract null sample', sample)
}
