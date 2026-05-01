import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface AccountRow {
  id: string
  name: string
  domain: string | null
  lifecycle_stage: string
  source_kind: string | null
  attributes: Record<string, unknown> | null
  first_seen_at: string
  last_seen_at: string
}

interface CountableRow {
  account_id: string | null
}

interface LeadRow {
  company_domain: string | null
  target_company: string
  status: string
  sent_at: string | null
  replied_at: string | null
  booked_at: string | null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Math.max(10, Math.min(80, Number(url.searchParams.get('limit') ?? 40)))
  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const [accountsRes, signalsRes, memoriesRes, touchpointsRes, leadsRes] = await Promise.all([
    supabase
      .from('gtm_accounts')
      .select('id, name, domain, lifecycle_stage, source_kind, attributes, first_seen_at, last_seen_at')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('last_seen_at', { ascending: false })
      .limit(limit),
    supabase
      .from('gtm_signals')
      .select('account_id')
      .eq('user_id', user.id)
      .match(clientFilter)
      .limit(2000),
    supabase
      .from('gtm_memories')
      .select('entity_id')
      .eq('user_id', user.id)
      .eq('entity_type', 'account')
      .match(clientFilter)
      .limit(2000),
    supabase
      .from('gtm_touchpoints')
      .select('account_id')
      .eq('user_id', user.id)
      .match(clientFilter)
      .limit(2000),
    supabase
      .from('leads')
      .select('company_domain, target_company, status, sent_at, replied_at, booked_at')
      .eq('user_id', user.id)
      .match(clientFilter)
      .neq('status', 'dismissed')
      .limit(2000),
  ])

  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })
  if (signalsRes.error) return NextResponse.json({ error: signalsRes.error.message }, { status: 500 })
  if (memoriesRes.error) return NextResponse.json({ error: memoriesRes.error.message }, { status: 500 })
  if (touchpointsRes.error) return NextResponse.json({ error: touchpointsRes.error.message }, { status: 500 })
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 })

  const accounts = (accountsRes.data ?? []) as AccountRow[]
  const signalsByAccount = countBy((signalsRes.data ?? []) as CountableRow[], row => row.account_id)
  const memoriesByAccount = countBy((memoriesRes.data ?? []) as Array<{ entity_id: string | null }>, row => row.entity_id)
  const touchpointsByAccount = countBy((touchpointsRes.data ?? []) as CountableRow[], row => row.account_id)
  const leads = (leadsRes.data ?? []) as LeadRow[]

  return NextResponse.json({
    accounts: accounts.map(account => {
      const relatedLeads = leads.filter(lead => {
        if (account.domain && lead.company_domain) return lead.company_domain === account.domain
        return lead.target_company.toLowerCase() === account.name.toLowerCase()
      })
      return {
        ...account,
        counts: {
          signals: signalsByAccount.get(account.id) ?? 0,
          memories: memoriesByAccount.get(account.id) ?? 0,
          touchpoints: touchpointsByAccount.get(account.id) ?? 0,
          leads: relatedLeads.length,
        },
        outcomes: {
          sent: relatedLeads.filter(lead => lead.sent_at || lead.status === 'sent').length,
          replied: relatedLeads.filter(lead => lead.replied_at || lead.status === 'replied').length,
          booked: relatedLeads.filter(lead => lead.booked_at || lead.status === 'booked').length,
        },
      }
    }),
  })
}

function countBy<T>(rows: T[], keyFn: (row: T) => string | null | undefined) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = keyFn(row)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
