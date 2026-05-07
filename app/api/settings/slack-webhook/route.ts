import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'scale')
  if (planCheck instanceof NextResponse) return planCheck
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slack_webhook_url, slack_min_score } = body as {
    slack_webhook_url?: string | null
    slack_min_score?: unknown
  }

  if (slack_webhook_url && !slack_webhook_url.startsWith('https://hooks.slack.com/')) {
    return NextResponse.json({ error: 'Invalid Slack webhook URL' }, { status: 400 })
  }

  const minScore = normalizeSlackMinScore(slack_min_score)
  if (minScore === null) {
    return NextResponse.json({ error: 'Slack alert threshold must be a score from 1 to 10.' }, { status: 400 })
  }

  await supabase
    .from('user_profiles')
    .update({
      slack_webhook_url: slack_webhook_url ?? null,
      slack_min_score: minScore,
    })
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}

function normalizeSlackMinScore(value: unknown): number | null {
  const score = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : 7
  if (!Number.isFinite(score)) return null
  const rounded = Math.round(score)
  return rounded >= 1 && rounded <= 10 ? rounded : null
}
