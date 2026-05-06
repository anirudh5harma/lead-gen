import type { SupabaseClient } from '@supabase/supabase-js'
import { buildGoogleNewsUrl, fetchRSSFromUrl, fetchRSSItems, type RSSItem } from '@/lib/rss'

interface WorkspaceProfileRow {
  user_id: string
  client_id: string | null
  company_name: string
  industry: string
  keywords: string[]
}

const INDUSTRY_PATTERN_QUERIES = [
  'viral LinkedIn B2B marketing post',
  'best B2B SaaS content marketing examples',
  'business marketing TikTok trend founders',
  'Instagram reels business marketing tips',
]

const INSPIRATION_FEEDS = [
  { url: 'https://www.socialmediaexaminer.com/feed/', source: 'socialmediaexaminer' },
  { url: 'https://contentmarketinginstitute.com/feed/', source: 'content_marketing_institute' },
  { url: 'https://blog.hubspot.com/marketing/rss.xml', source: 'hubspot_marketing' },
]

export async function ingestMarketingInspiration(
  supabase: SupabaseClient,
  options: { limitProfiles?: number; now?: Date } = {},
): Promise<{ profiles: number; inserted: number; skipped: number }> {
  const profiles = await fetchWorkspaceProfiles(supabase, options.limitProfiles ?? 80)
  let inserted = 0
  let skipped = 0

  for (const profile of profiles) {
    const items = await fetchInspirationItems(profile)
    const rows = items
      .map(item => buildInspirationRow(profile, item, options.now ?? new Date()))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, 10)
    if (rows.length === 0) continue

    const existingUrls = rows.map(row => row.source_url).filter((url): url is string => Boolean(url))
    let existingSet = new Set<string>()
    if (existingUrls.length > 0) {
      let existingQuery = supabase
        .from('gtm_content_inspiration_refs')
        .select('source_url')
        .eq('user_id', profile.user_id)
        .in('source_url', existingUrls)
      existingQuery = profile.client_id ? existingQuery.eq('client_id', profile.client_id) : existingQuery.is('client_id', null)
      const { data } = await existingQuery
      existingSet = new Set(((data ?? []) as Array<{ source_url?: string | null }>).map(row => row.source_url).filter(Boolean) as string[])
    }

    const insertRows = rows.filter(row => !row.source_url || !existingSet.has(row.source_url))
    if (insertRows.length === 0) {
      skipped += rows.length
      continue
    }
    const { error } = await supabase.from('gtm_content_inspiration_refs').insert(insertRows)
    if (error) {
      skipped += insertRows.length
    } else {
      inserted += insertRows.length
      skipped += rows.length - insertRows.length
    }
  }

  return { profiles: profiles.length, inserted, skipped }
}

async function fetchWorkspaceProfiles(supabase: SupabaseClient, limit: number): Promise<WorkspaceProfileRow[]> {
  const [{ data: users }, { data: clients }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, company_name, industry, icp_keywords, target_industries')
      .limit(limit),
    supabase
      .from('client_accounts')
      .select('id, user_id, name, industry, icp_keywords, target_industries, is_archived')
      .eq('is_archived', false)
      .limit(limit),
  ])

  return [
    ...((users ?? []) as Array<Record<string, unknown>>).map(row => ({
      user_id: stringValue(row.user_id),
      client_id: null,
      company_name: stringValue(row.company_name) || 'Workspace',
      industry: stringValue(row.industry) || firstString(row.target_industries) || 'B2B',
      keywords: stringArray(row.icp_keywords).concat(stringArray(row.target_industries)).slice(0, 8),
    })),
    ...((clients ?? []) as Array<Record<string, unknown>>).map(row => ({
      user_id: stringValue(row.user_id),
      client_id: stringValue(row.id),
      company_name: stringValue(row.name) || 'Client workspace',
      industry: stringValue(row.industry) || firstString(row.target_industries) || 'B2B',
      keywords: stringArray(row.icp_keywords).concat(stringArray(row.target_industries)).slice(0, 8),
    })),
  ].filter(row => row.user_id).slice(0, limit)
}

async function fetchInspirationItems(profile: WorkspaceProfileRow): Promise<RSSItem[]> {
  const terms = [
    `${profile.industry} viral LinkedIn post marketing`,
    `${profile.industry} business blog content examples`,
    `${profile.industry} TikTok Instagram reels marketing`,
    ...profile.keywords.slice(0, 2).map(keyword => `${keyword} B2B content marketing examples`),
    ...INDUSTRY_PATTERN_QUERIES,
  ]

  const [searchResults, feedResults] = await Promise.all([
    Promise.allSettled(terms.slice(0, 8).map(term => fetchRSSItems(term, '14d', { quiet: true, timeoutMs: 8000 }))),
    Promise.allSettled(INSPIRATION_FEEDS.map(feed => fetchRSSFromUrl(feed.url, feed.source, { quiet: true, timeoutMs: 8000 }))),
  ])

  return [...searchResults, ...feedResults]
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(item => item.title && item.link)
    .slice(0, 80)
}

function buildInspirationRow(profile: WorkspaceProfileRow, item: RSSItem, now: Date) {
  const platform = inferPlatform(item)
  const pattern = inferPatternSummary(item)
  if (!pattern) return null
  return {
    user_id: profile.user_id,
    client_id: profile.client_id,
    industry: profile.industry,
    platform,
    source_url: item.link || null,
    source_title: item.title.slice(0, 240),
    pattern_summary: pattern,
    engagement_score: scoreItem(item, platform),
    captured_at: now.toISOString(),
    metadata: {
      source: item.source,
      pub_date: item.pubDate,
      company_name: profile.company_name,
      ingestion_url: item.source === 'google_news' ? buildGoogleNewsUrl(profile.industry) : null,
    },
  }
}

function inferPlatform(item: RSSItem): string {
  const text = `${item.title} ${item.description} ${item.link}`.toLowerCase()
  if (/\btiktok\b/.test(text)) return 'videos'
  if (/\binstagram|reels?\b/.test(text)) return 'videos'
  if (/\blinkedin\b/.test(text)) return 'linkedin'
  if (/\bblog|seo|article|content marketing\b/.test(text)) return 'blog'
  if (/\bx\.com|twitter|thread\b/.test(text)) return 'x'
  return 'industry'
}

function inferPatternSummary(item: RSSItem): string {
  const text = `${item.title}. ${stripHtml(item.description)}`.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (/\bhow to|guide|steps|playbook|framework\b/.test(lower)) {
    return 'Educational pattern: start with a practical outcome, break the idea into steps, and close with a specific operational takeaway.'
  }
  if (/\btrend|viral|reels?|tiktok|instagram\b/.test(lower)) {
    return 'Short-form pattern: open with a fast visual hook, compress one lesson into three beats, and connect the caption to a current buyer pain.'
  }
  if (/\bcase study|example|teardown|analysis\b/.test(lower)) {
    return 'Teardown pattern: name the example, expose the underlying move, and translate it into an action the audience can reuse.'
  }
  if (/\bmistake|myth|wrong|contrarian|truth\b/.test(lower)) {
    return 'Contrarian pattern: challenge a common belief, show the hidden cost, and replace it with a sharper operating principle.'
  }
  return `Pattern: use the article's concrete hook and structure as inspiration, then create original product-relevant content. Source summary: ${text.slice(0, 260)}`
}

function scoreItem(item: RSSItem, platform: string): number {
  const recency = item.pubDate ? Math.max(0, 20 - Math.floor((Date.now() - new Date(item.pubDate).getTime()) / (24 * 60 * 60 * 1000))) : 8
  const sourceBoost = item.source === 'google_news' ? 8 : 14
  const platformBoost = platform === 'industry' ? 4 : 12
  return Math.max(1, Math.min(100, recency + sourceBoost + platformBoost))
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

function firstString(value: unknown): string {
  return stringArray(value)[0] ?? ''
}
