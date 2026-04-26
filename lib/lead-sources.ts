export type LeadOrigin = 'live' | 'explore' | 'crm_import'
export type LeadSourceKind = 'live_signal' | 'explore_target' | 'crm_record'
export type LeadSignalType = 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring' | 'crm_import'

export interface LeadFeedSnapshot {
  signal_type: LeadSignalType
  headline: string
  summary: string | null
  funding_amount?: string | null
  source_url?: string | null
  source_name?: string | null
  published_at?: string | null
  company_domain?: string | null
  provider?: string | null
  prompt?: string | null
  icp_hint?: string | null
  used_workspace_icp?: boolean | null
  crm_status?: string | null
  owner_name?: string | null
  lead_source?: string | null
}

export function normalizeLeadFeedSnapshot(value: unknown): LeadFeedSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const rawSignalType = typeof row.signal_type === 'string' ? row.signal_type.trim().toLowerCase() : ''
  const signalType = normalizeLeadSignalType(rawSignalType)
  const headline = typeof row.headline === 'string' ? row.headline.trim() : ''

  if (!signalType || !headline) return null

  return {
    signal_type: signalType,
    headline,
    summary: typeof row.summary === 'string' && row.summary.trim() ? row.summary.trim() : null,
    funding_amount: typeof row.funding_amount === 'string' && row.funding_amount.trim() ? row.funding_amount.trim() : null,
    source_url: typeof row.source_url === 'string' && row.source_url.trim() ? row.source_url.trim() : null,
    source_name: typeof row.source_name === 'string' && row.source_name.trim() ? row.source_name.trim() : null,
    published_at: typeof row.published_at === 'string' && row.published_at.trim() ? row.published_at.trim() : null,
    company_domain: typeof row.company_domain === 'string' && row.company_domain.trim() ? row.company_domain.trim().toLowerCase() : null,
    provider: typeof row.provider === 'string' && row.provider.trim() ? row.provider.trim() : null,
    prompt: typeof row.prompt === 'string' && row.prompt.trim() ? row.prompt.trim() : null,
    icp_hint: typeof row.icp_hint === 'string' && row.icp_hint.trim() ? row.icp_hint.trim() : null,
    used_workspace_icp: typeof row.used_workspace_icp === 'boolean' ? row.used_workspace_icp : null,
    crm_status: typeof row.crm_status === 'string' && row.crm_status.trim() ? row.crm_status.trim() : null,
    owner_name: typeof row.owner_name === 'string' && row.owner_name.trim() ? row.owner_name.trim() : null,
    lead_source: typeof row.lead_source === 'string' && row.lead_source.trim() ? row.lead_source.trim() : null,
  }
}

export function buildLiveLeadFeedSnapshot(signal: {
  signal_type: string
  headline: string
  summary?: string | null
  funding_amount?: string | null
  source_url?: string | null
  source_name?: string | null
  published_at?: string | null
  company_domain?: string | null
}): LeadFeedSnapshot {
  return {
    signal_type: normalizeLeadSignalType(signal.signal_type) ?? 'funding',
    headline: signal.headline,
    summary: signal.summary ?? null,
    funding_amount: signal.funding_amount ?? null,
    source_url: signal.source_url ?? null,
    source_name: signal.source_name ?? 'live_signal',
    published_at: signal.published_at ?? null,
    company_domain: signal.company_domain ?? null,
  }
}

export function buildExploreLeadFeedSnapshot(params: {
  signalType: LeadSignalType
  headline: string
  summary: string
  companyDomain?: string | null
  prompt: string
  icpHint?: string | null
  usedWorkspaceIcp: boolean
  sourceUrl?: string | null
  sourceName?: string | null
  publishedAt?: string | null
}): LeadFeedSnapshot {
  return {
    signal_type: params.signalType,
    headline: params.headline,
    summary: params.summary,
    source_url: params.sourceUrl ?? null,
    source_name: params.sourceName ?? 'explore_generated',
    published_at: params.publishedAt ?? null,
    company_domain: params.companyDomain ?? null,
    prompt: params.prompt,
    icp_hint: params.icpHint ?? null,
    used_workspace_icp: params.usedWorkspaceIcp,
  }
}

export function buildCrmLeadFeedSnapshot(params: {
  headline: string
  summary: string
  companyDomain?: string | null
  provider: string
  crmStatus?: string | null
  ownerName?: string | null
  leadSource?: string | null
  publishedAt?: string | null
}): LeadFeedSnapshot {
  return {
    signal_type: 'crm_import',
    headline: params.headline,
    summary: params.summary,
    source_name: 'crm_import',
    published_at: params.publishedAt ?? null,
    company_domain: params.companyDomain ?? null,
    provider: params.provider,
    crm_status: params.crmStatus ?? null,
    owner_name: params.ownerName ?? null,
    lead_source: params.leadSource ?? null,
  }
}

export function normalizeLeadSignalType(value: string): LeadSignalType | null {
  if (value === 'crm_import') return 'crm_import'
  if (value === 'funding') return 'funding'
  if (value === 'acquisition') return 'acquisition'
  if (value === 'expansion') return 'expansion'
  if (value === 'regulation') return 'regulation'
  if (value === 'hiring') return 'hiring'
  return null
}
