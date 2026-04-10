import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchApolloContacts } from '@/lib/email-finder/apollo'
import { hunterDomainSearch, constructEmailCandidates } from '@/lib/email-finder/hunter'
import { verifyEmailCandidates } from '@/lib/email-finder/smtp-verify'
import { scrapeCompanyContacts } from '@/lib/email-finder/firecrawl'

export interface Stakeholder {
  name: string
  title: string
  email: string
  confidence: 'high' | 'medium' | 'low'
  source: 'apollo' | 'hunter' | 'pattern' | 'scrape'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { companyName, companyDomain } = await request.json()
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 })

  const stakeholders: Stakeholder[] = []
  const seenEmails = new Set<string>()

  function addContact(s: Stakeholder) {
    if (!s.email || seenEmails.has(s.email.toLowerCase())) return
    seenEmails.add(s.email.toLowerCase())
    stakeholders.push(s)
  }

  // --- Step 1: Apollo.io ---
  const apolloContacts = await searchApolloContacts(companyName, companyDomain)
  for (const c of apolloContacts) {
    if (c.email) {
      addContact({ name: c.name, title: c.title, email: c.email, confidence: 'high', source: 'apollo' })
    }
  }

  // If Apollo found enough contacts, skip the rest
  if (stakeholders.length >= 3) {
    return NextResponse.json({ stakeholders: stakeholders.slice(0, 5) })
  }

  // --- Step 2: Hunter.io domain search ---
  const domain = companyDomain || guessDomain(companyName)
  let emailPattern: string | null = null

  if (domain) {
    const hunterResult = await hunterDomainSearch(domain)
    emailPattern = hunterResult.emailPattern

    for (const c of hunterResult.contacts) {
      addContact({ name: c.name, title: c.title, email: c.email, confidence: 'high', source: 'hunter' })
    }

    // --- Step 3: Pattern-based construction for Apollo contacts without emails ---
    const contactsWithoutEmail = apolloContacts.filter(c => !c.email && c.name)
    for (const c of contactsWithoutEmail) {
      const [firstName, ...rest] = c.name.split(' ')
      const lastName = rest.join(' ')
      if (!firstName || !lastName) continue

      const candidates = constructEmailCandidates(firstName, lastName, domain, emailPattern)
      const verified = await verifyEmailCandidates(candidates)

      for (const v of verified.slice(0, 1)) {
        addContact({ name: c.name, title: c.title, email: v.email, confidence: v.confidence, source: 'pattern' })
      }
    }
  }

  // --- Step 4: Firecrawl fallback if still sparse ---
  if (stakeholders.length < 2 && domain) {
    const scraped = await scrapeCompanyContacts(domain)
    for (const c of scraped) {
      if (c.email) {
        addContact({ name: c.name, title: c.title, email: c.email, confidence: 'medium', source: 'scrape' })
      }
    }
  }

  return NextResponse.json({ stakeholders: stakeholders.slice(0, 5) })
}

/**
 * Simple heuristic: turn "Acme Corp" → "acmecorp.com"
 * This is a last resort — Hunter/Apollo domain data is much better.
 */
function guessDomain(companyName: string): string | null {
  const cleaned = companyName
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|technologies|tech|labs|ai)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
  return cleaned ? `${cleaned}.com` : null
}
