import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { extractSignal, generateExploreQueries, scoreLeadRelevance } from '@/lib/deepseek'
import { fetchRSSItems, type RSSItem } from '@/lib/rss'

const MAX_QUERIES = 5
const MAX_ITEMS = 24
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
    source_summary: 'Explore searches Google News RSS over the last 30 days using your prompt, generated related queries, and your ICP context. It is not the live signal pipeline.',
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
  const rankingContext = [
    servicesDescription,
    `Targeting prompt: ${prompt}`,
    icpHint ? `User ICP hint: ${icpHint}` : '',
    icpKeywords.length > 0 ? `Workspace ICP keywords: ${icpKeywords.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  await updateRun(supabase, runId, userId, { status_message: 'Generating search queries…' })

  const generatedQueries = await generateExploreQueries({
    prompt,
    servicesDescription,
    icpKeywords: [...icpKeywords, ...(icpHint ? [icpHint] : [])],
  })
  const queries = Array.from(new Set([prompt, ...generatedQueries])).slice(0, MAX_QUERIES)

  await updateRun(supabase, runId, userId, {
    queries,
    status_message: `Searching recent coverage across ${queries.length} queries…`,
  })

  const settledItems = await Promise.allSettled(
    queries.map(query => fetchRSSItems(query, '30d')),
  )
  const items = flattenItems(settledItems)

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

  for (const [index, item] of items.slice(0, MAX_ITEMS).entries()) {
    const extracted = await extractSignal(item.title, item.description).catch(() => null)
    if (!extracted) {
      skipped++
      await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
      continue
    }

    const scored = await scoreLeadRelevance(
      rankingContext,
      extracted.signal_type,
      extracted.company_name,
      extracted.summary,
    ).catch(() => ({ score: 5, reason: 'Could not assess relevance.' }))

    if (scored.score < Math.max(5, minRelevanceScore - 1)) {
      skipped++
      await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
      continue
    }

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
      await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
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
      await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
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
        relevance_score: scored.score,
        relevance_reason: `Explore: ${prompt}. ${scored.reason}`.slice(0, 1000),
        status: 'new',
        is_unlocked: false,
        unlocked_at: null,
        match_debug: {
          matched_via: 'explore_search',
          prompt,
          icp_hint: icpHint || null,
          source_name: item.source,
          query: matchedQuery,
          run_id: runId,
        },
      })

    if (leadError) {
      skipped++
      await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
      continue
    }

    inserted++
    await updateProgress(supabase, runId, userId, index + 1, Math.min(items.length, MAX_ITEMS), inserted, skipped)
  }

  return await completeRun(supabase, runId, userId, {
    inserted_count: inserted,
    skipped_count: skipped,
    status_message: inserted > 0
      ? `Completed. Added ${inserted} explore ${inserted === 1 ? 'lead' : 'leads'}.`
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

function flattenItems(results: PromiseSettledResult<RSSItem[]>[]): RSSItem[] {
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

  return items
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
