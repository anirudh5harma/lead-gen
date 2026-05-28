import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

interface RateLimitResult {
  allowed: boolean
  current: number
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  options: { failClosed?: boolean; supabase?: SupabaseClient } = {},
): Promise<RateLimitResult> {
  try {
    const supabase = options.supabase ?? await createClient()
    const { data, error } = await supabase.rpc('rate_limit_check', {
      p_key: key,
      p_max: max,
      p_window_secs: windowSeconds,
    })

    if (error || !data?.[0]) return { allowed: options.failClosed !== true, current: 0 }

    return { allowed: data[0].allowed, current: data[0].current_count }
  } catch {
    return { allowed: options.failClosed !== true, current: 0 }
  }
}
