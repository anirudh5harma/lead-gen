import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'

const MAX_QUEUE_LEADS = 100

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`crm-queue:${user.id}`, 60, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many CRM queue requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as { lead_ids?: unknown } | null
  const leadIds = sanitizeLeadIds(body?.lead_ids).slice(0, MAX_QUEUE_LEADS)
  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one signal or explore lead.' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let leadQuery = supabase
    .from('leads')
    .select(`
      id, client_id, origin, target_company, company_domain, relevance_score, relevance_reason,
      status, is_unlocked, unlocked_at, contact_email, contact_name, contact_title,
      contact_verified, feed_snapshot, match_debug
    `)
    .eq('user_id', user.id)
    .in('id', leadIds)
    .in('origin', ['live', 'explore'])
    .neq('status', 'dismissed')

  leadQuery = activeClientId ? leadQuery.eq('client_id', activeClientId) : leadQuery.is('client_id', null)
  const { data: leads, error: leadError } = await leadQuery
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
  if (!leads?.length) {
    return NextResponse.json({ error: 'No eligible leads found for the active workspace.' }, { status: 404 })
  }

  let existingQuery = supabase
    .from('leads')
    .select('source_record_id')
    .eq('user_id', user.id)
    .eq('origin', 'crm_import')
    .eq('source_kind', 'crm_record')
    .in('source_record_id', leads.map(lead => lead.id))
  existingQuery = activeClientId ? existingQuery.eq('client_id', activeClientId) : existingQuery.is('client_id', null)
  const { data: existingRows } = await existingQuery
  const existingSourceIds = new Set((existingRows ?? []).map(row => row.source_record_id).filter(Boolean))

  const batchId = crypto.randomUUID()
  const now = new Date().toISOString()
  const label = `CRM queue · ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(now))}`

  const rows = leads
    .filter(lead => !existingSourceIds.has(lead.id))
    .map(lead => ({
      user_id: user.id,
      client_id: activeClientId,
      signal_id: null,
      origin: 'crm_import',
      source_kind: 'crm_record',
      source_record_id: lead.id,
      feed_session_id: batchId,
      feed_session_label: label,
      feed_session_started_at: now,
      target_company: lead.target_company,
      company_domain: lead.company_domain,
      relevance_score: lead.relevance_score,
      relevance_reason: lead.relevance_reason,
      status: 'new',
      is_unlocked: lead.is_unlocked === true,
      unlocked_at: lead.unlocked_at,
      contact_email: lead.contact_email,
      contact_name: lead.contact_name,
      contact_title: lead.contact_title,
      contact_verified: (lead as { contact_verified?: boolean | null }).contact_verified ?? null,
      feed_snapshot: lead.feed_snapshot,
      match_debug: {
        queued_for_crm: true,
        source_lead_id: lead.id,
        source_origin: lead.origin,
      },
    }))

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      queued: 0,
      skipped: leads.length,
      message: 'Selected leads are already in the CRM queue.',
    })
  }

  const { error: insertError } = await supabase.from('leads').insert(rows)
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    queued: rows.length,
    skipped: leads.length - rows.length,
    session_id: batchId,
  })
}

function sanitizeLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => uuidPattern.test(item)),
  )]
}
