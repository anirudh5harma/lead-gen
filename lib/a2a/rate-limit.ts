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
  const limits = await getAgentRateLimitTier(supabase, tier)

  // Check minute window
  const minuteKey = `rl:min:${apiKeyId}:${Math.floor(Date.now() / 60000)}`
  const minuteState = RATE_LIMIT_CACHE.get(minuteKey) ?? { count: 0, resetAt: Math.ceil(Date.now() / 60000) * 60000 }

  if (minuteState.count >= limits.requests_per_minute) {
    return { allowed: false, remaining: 0, resetAt: minuteState.resetAt, window: 'minute' }
  }

  // Check hour window
  const hourKey = `rl:hr:${apiKeyId}:${Math.floor(Date.now() / 3600000)}`
  const hourState = RATE_LIMIT_CACHE.get(hourKey) ?? { count: 0, resetAt: Math.ceil(Date.now() / 3600000) * 3600000 }

  if (hourState.count >= limits.requests_per_hour) {
    return { allowed: false, remaining: 0, resetAt: hourState.resetAt, window: 'hour' }
  }

  // Check day window
  const dayKey = `rl:day:${apiKeyId}:${Math.floor(Date.now() / 86400000)}`
  const dayState = RATE_LIMIT_CACHE.get(dayKey) ?? { count: 0, resetAt: Math.ceil(Date.now() / 86400000) * 86400000 }

  if (dayState.count >= limits.requests_per_day) {
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
    limits.requests_per_minute - minuteState.count,
    limits.requests_per_hour - hourState.count,
    limits.requests_per_day - dayState.count,
  )

  return { allowed: true, remaining, resetAt: minuteState.resetAt, window: 'minute' }
}
