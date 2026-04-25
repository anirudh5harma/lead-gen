import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  buildCrmExportCsv,
  buildCrmExportFilename,
  buildCrmExportRecord,
  normalizeCrmProvider,
} from '@/lib/crm-sync'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const { searchParams } = new URL(request.url)
  const provider = normalizeCrmProvider(searchParams.get('provider'))
  const feed = searchParams.get('feed') === 'crm_import' ? 'crm_import' : 'signal'
  const workspaceName = searchParams.get('workspace') ?? ''
  const expectedOrigin = feed === 'crm_import' ? 'crm_import' : 'live'

  let query = supabase
    .from('leads')
    .select(`
      origin,
      target_company, company_domain, contact_email,
      contact_name, contact_title,
      relevance_score, relevance_reason, status,
      created_at, sent_at, replied_at, booked_at,
      signals(signal_type, headline, summary)
    `)
    .eq('user_id', user.id)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data: leads } = await query

  if (!leads) return NextResponse.json({ error: 'No leads found' }, { status: 404 })

  const records = leads
    .filter(lead => ((lead as { origin?: string | null }).origin ?? 'live') === expectedOrigin)
    .map(lead => {
      const sig = Array.isArray(lead.signals) ? lead.signals[0] : lead.signals
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

  const csv = buildCrmExportCsv(provider, records)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${buildCrmExportFilename(provider, feed)}"`,
    },
  })
}
