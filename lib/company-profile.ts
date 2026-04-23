import Anthropic from '@anthropic-ai/sdk'

export interface ServicesDescriptionResult {
  description: string
  websiteUrl: string | null
  source: 'manual' | 'website' | 'combined'
}

const WEBSITE_SCRAPE_TIMEOUT_MS = 12_000

export function normalizeCompanyWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname.includes('.') || url.hostname === 'localhost') return null
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export async function resolveServicesDescription(params: {
  companyName: string
  industry: string
  manualDescription?: unknown
  websiteUrl?: unknown
}): Promise<ServicesDescriptionResult | null> {
  const manual = typeof params.manualDescription === 'string'
    ? params.manualDescription.trim()
    : ''
  const websiteUrl = normalizeCompanyWebsiteUrl(params.websiteUrl)

  if (websiteUrl) {
    const websiteDescription = await describeWebsite({
      companyName: params.companyName,
      industry: params.industry,
      websiteUrl,
      manualHint: manual,
    })
    if (websiteDescription) {
      return {
        description: websiteDescription,
        websiteUrl,
        source: manual ? 'combined' : 'website',
      }
    }
  }

  if (manual.length >= 10) {
    return {
      description: manual,
      websiteUrl,
      source: 'manual',
    }
  }

  return null
}

async function describeWebsite(params: {
  companyName: string
  industry: string
  websiteUrl: string
  manualHint: string
}): Promise<string | null> {
  const markdown = await scrapeWebsiteMarkdown(params.websiteUrl)
  if (!markdown) return null

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackWebsiteDescription(markdown)
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: `Create a concise product/service description for outreach lead matching.

Company: ${params.companyName}
Industry: ${params.industry}
Website: ${params.websiteUrl}
User-provided notes, if any: ${params.manualHint || 'None'}

Website content:
${markdown.slice(0, 5500)}

Return 2-4 plain-English sentences. Be specific about what the company sells, who it helps, and the business outcomes. Do not invent details. No markdown.`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return cleanDescription(text) || fallbackWebsiteDescription(markdown)
  } catch {
    return fallbackWebsiteDescription(markdown)
  }
}

async function scrapeWebsiteMarkdown(url: string): Promise<string | null> {
  if (!process.env.FIRECRAWL_API_KEY) return null

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
      signal: AbortSignal.timeout(WEBSITE_SCRAPE_TIMEOUT_MS),
    })

    if (!res.ok) return null
    const json = await res.json() as { data?: { markdown?: string } }
    const markdown = json.data?.markdown?.trim() ?? ''
    return markdown.length >= 120 ? markdown : null
  } catch {
    return null
  }
}

function fallbackWebsiteDescription(markdown: string): string | null {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map(sentence => cleanDescription(sentence))
    .filter((sentence): sentence is string => Boolean(sentence && sentence.length >= 40))
    .filter(sentence => !/^(home|privacy|terms|copyright|login|sign up)\b/i.test(sentence))

  const description = sentences.slice(0, 3).join(' ')
  return cleanDescription(description)
}

function cleanDescription(value: string): string | null {
  const cleaned = value
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length < 10) return null
  return cleaned.slice(0, 1200)
}
