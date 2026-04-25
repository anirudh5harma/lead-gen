import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { extractSignal, generateExploreQueries, scoreExploreCandidate } from '@/lib/deepseek'
import {
  buildExploreSearchTerms,
  rankExploreCandidates,
  resolveExploreScoreThreshold,
  scoreExploreSourceItem,
  shouldUseWorkspaceIcp,
} from '@/lib/explore'
import { fetchRSSFromUrl, fetchRSSItems, PRESS_RELEASE_FEEDS, type RSSItem } from '@/lib/rss'

const MAX_QUERIES = 5
const MAX_ITEMS = 24
const MAX_PRESS_RELEASE_ITEMS = 12
const PRESS_RELEASE_TIMEOUT_MS = 4500
type ExploreRunStatus = 'queued' | 'running' | 'completed' | 'failed'

interface ExploreRunRow {
  id: string
  prompt: string
  icp_hint: string | null
  status: ExploreRunStatus
  source_type: 'google_news_rss'
  status_message: string | null
  queries: string[] | null
  items_total: number
  items_processed: number
  inserted_count: number
  skipped_count: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface ExploreCandidate {
  item: RSSItem
  extracted: {
    company_name: string
    company_domain: string | null
    signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
    summary: string
    funding_amount: string | null
    confidence: 1 | 2 | 3
  }
  score: number
  reason: string
  publishedAt: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let query = supabase
    .from('explore_search_runs')
    .select(`
      id,
      prompt,
      icp_hint,
      status,
      source_type,
      status_message,
      queries,
      items_total,
      items_processed,
      inserted_count,
      skipped_count,
      error_message,
      started_at,
      completed_at,
      created_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(8)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    runs: ((data ?? []) as ExploreRunRow[]).map(serializeRun),
    source_summary: 'Explore searches Google News RSS plus selected press-release feeds over the last 30 days using your prompt and generated related queries. Workspace ICP is only applied when you explicitly ask for it or provide an ICP hint. It is not the live signal pipeline.',
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    prompt?: string
    icp_hint?: string
  } | null

  const prompt = body?.prompt?.trim() ?? ''
  const icpHint = body?.icp_hint?.trim() ?? ''
  if (prompt.length < 8) {
    return NextResponse.json({ error: 'Add a more specific targeting prompt.' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let runningQuery = supabase
    .from('explore_search_runs')
    .select(`
      id,
      prompt,
      icp_hint,
      status,
      source_type,
      status_message,
      queries,
      items_total,
      items_processed,
      inserted_count,
      skipped_count,
      error_message,
      started_at,
      completed_at,
      created_at
    `)
    .eq('user_id', user.id)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)

  runningQuery = activeClientId ? runningQuery.eq('client_id', activeClientId) : runningQuery.is('client_id', null)
  const { data: existingRun } = await runningQuery.maybeSingle()
  if (existingRun) {
    return NextResponse.json({
      error: 'An explore search is already running for this workspace.',
      run: serializeRun(existingRun as ExploreRunRow),
    }, { status: 409 })
  }

  const { data: createdRun, error: createError } = await supabase
    .from('explore_search_runs')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      prompt,
      icp_hint: icpHint || null,
      status: 'queued',
      source_type: 'google_news_rss',
      status_message: 'Generating search queries…',
    })
    .select(`
      id,
      prompt,
      icp_hint,
      status,
      source_type,
      status_message,
      queries,
      items_total,
      items_processed,
      inserted_count,
      skipped_count,
      error_message,
      started_at,
      completed_at,
      created_at
    `)
    .single()

  if (createError || !createdRun) {
    return NextResponse.json({ error: createError?.message ?? 'Failed to create explore search run.' }, { status: 500 })
  }

  after(async () => {
    try {
      await processExploreRun({
        supabase,
        userId: user.id,
        activeClientId,
        runId: createdRun.id,
        prompt,
        icpHint,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Explore search failed.'
      await supabase
        .from('explore_search_runs')
        .update({
          status: 'failed',
          status_message: 'Search failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', createdRun.id)
        .eq('user_id', user.id)
    }
  })

  return NextResponse.json({
    ok: true,
    run: serializeRun(createdRun as ExploreRunRow),
  })
}

async function processExploreRun(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  activeClientId: string | null
  runId: string
  prompt: string
  icpHint: string
}) {
  const { supabase, userId, activeClientId, runId, prompt, icpHint } = params

  await updateRun(supabase, runId, userId, {
    status: 'running',
    started_at: new Date().toISOString(),
    status_message: 'Loading workspace context…',
    error_message: null,
  })

  const [{ data: profile }, { data: clientProfile }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('services_description, icp_keywords, min_relevance_score')
      .eq('user_id', userId)
      .single(),
    activeClientId
      ? supabase
          .from('client_accounts')
          .select('services_description, icp_keywords, min_relevance_score')
          .eq('id', activeClientId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const servicesDescription = clientProfile?.services_description || profile?.services_description || ''
  const icpKeywords = (clientProfile?.icp_keywords ?? profile?.icp_keywords ?? []) as string[]
  const minRelevanceScore = (clientProfile?.min_relevance_score ?? profile?.min_relevance_score ?? 6) as number
  const useWorkspaceIcp = shouldUseWorkspaceIcp({ prompt, icpHint })
  const workspaceContext = useWorkspaceIcp
    ? [
        servicesDescription,
        icpHint ? `User ICP hint: ${icpHint}` : '',
        icpKeywords.length > 0 ? `Workspace ICP keywords: ${icpKeywords.join(', ')}` : '',
      ].filter(Boolean).join('\n')
    : ''
  const scoreThreshold = resolveExploreScoreThreshold({
    useWorkspaceIcp,
    minRelevanceScore,
  })

  await updateRun(supabase, runId, userId, { status_message: 'Generating search queries…' })

  const generatedQueries = await generateExploreQueries({
    prompt,
    servicesDescription: useWorkspaceIcp ? servicesDescription : '',
    icpKeywords: useWorkspaceIcp ? [...icpKeywords, ...(icpHint ? [icpHint] : [])] : [],
    useWorkspaceIcp,
  })
  const queries = Array.from(new Set([prompt, ...generatedQueries])).slice(0, MAX_QUERIES)

  await updateRun(supabase, runId, userId, {
    queries,
    status_message: `Searching recent coverage across news and press-release feeds…`,
  })

  const searchTerms = buildExploreSearchTerms({ prompt, queries })
  const [newsResults, pressReleaseItems] = await Promise.all([
    Promise.allSettled(queries.map(query => fetchRSSItems(query, '30d'))),
    fetchPressReleaseItems(searchTerms),
  ])
  const items = flattenItems(newsResults, pressReleaseItems)

  await updateRun(supabase, runId, userId, {
    items_total: Math.min(items.length, MAX_ITEMS),
    items_processed: 0,
    status_message: items.length === 0
      ? 'No source coverage found for this search.'
      : `Reviewing ${Math.min(items.length, MAX_ITEMS)} recent results…`,
  })

  if (items.length === 0) {
    return await completeRun(supabase, runId, userId, {
      inserted_count: 0,
      skipped_count: 0,
      status_message: 'Completed with no matching source coverage.',
    })
  }

  let inserted = 0
  let skipped = 0
  const candidates: ExploreCandidate[] = []
  const itemsToReview = items.slice(0, MAX_ITEMS)

  for (const [index, item] of itemsToReview.entries()) {
    const extracted = await extractSignal(item.title, item.description).catch(() => null)
    if (!extracted) {
      skipped++
      await updateProgress(supabase, runId, userId, index + 1, itemsToReview.length, inserted, skipped)
      continue
    }

    const scored = await scoreExploreCandidate({
      prompt,
      companyName: extracted.company_name,
      signalType: extracted.signal_type,
      signalSummary: extracted.summary,
      workspaceContext: workspaceContext || null,
    }).catch(() => ({ score: 5, reason: 'Could not assess prompt match.' }))

    if (scored.score < scoreThreshold) {
      skipped++
      await updateProgress(supabase, runId, userId, index + 1, itemsToReview.length, inserted, skipped)
      continue
    }

    candidates.push({
      item,
      extracted,
      score: scored.score,
      reason: scored.reason,
      publishedAt: item.pubDate,
    })

    await updateProgress(supabase, runId, userId, index + 1, itemsToReview.length, inserted, skipped)
  }

  const rankedCandidates = rankExploreCandidates(candidates)

  for (const candidate of rankedCandidates) {
    const { item, extracted, score, reason } = candidate

    const signalUrl = item.link || `explore://${slugify(extracted.company_name)}:${slugify(item.title)}`
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .upsert({
        company_name: extracted.company_name,
        company_domain: extracted.company_domain,
        signal_type: extracted.signal_type,
        headline: item.title,
        summary: extracted.summary,
        funding_amount: extracted.funding_amount,
        source_url: signalUrl,
        source_name: item.source,
        published_at: item.pubDate,
      }, { onConflict: 'source_url' })
      .select('id')
      .single()

    if (signalError || !signal) {
      skipped++
      continue
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', userId)
      .eq('signal_id', signal.id)
      .eq('origin', 'explore')
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    const matchedQuery = queries.find(query =>
      item.title.toLowerCase().includes(query.toLowerCase().slice(0, 12)),
    ) ?? prompt

    const { error: leadError } = await supabase
      .from('leads')
      .insert({
        user_id: userId,
        client_id: activeClientId,
        signal_id: signal.id,
        origin: 'explore',
        target_company: extracted.company_name,
        company_domain: extracted.company_domain,
        relevance_score: score,
        relevance_reason: `Explore: ${prompt}. ${reason}`.slice(0, 1000),
        status: 'new',
        is_unlocked: false,
        unlocked_at: null,
        match_debug: {
          matched_via: 'explore_search',
          prompt,
          icp_hint: icpHint || null,
          used_workspace_icp: useWorkspaceIcp,
          source_name: item.source,
          query: matchedQuery,
          run_id: runId,
        },
      })

    if (leadError) {
      skipped++
      continue
    }

    inserted++
  }

  return await completeRun(supabase, runId, userId, {
    inserted_count: inserted,
    skipped_count: skipped,
    status_message: inserted > 0
      ? `Completed. Added ${inserted} explore ${inserted === 1 ? 'lead' : 'leads'}${useWorkspaceIcp ? ' using workspace ICP filters.' : ' ranked only against the prompt.'}`
      : 'Completed, but nothing cleared the relevance threshold.',
  })
}

async function updateProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  userId: string,
  itemsProcessed: number,
  itemsTotal: number,
  insertedCount: number,
  skippedCount: number,
) {
  await updateRun(supabase, runId, userId, {
    items_processed: itemsProcessed,
    inserted_count: insertedCount,
    skipped_count: skippedCount,
    status_message: `Reviewing result ${itemsProcessed} of ${itemsTotal}…`,
  })
}

async function completeRun(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  userId: string,
  fields: {
    inserted_count: number
    skipped_count: number
    status_message: string
  },
) {
  await updateRun(supabase, runId, userId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    ...fields,
  })

  const { data: finalRun, error } = await supabase
    .from('explore_search_runs')
    .select(`
      id,
      prompt,
      icp_hint,
      status,
      source_type,
      status_message,
      queries,
      items_total,
      items_processed,
      inserted_count,
      skipped_count,
      error_message,
      started_at,
      completed_at,
      created_at
    `)
    .eq('id', runId)
    .eq('user_id', userId)
    .single()

  if (error || !finalRun) {
    throw new Error(error?.message ?? 'Failed to load completed explore search run.')
  }

  return finalRun as ExploreRunRow
}

async function updateRun(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('explore_search_runs')
    .update(fields)
    .eq('id', runId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(error.message)
  }
}

function serializeRun(run: ExploreRunRow) {
  return {
    ...run,
    queries: Array.isArray(run.queries) ? run.queries : [],
  }
}

async function fetchPressReleaseItems(searchTerms: string[]): Promise<RSSItem[]> {
  if (searchTerms.length === 0) return []

  const results = await Promise.allSettled(
    PRESS_RELEASE_FEEDS.map(feed =>
      fetchRSSFromUrl(feed.url, feed.source, {
        quiet: true,
        timeoutMs: PRESS_RELEASE_TIMEOUT_MS,
      }),
    ),
  )

  const ranked: Array<RSSItem & { sourceScore: number }> = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const sourceScore = scoreExploreSourceItem(
        `${item.title} ${item.description}`,
        searchTerms,
      )
      if (sourceScore <= 0) continue
      ranked.push({ ...item, sourceScore })
    }
  }

  return ranked
    .sort((a, b) => {
      if (b.sourceScore !== a.sourceScore) return b.sourceScore - a.sourceScore
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0
      return bTime - aTime
    })
    .slice(0, MAX_PRESS_RELEASE_ITEMS)
    .map(item => ({
      title: item.title,
      description: item.description,
      link: item.link,
      pubDate: item.pubDate,
      source: item.source,
    }))
}

function flattenItems(
  results: PromiseSettledResult<RSSItem[]>[],
  extraItems: RSSItem[] = [],
): RSSItem[] {
  const dedupe = new Set<string>()
  const items: RSSItem[] = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const key = `${item.link}|${item.title}`.toLowerCase()
      if (dedupe.has(key)) continue
      dedupe.add(key)
      items.push(item)
    }
  }

  for (const item of extraItems) {
    const key = `${item.link}|${item.title}`.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    items.push(item)
  }

  return items
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
