import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserPlan } from '@/lib/plan'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await getUserPlan(user.id)
  if (plan !== 'max') {
    return NextResponse.json({ error: 'Slack integration requires the Max plan.' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slack_webhook_url } = body as { slack_webhook_url?: string }

  if (slack_webhook_url && !slack_webhook_url.startsWith('https://hooks.slack.com/')) {
    return NextResponse.json({ error: 'Invalid Slack webhook URL' }, { status: 400 })
  }

  await supabase
    .from('user_profiles')
    .update({ slack_webhook_url: slack_webhook_url ?? null })
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
