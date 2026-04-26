import type { LeadOrigin } from './lead-sources'

export interface AutoSendPolicyRecord {
  id?: string
  user_id?: string
  client_id?: string | null
  enabled?: boolean | null
  connected_account_id?: string | null
  target_origins?: string[] | null
  require_verified_contact?: boolean | null
  min_relevance_score?: number | null
  max_lead_age_days?: number | null
}

export interface AutoSendPolicy {
  enabled: boolean
  connected_account_id: string | null
  target_origins: LeadOrigin[]
  require_verified_contact: boolean
  min_relevance_score: number
  max_lead_age_days: number
}

export const AUTO_SEND_ORIGINS: LeadOrigin[] = ['live', 'explore', 'crm_import']

export function normalizeAutoSendPolicy(record: AutoSendPolicyRecord | null | undefined): AutoSendPolicy {
  const origins = Array.isArray(record?.target_origins)
    ? record.target_origins.filter((origin): origin is LeadOrigin => AUTO_SEND_ORIGINS.includes(origin as LeadOrigin))
    : []

  return {
    enabled: record?.enabled === true,
    connected_account_id: record?.connected_account_id ?? null,
    target_origins: origins.length > 0 ? origins : ['live', 'explore', 'crm_import'],
    require_verified_contact: record?.require_verified_contact === true,
    min_relevance_score: normalizePolicyScore(record?.min_relevance_score),
    max_lead_age_days: normalizePolicyAge(record?.max_lead_age_days),
  }
}

export function sanitizeAutoSendOrigins(origins: unknown): LeadOrigin[] {
  if (!Array.isArray(origins)) return ['live', 'explore', 'crm_import']
  const sanitized = origins.filter((origin): origin is LeadOrigin => AUTO_SEND_ORIGINS.includes(origin as LeadOrigin))
  return sanitized.length > 0 ? sanitized : ['live', 'explore', 'crm_import']
}

export function normalizePolicyScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.min(10, Math.round(value)))
}

export function normalizePolicyAge(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30
  return Math.max(1, Math.min(365, Math.round(value)))
}

export function policyKey(userId: string, clientId: string | null): string {
  return `${userId}:${clientId ?? 'workspace-none'}`
}
