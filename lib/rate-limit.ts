import { createClient } from '@/lib/supabase/server'

interface RateLimitResult {
  allowed: boolean
  current: number
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('rate_limit_check', {
      p_key: key,
      p_max: max,
      p_window_secs: windowSeconds,
    })

    if (error || !data?.[0]) return { allowed: true, current: 0 }

    return { allowed: data[0].allowed, current: data[0].current_count }
  } catch {
    // Fail open — don't block users if rate limit check itself fails
    return { allowed: true, current: 0 }
  }
}
