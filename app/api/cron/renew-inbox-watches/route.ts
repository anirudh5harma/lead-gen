import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { startGmailWatch } from '@/lib/oauth/gmail-watch'
import { renewOutlookSubscription } from '@/lib/oauth/outlook-watch'
import { getValidAccessToken, type ConnectedAccount } from '@/lib/oauth/sender'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase     = await createServiceClient()
  const runId = await startCronRun(supabase, 'renew_inbox_watches')
  try {
  const pubsubTopic  = process.env.GOOGLE_PUBSUB_TOPIC
  const renewedGmail = []
  const renewedOutlook = []

  // Renew all active Gmail accounts (watch expires in 7 days; renew daily = always fresh)
  if (pubsubTopic) {
    const { data: gmailAccounts } = await supabase
      .from('connected_accounts')
      .select('id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at')
      .eq('provider', 'gmail')
      .eq('is_active', true)

    for (const acc of (gmailAccounts ?? [])) {
      try {
        const accessToken = await getValidAccessToken(acc as ConnectedAccount, supabase)
        const watch = await startGmailWatch(accessToken, pubsubTopic)
        await supabase.from('connected_accounts')
          .update({ gmail_history_id: watch.historyId })
          .eq('id', acc.id)
        renewedGmail.push(acc.email)
      } catch (err) {
        console.error(`[renew-watches] Gmail watch renewal failed for ${acc.email}:`, err)
      }
    }
  }

  // Renew Outlook subscriptions expiring within 12 hours
  const twelveHoursFromNow = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const { data: outlookAccounts } = await supabase
    .from('connected_accounts')
    .select('id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, outlook_subscription_id')
    .eq('provider', 'outlook')
    .eq('is_active', true)
    .lte('outlook_subscription_exp', twelveHoursFromNow)
    .not('outlook_subscription_id', 'is', null)

  for (const acc of (outlookAccounts ?? [])) {
    const subscriptionId = (acc as { outlook_subscription_id?: string }).outlook_subscription_id
    if (!subscriptionId) continue
    try {
      const accessToken = await getValidAccessToken(acc as ConnectedAccount, supabase)
      const newExpiry = await renewOutlookSubscription({ accessToken, subscriptionId })
      await supabase.from('connected_accounts')
        .update({ outlook_subscription_exp: newExpiry })
        .eq('id', acc.id)
      renewedOutlook.push(acc.email)
    } catch (err) {
      console.error(`[renew-watches] Outlook renewal failed for ${acc.email}:`, err)
    }
  }

  const payload = { renewedGmail, renewedOutlook }
  await finishCronRun(supabase, runId, { status: 'success', metrics: {
    renewed_gmail: renewedGmail.length,
    renewed_outlook: renewedOutlook.length,
  } })
  return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
