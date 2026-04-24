import { fetchRSSFromUrl, fetchRSSItems, type RSSItem } from '@/lib/rss'

export interface CompanySeed {
  clientId?: string
  name: string
  domain: string | null
  websiteUrl?: string | null
  priorityScore?: number
  isWatchlist?: boolean
}

const USER_AGENT = 'Mozilla/5.0 (compatible; Bombsell/1.0)'
const GDELT_MAX_RECORDS = 25
const HN_STORY_LIMIT = 80
const COMPANY_FEED_COMPANY_LIMIT = 120
const COMPANY_FEEDS_PER_COMPANY = 8
const MONITORED_NEWS_COMPANY_LIMIT = 24

const GDELT_QUERIES = [
  '(startup OR company) (raises OR funding OR "Series A" OR "seed round")',
  '(startup OR company) (acquires OR acquisition OR merger)',
  '(company OR startup) (launches OR expands OR "new market" OR "new office")',
  '(company OR startup) (appoints OR hires OR "new CEO" OR "new CFO" OR "new CTO")',
  '(company OR fintech OR healthcare) (regulation OR compliance OR fined OR settlement)',
  '(company OR startup) ("soc 2" OR "iso 27001" OR certification OR compliance)',
  '(company OR startup) (partnership OR integration OR reseller OR alliance)',
]

const HN_SIGNAL_PATTERN =
  /\b(launch hn|launch|launched|raises?|funding|acquired|acquisition|merger|hiring|appoints?|open roles|new product|platform)\b/i

const COMPANY_OWNED_SIGNAL_PATTERN =
  /\b(launch(?:es|ed)?|announces?|releases?|partnership|partnered|integration|pricing|expands?|acquires?|acquired|raises?|funding|appoints?|hires?|soc 2|iso 27001|compliance|certification|new office|new market)\b/i

interface GdeltArticle {
  title?: string
  url?: string
  seendate?: string
  domain?: string
  sourcecountry?: string
}

interface HackerNewsItem {
  id?: number
  type?: string
  title?: string
  url?: string
  time?: number
}

interface ProductHuntPost {
  name?: string
  tagline?: string
  url?: string
  website?: string
  createdAt?: string
}

/**
 * GDELT is a free global event/news index. We keep the query list short and
 * time-boxed to avoid turning the hourly cron into a broad web crawl.
 */
export async function fetchGdeltItems(): Promise<RSSItem[]> {
  const results = await Promise.allSettled(
    GDELT_QUERIES.map(async query => {
      const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc')
      url.searchParams.set('query', query)
      url.searchParams.set('mode', 'ArtList')
      url.searchParams.set('format', 'json')
      url.searchParams.set('maxrecords', String(GDELT_MAX_RECORDS))
      url.searchParams.set('sort', 'HybridRel')
      url.searchParams.set('timespan', '1d')

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': USER_AGENT },
        next: { revalidate: 0 },
      })
      if (!res.ok) return []

      const json = (await res.json()) as { articles?: GdeltArticle[] }
      return (json.articles ?? [])
        .filter(article => article.title && article.url)
        .map(article => ({
          title: article.title ?? '',
          description: [article.domain, article.sourcecountry].filter(Boolean).join(' '),
          link: article.url ?? '',
          pubDate: parseGdeltDate(article.seendate),
          source: 'gdelt',
        }))
    })
  )

  return flattenSettled(results)
}

/**
 * Hacker News is useful for early product launches and founder-led launches.
 * The free Firebase API has no search, so we sample recent stories and keep
 * only titles with explicit commercial/event intent.
 */
export async function fetchHackerNewsItems(): Promise<RSSItem[]> {
  try {
    const idsRes = await fetch('https://hacker-news.firebaseio.com/v0/newstories.json', {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 0 },
    })
    if (!idsRes.ok) return []

    const ids = ((await idsRes.json()) as number[]).slice(0, HN_STORY_LIMIT)
    const itemResults = await Promise.allSettled(
      ids.map(async id => {
        const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          signal: AbortSignal.timeout(4000),
          headers: { 'User-Agent': USER_AGENT },
          next: { revalidate: 0 },
        })
        if (!itemRes.ok) return null
        return (await itemRes.json()) as HackerNewsItem | null
      })
    )

    return itemResults
      .filter((result): result is PromiseFulfilledResult<HackerNewsItem | null> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter((item): item is HackerNewsItem => Boolean(item?.title && item.url && item.type === 'story'))
      .filter(item => HN_SIGNAL_PATTERN.test(item.title ?? ''))
      .map(item => ({
        title: item.title ?? '',
        description: 'Hacker News launch or company event discussion',
        link: item.url ?? '',
        pubDate: item.time ? new Date(item.time * 1000).toISOString() : null,
        source: 'hacker_news',
      }))
  } catch (error) {
    console.error('[signal-sources] Hacker News fetch error:', error instanceof Error ? error.message : String(error))
    return []
  }
}

/**
 * Product Hunt requires an API token, so this is optional and no-ops unless
 * PRODUCT_HUNT_TOKEN is configured.
 */
export async function fetchProductHuntItems(): Promise<RSSItem[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN
  if (!token) return []

  try {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        query: `
          query RecentPosts {
            posts(first: 25, order: NEWEST) {
              edges {
                node {
                  name
                  tagline
                  url
                  website
                  createdAt
                }
              }
            }
          }
        `,
      }),
      next: { revalidate: 0 },
    })
    if (!res.ok) return []

    const json = (await res.json()) as {
      data?: { posts?: { edges?: Array<{ node?: ProductHuntPost }> } }
    }
    return (json.data?.posts?.edges ?? [])
      .map(edge => edge.node)
      .filter((post): post is ProductHuntPost => Boolean(post?.name))
      .map(post => ({
        title: `${post.name} launches on Product Hunt`,
        description: post.tagline ?? '',
        link: post.website || post.url || '',
        pubDate: post.createdAt ?? null,
        source: 'product_hunt',
      }))
  } catch (error) {
    console.error('[signal-sources] Product Hunt fetch error:', error instanceof Error ? error.message : String(error))
    return []
  }
}

export async function fetchMonitoredCompanyNewsItems(companies: CompanySeed[]): Promise<RSSItem[]> {
  const scopedCompanies = uniqueCompanies(companies)
    .slice(0, MONITORED_NEWS_COMPANY_LIMIT)

  const results = await Promise.allSettled(
    scopedCompanies.map(async company => {
      const query = `"${company.name}" (funding OR acquisition OR merger OR hiring OR partnership OR integration OR launch OR expansion OR compliance OR "new office")`
      const items = await fetchRSSItems(query)
      return items.map(item => ({
        ...item,
        source: 'google_news_company',
        title: titleWithCompany(company.name, item.title),
      }))
    })
  )

  return flattenSettled(results)
}

/**
 * Company-owned monitoring stays cheap by checking RSS/feed endpoints only for
 * companies already seen in the product. It intentionally avoids HTML crawling.
 */
export async function fetchCompanyOwnedItems(companies: CompanySeed[]): Promise<RSSItem[]> {
  const scopedCompanies = uniqueCompanies(companies)
    .filter(company => company.domain || company.websiteUrl)
    .slice(0, COMPANY_FEED_COMPANY_LIMIT)

  const results = await Promise.allSettled(
    scopedCompanies.map(async company => {
      const domain = normalizeDomain(company.domain)
      const websiteDomain = normalizeDomain(company.websiteUrl ?? null)
      const resolvedDomain = domain ?? websiteDomain
      if (!resolvedDomain) return []

      const feedUrls = [
        `https://${resolvedDomain}/feed`,
        `https://${resolvedDomain}/feed.xml`,
        `https://${resolvedDomain}/atom.xml`,
        `https://${resolvedDomain}/rss.xml`,
        `https://${resolvedDomain}/blog/feed`,
        `https://${resolvedDomain}/blog/rss.xml`,
        `https://${resolvedDomain}/blog/index.xml`,
        `https://${resolvedDomain}/news/rss.xml`,
        `https://${resolvedDomain}/news/feed`,
        `https://${resolvedDomain}/newsroom/feed`,
        `https://${resolvedDomain}/newsroom/rss.xml`,
        `https://${resolvedDomain}/press/rss.xml`,
        `https://${resolvedDomain}/changelog.xml`,
        `https://${resolvedDomain}/changelog/feed`,
        `https://${resolvedDomain}/release-notes.xml`,
        `https://${resolvedDomain}/releases/feed`,
        `https://${resolvedDomain}/updates/feed`,
        `https://${resolvedDomain}/resources/rss.xml`,
      ].slice(0, COMPANY_FEEDS_PER_COMPANY)

      const feedResults = await Promise.allSettled(
        feedUrls.map(url => fetchRSSFromUrl(url, 'company_owned', { quiet: true, timeoutMs: 5000 }))
      )

      return flattenSettled(feedResults)
        .filter(item => COMPANY_OWNED_SIGNAL_PATTERN.test(`${item.title} ${item.description}`))
        .map(item => ({
          ...item,
          title: titleWithCompany(company.name, item.title),
          description: item.description || `Owned update from ${company.name}`,
        }))
    })
  )

  return flattenSettled(results)
}

function flattenSettled<T>(results: Array<PromiseSettledResult<T[]>>): T[] {
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
}

function parseGdeltDate(value?: string): string | null {
  if (!value) return null
  if (/^\d{14}$/.test(value)) {
    const year = value.slice(0, 4)
    const month = value.slice(4, 6)
    const day = value.slice(6, 8)
    const hour = value.slice(8, 10)
    const minute = value.slice(10, 12)
    const second = value.slice(12, 14)
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function titleWithCompany(companyName: string, title: string): string {
  return title.toLowerCase().includes(companyName.toLowerCase())
    ? title
    : `${companyName}: ${title}`
}

function uniqueCompanies(companies: CompanySeed[]): CompanySeed[] {
  const seen = new Set<string>()
  const unique: CompanySeed[] = []

  for (const company of companies) {
    const name = company.name.trim()
    if (!name) continue
    const domain = normalizeDomain(company.domain)
    const key = domain || name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({
      clientId: company.clientId,
      name,
      domain,
      websiteUrl: company.websiteUrl ?? null,
      priorityScore: company.priorityScore,
      isWatchlist: company.isWatchlist,
    })
  }

  return unique
}

function normalizeDomain(domain?: string | null): string | null {
  if (!domain) return null
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim() || null
}
