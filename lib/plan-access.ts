import type { SubscriptionTier } from './lead-credits'

// Low → high. v2 ships two real tiers (launch, team); legacy tiers are slotted
// so existing access checks keep behaving sanely.
const TIER_ORDER: SubscriptionTier[] = ['free', 'launch', 'growth', 'scale', 'team', 'enterprise']

export function tierIndex(tier: SubscriptionTier): number {
  const i = TIER_ORDER.indexOf(tier)
  return i === -1 ? 0 : i
}

export function hasPlanAccess(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  return tierIndex(userTier) >= tierIndex(requiredTier)
}

/** Team plan (or above): team workspaces, member roles, CRM agent. */
export function hasTeamFeatures(userTier: SubscriptionTier): boolean {
  return userTier === 'team' || userTier === 'enterprise'
}

/** Which nav views are gated by tier */
export const VIEW_TIER_REQUIREMENTS: Record<string, SubscriptionTier> = {
  'sales/explore': 'launch',
  'marketing/content': 'launch',
  'marketing/content/posts': 'launch',
  'marketing/content/blogs': 'launch',
  'marketing/content/videos': 'launch',
  'marketing/campaigns': 'launch',
  'marketing/audience': 'launch',
  'engine/autopilot': 'launch',
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

/** Legacy feature grouping kept for older route/view checks. */
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
