import { createClient } from '@/lib/supabase/server'

export type PlanTier = 'free'

export interface PlanLimits {
  leads_per_month: number
  auto_send: boolean
  followups: boolean
  reply_detection: boolean
  crm_export: boolean
  slack: boolean
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    leads_per_month: Number.MAX_SAFE_INTEGER,
    auto_send: true,
    followups: true,
    reply_detection: true,
    crm_export: true,
    slack: true,
  },
}

export function normalizePlanTier(plan: string | null | undefined): PlanTier {
  void plan
  return 'free'
}

export async function getUserPlan(userId: string): Promise<{ plan: PlanTier; used: number; limit: number }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_profiles')
    .select('plan, leads_used_this_month, leads_reset_at')
    .eq('user_id', userId)
    .single()

  if (!data) return { plan: 'free', used: 0, limit: PLAN_LIMITS.free.leads_per_month }

  const plan = normalizePlanTier(data.plan)
  const resetAt = new Date(data.leads_reset_at)
  const now = new Date()
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  if (resetAt < windowStart) {
    await supabase
      .from('user_profiles')
      .update({ leads_used_this_month: 0, leads_reset_at: now.toISOString() })
      .eq('user_id', userId)
    return { plan, used: 0, limit: PLAN_LIMITS[plan].leads_per_month }
  }

  return {
    plan,
    used: data.leads_used_this_month ?? 0,
    limit: PLAN_LIMITS[plan].leads_per_month,
  }
}

export async function canSendEmail(userId: string): Promise<boolean> {
  const { used, limit } = await getUserPlan(userId)
  return used < limit
}

export async function incrementSendCount(userId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('increment_leads_used', { p_user_id: userId })
}

export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan]
}
