import { parseStringPromise } from 'xml2js'

export interface RSSItem {
  title: string
  description: string
  link: string
  pubDate: string | null
  source: string
}

interface RSSFetchOptions {
  quiet?: boolean
  timeoutMs?: number
}

/**
 * Google News RSS search URL builder.
 * `when` restricts results to the last N days.
 */
export function buildGoogleNewsUrl(query: string, when = '7d'): string {
  const encoded = encodeURIComponent(`${query} when:${when}`)
  return `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`
}

/**
 * Google News keyword queries — run on every poll cycle.
 */
export const RSS_QUERIES = [
  // Funding
  'startup funding round Series A B C',
  'startup raises seed round',
  'startup raises pre-seed funding',
  'startup closes Series A funding',
  'startup secures growth funding',
  'fintech startup raised million funding',
  'healthtech startup funding investment',
  'SaaS company fundraising venture capital',
  'AI startup raises funding',
  'cybersecurity startup raises funding',
  'B2B SaaS startup raises funding',
  // Acquisition
  'company acquisition deal announced tech',
  'startup acquired by company',
  'company to acquire startup',
  'fintech acquisition merger',
  'health company acquisition announced',
  // Expansion
  'company expansion new market launch',
  'tech company new office expansion hiring',
  'company launches new product platform',
  'company enters new market expansion',
  // Regulation
  'government regulation technology compliance',
  'financial regulation update SEC FINRA',
  'healthcare compliance regulation update FDA',
  'company fined regulatory compliance',
  // Hiring (C-suite = buying intent)
  'company hires new CTO CPO CISO CFO',
  'company appoints new CEO CFO CTO',
  'startup appoints chief revenue officer',
]

/**
 * High-quality press release feeds — far less noise than Google News.
 * These services are used by companies to announce funding, acquisitions,
 * product launches, and executive appointments.
 */
export const PRESS_RELEASE_FEEDS: Array<{ url: string; source: string }> = [
  // PRNewswire — Technology
  {
    url: 'https://www.prnewswire.com/rss/news-releases-list.rss?category=TEC&language=en',
    source: 'prnewswire',
  },
  // PRNewswire — Financial Services
  {
    url: 'https://www.prnewswire.com/rss/news-releases-list.rss?category=FN&language=en',
    source: 'prnewswire',
  },
  // PRNewswire — Healthcare
  {
    url: 'https://www.prnewswire.com/rss/news-releases-list.rss?category=HTH&language=en',
    source: 'prnewswire',
  },
  // BusinessWire — Technology
  {
    url: 'https://feed.businesswire.com/rss/home/?rss=G22',
    source: 'businesswire',
  },
  // BusinessWire — Financial Services
  {
    url: 'https://feed.businesswire.com/rss/home/?rss=G17',
    source: 'businesswire',
  },
  // GlobeNewswire — Mergers & Acquisitions
  {
    url: 'https://www.globenewswire.com/RssFeed/subjectcode/23-Mergers%2Band%2BAcquisitions',
    source: 'globenewswire',
  },
  // GlobeNewswire — Financing Agreements (funding)
  {
    url: 'https://www.globenewswire.com/RssFeed/subjectcode/01-Financing%2BAgreements',
    source: 'globenewswire',
  },
]

// ----------------------------------------------------------------
// Internal XML parser (handles both Google News and PR RSS formats)
// ----------------------------------------------------------------

async function parseRSSXML(xml: string, source: string): Promise<RSSItem[]> {
  let parsed: Record<string, unknown>
  try {
    parsed = await parseStringPromise(xml, { explicitArray: false })
  } catch {
    return []
  }

  const channel = (parsed as { rss?: { channel?: { item?: unknown } } })?.rss?.channel
  if (!channel) return parseAtomXML(parsed, source)

  const rawItems = Array.isArray((channel as { item?: unknown }).item)
    ? (channel as { item: unknown[] }).item
    : [(channel as { item?: unknown }).item].filter(Boolean)

  return (rawItems as Record<string, unknown>[]).map(item => ({
    title: decodeEntities(textValue(item.title)),
    description: decodeEntities(textValue(item.description || item.summary)),
    link: extractLink(item),
    pubDate: item.pubDate
      ? String(item.pubDate)
      : item['dc:date']
        ? String(item['dc:date'])
        : null,
    source,
  }))
}

function extractLink(item: Record<string, unknown>): string {
  if (Array.isArray(item.link)) {
    const preferred = item.link.find(link => {
      if (typeof link !== 'object' || link === null) return Boolean(link)
      const attrs = (link as Record<string, unknown>).$ as Record<string, unknown> | undefined
      return attrs?.href && attrs.rel !== 'self'
    })
    return extractLink({ link: preferred })
  }

  // Atom/RSS hybrid: <link href="..."> parses as { $: { href: '...' } }
  if (typeof item.link === 'object' && item.link !== null) {
    const obj = item.link as Record<string, unknown>
    if (obj.$) return String((obj.$ as Record<string, unknown>).href || '')
  }
  return String(item.link || item.guid || '')
}

function parseAtomXML(parsed: Record<string, unknown>, source: string): RSSItem[] {
  const feed = (parsed as { feed?: { entry?: unknown } }).feed
  if (!feed) return []

  const rawEntries = Array.isArray(feed.entry)
    ? feed.entry
    : [feed.entry].filter(Boolean)

  return (rawEntries as Record<string, unknown>[]).map(entry => ({
    title: decodeEntities(textValue(entry.title)),
    description: decodeEntities(textValue(entry.summary || entry.content)),
    link: extractLink(entry),
    pubDate: entry.published
      ? String(entry.published)
      : entry.updated
        ? String(entry.updated)
        : null,
    source,
  }))
}

function textValue(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj._ === 'string') return obj._
  }
  return String(value)
}

function decodeEntities(str: string): string {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

// ----------------------------------------------------------------
// Public fetchers
// ----------------------------------------------------------------

/**
 * Fetches and parses a Google News RSS feed for a keyword query.
 */
export async function fetchRSSItems(query: string, when = '7d'): Promise<RSSItem[]> {
  const url = buildGoogleNewsUrl(query, when)
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bombsell/1.0)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      console.error(`Google News RSS failed for "${query}": ${res.status}`)
      return []
    }
    return await parseRSSXML(await res.text(), 'google_news')
  } catch (e) {
    console.error(`Google News fetch error for "${query}":`, (e as Error).message)
    return []
  }
}

/**
 * Fetches and parses a direct RSS URL (PRNewswire, BusinessWire, GlobeNewswire, etc.)
 */
export async function fetchRSSFromUrl(
  url: string,
  source: string,
  options: RSSFetchOptions = {},
): Promise<RSSItem[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bombsell/1.0)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      if (!options.quiet) console.error(`RSS fetch failed (${source}): ${res.status}`)
      return []
    }
    return await parseRSSXML(await res.text(), source)
  } catch (e) {
    if (!options.quiet) console.error(`RSS fetch error (${source}):`, (e as Error).message)
    return []
  }
}
