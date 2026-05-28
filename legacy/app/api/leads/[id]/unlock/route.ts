import { NextResponse } from 'next/server'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { loadAccessibleLead } from '@/lib/lead-access'
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

  const serviceSupabase = await createServiceClient()
  const rl = await checkRateLimit(`unlock:${user.id}`, 120, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many unlock attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const leadRes = await loadAccessibleLead<{
    id: string
    user_id: string
    client_id: string | null
    target_company: string
    company_domain: string | null
    is_unlocked: boolean
    contact_email: string | null
    contact_name: string | null
    contact_title: string | null
    contact_verified: boolean | null
    feed_snapshot: unknown
  }>(serviceSupabase, {
    userId: user.id,
    leadId: id,
    select: 'id, user_id, client_id, target_company, company_domain, is_unlocked, contact_email, contact_name, contact_title, contact_verified, feed_snapshot',
  })

  if (leadRes.error) return NextResponse.json({ error: leadRes.error }, { status: 500 })
  if (!leadRes.lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (leadRes.lead.is_unlocked) {
    const enrichment = leadRes.lead.contact_email
      ? null
      : await enrichUnlockedLeadContact(serviceSupabase, leadRes.lead as Record<string, unknown>, user.id)
    return NextResponse.json({
      ok: true,
      alreadyUnlocked: true,
      contact: leadRes.lead.contact_email ? {
        email: leadRes.lead.contact_email,
        name: leadRes.lead.contact_name,
        title: leadRes.lead.contact_title,
        verified: leadRes.lead.contact_verified,
      } : enrichment?.contact ?? null,
      contact_enrichment: enrichment?.debug ?? { skipped: Boolean(leadRes.lead.contact_email) },
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
  const { data: unlockedLead, error: updateError } = await serviceSupabase
    .from('leads')
    .update({ is_unlocked: true, unlocked_at: unlockedAt })
    .eq('id', id)
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

  const enrichment = await enrichUnlockedLeadContact(serviceSupabase, leadRes.lead as Record<string, unknown>, user.id)

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
