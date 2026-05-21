/**
 * Shared autopilot state machine. Sets `user_profiles.automation_mode` and the
 * matching `auto_send_policies` row atomically so the two cannot drift —
 * `cron/send-automation` only reads the policy table, so leaving the two in
 * disagreement silently kills outbound (see the Settings → /api/profile/field
 * regression that motivated this helper).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import { sendAutomationLifecycleEmail } from '@/lib/resend'

export type AutomationMode = 'research_only' | 'approve_first' | 'autopilot'

export const AUTOMATION_MODES: readonly AutomationMode[] = ['research_only', 'approve_first', 'autopilot']

export const DEFAULT_AUTOPILOT = {
  require_verified_contact: true,
  min_relevance_score: 7,
  max_lead_age_days: 30,
  daily_send_limit: 10,
  min_minutes_between_sends: 30,
}

export interface ReadinessItem {
  key: 'profile' | 'website' | 'icp' | 'inbox' | 'credits'
  label: string
  done: boolean
  action: string
}

export function buildReadiness(input: {
  hasProfile: boolean
  hasWebsite: boolean
  hasIcp: boolean
  hasInbox: boolean
  hasCredits: boolean
}): ReadinessItem[] {
  return [
    { key: 'profile', label: 'Offer and company profile', done: input.hasProfile, action: 'Edit onboarding' },
    { key: 'website', label: 'Website for personalization', done: input.hasWebsite, action: 'Add website' },
    { key: 'icp', label: 'ICP targets', done: input.hasIcp, action: 'Tune ICP' },
    { key: 'inbox', label: 'Connected sending inbox', done: input.hasInbox, action: 'Connect inbox' },
    { key: 'credits', label: 'Lead unlock credits', done: input.hasCredits, action: 'Add credits' },
  ]
}

export function normalizeAutomationMode(value: unknown): AutomationMode | null {
  return value === 'research_only' || value === 'approve_first' || value === 'autopilot' ? value : null
}

export async function loadReadiness(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ readiness: ReadinessItem[]; companyName: string | null; error?: string }> {
  const [profileRes, accountsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, icp_keywords, target_industries, lead_credit_balance')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1),
  ])
  if (profileRes.error) return { readiness: [], companyName: null, error: profileRes.error.message }
  if (accountsRes.error) return { readiness: [], companyName: null, error: accountsRes.error.message }

  const profile = profileRes.data as {
    company_name?: string | null
    website_url?: string | null
    services_description?: string | null
    icp_keywords?: string[] | null
    target_industries?: string[] | null
    lead_credit_balance?: number | null
  } | null

  const readiness = buildReadiness({
    hasProfile: Boolean(profile?.company_name && profile?.services_description),
    hasWebsite: Boolean(profile?.website_url),
    hasIcp: Boolean(profile?.icp_keywords?.length || profile?.target_industries?.length),
    hasInbox: Boolean(accountsRes.data?.length),
    hasCredits: (profile?.lead_credit_balance ?? 0) > 0,
  })
  return { readiness, companyName: profile?.company_name ?? null }
}

export interface ApplyAutomationModeResult {
  ok: boolean
  mode: AutomationMode
  enabled: boolean
  readiness: ReadinessItem[]
  error?: string
  status?: number
}

/**
 * Applies a new automation mode to the workspace. Performs:
 *   1. Readiness gate when switching to `autopilot` (mirrors the launch checklist).
 *   2. `user_profiles.automation_mode` update.
 *   3. `auto_send_policies` upsert — toggles the `live` origin so the
 *      send-automation cron picks the workspace up.
 *   4. Agent event + lifecycle email when transitioning into autopilot.
 *
 * Returns a structured result so the caller can decide HTTP status. `clientId`
 * is the workspace scope (null for solo accounts).
 */
export async function applyAutomationMode(
  supabase: SupabaseClient,
  params: {
    userId: string
    clientId: string | null
    mode: AutomationMode
    userEmail?: string | null
    /** When true, skips readiness enforcement (only safe for trusted internal callers). */
    skipReadinessGate?: boolean
  },
): Promise<ApplyAutomationModeResult> {
  const { userId, clientId, mode } = params
  const { readiness, companyName, error: readinessError } = await loadReadiness(supabase, userId)
  if (readinessError) {
    return { ok: false, mode, enabled: false, readiness, error: readinessError, status: 500 }
  }

  if (mode === 'autopilot' && !params.skipReadinessGate && readiness.some(item => !item.done)) {
    return {
      ok: false,
      mode,
      enabled: false,
      readiness,
      error: 'Finish the launch checklist before starting autopilot.',
      status: 400,
    }
  }

  const existingQuery = clientId
    ? supabase
        .from('auto_send_policies')
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .maybeSingle()
    : supabase
        .from('auto_send_policies')
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends')
        .eq('user_id', userId)
        .is('client_id', null)
        .maybeSingle()
  const { data: existingPolicy, error: existingPolicyError } = await existingQuery
  if (existingPolicyError) {
    return { ok: false, mode, enabled: false, readiness, error: existingPolicyError.message, status: 500 }
  }

  const now = new Date().toISOString()
  const existingOrigins = Array.isArray((existingPolicy as { target_origins?: unknown } | null)?.target_origins)
    ? ((existingPolicy as { target_origins?: string[] }).target_origins ?? []).filter(origin => origin === 'live' || origin === 'explore')
    : []
  const targetOrigins = mode === 'autopilot'
    ? Array.from(new Set([...existingOrigins, 'live']))
    : existingOrigins.filter(origin => origin !== 'live')
  const enabled = targetOrigins.length > 0
  const exploreSessionIds = Array.isArray((existingPolicy as { target_explore_session_ids?: unknown } | null)?.target_explore_session_ids)
    ? ((existingPolicy as { target_explore_session_ids?: string[] }).target_explore_session_ids ?? [])
    : []

  const policyPayload = {
    user_id: userId,
    client_id: clientId,
    enabled,
    connected_account_id: (existingPolicy as { connected_account_id?: string | null } | null)?.connected_account_id ?? null,
    target_origins: targetOrigins,
    target_explore_session_ids: exploreSessionIds,
    require_verified_contact: (existingPolicy as { require_verified_contact?: boolean | null } | null)?.require_verified_contact ?? DEFAULT_AUTOPILOT.require_verified_contact,
    min_relevance_score: (existingPolicy as { min_relevance_score?: number | null } | null)?.min_relevance_score ?? DEFAULT_AUTOPILOT.min_relevance_score,
    max_lead_age_days: (existingPolicy as { max_lead_age_days?: number | null } | null)?.max_lead_age_days ?? DEFAULT_AUTOPILOT.max_lead_age_days,
    daily_send_limit: (existingPolicy as { daily_send_limit?: number | null } | null)?.daily_send_limit ?? DEFAULT_AUTOPILOT.daily_send_limit,
    min_minutes_between_sends: (existingPolicy as { min_minutes_between_sends?: number | null } | null)?.min_minutes_between_sends ?? DEFAULT_AUTOPILOT.min_minutes_between_sends,
    last_started_at: mode === 'autopilot' ? now : null,
    last_completed_at: null,
    started_notification_sent_at: mode === 'autopilot' ? now : null,
    completed_notification_sent_at: null,
  }

  const [profileUpdate, policyUpdate] = await Promise.all([
    supabase.from('user_profiles').update({ automation_mode: mode }).eq('user_id', userId),
    existingPolicy
      ? supabase.from('auto_send_policies').update(policyPayload).eq('id', (existingPolicy as { id: string }).id)
      : supabase.from('auto_send_policies').insert(policyPayload),
  ])

  if (profileUpdate.error) return { ok: false, mode, enabled, readiness, error: profileUpdate.error.message, status: 500 }
  if (policyUpdate.error) return { ok: false, mode, enabled, readiness, error: policyUpdate.error.message, status: 500 }

  await recordAgentEvent(supabase, {
    userId,
    clientId,
    agentName: 'operator',
    eventType: 'autopilot_mode_changed',
    status: enabled ? 'running' : 'completed',
    title: mode === 'autopilot' ? 'GTM Engine started' : 'GTM Engine set to approve-first',
    body: mode === 'autopilot'
      ? 'Bombsell will now unlock high-fit accounts with credits, find verified contacts, and send safely from your inbox.'
      : 'Bombsell will continue surfacing account work for review before sending.',
    metadata: { mode },
  })

  if (mode === 'autopilot' && params.userEmail) {
    sendAutomationLifecycleEmail({
      toEmail: params.userEmail,
      companyName: companyName ?? 'your workspace',
      event: 'started',
      summary: 'Bombsell GTM Engine is active. Account agents will unlock high-fit leads using credits, use verified contacts only, send with mailbox pacing, stop on replies, and surface outcomes in Bombsell.',
    }).catch(error => console.error('[autopilot] start email failed:', error))
  }

  return { ok: true, mode, enabled, readiness }
}
