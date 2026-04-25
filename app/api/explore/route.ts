import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { generateExploreLeads } from '@/lib/deepseek'
import { shouldUseWorkspaceIcp } from '@/lib/explore'

const MAX_RESULTS = 12

export async function POST(request: Request) {
  const startedAt = Date.now()
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
      .select('services_description, icp_keywords')
      .eq('user_id', user.id)
      .single(),
    activeClientId
      ? supabase
          .from('client_accounts')
          .select('services_description, icp_keywords')
          .eq('id', activeClientId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const servicesDescription = clientProfile?.services_description || profile?.services_description || ''
  const icpKeywords = (clientProfile?.icp_keywords ?? profile?.icp_keywords ?? []) as string[]
  const useWorkspaceIcp = shouldUseWorkspaceIcp({ prompt, icpHint })
  const workspaceIcpContext = useWorkspaceIcp
    ? [
        icpHint ? `User ICP hint: ${icpHint}` : '',
        icpKeywords.length > 0 ? `Workspace ICP keywords: ${icpKeywords.join(', ')}` : '',
      ].filter(Boolean).join('\n')
    : ''

  const generation = await generateExploreLeads({
    prompt,
    sellerProfileDescription: servicesDescription,
    workspaceIcpContext,
    useWorkspaceIcp,
  })

  if (!generation.ok) {
    return NextResponse.json({
      ok: false,
      inserted: 0,
      skipped: 0,
      generated: 0,
      duration_ms: Date.now() - startedAt,
      message: generation.rejection_reason ?? 'This prompt is outside the scope of lead generation.',
    }, { status: generation.failure_kind === 'invalid_prompt' ? 400 : 502 })
  }

  const suggestions = generation.leads

  if (suggestions.length === 0) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: 0,
      generated: 0,
      duration_ms: Date.now() - startedAt,
      message: 'No lead suggestions were generated for this prompt.',
    })
  }

  const now = new Date().toISOString()
  let inserted = 0
  let skipped = 0

  for (const [index, suggestion] of suggestions.slice(0, MAX_RESULTS).entries()) {
    const sourceUrl = buildExploreSourceUrl({
      prompt,
      companyName: suggestion.company_name,
      index,
    })

    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .upsert({
        company_name: suggestion.company_name,
        company_domain: suggestion.company_domain,
        signal_type: suggestion.signal_type,
        headline: suggestion.headline,
        summary: suggestion.summary,
        source_url: sourceUrl,
        source_name: 'explore_generated',
        published_at: now,
      }, { onConflict: 'source_url' })
      .select('id')
      .single()

    if (signalError || !signal) {
      skipped++
      continue
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', user.id)
      .eq('signal_id', signal.id)
      .eq('origin', 'explore')
      .maybeSingle()

    if (existingLead) {
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
        target_company: suggestion.company_name,
        company_domain: suggestion.company_domain,
        relevance_score: suggestion.relevance_score,
        relevance_reason: `Explore: ${suggestion.relevance_reason}`.slice(0, 1000),
        status: 'new',
        is_unlocked: false,
        unlocked_at: null,
        match_debug: {
          matched_via: 'explore_generation',
          prompt,
          icp_hint: icpHint || null,
          used_workspace_icp: useWorkspaceIcp,
          source_name: 'explore_generated',
          generation_mode: 'generated',
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
    generated: suggestions.length,
    inserted,
    skipped,
    duration_ms: Date.now() - startedAt,
    message: inserted > 0
      ? `Added ${inserted} explore ${inserted === 1 ? 'lead' : 'leads'}${useWorkspaceIcp ? ' using workspace ICP context.' : ' directly from the prompt.'}`
      : 'No new explore leads were added.',
  })
}

function buildExploreSourceUrl(params: {
  prompt: string
  companyName: string
  index: number
}) {
  return `explore://generated/${slugify(params.companyName)}:${slugify(params.prompt).slice(0, 60)}:${params.index}`
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
