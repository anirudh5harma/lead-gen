/**
 * Cron — monthly outcome-credit grant. Tops up each workspace's wallet by its
 * `monthly_credit_grant` once per calendar month from the last payment/grant
 * anchor. Billing webhooks remain the primary renewal path; this covers annual
 * plans and missed grant retries without drifting to the first of the month.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { grantCredits } from '@/lib/credits/outcomes'
import { isBillingPeriodStillActive, isMonthlyGrantDue } from '@/lib/billing-period'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) { return run(request) }
export async function POST(request: Request) { return run(request) }

async function run(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createServiceClient()
  const now = new Date()
  const nowIso = now.toISOString()

  const { data: rows } = await supabase
    .from('user_profiles')
    .select('user_id, active_client_id, monthly_credit_grant, credits_granted_at, subscription_status, subscription_renews_at')
    .gt('monthly_credit_grant', 0)
    .eq('subscription_status', 'active')
    .limit(1000)

  let granted = 0
  let skipped = 0
  const errors: string[] = []
  for (const r of rows ?? []) {
    if (!isMonthlyGrantDue(r.credits_granted_at, now) || !isBillingPeriodStillActive(r.subscription_renews_at, now)) {
      skipped++
      continue
    }

    try {
      await grantCredits(supabase, {
        userId: r.user_id as string,
        clientId: (r.active_client_id as string | null) ?? null,
        units: Number(r.monthly_credit_grant),
        event: 'monthly_grant',
        note: 'monthly plan credit grant',
      })
      await supabase.from('user_profiles').update({ credits_granted_at: nowIso }).eq('user_id', r.user_id)
      granted++
    } catch (e) {
      errors.push(`${r.user_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: errors.length === 0, scanned: (rows ?? []).length, granted, skipped, errors: errors.length ? errors : undefined })
}
