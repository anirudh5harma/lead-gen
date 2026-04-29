import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  normalizeAutoSendPolicy,
  normalizePolicyAge,
  normalizePolicyScore,
  sanitizeAutoSendOrigins,
} from '@/lib/auto-send-policies'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const [policyRes, accountsRes] = await Promise.all([
    activeClientId
      ? supabase
          .from('auto_send_policies')
          .select('id, enabled, connected_account_id, target_origins, require_verified_contact, min_relevance_score, max_lead_age_days')
          .eq('user_id', user.id)
          .eq('client_id', activeClientId)
          .maybeSingle()
      : supabase
          .from('auto_send_policies')
          .select('id, enabled, connected_account_id, target_origins, require_verified_contact, min_relevance_score, max_lead_age_days')
          .eq('user_id', user.id)
          .is('client_id', null)
          .maybeSingle(),
    supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, is_active, last_used_at, created_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ])

  if (policyRes.error) return NextResponse.json({ error: policyRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })

  return NextResponse.json({
    policy: normalizeAutoSendPolicy(policyRes.data ?? null),
    accounts: accountsRes.data ?? [],
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const body = await request.json().catch(() => null) as {
    enabled?: boolean
    connected_account_id?: string | null
    target_origins?: unknown
    require_verified_contact?: boolean
    min_relevance_score?: number
    max_lead_age_days?: number
  } | null

  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  const targetOrigins = sanitizeAutoSendOrigins(body.target_origins)
  const requireVerifiedContact = body.require_verified_contact === true
  const minRelevanceScore = normalizePolicyScore(body.min_relevance_score)
  const maxLeadAgeDays = normalizePolicyAge(body.max_lead_age_days)
  const connectedAccountId = typeof body.connected_account_id === 'string' && body.connected_account_id.trim()
    ? body.connected_account_id.trim()
    : null

  if (connectedAccountId) {
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', connectedAccountId)
      .eq('is_active', true)
      .maybeSingle()

    if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })
    if (!account) return NextResponse.json({ error: 'Connected inbox not found' }, { status: 400 })
  }

  const existingQuery = activeClientId
    ? supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', user.id)
        .eq('client_id', activeClientId)
        .maybeSingle()
    : supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', user.id)
        .is('client_id', null)
        .maybeSingle()

  const { data: existing, error: existingError } = await existingQuery
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  const payload = {
    user_id: user.id,
    client_id: activeClientId,
    enabled: body.enabled,
    connected_account_id: connectedAccountId,
    target_origins: targetOrigins,
    require_verified_contact: requireVerifiedContact,
    min_relevance_score: minRelevanceScore,
    max_lead_age_days: maxLeadAgeDays,
  }

  const response = existing
    ? await supabase
        .from('auto_send_policies')
        .update(payload)
        .eq('id', existing.id)
        .select('id, enabled, connected_account_id, target_origins, require_verified_contact, min_relevance_score, max_lead_age_days')
        .single()
    : await supabase
        .from('auto_send_policies')
        .insert(payload)
        .select('id, enabled, connected_account_id, target_origins, require_verified_contact, min_relevance_score, max_lead_age_days')
        .single()

  if (response.error) return NextResponse.json({ error: response.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    policy: normalizeAutoSendPolicy(response.data ?? null),
  })
}
