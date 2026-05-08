import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface EvalTraceRow {
  trace_type: string
  status: 'passed' | 'blocked' | 'failed' | 'warning'
  score: number
  failure_taxonomy: string | null
  reasons: string[] | null
  created_at: string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = clamp(Number(url.searchParams.get('limit') ?? 200))
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let query = supabase
    .from('gtm_eval_traces')
    .select('trace_type, status, score, failure_taxonomy, reasons, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as EvalTraceRow[]
  const statusCounts = countBy(rows.map(row => row.status))
  const typeCounts = countBy(rows.map(row => row.trace_type))
  const taxonomyCounts = countBy(rows.map(row => row.failure_taxonomy ?? 'none'))
  const averageScore = rows.length > 0
    ? Math.round((rows.reduce((sum, row) => sum + Number(row.score || 0), 0) / rows.length) * 100) / 100
    : 0

  return NextResponse.json({
    metrics: {
      total: rows.length,
      average_score: averageScore,
      by_status: statusCounts,
      by_trace_type: typeCounts,
      by_failure_taxonomy: taxonomyCounts,
    },
    traces: rows,
  })
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 200
  return Math.max(1, Math.min(1000, Math.floor(value)))
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, key) => {
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}
