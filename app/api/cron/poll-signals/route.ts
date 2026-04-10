import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchRSSItems, fetchRSSFromUrl, RSS_QUERIES, PRESS_RELEASE_FEEDS, type RSSItem } from '@/lib/rss'
import { extractSignal } from '@/lib/claude'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { fetchJobBoard } from '@/lib/job-boards'

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

  // ── 1. Collect all RSS items ──────────────────────────────────────

  // Google News (keyword queries, 5 at a time)
  const googleItems: RSSItem[] = []
  const BATCH = 5
  for (let i = 0; i < RSS_QUERIES.length; i += BATCH) {
    const batch = RSS_QUERIES.slice(i, i + BATCH)
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
  console.log(`Poll: ${googleItems.length} Google News items, ${prItems.length} press release items`)

  // ── 2. Process each RSS item ──────────────────────────────────────

  for (const item of allItems) {
    // Skip articles older than 7 days
    if (item.pubDate) {
      const age = Date.now() - new Date(item.pubDate).getTime()
      if (age > 7 * 24 * 60 * 60 * 1000) { skipped++; continue }
    }

    let signal
    try {
      signal = await extractSignal(item.title, item.description)
    } catch (e) {
      console.error('extractSignal error:', (e as Error).message)
      skipped++
      continue
    }
    if (!signal) { skipped++; continue }

    // Deduplicate by company+type+date
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

    if (existing) { skipped++; continue }

    const embeddingText = `${signal.company_name} ${signal.signal_type} ${signal.summary}`
    const embedding = await embed(embeddingText)

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
      console.error('Signal insert error:', error.message)
    } else {
      inserted++
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

        await supabase.from('signals').insert({
          company_name:     entry.company_name,
          company_domain:   entry.company_domain,
          signal_type:      'hiring',
          headline:         `${entry.company_name} is actively hiring — ${result.jobCount} open roles on ${result.platform}`,
          summary,
          source_url:       null,
          source_name:      'job_board',
          published_at:     new Date().toISOString(),
          signal_embedding: toVectorLiteral(embedding),
        })

        inserted++
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
    }).catch(console.error)
  }

  return NextResponse.json({ inserted, skipped })
}
