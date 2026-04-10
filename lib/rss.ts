import { parseStringPromise } from 'xml2js'

export interface RSSItem {
  title: string
  description: string
  link: string
  pubDate: string | null
  source: string
}

/**
 * Google News RSS search URL builder.
 * `when:7d` restricts results to the last 7 days.
 */
export function buildGoogleNewsUrl(query: string): string {
  const encoded = encodeURIComponent(`${query} when:7d`)
  return `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`
}

/**
 * Google News keyword queries — run on every poll cycle.
 */
export const RSS_QUERIES = [
  // Funding
  'startup funding round Series A B C',
  'fintech startup raised million funding',
  'healthtech startup funding investment',
  'SaaS company fundraising venture capital',
  // Acquisition
  'company acquisition deal announced tech',
  'fintech acquisition merger',
  'health company acquisition announced',
  // Expansion
  'company expansion new market launch',
  'tech company new office expansion hiring',
  // Regulation
  'government regulation technology compliance',
  'financial regulation update SEC FINRA',
  'healthcare compliance regulation update FDA',
  // Hiring (C-suite = buying intent)
  'company hires new CTO CPO CISO CFO',
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
  if (!channel) return []

  const rawItems = Array.isArray((channel as { item?: unknown }).item)
    ? (channel as { item: unknown[] }).item
    : [(channel as { item?: unknown }).item].filter(Boolean)

  return (rawItems as Record<string, unknown>[]).map(item => ({
    title: decodeEntities(String(item.title || '')),
    description: decodeEntities(String(item.description || item.summary || '')),
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
  // Atom/RSS hybrid: <link href="..."> parses as { $: { href: '...' } }
  if (typeof item.link === 'object' && item.link !== null) {
    const obj = item.link as Record<string, unknown>
    if (obj.$) return String((obj.$ as Record<string, unknown>).href || '')
  }
  return String(item.link || item.guid || '')
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
export async function fetchRSSItems(query: string): Promise<RSSItem[]> {
  const url = buildGoogleNewsUrl(query)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectSignal/1.0)' },
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
export async function fetchRSSFromUrl(url: string, source: string): Promise<RSSItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectSignal/1.0)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      console.error(`Press release RSS failed (${source}): ${res.status}`)
      return []
    }
    return await parseRSSXML(await res.text(), source)
  } catch (e) {
    console.error(`Press release RSS error (${source}):`, (e as Error).message)
    return []
  }
}
