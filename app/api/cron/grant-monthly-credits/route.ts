/**
 * Cron — monthly outcome-credit grant. Tops up each workspace's wallet by its
 * `monthly_credit_grant` once per ~30 days. (Real billing-renewal hooks can
 * supersede this later; for now it keeps wallets funded.)
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { grantCredits } from '@/lib/credits/outcomes'

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
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()

  const { data: rows } = await supabase
    .from('user_profiles')
    .select('user_id, active_client_id, monthly_credit_grant, credits_granted_at')
    .gt('monthly_credit_grant', 0)
    .or(`credits_granted_at.is.null,credits_granted_at.lte.${cutoff}`)
    .limit(1000)

  let granted = 0
  const errors: string[] = []
  for (const r of rows ?? []) {
    try {
      await grantCredits(supabase, {
        userId: r.user_id as string,
        clientId: (r.active_client_id as string | null) ?? null,
        units: Number(r.monthly_credit_grant),
        event: 'monthly_grant',
        note: 'monthly plan credit grant',
      })
      await supabase.from('user_profiles').update({ credits_granted_at: new Date().toISOString() }).eq('user_id', r.user_id)
      granted++
    } catch (e) {
      errors.push(`${r.user_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: errors.length === 0, scanned: (rows ?? []).length, granted, errors: errors.length ? errors : undefined })
}
