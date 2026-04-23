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

  const { companyName, companyDomain, servicesDescription, signalType } = await request.json()
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 })

  const rl = await checkRateLimit(`contacts:${user.id}`, 20, 3600)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many contact lookups. Limit is 20 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const serviceClient = await createServiceClient()
  const result = await enrichCompany(companyName, companyDomain ?? null, serviceClient, {
    servicesDescription: typeof servicesDescription === 'string' ? servicesDescription : null,
    signalType: typeof signalType === 'string' ? signalType : null,
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
