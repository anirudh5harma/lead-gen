import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { extractSignal, generateExploreQueries, scoreLeadRelevance } from '@/lib/deepseek'
import { fetchRSSItems, type RSSItem } from '@/lib/rss'

const MAX_QUERIES = 5
const MAX_ITEMS = 24

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
  const [{ data: profile }, { data: clientProfile }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('services_description, icp_keywords, min_relevance_score')
      .eq('user_id', user.id)
      .single(),
    activeClientId
      ? supabase
          .from('client_accounts')
          .select('services_description, icp_keywords, min_relevance_score')
          .eq('id', activeClientId)
          .eq('user_id', user.id)
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

  const generatedQueries = await generateExploreQueries({
    prompt,
    servicesDescription,
    icpKeywords: [...icpKeywords, ...(icpHint ? [icpHint] : [])],
  })
  const queries = Array.from(new Set([prompt, ...generatedQueries])).slice(0, MAX_QUERIES)

  const settledItems = await Promise.allSettled(
    queries.map(query => fetchRSSItems(query, '30d')),
  )
  const items = flattenItems(settledItems)
  if (items.length === 0) {
    return NextResponse.json({ ok: true, queries, inserted: 0, skipped: 0 })
  }

  let inserted = 0
  let skipped = 0

  for (const item of items.slice(0, MAX_ITEMS)) {
    const extracted = await extractSignal(item.title, item.description).catch(() => null)
    if (!extracted) {
      skipped++
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
      continue
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', user.id)
      .eq('signal_id', signal.id)
      .eq('origin', 'explore')
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    const { error: leadError } = await supabase
      .from('leads')
      .insert({
        user_id: user.id,
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
          query: queries.find(query => item.title.toLowerCase().includes(query.toLowerCase().slice(0, 12))) ?? prompt,
        },
      })

    if (leadError) {
      skipped++
      continue
    }

    inserted++
  }

  return NextResponse.json({
    ok: true,
    queries,
    inserted,
    skipped,
  })
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
