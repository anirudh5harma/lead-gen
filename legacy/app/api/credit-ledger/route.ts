/**
 * Credit ledger — every grant / debit for the workspace, newest first.
 * GET ?limit=30
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id, lead_credit_balance, monthly_credit_grant').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profile?.active_client_id as string | null) ?? user.id
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 30, 200)

  const { data: entries } = await supabase
    .from('credit_ledger')
    .select('id, direction, event_type, units, balance_after, lead_id, post_id, note, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return NextResponse.json({
    balance: profile?.lead_credit_balance ?? 0,
    monthlyGrant: profile?.monthly_credit_grant ?? 0,
    entries: entries ?? [],
  })
}
