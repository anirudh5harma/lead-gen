import type { SupabaseClient } from '@supabase/supabase-js'
import { listGtmWorkItems } from './work-items'

export interface GtmLaunchReadiness {
  score: number
  status: 'blocked' | 'needs_work' | 'ready' | 'running'
  headline: string
  first_value: {
    signal_clusters: number
    high_quality_clusters: number
    ready_work_items: number
    verified_contacts: number
    sent: number
    replies: number
    booked: number
  }
  segments: Array<{
    key: string
    label: string
    score: number
    done: boolean
    reason: string
    action: string
  }>
  recommendations: string[]
  source_learning: Array<{
    source_name: string
    signal_type: string | null
    reliability_score: number
    sent_count: number
    replied_count: number
    booked_count: number
  }>
}

interface LooseQuery<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  select(columns: string): LooseQuery<T>
  eq(column: string, value: string | boolean): LooseQuery<T>
  is(column: string, value: null): LooseQuery<T>
  neq(column: string, value: string): LooseQuery<T>
  order(column: string, options?: { ascending?: boolean }): LooseQuery<T>
  limit(count: number): LooseQuery<T>
  maybeSingle(): Promise<{ data: T | null; error: { message: string } | null }>
}

export async function getGtmLaunchReadiness(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
  },
): Promise<GtmLaunchReadiness> {
  const clientId = input.clientId ?? null
  const policyQuery = scopedLooseQuery(
    looseQuery<Record<string, unknown>>(supabase, 'auto_send_policies')
      .select('enabled, target_origins, require_verified_contact, min_relevance_score, daily_send_limit, min_minutes_between_sends')
      .eq('user_id', input.userId),
    clientId,
  ).maybeSingle()
  const leadQuery = scopedLooseQuery(
    looseQuery<Record<string, unknown>>(supabase, 'leads')
      .select('id, status, is_unlocked, contact_email, contact_verified, sent_at, replied_at, booked_at')
      .eq('user_id', input.userId)
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
      .limit(500),
    clientId,
  )
  const clusterQuery = scopedLooseQuery(
    looseQuery<Record<string, unknown>>(supabase, 'gtm_signal_clusters')
      .select('id, weighted_score')
      .eq('user_id', input.userId)
      .order('last_observed_at', { ascending: false })
      .limit(500),
    clientId,
  )
  const sourceQuery = scopedLooseQuery(
    looseQuery<Record<string, unknown>>(supabase, 'gtm_source_reliability')
      .select('source_name, signal_type, reliability_score, sent_count, replied_count, booked_count')
      .eq('user_id', input.userId)
      .order('reliability_score', { ascending: false })
      .limit(8),
    clientId,
  )
  const [profileRes, clientRes, inboxRes, policyRes, leadRes, clusterRes, sourceRes, workItemsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, icp_keywords, target_industries, lead_credit_balance, automation_mode')
      .eq('user_id', input.userId)
      .maybeSingle(),
    clientId
      ? supabase
          .from('client_accounts')
          .select('name, website_url, services_description, icp_keywords, target_industries')
          .eq('id', clientId)
          .eq('user_id', input.userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('connected_accounts')
      .select('id, is_active')
      .eq('user_id', input.userId)
      .eq('is_active', true),
    policyQuery,
    leadQuery,
    safeMaybeRows(clusterQuery),
    safeMaybeRows(sourceQuery),
    listGtmWorkItems(supabase, { userId: input.userId, clientId, limit: 50 }).catch(() => ({ work_items: [] })),
  ])

  if (profileRes.error) throw new Error(profileRes.error.message)
  if (clientRes.error) throw new Error(clientRes.error.message)
  if (inboxRes.error) throw new Error(inboxRes.error.message)
  if (policyRes.error) throw new Error(policyRes.error.message)
  if (leadRes.error) throw new Error(leadRes.error.message)

  const effectiveProfile = (clientRes.data ?? profileRes.data) as Record<string, unknown> | null
  const rootProfile = (profileRes.data ?? {}) as Record<string, unknown>
  const leads = (leadRes.data ?? []) as Array<Record<string, unknown>>
  const clusters = clusterRes.rows
  const workItems = workItemsRes.work_items
  const sourceLearning = sourceRes.rows.map(row => ({
    source_name: String(row.source_name ?? 'unknown'),
    signal_type: typeof row.signal_type === 'string' ? row.signal_type : null,
    reliability_score: numberValue(row.reliability_score),
    sent_count: numberValue(row.sent_count),
    replied_count: numberValue(row.replied_count),
    booked_count: numberValue(row.booked_count),
  }))

  const firstValue = {
    signal_clusters: clusters.length,
    high_quality_clusters: clusters.filter(row => numberValue(row.weighted_score) >= 70).length,
    ready_work_items: workItems.filter(item => item.status === 'open' || item.status === 'waiting').length,
    verified_contacts: leads.filter(lead => lead.contact_email && lead.contact_verified === true).length,
    sent: leads.filter(lead => Boolean(lead.sent_at) || lead.status === 'sent').length,
    replies: leads.filter(lead => Boolean(lead.replied_at) || lead.status === 'replied').length,
    booked: leads.filter(lead => Boolean(lead.booked_at) || lead.status === 'booked').length,
  }

  const hasOffer = stringValue(effectiveProfile?.services_description).length >= 40
  const hasWebsite = Boolean(stringValue(effectiveProfile?.website_url))
  const hasIcp = arrayValue(effectiveProfile?.icp_keywords).length >= 3 || arrayValue(effectiveProfile?.target_industries).length > 0
  const hasInbox = (inboxRes.data ?? []).length > 0
  const credits = numberValue(rootProfile.lead_credit_balance)
  const policy = policyRes.data as Record<string, unknown> | null
  const policyEnabled = Boolean(policy?.enabled && Array.isArray(policy.target_origins) && policy.target_origins.includes('live'))
  const hasLearning = firstValue.sent + firstValue.replies + firstValue.booked > 0 || sourceLearning.length > 0

  const segments = [
    segment('offer', 'Offer clarity', hasOffer ? 100 : 45, hasOffer, hasOffer ? 'Offer context is ready for account-specific reasoning.' : 'Describe the offer in enough detail for accurate positioning.', 'Tighten offer'),
    segment('website', 'Company context', hasWebsite ? 100 : 55, hasWebsite, hasWebsite ? 'Website context can support account research and enrichment.' : 'Add a website to improve account context.', 'Add website'),
    segment('icp', 'ICP precision', hasIcp ? 100 : 40, hasIcp, hasIcp ? 'ICP has industries or explicit keywords.' : 'Add buyer categories, pain keywords, and target industries.', 'Tune ICP'),
    segment('signals', 'Account movement', firstValue.signal_clusters > 0 ? Math.min(100, 55 + firstValue.high_quality_clusters * 15) : 35, firstValue.high_quality_clusters > 0, firstValue.signal_clusters > 0 ? `${firstValue.signal_clusters} clustered signals captured.` : 'No clustered account movement captured yet.', 'Seed watchlist'),
    segment('contacts', 'Contact path', firstValue.verified_contacts > 0 ? 100 : 45, firstValue.verified_contacts > 0, firstValue.verified_contacts > 0 ? `${firstValue.verified_contacts} verified contacts are available.` : 'Use credits to unlock verified contacts for the best accounts.', 'Find contacts'),
    segment('inbox', 'Sending safety', hasInbox ? 100 : 30, hasInbox, hasInbox ? 'At least one active sending inbox is connected.' : 'Connect Gmail or Outlook before safe execution.', 'Connect inbox'),
    segment('credits', 'Lead credits', credits > 0 ? 100 : 45, credits > 0, credits > 0 ? `${credits} unlock credits are available.` : 'Add unlock credits so Bombsell can enrich verified contacts.', 'Add credits'),
    segment('autopilot', 'Execution mode', policyEnabled ? 100 : 60, policyEnabled, policyEnabled ? 'Account agents can send from live signals under your guardrails.' : 'Approve-first mode is active; automated sending is off.', 'Review engine'),
    segment('learning', 'Learning loop', hasLearning ? 100 : 50, hasLearning, hasLearning ? 'Replies and decisions are feeding memory and ranking.' : 'Learning improves once sends, replies, dismissals, and bookings occur.', 'Review accounts'),
  ]

  const score = Math.round(segments.reduce((sum, item) => sum + item.score, 0) / segments.length)
  const status = score >= 85 && policyEnabled ? 'running' : score >= 78 ? 'ready' : score >= 55 ? 'needs_work' : 'blocked'
  const recommendations = segments.filter(item => !item.done).slice(0, 4).map(item => item.action)

  return {
    score,
    status,
    headline: headlineForStatus(status, firstValue),
    first_value: firstValue,
    segments,
    recommendations,
    source_learning: sourceLearning,
  }
}

function segment(key: string, label: string, score: number, done: boolean, reason: string, action: string) {
  return { key, label, score: Math.max(0, Math.min(100, Math.round(score))), done, reason, action }
}

function headlineForStatus(status: GtmLaunchReadiness['status'], firstValue: GtmLaunchReadiness['first_value']): string {
  if (status === 'running') return 'Bombsell is working account movement into pipeline.'
  if (status === 'ready') return 'Your account-agent loop is ready for approve-first execution.'
  if (firstValue.high_quality_clusters > 0) return 'Signals are coming in; finish setup to make them actionable.'
  return 'Finish the launch path to reach the first qualified work item.'
}

async function safeMaybeRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[] }> {
  const result = await query
  if (result.error) {
    console.error('[launch-readiness] optional table query failed:', result.error.message)
    return { rows: [] }
  }
  return { rows: result.data ?? [] }
}

function looseQuery<T>(supabase: SupabaseClient, table: string): LooseQuery<T> {
  return supabase.from(table) as unknown as LooseQuery<T>
}

function scopedLooseQuery<T>(
  query: LooseQuery<T>,
  clientId: string | null,
): LooseQuery<T> {
  return clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}
