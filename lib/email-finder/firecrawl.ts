import Anthropic from '@anthropic-ai/sdk'

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

interface FirecrawlContact {
  name: string
  title: string
  email: string
}

/**
 * Scrapes a company's /about or /team page with Firecrawl,
 * then uses Claude to extract named contacts with emails.
 *
 * Free tier: 500 pages/month.
 */
export async function scrapeCompanyContacts(domain: string): Promise<FirecrawlContact[]> {
  if (!process.env.FIRECRAWL_API_KEY) return []

  const pagesToTry = [`https://${domain}/about`, `https://${domain}/team`, `https://${domain}/contact`]
  let pageContent = ''

  for (const url of pagesToTry) {
    try {
      const res = await fetch('https://api.firecrawl.dev/v0/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
      })

      if (!res.ok) continue
      const json = await res.json()
      const markdown = json.data?.markdown || ''

      // Quick check: does the page have any email addresses?
      const emailsFound = markdown.match(EMAIL_REGEX)
      if (emailsFound?.length) {
        pageContent = markdown
        break
      }
    } catch {
      continue
    }
  }

  if (!pageContent) return []

  // Use Claude to extract structured contacts from page content
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // cheap model for extraction
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract contact information from this company page.

${pageContent.slice(0, 3000)}

Return a JSON array of contacts. Each contact:
{"name": "...", "title": "...", "email": "..."}

Only include people with emails AND a clear title/role.
Return ONLY the JSON array, no markdown.`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
    return JSON.parse(text) as FirecrawlContact[]
  } catch {
    // Fallback: just extract raw emails from the page
    const emails = pageContent.match(EMAIL_REGEX) || []
    return emails.slice(0, 3).map(email => ({ name: '', title: '', email }))
  }
}
