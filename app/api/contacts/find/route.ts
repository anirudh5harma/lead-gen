import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchApolloContacts } from '@/lib/email-finder/apollo'
import { hunterDomainSearch } from '@/lib/email-finder/hunter'
import { verifyEmail, isSafeToSend } from '@/lib/email-finder/zeroBounce'
import { scrapeCompanyContacts } from '@/lib/email-finder/firecrawl'
import { checkRateLimit } from '@/lib/rate-limit'

export interface Stakeholder {
  name: string
  title: string
  email: string
  confidence: 'high' | 'medium' | 'low'
  source: 'apollo' | 'hunter' | 'scrape'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { companyName, companyDomain } = await request.json()
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 })

  const rl = await checkRateLimit(`contacts:${user.id}`, 20, 3600)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many contact lookups. Limit is 20 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const stakeholders: Stakeholder[] = []
  const seenEmails = new Set<string>()

  async function addVerified(name: string, title: string, email: string, source: Stakeholder['source']) {
    const key = email.toLowerCase()
    if (seenEmails.has(key)) return
    seenEmails.add(key)
    const zb = await verifyEmail(email)
    if (zb && !isSafeToSend(zb.status)) return
    const confidence: Stakeholder['confidence'] = zb?.status === 'valid' ? 'high' : 'medium'
    stakeholders.push({ name, title, email, confidence, source })
  }

  // --- Step 1: Apollo — verified contacts only ---
  const apolloContacts = await searchApolloContacts(companyName, companyDomain)
  for (const c of apolloContacts) {
    if (c.email) await addVerified(c.name, c.title, c.email, 'apollo')
  }

  if (stakeholders.length >= 3) {
    return NextResponse.json({ stakeholders: stakeholders.slice(0, 5) })
  }

  // --- Step 2: Hunter — known emails with confidence ≥ 70 only, no pattern construction ---
  const domain = companyDomain ?? null
  if (domain) {
    const hunterResult = await hunterDomainSearch(domain)
    const highConfidence = hunterResult.contacts.filter(c => c.confidence >= 70)
    for (const c of highConfidence) {
      await addVerified(c.name, c.title, c.email, 'hunter')
    }
  }

  // --- Step 3: Firecrawl fallback if still sparse ---
  if (stakeholders.length < 2 && domain) {
    const scraped = await scrapeCompanyContacts(domain)
    for (const c of scraped) {
      if (c.email) await addVerified(c.name, c.title, c.email, 'scrape')
    }
  }

  return NextResponse.json({ stakeholders: stakeholders.slice(0, 5) })
}
