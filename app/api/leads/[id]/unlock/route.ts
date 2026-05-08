import { NextResponse } from 'next/server'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { checkRateLimit } from '@/lib/rate-limit'
import { resolveLeadRecipients } from '@/lib/outreach-workflow'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const rl = await checkRateLimit(`unlock:${user.id}`, 120, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many unlock attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const leadRes = await supabase
    .from('leads')
    .select('id, user_id, client_id, target_company, company_domain, is_unlocked, contact_email, contact_name, contact_title, contact_verified, feed_snapshot')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const serviceSupabase = await createServiceClient()

  if (leadRes.data.is_unlocked) {
    const enrichment = leadRes.data.contact_email
      ? null
      : await enrichUnlockedLeadContact(serviceSupabase, leadRes.data as Record<string, unknown>, user.id)
    return NextResponse.json({
      ok: true,
      alreadyUnlocked: true,
      contact: leadRes.data.contact_email ? {
        email: leadRes.data.contact_email,
        name: leadRes.data.contact_name,
        title: leadRes.data.contact_title,
        verified: leadRes.data.contact_verified,
      } : enrichment?.contact ?? null,
      contact_enrichment: enrichment?.debug ?? { skipped: Boolean(leadRes.data.contact_email) },
    })
  }

  let usedCredit = false
  try {
    usedCredit = await consumeLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock' },
    })
  } catch (creditError) {
    return NextResponse.json(
      { error: creditError instanceof Error ? creditError.message : 'Unable to use lead credit.' },
      { status: 500 },
    )
  }

  if (!usedCredit) {
    return NextResponse.json(
      { error: 'You need lead credits to unlock this lead. Add credits to continue.' },
      { status: 403 },
    )
  }

  const unlockedAt = new Date().toISOString()
  const { data: unlockedLead, error: updateError } = await supabase
    .from('leads')
    .update({ is_unlocked: true, unlocked_at: unlockedAt })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('is_unlocked', false)
    .select('id')
    .maybeSingle()

  if (updateError) {
    await refundLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock_update_failed' },
    }).catch(() => {})
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!unlockedLead) {
    await refundLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock_race_refund' },
    }).catch(() => {})
    return NextResponse.json({ ok: true, alreadyUnlocked: true })
  }

  const enrichment = await enrichUnlockedLeadContact(serviceSupabase, leadRes.data as Record<string, unknown>, user.id)

  return NextResponse.json({
    ok: true,
    unlockedAt,
    usedCredit,
    contact: enrichment.contact,
    contact_enrichment: enrichment.debug,
  })
}

async function enrichUnlockedLeadContact(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  lead: Record<string, unknown>,
  userId: string,
): Promise<{
  contact: { email: string; name: string | null; title: string | null; verified: boolean } | null
  debug: Record<string, unknown>
}> {
  const signal = normalizeLeadFeedSnapshot(lead.feed_snapshot ?? null)
  const [{ data: profile }, { data: clientProfile }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('services_description')
      .eq('user_id', userId)
      .maybeSingle(),
    typeof lead.client_id === 'string'
      ? supabase
          .from('client_accounts')
          .select('services_description')
          .eq('id', lead.client_id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const servicesDescription =
    (clientProfile as { services_description?: string | null } | null)?.services_description ??
    (profile as { services_description?: string | null } | null)?.services_description ??
    null
  const resolution = await resolveLeadRecipients(supabase, {
    lead: { ...lead, is_unlocked: true },
    userId,
    servicesDescription,
    signalType: signal?.signal_type ?? null,
    signalDomain: signal?.company_domain ?? null,
    consumeCreditIfLocked: false,
    forceRefresh: !lead.contact_email,
    maxContacts: 3,
  })

  return {
    contact: resolution.contact,
    debug: {
      ...resolution.debug,
      found: Boolean(resolution.contact),
    },
  }
}
