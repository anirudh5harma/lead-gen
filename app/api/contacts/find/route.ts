import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { enrichCompany } from '@/lib/email-finder/enrich'
import { checkRateLimit } from '@/lib/rate-limit'

export interface Stakeholder {
  name: string
  title: string
  email: string
  confidence: 'high' | 'medium' | 'low'
  source: 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    leadId?: unknown
    servicesDescription?: unknown
    signalType?: unknown
  } | null
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : ''
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, target_company, company_domain, is_unlocked')
    .eq('id', leadId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.is_unlocked) {
    return NextResponse.json({ error: 'Unlock this lead before looking up contacts.' }, { status: 403 })
  }

  const rl = await checkRateLimit(`contacts:${user.id}`, 20, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many contact lookups. Limit is 20 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const serviceClient = await createServiceClient()
  const result = await enrichCompany(lead.target_company, lead.company_domain ?? null, serviceClient, {
    servicesDescription: typeof body?.servicesDescription === 'string' ? body.servicesDescription : null,
    signalType: typeof body?.signalType === 'string' ? body.signalType : null,
    maxContacts: 4,
  })

  const stakeholders: Stakeholder[] = result.contacts.map(contact => ({
    name: contact.name,
    title: contact.title,
    email: contact.email,
    confidence: contact.verified ? 'high' : contact.zb_status === 'catch-all' ? 'medium' : 'low',
    source: contact.source,
  }))

  return NextResponse.json({ stakeholders })
}
