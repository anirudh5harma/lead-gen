import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface DraftEvalCheckRow {
  id?: unknown
  passed?: unknown
  weight?: unknown
  detail?: unknown
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? 50))
  const minScoreParam = Number(url.searchParams.get('min_score') ?? 0)
  const minScore = Number.isFinite(minScoreParam) ? minScoreParam : 0
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let draftsQuery = supabase
    .from('outreach_drafts')
    .select('lead_id, subject, quality_score, quality_checks, quality_checked_at, quality_version')
    .eq('user_id', user.id)
    .not('quality_checked_at', 'is', null)
    .order('quality_checked_at', { ascending: false })
    .limit(limit)
  draftsQuery = activeClientId
    ? draftsQuery.eq('client_id', activeClientId)
    : draftsQuery.is('client_id', null)
  if (minScore > 0) draftsQuery = draftsQuery.gte('quality_score', minScore)

  const { data: drafts, error } = await draftsQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const leadIds = (drafts ?? []).map(row => row.lead_id).filter((id): id is string => typeof id === 'string')
  const leadById = new Map<string, { target_company: string; company_domain: string | null }>()
  if (leadIds.length > 0) {
    let leadQuery = supabase
      .from('leads')
      .select('id, target_company, company_domain')
      .eq('user_id', user.id)
      .in('id', leadIds)
    leadQuery = activeClientId
      ? leadQuery.eq('client_id', activeClientId)
      : leadQuery.is('client_id', null)
    const { data: leads, error: leadError } = await leadQuery
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
    for (const lead of leads ?? []) {
      leadById.set(lead.id, {
        target_company: lead.target_company,
        company_domain: lead.company_domain,
      })
    }
  }

  const failures = new Map<string, number>()
  let totalScore = 0
  let scoredCount = 0
  let lowQualityCount = 0

  const records = (drafts ?? []).map(row => {
    const score = Number(row.quality_score ?? 0)
    if (Number.isFinite(score)) {
      totalScore += score
      scoredCount += 1
      if (score < 70) lowQualityCount += 1
    }
    const checks = Array.isArray(row.quality_checks) ? row.quality_checks as DraftEvalCheckRow[] : []
    const failed = checks
      .filter(check => check?.passed !== true)
      .map(check => typeof check.id === 'string' ? check.id : 'unknown')
    for (const key of failed) failures.set(key, (failures.get(key) ?? 0) + 1)
    const leadContext = typeof row.lead_id === 'string' ? leadById.get(row.lead_id) : undefined
    return {
      lead_id: row.lead_id,
      target_company: leadContext?.target_company ?? null,
      company_domain: leadContext?.company_domain ?? null,
      subject: row.subject,
      quality_score: score,
      quality_checked_at: row.quality_checked_at,
      quality_version: row.quality_version,
      failed_checks: failed,
    }
  })

  const topFailures = [...failures.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }))

  return NextResponse.json({
    metrics: {
      evaluated_drafts: records.length,
      avg_score: scoredCount > 0 ? roundToTwo(totalScore / scoredCount) : 0,
      low_quality_count: lowQualityCount,
      low_quality_rate: scoredCount > 0 ? roundToTwo((lowQualityCount / scoredCount) * 100) : 0,
      top_failed_checks: topFailures,
    },
    drafts: records,
  })
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(1, Math.min(200, Math.floor(value)))
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}
