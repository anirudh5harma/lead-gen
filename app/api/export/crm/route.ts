import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import {
  buildCrmExportCsv,
  buildCrmExportFilename,
  buildCrmExportRecord,
  type CrmExportFeed,
  normalizeCrmProvider,
} from '@/lib/crm-sync'

async function loadExportContext(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const { searchParams } = new URL(request.url)
  const provider = normalizeCrmProvider(searchParams.get('provider'))
  const feedParam = searchParams.get('feed')
  const feed: CrmExportFeed =
    feedParam === 'crm_import'
      ? 'crm_import'
      : feedParam === 'explore'
        ? 'explore'
        : 'signal'
  const workspaceName = searchParams.get('workspace') ?? ''
  const selectedLeadIds = searchParams
    .getAll('lead_id')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
  const expectedOrigin = feed === 'crm_import' ? 'crm_import' : feed === 'explore' ? 'explore' : 'live'

  let query = supabase
    .from('leads')
    .select(`
      origin,
      target_company, company_domain, contact_email,
      contact_name, contact_title,
      relevance_score, relevance_reason, status,
      created_at, sent_at, replied_at, booked_at,
      feed_snapshot
    `)
    .eq('user_id', user.id)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  if (selectedLeadIds.length > 0) query = query.in('id', selectedLeadIds)
  const { data: leads } = await query

  const records = leads
    ? leads
    .filter(lead => ((lead as { origin?: string | null }).origin ?? 'live') === expectedOrigin)
    .map(lead => {
      const sig = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)
      return buildCrmExportRecord({
        company: lead.target_company,
        domain: (lead as { company_domain?: string | null }).company_domain ?? '',
        contactName: (lead as { contact_name?: string | null }).contact_name ?? '',
        contactTitle: (lead as { contact_title?: string | null }).contact_title ?? '',
        contactEmail: (lead as { contact_email?: string | null }).contact_email ?? '',
        signalType: (sig as { signal_type?: string | null } | null)?.signal_type ?? '',
        signalHeadline: (sig as { headline?: string | null } | null)?.headline ?? '',
        signalSummary: (sig as { summary?: string | null } | null)?.summary ?? '',
        fitScore: lead.relevance_score,
        fitReason: lead.relevance_reason ?? '',
        status: lead.status,
        workspace: workspaceName,
        createdAt: lead.created_at,
        sentAt: lead.sent_at ?? '',
        repliedAt: lead.replied_at ?? '',
        bookedAt: lead.booked_at ?? '',
      })
    })
    : []

  return {
    supabase,
    user,
    activeClientId,
    provider,
    feed,
    selectedLeadIds,
    records,
    csv: buildCrmExportCsv(provider, records),
  }
}

export async function GET(request: Request) {
  const context = await loadExportContext(request)
  if ('error' in context) return context.error

  return new NextResponse(context.csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${buildCrmExportFilename(context.provider, context.feed)}"`,
    },
  })
}

export async function POST(request: Request) {
  const context = await loadExportContext(request)
  if ('error' in context) return context.error

  let crmQuery = context.supabase
    .from('crm_sync_settings')
    .select('provider, webhook_url, enabled')
    .eq('user_id', context.user.id)
    .eq('enabled', true)
    .limit(1)

  crmQuery = context.activeClientId
    ? crmQuery.eq('client_id', context.activeClientId)
    : crmQuery.is('client_id', null)

  const { data: setting } = await crmQuery.maybeSingle()
  const row = setting as { provider?: string | null; webhook_url?: string | null; enabled?: boolean | null } | null

  if (!row?.enabled || !row.webhook_url) {
    return NextResponse.json({ error: 'CRM sync is not connected' }, { status: 409 })
  }

  const provider = normalizeCrmProvider(row.provider ?? context.provider)
  const response = await fetch(row.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'feed.export',
      occurred_at: new Date().toISOString(),
      provider,
      feed: context.feed,
      exported_count: context.records.length,
      records: context.records,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return NextResponse.json({
      error: body || `CRM export failed with status ${response.status}`,
    }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    provider,
    feed: context.feed,
    exported: context.records.length,
  })
}
