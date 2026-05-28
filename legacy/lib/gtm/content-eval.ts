/**
 * Content eval — pre-publish lint for social posts. Mirrors the outreach
 * draft-eval pattern. Records a `content_post_quality` eval trace; engagement
 * outcomes are recorded later as `content_engagement`. See PLAN.md §3.4.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { upsertGtmEvalTrace } from './eval-traces'

export type ContentPlatform = 'linkedin' | 'x'

export interface ContentPostInput {
  platform: ContentPlatform
  hook?: string | null
  body: string
  bannedPhrases?: string[]
  maxHashtags?: number
}

export interface ContentEvalResult {
  score: number                 // 0–100
  checks: Record<string, boolean>
  failed: string[]
  version: string
}

const VERSION = 'content-eval@1'

// Platform hard limits (chars). X is 280 unless premium long-form; we lint the common case.
const PLATFORM_MAX: Record<ContentPlatform, number> = { linkedin: 3000, x: 280 }
const HASHTAG_RE = /(^|\s)#[A-Za-z0-9_]+/g

export function evaluateContentPost(input: ContentPostInput): ContentEvalResult {
  const body = (input.body ?? '').trim()
  const text = `${input.hook ?? ''}\n${body}`.trim()
  const lower = text.toLowerCase()
  const maxLen = PLATFORM_MAX[input.platform]
  const hashtags = (text.match(HASHTAG_RE) ?? []).length
  const maxHashtags = input.maxHashtags ?? 3
  const banned = (input.bannedPhrases ?? []).filter((p) => p && lower.includes(p.toLowerCase()))

  const checks: Record<string, boolean> = {
    body_present: body.length >= 20,
    hook_present: !!(input.hook && input.hook.trim().length >= 8) || body.length >= 80,
    within_platform_limit: text.length <= maxLen,
    not_too_short: text.length >= (input.platform === 'x' ? 40 : 120),
    hashtags_in_range: hashtags <= maxHashtags,
    no_banned_phrases: banned.length === 0,
    no_link_spam: (text.match(/https?:\/\//g) ?? []).length <= 1,
    single_call_to_action: (text.match(/\?\s*$/gm) ?? []).length <= 2,
  }

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
  const total = Object.keys(checks).length
  const score = Math.round(((total - failed.length) / total) * 100)
  return { score, checks, failed, version: VERSION }
}

export async function recordContentEvalTrace(
  supabase: SupabaseClient,
  opts: {
    userId: string
    clientId: string | null
    postId?: string
    eval: ContentEvalResult
    type: 'content_post_quality' | 'content_engagement'
    reasons?: string[] | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await upsertGtmEvalTrace(supabase, {
    userId: opts.userId,
    clientId: opts.clientId,
    traceType: opts.type,
    status: opts.eval.failed.length === 0 ? 'passed' : opts.eval.score >= 60 ? 'warning' : 'failed',
    reasons: opts.reasons ?? (opts.eval.failed.length ? opts.eval.failed : null),
    draftQualityScore: opts.eval.score,
    metadata: { ...opts.metadata, postId: opts.postId, checks: opts.eval.checks, version: opts.eval.version },
  })
}
