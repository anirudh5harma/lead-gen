import type { SubscriptionTier } from './lead-credits'

const TIER_ORDER: SubscriptionTier[] = ['free', 'growth', 'scale', 'enterprise']

export function tierIndex(tier: SubscriptionTier): number {
  return TIER_ORDER.indexOf(tier)
}

export function hasPlanAccess(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  return tierIndex(userTier) >= tierIndex(requiredTier)
}

/** Which nav views are gated by tier */
export const VIEW_TIER_REQUIREMENTS: Record<string, SubscriptionTier> = {
  'sales/explore': 'growth',
  'marketing/content': 'growth',
  'marketing/content/posts': 'growth',
  'marketing/content/blogs': 'growth',
  'marketing/content/videos': 'growth',
  'marketing/campaigns': 'growth',
  'marketing/audience': 'growth',
  'engine/autopilot': 'growth',
  'engine/sequences': 'free', // basic sequences for all, custom templates = scale
}

export function viewRequiredTier(view: string): SubscriptionTier | null {
  return VIEW_TIER_REQUIREMENTS[view] ?? null
}

export function canAccessView(userTier: SubscriptionTier, view: string): boolean {
  const required = viewRequiredTier(view)
  if (!required) return true
  return hasPlanAccess(userTier, required)
}

/** Features that need Scale+ */
export const SCALE_FEATURES = [
  'team',
  'slack',
  'crm_sync',
  'custom_templates',
] as const

export type ScaleFeature = (typeof SCALE_FEATURES)[number]

export function isScaleFeature(feature: ScaleFeature): boolean {
  return SCALE_FEATURES.includes(feature)
}

export function canUseScaleFeature(userTier: SubscriptionTier): boolean {
  return hasPlanAccess(userTier, 'scale')
}
