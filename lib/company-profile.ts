import { completePrompt } from './deepseek.ts'

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

  if (manual.length >= 10) {
    return {
      description: manual,
      websiteUrl,
      source: 'manual',
    }
  }

  return null
}

export async function suggestServicesDescriptionFromWebsite(params: {
  companyName?: string
  industry?: string
  websiteUrl?: unknown
}): Promise<ServicesDescriptionResult | null> {
  const websiteUrl = normalizeCompanyWebsiteUrl(params.websiteUrl)
  if (!websiteUrl) return null

  const websiteDescription = await describeWebsite({
    companyName: params.companyName ?? '',
    industry: params.industry ?? '',
    websiteUrl,
    manualHint: '',
  })
  if (!websiteDescription) return null

  return {
    description: websiteDescription,
    websiteUrl,
    source: 'website',
  }
}

export interface CompanyAnalysis {
  description: string
  companyName: string | null
  industry: string | null   // one of `allowedIndustries`, or null if none fit
  websiteUrl: string
}

/**
 * Scrape a company website (Firecrawl) and frame a crisp profile: a 2–4 sentence
 * "what you sell" description, a clean company name, and the closest-matching
 * industry from the provided list. Used by onboarding's "Analyse" action.
 */
export async function analyzeCompanyWebsite(params: {
  websiteUrl: unknown
  allowedIndustries?: string[]
  companyHint?: string
}): Promise<CompanyAnalysis | null> {
  const websiteUrl = normalizeCompanyWebsiteUrl(params.websiteUrl)
  if (!websiteUrl) return null
  const markdown = await scrapeWebsiteMarkdown(websiteUrl)
  if (!markdown) return null

  const allowed = (params.allowedIndustries ?? []).filter(Boolean)
  const fallbackName = params.companyHint?.trim() || companyNameFromHost(websiteUrl)

  try {
    const { complete, parseJsonLoose } = await import('./llm')
    const { text } = await complete({
      system: 'You analyze a company website and return a tight JSON profile for B2B outreach. Be specific and factual; never invent details. Respond with ONLY a JSON object.',
      prompt: [
        `Website: ${websiteUrl}`,
        params.companyHint ? `Hint — company name may be: ${params.companyHint}` : '',
        allowed.length ? `Pick "industry" as exactly one of: ${allowed.join(', ')} — or "" if none fit.` : 'Set "industry" to a short lowercase category, or "".',
        '',
        'Website content:',
        markdown.slice(0, 6000),
        '',
        'Return: {"company_name": string, "industry": string, "description": string} where "description" is 2-4 plain-English sentences on what the company sells, who it helps, and the outcomes — no markdown.',
      ].filter(Boolean).join('\n'),
      json: true,
      maxTokens: 360,
      timeoutMs: 22_000,
    })
    const parsed = parseJsonLoose<{ company_name?: string; industry?: string; description?: string }>(text)
    const description = cleanDescription(parsed?.description ?? '') || fallbackWebsiteDescription(markdown)
    if (!description) return null
    const industry = parsed?.industry && allowed.includes(parsed.industry) ? parsed.industry : (allowed.length === 0 ? (parsed?.industry?.trim() || null) : null)
    return {
      description,
      companyName: (parsed?.company_name?.trim() || fallbackName) || null,
      industry,
      websiteUrl,
    }
  } catch {
    const description = fallbackWebsiteDescription(markdown)
    return description ? { description, companyName: fallbackName || null, industry: null, websiteUrl } : null
  }
}

function companyNameFromHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0]
    return host.charAt(0).toUpperCase() + host.slice(1)
  } catch { return '' }
}

async function describeWebsite(params: {
  companyName: string
  industry: string
  websiteUrl: string
  manualHint: string
}): Promise<string | null> {
  const markdown = await scrapeWebsiteMarkdown(params.websiteUrl)
  if (!markdown) return null

  if (!process.env.DEEPSEEK_API_KEY) {
    return fallbackWebsiteDescription(markdown)
  }

  try {
    const text = await completePrompt({
      prompt: `Create a concise product/service description for outreach lead matching.

Company: ${params.companyName}
Industry: ${params.industry}
Website: ${params.websiteUrl}
User-provided notes, if any: ${params.manualHint || 'None'}

Website content:
${markdown.slice(0, 5500)}

Return 2-4 plain-English sentences. Be specific about what the company sells, who it helps, and the business outcomes. Do not invent details. No markdown.`,
      maxTokens: 220,
      timeoutMs: 20_000,
    })
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
