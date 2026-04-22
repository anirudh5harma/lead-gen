import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const CANDIDATE_STATUSES = [
  'pending',
  'extract_null',
  'extract_timeout',
  'extract_error',
  'duplicate',
  'embed_error',
  'insert_error',
  'inserted',
] as const

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    recentLeadsRes,
    pendingEnrichmentRes,
    pendingFollowupsRes,
    sendingAccountsRes,
    leadDebugRes,
    cronRunsRes,
    ...candidateCountResults
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('contact_email', null)
      .neq('status', 'dismissed'),
    supabase
      .from('scheduled_followups')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('sent_at', null)
      .lte('scheduled_for', new Date().toISOString()),
    supabase
      .from('connected_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true),
    supabase
      .from('leads')
      .select(`
        id,
        target_company,
        relevance_score,
        status,
        created_at,
        match_debug,
        signals(signal_type, headline)
      `)
      .eq('user_id', user.id)
      .not('match_debug', 'is', null)
      .order('created_at', { ascending: false })
      .limit(8),
    service
      .from('cron_runs')
      .select('job_name, status, started_at, finished_at, metrics, error_message')
      .order('started_at', { ascending: false })
      .limit(20),
    ...CANDIDATE_STATUSES.map(status => (
      service
        .from('signal_candidates')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', oneDayAgo)
        .eq('extract_status', status)
    )),
  ])

  const latestRunsByJob = new Map<string, {
    job_name: string
    status: string
    started_at: string
    finished_at: string | null
    metrics: Record<string, unknown> | null
    error_message: string | null
  }>()

  for (const run of (cronRunsRes.data ?? [])) {
    if (!latestRunsByJob.has(run.job_name)) {
      latestRunsByJob.set(run.job_name, {
        job_name: run.job_name,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
        metrics: (run.metrics as Record<string, unknown> | null) ?? null,
        error_message: run.error_message ?? null,
      })
    }
  }

  const candidateCounts = Object.fromEntries(
    candidateCountResults.map((result, index) => [
      CANDIDATE_STATUSES[index],
      result.count ?? 0,
    ]),
  )

  return NextResponse.json({
    counts: {
      user_leads_last_24h: recentLeadsRes.count ?? 0,
      pending_enrichment: pendingEnrichmentRes.count ?? 0,
      pending_followups: pendingFollowupsRes.count ?? 0,
      active_sending_accounts: sendingAccountsRes.count ?? 0,
    },
    signal_candidates_last_24h: candidateCounts,
    cron_health: Array.from(latestRunsByJob.values()),
    lead_diagnostics: (leadDebugRes.data ?? []).map(lead => ({
      id: lead.id,
      target_company: lead.target_company,
      relevance_score: lead.relevance_score,
      status: lead.status,
      created_at: lead.created_at,
      match_debug: lead.match_debug,
      signal: Array.isArray(lead.signals) ? lead.signals[0] ?? null : lead.signals,
    })),
  })
}
