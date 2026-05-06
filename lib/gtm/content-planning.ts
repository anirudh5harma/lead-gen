export type MarketingContentType = 'x_post' | 'linkedin_post' | 'blog_article' | 'video_script' | 'newsletter_blurb' | 'campaign_brief' | 'sales_enablement_note'
export type MarketingContentTab = 'posts' | 'blogs' | 'videos'

export interface MarketingDraftSettings {
  platform?: string | null
  wordTarget?: number | null
  tone?: string | null
  cta?: string | null
  emojiLevel?: 'none' | 'light' | 'expressive' | null
  linkMode?: 'none' | 'inline' | 'end' | null
  imageMode?: 'none' | 'optional' | 'required' | null
  voice?: 'founder' | 'company' | 'operator' | null
  seoIntent?: string | null
  outlineDepth?: 'brief' | 'standard' | 'detailed' | null
  durationSeconds?: number | null
  avatarStyle?: string | null
  hookType?: string | null
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9' | null
  aiLabel?: boolean | null
}

export function dailySuggestionDate(now = new Date(), timeZone = 'UTC'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`
  } catch {
    // Fall back to UTC below.
  }
  return now.toISOString().slice(0, 10)
}

export function tabForContentType(value: string): MarketingContentTab {
  if (value === 'blog_article' || value === 'newsletter_blurb') return 'blogs'
  if (value === 'video_script') return 'videos'
  return 'posts'
}

export function applyDailySuggestionCaps<T extends { idea: { contentType: MarketingContentType } }>(
  items: T[],
  remainingByTab: Record<MarketingContentTab, number>,
): Array<T & { rank: number }> {
  const used: Record<MarketingContentTab, number> = { posts: 0, blogs: 0, videos: 0 }
  const capped: Array<T & { rank: number }> = []
  for (const item of items) {
    const tab = tabForContentType(item.idea.contentType)
    if (used[tab] >= Math.max(0, remainingByTab[tab] ?? 0)) continue
    used[tab]++
    capped.push({ ...item, rank: used[tab] })
  }
  return capped
}

export function defaultDraftSettingsForContentType(contentType: string): MarketingDraftSettings {
  if (contentType === 'x_post') {
    return { platform: 'x', wordTarget: 55, tone: 'sharp', cta: 'soft question', emojiLevel: 'none', linkMode: 'end', imageMode: 'optional', voice: 'operator' }
  }
  if (contentType === 'linkedin_post') {
    return { platform: 'linkedin', wordTarget: 180, tone: 'operator-led', cta: 'discussion prompt', emojiLevel: 'light', linkMode: 'end', imageMode: 'optional', voice: 'founder' }
  }
  if (contentType === 'blog_article') {
    return { platform: 'blog', wordTarget: 900, tone: 'useful and specific', cta: 'product-relevant next step', emojiLevel: 'none', linkMode: 'inline', imageMode: 'optional', voice: 'company', seoIntent: 'problem-aware', outlineDepth: 'standard' }
  }
  if (contentType === 'video_script') {
    return { platform: 'tiktok', tone: 'direct and visual', cta: 'comment or visit link', emojiLevel: 'light', linkMode: 'end', imageMode: 'required', voice: 'founder', durationSeconds: 35, avatarStyle: 'credible founder avatar', hookType: 'pattern interrupt', aspectRatio: '9:16', aiLabel: true }
  }
  return { platform: platformForContentType(contentType), wordTarget: 160, tone: 'clear', cta: 'soft next step', emojiLevel: 'none', linkMode: 'end', imageMode: 'optional', voice: 'company' }
}

export function normalizeDraftSettings(value: unknown, contentType = 'linkedin_post'): MarketingDraftSettings {
  const defaults = defaultDraftSettingsForContentType(contentType)
  const row = normalizeRecord(value)
  return {
    platform: stringValue(row.platform) || defaults.platform,
    wordTarget: boundedInt(row.wordTarget ?? row.word_target, 1, 5000) ?? defaults.wordTarget ?? null,
    tone: stringValue(row.tone).slice(0, 80) || defaults.tone,
    cta: stringValue(row.cta).slice(0, 120) || defaults.cta,
    emojiLevel: enumValue(row.emojiLevel ?? row.emoji_level, ['none', 'light', 'expressive'] as const) ?? (defaults.emojiLevel as MarketingDraftSettings['emojiLevel']),
    linkMode: enumValue(row.linkMode ?? row.link_mode, ['none', 'inline', 'end'] as const) ?? (defaults.linkMode as MarketingDraftSettings['linkMode']),
    imageMode: enumValue(row.imageMode ?? row.image_mode, ['none', 'optional', 'required'] as const) ?? (defaults.imageMode as MarketingDraftSettings['imageMode']),
    voice: enumValue(row.voice, ['founder', 'company', 'operator'] as const) ?? (defaults.voice as MarketingDraftSettings['voice']),
    seoIntent: stringValue(row.seoIntent ?? row.seo_intent).slice(0, 100) || defaults.seoIntent,
    outlineDepth: enumValue(row.outlineDepth ?? row.outline_depth, ['brief', 'standard', 'detailed'] as const) ?? (defaults.outlineDepth as MarketingDraftSettings['outlineDepth']),
    durationSeconds: boundedInt(row.durationSeconds ?? row.duration_seconds, 5, 240) ?? defaults.durationSeconds ?? null,
    avatarStyle: stringValue(row.avatarStyle ?? row.avatar_style).slice(0, 120) || defaults.avatarStyle,
    hookType: stringValue(row.hookType ?? row.hook_type).slice(0, 100) || defaults.hookType,
    aspectRatio: enumValue(row.aspectRatio ?? row.aspect_ratio, ['1:1', '4:5', '9:16', '16:9'] as const) ?? (defaults.aspectRatio as MarketingDraftSettings['aspectRatio']),
    aiLabel: typeof row.aiLabel === 'boolean' ? row.aiLabel : typeof row.ai_label === 'boolean' ? row.ai_label : defaults.aiLabel,
  }
}

function platformForContentType(value: string): string {
  if (value === 'x_post') return 'x'
  if (value === 'linkedin_post') return 'linkedin'
  if (value === 'blog_article') return 'blog'
  if (value === 'video_script') return 'youtube'
  if (value === 'newsletter_blurb') return 'newsletter'
  return 'campaign'
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  const parsed = numberValue(value)
  if (parsed === null) return null
  return Math.round(Math.min(max, Math.max(min, parsed)))
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null
  return allowed.includes(value as T) ? value as T : null
}
