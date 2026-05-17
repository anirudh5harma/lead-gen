export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'dismissed'
export type CampaignTargetStatus = 'proposed' | 'enrolled' | 'drafted' | 'approved' | 'sent' | 'replied' | 'booked' | 'dismissed' | 'blocked'
export type CampaignContentStatus = 'linked' | 'drafted' | 'approved' | 'scheduled' | 'published' | 'dismissed'
export type CampaignAssetStatus = 'draft' | 'approved' | 'published' | 'dismissed'
export type CampaignReadinessMissing = 'objective' | 'audience' | 'trigger' | 'narrative' | 'targets'
export type CampaignReadinessRecommendation = 'content_air_cover'

export interface CampaignRowLike {
  id: string
  status: string | null
  name?: string | null
  segment?: string | null
  trigger?: string | null
  narrative?: string | null
  objective?: string | null
  offer?: string | null
  success_metric?: string | null
  channels?: string[] | null
  [key: string]: unknown
}

export interface CampaignTargetLike {
  campaign_id: string
  lead_id?: string | null
  status: string | null
}

export interface CampaignContentLinkLike {
  campaign_id: string
  status: string | null
  channel?: string | null
}

export interface CampaignAssetLike {
  campaign_id: string
  status: string | null
}

export interface CampaignLeadLike {
  id: string
  target_company: string
  relevance_score?: number | null
  status?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  created_at?: string | null
}

export interface CampaignAssetCounts {
  total: number
  draft: number
  approved: number
  published: number
  dismissed: number
}

export interface CampaignTargetCounts {
  total: number
  proposed: number
  enrolled: number
  drafted: number
  approved: number
  sent: number
  replied: number
  booked: number
  dismissed: number
  blocked: number
}

export interface CampaignContentCounts {
  total: number
  linked: number
  drafted: number
  approved: number
  scheduled: number
  published: number
  dismissed: number
}

export interface CampaignMetrics {
  total: number
  draft: number
  active: number
  paused: number
  completed: number
  targets: number
  sent: number
  replied: number
  booked: number
  content: number
  content_published: number
}

export type CampaignReadinessStage = 'strategy' | 'audience' | 'content' | 'launch-ready' | 'live' | 'learning'

export interface CampaignReadiness {
  stage: CampaignReadinessStage
  canLaunch: boolean
  missing: CampaignReadinessMissing[]
  recommendations: CampaignReadinessRecommendation[]
  nextAction: string
}

const TARGET_STATUSES: CampaignTargetStatus[] = ['proposed', 'enrolled', 'drafted', 'approved', 'sent', 'replied', 'booked', 'dismissed', 'blocked']
const CONTENT_STATUSES: CampaignContentStatus[] = ['linked', 'drafted', 'approved', 'scheduled', 'published', 'dismissed']
const ASSET_STATUSES: CampaignAssetStatus[] = ['draft', 'approved', 'published', 'dismissed']

export function emptyTargetCounts(): CampaignTargetCounts {
  return { total: 0, proposed: 0, enrolled: 0, drafted: 0, approved: 0, sent: 0, replied: 0, booked: 0, dismissed: 0, blocked: 0 }
}

export function emptyContentCounts(): CampaignContentCounts {
  return { total: 0, linked: 0, drafted: 0, approved: 0, scheduled: 0, published: 0, dismissed: 0 }
}

export function emptyAssetCounts(): CampaignAssetCounts {
  return { total: 0, draft: 0, approved: 0, published: 0, dismissed: 0 }
}

export function summarizeCampaignCounts<T extends CampaignRowLike>(
  campaigns: T[],
  rows: {
    targets?: CampaignTargetLike[]
    links?: CampaignContentLinkLike[]
    assets?: CampaignAssetLike[]
  },
): Array<T & { target_counts: CampaignTargetCounts; content_counts: CampaignContentCounts; asset_counts: CampaignAssetCounts }> {
  return campaigns.map(campaign => {
    const targetCounts = emptyTargetCounts()
    for (const target of rows.targets ?? []) {
      if (target.campaign_id !== campaign.id) continue
      targetCounts.total += 1
      const status = normalizeStatus(target.status, TARGET_STATUSES, 'proposed')
      targetCounts[status] += 1
    }

    const contentCounts = emptyContentCounts()
    for (const link of rows.links ?? []) {
      if (link.campaign_id !== campaign.id) continue
      contentCounts.total += 1
      const status = normalizeStatus(link.status, CONTENT_STATUSES, 'linked')
      contentCounts[status] += 1
    }

    const assetCounts = emptyAssetCounts()
    for (const asset of rows.assets ?? []) {
      if (asset.campaign_id !== campaign.id) continue
      assetCounts.total += 1
      const status = normalizeStatus(asset.status, ASSET_STATUSES, 'draft')
      assetCounts[status] += 1
    }

    return { ...campaign, target_counts: targetCounts, content_counts: contentCounts, asset_counts: assetCounts }
  })
}

export function buildCampaignMetrics(
  campaigns: CampaignRowLike[],
  rows: {
    targets?: CampaignTargetLike[]
    links?: CampaignContentLinkLike[]
    assets?: CampaignAssetLike[]
  },
): CampaignMetrics {
  const targets = rows.targets ?? []
  const links = rows.links ?? []
  const assets = rows.assets ?? []
  return {
    total: campaigns.length,
    draft: campaigns.filter(c => c.status === 'draft').length,
    active: campaigns.filter(c => c.status === 'active').length,
    paused: campaigns.filter(c => c.status === 'paused').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
    targets: targets.length,
    sent: targets.filter(t => t.status === 'sent').length,
    replied: targets.filter(t => t.status === 'replied').length,
    booked: targets.filter(t => t.status === 'booked').length,
    content: links.length + assets.length,
    content_published: links.filter(l => l.status === 'published').length + assets.filter(a => a.status === 'published').length,
  }
}

export function rankCampaignLeadCandidates<T extends CampaignLeadLike>(
  leads: T[],
  targets: Array<CampaignTargetLike & { lead_id?: string | null }>,
  campaignId: string,
): T[] {
  const enrolled = new Set(
    targets
      .filter(target => target.campaign_id === campaignId && target.lead_id)
      .map(target => String(target.lead_id)),
  )

  return leads
    .filter(lead => !enrolled.has(lead.id))
    .slice()
    .sort((a, b) => candidateScore(b) - candidateScore(a) || dateValue(b.created_at) - dateValue(a.created_at))
}

export function deriveCampaignTargetStatus(lead: CampaignLeadLike, currentStatus?: string | null): CampaignTargetStatus {
  if (lead.status === 'dismissed') return 'dismissed'
  if (lead.booked_at || lead.status === 'booked') return 'booked'
  if (lead.replied_at || lead.status === 'replied') return 'replied'
  if (lead.sent_at || lead.status === 'sent') return 'sent'

  const normalized = normalizeStatus(currentStatus, TARGET_STATUSES, 'enrolled')
  if (normalized === 'approved' || normalized === 'drafted' || normalized === 'blocked' || normalized === 'proposed') return normalized
  return normalized === 'dismissed' ? 'dismissed' : 'enrolled'
}

export function syncCampaignTargetsWithLeads(
  targets: Array<CampaignTargetLike & { lead_id?: string | null }>,
  leads: CampaignLeadLike[],
): Array<{ campaign_id: string; lead_id: string; status: CampaignTargetStatus }> {
  const leadsById = new Map(leads.map(lead => [lead.id, lead]))
  const updates: Array<{ campaign_id: string; lead_id: string; status: CampaignTargetStatus }> = []

  for (const target of targets) {
    if (!target.lead_id) continue
    const lead = leadsById.get(target.lead_id)
    if (!lead) continue
    const nextStatus = deriveCampaignTargetStatus(lead, target.status)
    if (nextStatus !== target.status) {
      updates.push({ campaign_id: target.campaign_id, lead_id: target.lead_id, status: nextStatus })
    }
  }

  return updates
}

export function buildCampaignReadiness(input: {
  campaign: CampaignRowLike
  targetCount: number
  contentCount: number
  approvedAssetCount?: number
}): CampaignReadiness {
  const { campaign, targetCount, contentCount } = input
  const missing: CampaignReadiness['missing'] = []
  const recommendations: CampaignReadiness['recommendations'] = []
  if (!hasMeaning(campaign.objective) && !hasMeaning(campaign.name)) missing.push('objective')
  if (!hasMeaning(campaign.segment)) missing.push('audience')
  if (!hasMeaning(campaign.trigger)) missing.push('trigger')
  if (!hasMeaning(campaign.narrative)) missing.push('narrative')
  if (targetCount <= 0) missing.push('targets')
  if (contentCount + (input.approvedAssetCount ?? 0) <= 0) recommendations.push('content_air_cover')

  if (campaign.status === 'active') {
    return { stage: 'live', canLaunch: true, missing, recommendations, nextAction: missing.length ? nextActionFor(missing[0]) : 'Review replies, meetings, content engagement, and objections before scaling the next batch.' }
  }
  if (campaign.status === 'completed') {
    return { stage: 'learning', canLaunch: false, missing, recommendations, nextAction: 'Consolidate learnings: winning hook, best segment, objections, and the next campaign to launch.' }
  }
  if (missing.includes('audience') || missing.includes('trigger') || missing.includes('narrative') || missing.includes('objective')) {
    return { stage: 'strategy', canLaunch: false, missing, recommendations, nextAction: nextActionFor(missing[0]) }
  }
  if (missing.includes('targets')) {
    return { stage: 'audience', canLaunch: false, missing, recommendations, nextAction: nextActionFor('targets') }
  }
  return { stage: 'launch-ready', canLaunch: true, missing, recommendations, nextAction: 'Launch a small batch, watch reply quality, then scale what works.' }
}

function hasMeaning(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

function nextActionFor(missing: CampaignReadinessMissing | undefined): string {
  switch (missing) {
    case 'objective': return 'Define the outcome: booked meetings, pipeline, validation, reactivation, expansion, or launch awareness.'
    case 'audience': return 'Define the audience tightly enough to choose targets without guessing.'
    case 'trigger': return 'Choose the reason-now signal that makes this campaign timely.'
    case 'narrative': return 'Write the campaign narrative: pain hypothesis, proof, offer, and CTA.'
    case 'targets': return 'Enroll a small, high-fit batch from Pipeline before launching.'
    default: return 'Review the campaign motion and choose the next constraint to remove.'
  }
}

function candidateScore(lead: CampaignLeadLike): number {
  let score = typeof lead.relevance_score === 'number' ? lead.relevance_score : 0
  if (!lead.sent_at && lead.status !== 'sent') score += 20
  if (lead.status === 'sent' || lead.sent_at) score -= 50
  if (lead.status === 'drafted' || lead.status === 'unlocked' || lead.status === 'delivered') score += 8
  if (lead.replied_at) score -= 35
  if (lead.booked_at) score -= 50
  return score
}

function dateValue(value?: string | null): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function normalizeStatus<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}
