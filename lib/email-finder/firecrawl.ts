import { completePrompt } from '../deepseek.ts'

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

/**
 * Scrapes a news article URL and extracts key facts for email personalization.
 * Returns a formatted string of facts (CEO quote, lead investor, use of proceeds, etc.)
 * or an empty string if unavailable. Gracefully handles all failure modes.
 */
export async function scrapeSignalArticle(url: string): Promise<string> {
  if (!process.env.FIRECRAWL_API_KEY || !url) return ''

  try {
    const res = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    })

    if (!res.ok) return ''
    const json = await res.json()
    const markdown: string = json.data?.markdown || ''
    if (!markdown || markdown.length < 100) return ''

    const text = await completePrompt({
      prompt: `From this news article, extract facts useful for a sales email. Only include facts explicitly stated.

${markdown.slice(0, 4000)}

Return ONLY this JSON (omit any field you cannot find verbatim in the article):
{
  "lead_investor": "...",
  "use_of_proceeds": "...",
  "ceo_quote": "...",
  "growth_target": "...",
  "key_detail": "..."
}`,
      maxTokens: 350,
      timeoutMs: 20_000,
    })

    if (!text) return ''

    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const facts = JSON.parse(cleaned) as Record<string, string>
    const parts: string[] = []
    if (facts.lead_investor)   parts.push(`Lead investor: ${facts.lead_investor}`)
    if (facts.use_of_proceeds) parts.push(`Use of proceeds: ${facts.use_of_proceeds}`)
    if (facts.ceo_quote)       parts.push(`CEO said: "${facts.ceo_quote}"`)
    if (facts.growth_target)   parts.push(`Growth target: ${facts.growth_target}`)
    if (facts.key_detail)      parts.push(`Key detail: ${facts.key_detail}`)
    return parts.join('\n')
  } catch {
    return ''
  }
}

interface FirecrawlContact {
  name: string
  title: string
  email: string
}

export interface FirecrawlPerson {
  name: string
  title: string
  email?: string | null
}

/**
 * Scrapes a company's /about or /team page with Firecrawl,
 * then uses DeepSeek to extract named contacts with emails.
 *
 * Free tier: 500 pages/month.
 */
export async function scrapeCompanyContacts(domain: string): Promise<FirecrawlContact[]> {
  const people = await scrapeCompanyPeople(domain)
  return people
    .filter((person): person is FirecrawlContact => Boolean(person.email))
    .map(person => ({
      name: person.name,
      title: person.title,
      email: person.email!,
    }))
}

export async function scrapeCompanyPeople(domain: string): Promise<FirecrawlPerson[]> {
  if (!process.env.FIRECRAWL_API_KEY) return []

  const pagesToTry = [`https://${domain}/leadership`, `https://${domain}/team`, `https://${domain}/about`, `https://${domain}/company`, `https://${domain}/contact`]
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
      if (markdown.length >= 250) {
        pageContent = markdown
        break
      }
    } catch {
      continue
    }
  }

  if (!pageContent) return []

  // Use DeepSeek to extract structured contacts from page content
  try {
    const text = await completePrompt({
      prompt: `Extract leadership contacts from this company page.

${pageContent.slice(0, 3000)}

Return a JSON array of people. Each person:
{"name": "...", "title": "...", "email": "..." | null}

Only include senior or decision-making roles with a clear title.
Email can be null if the page does not show one.
Return ONLY the JSON array, no markdown.`,
      maxTokens: 400,
      timeoutMs: 20_000,
    })

    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned) as FirecrawlPerson[]
    return parsed.filter(person => person?.name && person?.title)
  } catch {
    // Fallback: just extract raw emails from the page
    const emails = pageContent.match(EMAIL_REGEX) || []
    return emails.slice(0, 3).map(email => ({ name: '', title: '', email }))
  }
}
