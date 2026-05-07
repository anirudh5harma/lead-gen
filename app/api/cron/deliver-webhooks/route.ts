import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from '@/lib/a2a/webhook'
import { startCronRun, finishCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BATCH_SIZE = 50
const SIGNAL_LOOKBACK_MINUTES = 15

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

function signalMatchesFilter(
  signal: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true

  const text = `${signal.company_name ?? ''} ${signal.headline ?? ''} ${signal.summary ?? ''}`.toLowerCase()

  const keywords = filter.keywords as string[] | undefined
  if (keywords && keywords.length > 0) {
    const matches = keywords.some((k: string) => text.includes(k.toLowerCase()))
    if (!matches) return false
  }

  const signalTypes = filter.signal_types as string[] | undefined
  if (signalTypes && signalTypes.length > 0) {
    if (!signalTypes.includes(String(signal.signal_type))) return false
  }

  const minScore = filter.min_score as number | undefined
  if (minScore !== undefined && minScore !== null) {
    const clusterScore = Number(signal.cluster_score ?? 0)
    if (clusterScore < minScore) return false
  }

  return true
}

export async function GET(request: Request) {
  return runDeliverWebhooks(request)
}

export async function POST(request: Request) {
  return runDeliverWebhooks(request)
}

async function runDeliverWebhooks(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'deliver_webhooks')

  try {
    const lookback = new Date(Date.now() - SIGNAL_LOOKBACK_MINUTES * 60 * 1000).toISOString()

    // Find signals created in the last 15 minutes that haven't been broadcast yet
    const { data: signals, error: sigErr } = await supabase
      .from('signals')
      .select('id, company_name, company_domain, signal_type, headline, summary, cluster_score, published_at, created_at')
      .gte('created_at', lookback)
      .is('webhook_broadcast_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (sigErr) {
      await finishCronRun(supabase, runId, { status: 'error', errorMessage: sigErr.message })
      return NextResponse.json({ error: sigErr.message }, { status: 500 })
    }

    if (!signals || signals.length === 0) {
      await finishCronRun(supabase, runId, { status: 'success', metrics: { signals: 0, delivered: 0, failed: 0 } })
      return NextResponse.json({ signals: 0, delivered: 0, failed: 0 })
    }

    // Find all active signal.new webhook subscriptions
    const { data: subscriptions, error: subErr } = await supabase
      .from('agent_webhook_subscriptions')
      .select('id, agent_id, url, secret, event_types, min_score, icp_filter')
      .eq('is_active', true)
      .contains('event_types', ['signal.new'])

    if (subErr) {
      await finishCronRun(supabase, runId, { status: 'error', errorMessage: subErr.message })
      return NextResponse.json({ error: subErr.message }, { status: 500 })
    }

    if (!subscriptions || subscriptions.length === 0) {
      // Mark signals as broadcast even if no subscriptions exist
      const signalIds = signals.map(s => s.id)
      await supabase.from('signals').update({ webhook_broadcast_at: new Date().toISOString() }).in('id', signalIds)

      await finishCronRun(supabase, runId, { status: 'success', metrics: { signals: signals.length, delivered: 0, failed: 0, reason: 'No active subscriptions' } })
      return NextResponse.json({ signals: signals.length, delivered: 0, failed: 0, reason: 'No active subscriptions' })
    }

    let totalDelivered = 0
    let totalFailed = 0
    const broadcastedSignalIds = new Set<string>()

    for (const signal of signals) {
      const payload = {
        id: signal.id,
        company_name: signal.company_name,
        company_domain: signal.company_domain,
        signal_type: signal.signal_type,
        headline: signal.headline,
        summary: signal.summary,
        cluster_score: signal.cluster_score,
        published_at: signal.published_at,
      }

      const matchingSubs = subscriptions.filter(sub => {
        // Check min_score against subscription threshold
        const subMinScore = sub.min_score ?? 0
        const clusterScore = Number(signal.cluster_score ?? 0)
        if (clusterScore < subMinScore) return false

        // Check ICP filter
        return signalMatchesFilter(signal as Record<string, unknown>, (sub.icp_filter ?? {}) as Record<string, unknown>)
      })

      if (matchingSubs.length === 0) {
        broadcastedSignalIds.add(signal.id)
        continue
      }

      // Check for existing deliveries to avoid duplicates
      const { data: existingDeliveries } = await supabase
        .from('agent_webhook_deliveries')
        .select('subscription_id')
        .eq('signal_id', signal.id)
        .eq('success', true)

      const alreadyDeliveredTo = new Set((existingDeliveries ?? []).map(d => d.subscription_id))

          const deliveryResults = await Promise.all(
        matchingSubs
          .filter(sub => !alreadyDeliveredTo.has(sub.id))
          .map(async (sub) => {
            return deliverWebhook(supabase, {
              id: sub.id,
              url: sub.url,
              secret: sub.secret,
              event_types: sub.event_types ?? [],
              min_score: sub.min_score ?? 7,
              icp_filter: (sub.icp_filter ?? {}) as Record<string, unknown>,
            }, 'signal.new', payload, signal.id)
          }),
      )

      for (const result of deliveryResults) {
        if (result.success) totalDelivered++
        else totalFailed++
      }

      broadcastedSignalIds.add(signal.id)
    }

    // Mark all processed signals as broadcast
    if (broadcastedSignalIds.size > 0) {
      await supabase
        .from('signals')
        .update({ webhook_broadcast_at: new Date().toISOString() })
        .in('id', Array.from(broadcastedSignalIds))
    }

    const metrics = {
      signals: signals.length,
      subscriptions: subscriptions.length,
      delivered: totalDelivered,
      failed: totalFailed,
    }

    await finishCronRun(supabase, runId, { status: 'success', metrics })
    return NextResponse.json(metrics)

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
