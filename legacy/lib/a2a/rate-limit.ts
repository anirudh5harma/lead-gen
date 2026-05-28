import type { SupabaseClient } from '@supabase/supabase-js'

interface RateLimitTier {
  requests_per_minute: number
  requests_per_hour: number
  requests_per_day: number
  concurrent_requests: number
}

interface RateLimitState {
  allowed: boolean
  remaining: number
  resetAt: number
  window: string
}

const RATE_LIMIT_CACHE = new Map<string, { count: number; resetAt: number }>()
let lastCleanupAt = 0

function isUnlimited(limit: number): boolean {
  return limit === 0
}

function cleanupExpiredRateLimitWindows(now: number): void {
  if (now - lastCleanupAt < 60_000) return
  lastCleanupAt = now
  for (const [key, state] of RATE_LIMIT_CACHE.entries()) {
    if (state.resetAt <= now) RATE_LIMIT_CACHE.delete(key)
  }
}

export async function getAgentRateLimitTier(
  supabase: SupabaseClient,
  tier: string,
): Promise<RateLimitTier> {
  const { data } = await supabase
    .from('agent_rate_limit_tiers')
    .select('requests_per_minute, requests_per_hour, requests_per_day, concurrent_requests')
    .eq('tier', tier)
    .maybeSingle()

  return {
    requests_per_minute: data?.requests_per_minute ?? 60,
    requests_per_hour: data?.requests_per_hour ?? 1000,
    requests_per_day: data?.requests_per_day ?? 10000,
    concurrent_requests: data?.concurrent_requests ?? 5,
  }
}

export async function checkAgentRateLimit(
  supabase: SupabaseClient,
  apiKeyId: string,
  tier: string,
): Promise<RateLimitState> {
  const rpcResult = await checkDistributedRateLimit(supabase, apiKeyId, tier)
  if (rpcResult) return rpcResult

  // Fallback for environments where the migration is not applied yet.
  return checkInMemoryRateLimit(supabase, apiKeyId, tier)
}

async function checkDistributedRateLimit(
  supabase: SupabaseClient,
  apiKeyId: string,
  tier: string,
): Promise<RateLimitState | null> {
  const { data, error } = await supabase.rpc('check_and_increment_agent_rate_limit', {
    p_api_key_id: apiKeyId,
    p_tier: tier,
  })

  if (error) {
    // Keep API availability high during staggered deploy/migration windows.
    console.warn('[a2a-rate-limit] distributed limiter unavailable, using fallback:', error.message)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const payload = row as Record<string, unknown>

  const resetAt = parseResetAt(payload.reset_at)
  const remaining = Number(payload.remaining)
  return {
    allowed: Boolean(payload.allowed),
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt,
    window: normalizeWindow(payload.rate_window ?? payload.window),
  }
}

function parseResetAt(value: unknown): number {
  if (typeof value === 'string' || value instanceof Date) {
    const parsed = new Date(value).getTime()
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now() + 60_000
}

function normalizeWindow(value: unknown): string {
  return value === 'day' || value === 'hour' || value === 'minute'
    ? value
    : 'minute'
}

async function checkInMemoryRateLimit(
  supabase: SupabaseClient,
  apiKeyId: string,
  tier: string,
): Promise<RateLimitState> {
  const now = Date.now()
  cleanupExpiredRateLimitWindows(now)
  const limits = await getAgentRateLimitTier(supabase, tier)

  // Check minute window
  const minuteKey = `rl:min:${apiKeyId}:${Math.floor(now / 60000)}`
  const minuteState = RATE_LIMIT_CACHE.get(minuteKey) ?? { count: 0, resetAt: Math.ceil(now / 60000) * 60000 }

  if (!isUnlimited(limits.requests_per_minute) && minuteState.count >= limits.requests_per_minute) {
    return { allowed: false, remaining: 0, resetAt: minuteState.resetAt, window: 'minute' }
  }

  // Check hour window
  const hourKey = `rl:hr:${apiKeyId}:${Math.floor(now / 3600000)}`
  const hourState = RATE_LIMIT_CACHE.get(hourKey) ?? { count: 0, resetAt: Math.ceil(now / 3600000) * 3600000 }

  if (!isUnlimited(limits.requests_per_hour) && hourState.count >= limits.requests_per_hour) {
    return { allowed: false, remaining: 0, resetAt: hourState.resetAt, window: 'hour' }
  }

  // Check day window
  const dayKey = `rl:day:${apiKeyId}:${Math.floor(now / 86400000)}`
  const dayState = RATE_LIMIT_CACHE.get(dayKey) ?? { count: 0, resetAt: Math.ceil(now / 86400000) * 86400000 }

  if (!isUnlimited(limits.requests_per_day) && dayState.count >= limits.requests_per_day) {
    return { allowed: false, remaining: 0, resetAt: dayState.resetAt, window: 'day' }
  }

  // Increment counters
  minuteState.count++
  hourState.count++
  dayState.count++
  RATE_LIMIT_CACHE.set(minuteKey, minuteState)
  RATE_LIMIT_CACHE.set(hourKey, hourState)
  RATE_LIMIT_CACHE.set(dayKey, dayState)

  const remaining = Math.min(
    isUnlimited(limits.requests_per_minute) ? Number.MAX_SAFE_INTEGER : limits.requests_per_minute - minuteState.count,
    isUnlimited(limits.requests_per_hour) ? Number.MAX_SAFE_INTEGER : limits.requests_per_hour - hourState.count,
    isUnlimited(limits.requests_per_day) ? Number.MAX_SAFE_INTEGER : limits.requests_per_day - dayState.count,
  )

  return { allowed: true, remaining, resetAt: minuteState.resetAt, window: 'minute' }
}
