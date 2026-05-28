import type { LeadOrigin } from './lead-sources'

export interface AutoSendPolicyRecord {
  id?: string
  user_id?: string
  client_id?: string | null
  enabled?: boolean | null
  connected_account_id?: string | null
  target_origins?: string[] | null
  target_explore_session_ids?: string[] | null
  require_verified_contact?: boolean | null
  min_relevance_score?: number | null
  max_lead_age_days?: number | null
  daily_send_limit?: number | null
  explore_daily_send_limit?: number | null
  min_minutes_between_sends?: number | null
  started_notification_sent_at?: string | null
  completed_notification_sent_at?: string | null
}

export interface AutoSendPolicy {
  enabled: boolean
  connected_account_id: string | null
  target_origins: LeadOrigin[]
  target_explore_session_ids: string[]
  require_verified_contact: boolean
  min_relevance_score: number
  max_lead_age_days: number
  daily_send_limit: number
  explore_daily_send_limit: number
  min_minutes_between_sends: number
}

export const AUTO_SEND_ORIGINS: LeadOrigin[] = ['live', 'explore']

export function normalizeAutoSendPolicy(record: AutoSendPolicyRecord | null | undefined): AutoSendPolicy {
  const origins = Array.isArray(record?.target_origins)
    ? record.target_origins.filter((origin): origin is LeadOrigin => AUTO_SEND_ORIGINS.includes(origin as LeadOrigin))
    : []

  return {
    enabled: record?.enabled === true,
    connected_account_id: record?.connected_account_id ?? null,
    target_origins: origins.length > 0 ? origins : ['live'],
    target_explore_session_ids: sanitizeSessionIds(record?.target_explore_session_ids),
    require_verified_contact: record?.require_verified_contact === true,
    min_relevance_score: normalizePolicyScore(record?.min_relevance_score),
    max_lead_age_days: normalizePolicyAge(record?.max_lead_age_days),
    daily_send_limit: normalizeDailySendLimit(record?.daily_send_limit),
    explore_daily_send_limit: normalizeExploreDailySendLimit(record?.explore_daily_send_limit),
    min_minutes_between_sends: normalizeSendSpacing(record?.min_minutes_between_sends),
  }
}

export function sanitizeAutoSendOrigins(origins: unknown): LeadOrigin[] {
  if (!Array.isArray(origins)) return ['live']
  const sanitized = origins.filter((origin): origin is LeadOrigin => AUTO_SEND_ORIGINS.includes(origin as LeadOrigin))
  return sanitized.length > 0 ? sanitized : ['live']
}

export function sanitizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => uuidPattern.test(item)),
  )].slice(0, 25)
}

export function normalizePolicyScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.min(10, Math.round(value)))
}

export function normalizePolicyAge(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30
  return Math.max(1, Math.min(365, Math.round(value)))
}

export function normalizeDailySendLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 10
  return Math.max(1, Math.min(50, Math.round(value)))
}

export function normalizeExploreDailySendLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3
  return Math.max(0, Math.min(50, Math.round(value)))
}

export function normalizeSendSpacing(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 15
  return Math.max(5, Math.min(1440, Math.round(value)))
}

export function policyKey(userId: string, clientId: string | null): string {
  return `${userId}:${clientId ?? 'workspace-none'}`
}
