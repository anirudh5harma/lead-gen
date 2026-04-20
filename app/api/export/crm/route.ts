import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserPlan } from '@/lib/plan'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await getUserPlan(user.id)
  if (plan !== 'max') {
    return NextResponse.json({ error: 'CRM export requires the Max plan.' }, { status: 403 })
  }

  const { data: leads } = await supabase
    .from('leads')
    .select(`
      target_company, company_domain, contact_email,
      relevance_score, relevance_reason, status,
      created_at, sent_at, replied_at, booked_at,
      signals(signal_type, headline)
    `)
    .eq('user_id', user.id)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })

  if (!leads) return NextResponse.json({ error: 'No leads found' }, { status: 404 })

  const rows = [
    ['Company', 'Domain', 'Contact Email', 'Signal Type', 'Headline', 'Score', 'Reason', 'Status', 'Created', 'Sent', 'Replied', 'Booked'],
    ...leads.map(l => {
      const sig = Array.isArray(l.signals) ? l.signals[0] : l.signals
      return [
        l.target_company,
        l.company_domain ?? '',
        (l as unknown as { contact_email?: string }).contact_email ?? '',
        (sig as unknown as { signal_type?: string })?.signal_type ?? '',
        (sig as unknown as { headline?: string })?.headline ?? '',
        String(l.relevance_score),
        (l.relevance_reason ?? '').replace(/"/g, '""'),
        l.status,
        l.created_at,
        l.sent_at ?? '',
        l.replied_at ?? '',
        l.booked_at ?? '',
      ]
    }),
  ]

  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="bombsell-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
