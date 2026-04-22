import { NextResponse } from 'next/server'
import { createAdminClient, createServiceClient } from '@/lib/supabase/server'
import { sendMaxWorkspaceDowngradeWarningEmail } from '@/lib/resend'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const WARNING_WINDOW_DAYS = 7

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'notify_workspace_downgrade')
  try {
  const admin = createAdminClient()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: subscriptions, error } = await supabase
    .from('subscriptions')
    .select('user_id, plan, status, next_billing_date, workspace_downgrade_warning_cycle_at')
    .eq('plan', 'max')
    .neq('status', 'expired')
    .not('next_billing_date', 'is', null)
    .gt('next_billing_date', now.toISOString())
    .lte('next_billing_date', windowEnd)

  if (error) {
    console.error('[notify-workspace-downgrade] subscriptions query error:', error.message)
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let eligible = 0
  let sent = 0
  let skipped = 0

  for (const sub of (subscriptions ?? [])) {
    const cycleAt = sub.next_billing_date
    if (!cycleAt) {
      skipped++
      continue
    }

    if (sub.workspace_downgrade_warning_cycle_at === cycleAt) {
      skipped++
      continue
    }

    const { data: clients, error: clientsErr } = await supabase
      .from('client_accounts')
      .select('id, name')
      .eq('user_id', sub.user_id)
      .eq('is_archived', false)

    if (clientsErr || !clients || clients.length <= 1) {
      skipped++
      continue
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('company_name, active_client_id')
      .eq('user_id', sub.user_id)
      .maybeSingle()

    const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? clients[0]?.id ?? null
    const activeClient = clients.find(client => client.id === activeClientId) ?? clients[0]

    if (!activeClient) {
      skipped++
      continue
    }

    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(sub.user_id)
    const toEmail = userRes.user?.email
    if (userErr || !toEmail) {
      skipped++
      continue
    }

    eligible++

    try {
      await sendMaxWorkspaceDowngradeWarningEmail({
        toEmail,
        accountName: (profile as { company_name?: string } | null)?.company_name ?? activeClient.name,
        activeWorkspaceName: activeClient.name,
        extraWorkspaceCount: Math.max(clients.length - 1, 0),
        nextBillingDate: cycleAt,
      })

      await supabase
        .from('subscriptions')
        .update({
          workspace_downgrade_warning_sent_at: new Date().toISOString(),
          workspace_downgrade_warning_cycle_at: cycleAt,
        })
        .eq('user_id', sub.user_id)

      sent++
    } catch (sendErr) {
      console.error('[notify-workspace-downgrade] send failed:', sendErr)
      skipped++
    }
  }

  console.log('[notify-workspace-downgrade] stats', { eligible, sent, skipped })
  const payload = { eligible, sent, skipped }
  await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
  return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
