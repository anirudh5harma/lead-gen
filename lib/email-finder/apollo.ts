export interface ApolloContact {
  name: string
  title: string
  email: string | null
  linkedin_url: string | null
}

const TARGET_TITLES = [
  'CTO', 'Chief Technology Officer',
  'CPO', 'Chief Product Officer',
  'CIO', 'Chief Information Officer',
  'CISO', 'Chief Information Security Officer',
  'CFO', 'Chief Financial Officer',
  'VP Engineering', 'VP of Engineering',
  'VP Product', 'VP of Product',
  'Head of Engineering',
  'Head of Product',
  'Director of Engineering',
  'Director of Technology',
]

/**
 * Searches Apollo.io for decision-maker contacts at a given company.
 * Free tier: 50 exports/month. Paid: $49/mo for more.
 *
 * API docs: https://apolloio.github.io/apollo-api-docs/
 */
export async function searchApolloContacts(
  companyName: string,
  companyDomain?: string | null
): Promise<ApolloContact[]> {
  if (!process.env.APOLLO_API_KEY) return []

  const body: Record<string, unknown> = {
    api_key: process.env.APOLLO_API_KEY,
    per_page: 5,
    page: 1,
    person_titles: TARGET_TITLES,
    contact_email_status: ['verified', 'guessed', 'unavailable', 'bounced', 'pending_manual_fulfill'],
  }

  if (companyDomain) {
    body.q_organization_domains = [companyDomain]
  } else {
    body.q_organization_name = companyName
  }

  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return []
    const json = await res.json()
    const people = json.people || []

    return people
      .filter((p: Record<string, unknown>) => p.email || p.email_status === 'verified')
      .map((p: Record<string, unknown>) => ({
        name: String(p.name || ''),
        title: String(p.title || ''),
        email: p.email ? String(p.email) : null,
        linkedin_url: p.linkedin_url ? String(p.linkedin_url) : null,
      }))
  } catch (e) {
    console.error('Apollo search error:', e)
    return []
  }
}
