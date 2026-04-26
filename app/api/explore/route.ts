import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { generateExploreLeads } from '@/lib/deepseek'
import { shouldUseWorkspaceIcp } from '@/lib/explore'
import { buildExploreLeadFeedSnapshot, type LeadSignalType } from '@/lib/lead-sources'

const MAX_RESULTS = 12

export async function POST(request: Request) {
  const startedAt = Date.now()
  const supabase = await createClient()
  const admin = createAdminClient()
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

  const { data: run } = await admin
    .from('explore_runs')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      prompt,
      icp_hint: icpHint || null,
      seller_profile_snapshot: servicesDescription || null,
      workspace_icp_snapshot: workspaceIcpContext || null,
      used_workspace_icp: useWorkspaceIcp,
      status: 'running',
    })
    .select('id')
    .single()

  const runId = run?.id ?? null

  const generation = await generateExploreLeads({
    prompt,
    sellerProfileDescription: servicesDescription,
    workspaceIcpContext,
    useWorkspaceIcp,
  })

  if (!generation.ok) {
    if (runId) {
      await admin
        .from('explore_runs')
        .update({
          status: 'failed',
          error_message: generation.rejection_reason ?? 'Prompt generation failed.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }

    return NextResponse.json({
      ok: false,
      inserted: 0,
      skipped: 0,
      generated: 0,
      duration_ms: Date.now() - startedAt,
      message: generation.rejection_reason ?? 'This prompt is outside the scope of lead generation.',
    }, { status: generation.failure_kind === 'invalid_prompt' ? 400 : 502 })
  }

  const suggestions = generation.leads.slice(0, MAX_RESULTS)

  if (suggestions.length === 0) {
    if (runId) {
      await admin
        .from('explore_runs')
        .update({
          status: 'completed',
          generated_count: 0,
          inserted_count: 0,
          skipped_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }

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
  let duplicates = 0
  let sourceErrors = 0
  let leadErrors = 0

  for (const suggestion of suggestions) {
    const resultKey = buildExploreResultKey({
      userId: user.id,
      clientId: activeClientId,
      companyName: suggestion.company_name,
      companyDomain: suggestion.company_domain,
    })

    const { data: target, error: targetError } = await saveExploreTarget(admin, {
      run_id: runId,
      user_id: user.id,
      client_id: activeClientId,
      result_key: resultKey,
      company_name: suggestion.company_name,
      company_domain: suggestion.company_domain,
      signal_type: suggestion.signal_type,
      headline: suggestion.headline,
      summary: suggestion.summary,
      relevance_reason: suggestion.relevance_reason,
      relevance_score: suggestion.relevance_score,
      prompt,
      icp_hint: icpHint || null,
      source_payload: {
        prompt,
        icp_hint: icpHint || null,
        used_workspace_icp: useWorkspaceIcp,
      },
      updated_at: now,
    })

    if (targetError || !target) {
      sourceErrors++
      if (targetError) console.error('[explore] explore target save error:', targetError.message)
      skipped++
      continue
    }

    const { data: existingLead } = await admin
      .from('leads')
      .select('id')
      .eq('user_id', user.id)
      .eq('source_kind', 'explore_target')
      .eq('source_record_id', target.id)
      .maybeSingle()

    if (existingLead) {
      duplicates++
      skipped++
      continue
    }

    const snapshot = buildExploreLeadFeedSnapshot({
      signalType: suggestion.signal_type as LeadSignalType,
      headline: suggestion.headline,
      summary: suggestion.summary,
      companyDomain: suggestion.company_domain,
      prompt,
      icpHint: icpHint || null,
      usedWorkspaceIcp: useWorkspaceIcp,
      sourceUrl: `explore://target/${target.id}`,
      sourceName: 'explore_generated',
      publishedAt: now,
    })

    const { error: leadError } = await admin
      .from('leads')
      .insert({
        user_id: user.id,
        client_id: activeClientId,
        signal_id: null,
        origin: 'explore',
        source_kind: 'explore_target',
        source_record_id: target.id,
        target_company: suggestion.company_name,
        company_domain: suggestion.company_domain,
        relevance_score: suggestion.relevance_score,
        relevance_reason: `Explore: ${suggestion.relevance_reason}`.slice(0, 1000),
        status: 'new',
        is_unlocked: false,
        unlocked_at: null,
        feed_snapshot: snapshot,
        match_debug: {
          matched_via: 'explore_generation',
          prompt,
          icp_hint: icpHint || null,
          used_workspace_icp: useWorkspaceIcp,
          run_id: runId,
          source_kind: 'explore_target',
        },
      })

    if (leadError) {
      leadErrors++
      console.error('[explore] lead insert error:', leadError.message)
      skipped++
      continue
    }

    inserted++
  }

  if (runId) {
    await admin
      .from('explore_runs')
      .update({
        status: 'completed',
        generated_count: suggestions.length,
        inserted_count: inserted,
        skipped_count: skipped,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
  }

  return NextResponse.json({
    ok: true,
    generated: suggestions.length,
    inserted,
    skipped,
    duplicates,
    source_errors: sourceErrors,
    lead_errors: leadErrors,
    duration_ms: Date.now() - startedAt,
    message: inserted > 0
      ? `Added ${inserted} explore ${inserted === 1 ? 'lead' : 'leads'}${useWorkspaceIcp ? ' using workspace ICP context.' : ' directly from the prompt.'}`
      : duplicates > 0 && sourceErrors === 0 && leadErrors === 0
          ? `Found ${duplicates} duplicate explore ${duplicates === 1 ? 'lead' : 'leads'} and added no new ones.`
          : 'No new explore leads were added due to save errors.',
  })
}

function buildExploreResultKey(params: {
  userId: string
  clientId: string | null
  companyName: string
  companyDomain: string | null
}) {
  return [
    'explore',
    params.userId,
    params.clientId ?? 'workspace-none',
    (params.companyDomain || params.companyName).trim().toLowerCase(),
  ]
    .join(':')
    .replace(/[^a-z0-9:.-]+/g, '-')
}

async function saveExploreTarget(
  admin: ReturnType<typeof createAdminClient>,
  payload: {
    run_id: string | null
    user_id: string
    client_id: string | null
    result_key: string
    company_name: string
    company_domain: string | null
    signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
    headline: string
    summary: string
    relevance_reason: string
    relevance_score: number
    prompt: string
    icp_hint: string | null
    source_payload: Record<string, unknown>
    updated_at: string
  },
) {
  const { data: existing, error: existingError } = await admin
    .from('explore_targets')
    .select('id')
    .eq('result_key', payload.result_key)
    .maybeSingle()

  if (existingError) return { data: null, error: existingError }

  if (existing) {
    const { data, error } = await admin
      .from('explore_targets')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single()
    return { data, error }
  }

  const inserted = await admin
    .from('explore_targets')
    .insert(payload)
    .select('id')
    .single()

  if (!inserted.error) return inserted

  if (inserted.error.code === '23505') {
    return await admin
      .from('explore_targets')
      .select('id')
      .eq('result_key', payload.result_key)
      .single()
  }

  return inserted
}
