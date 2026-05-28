/**
 * Outcome-based credit metering. Tier price = features; everything variable is
 * debited here when a *value event* happens (a positive reply, a booked
 * meeting, a published post, a post that crossed the engagement bar) or when a
 * hard third-party cost is incurred (verified contact). See PLAN.md §6.
 *
 * The running balance mirror lives on `user_profiles.lead_credit_balance`;
 * every change is logged to `credit_ledger`. Debits are idempotent per
 * (workspace, event_type, lead_id|post_id).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type OutcomeEvent =
  | 'outbound_positive_reply'
  | 'outbound_meeting_booked'
  | 'content_post_published'
  | 'content_post_winner'      // bonus debit when a post crosses the engagement threshold
  | 'contact_enriched'

/** Default credit cost per outcome — sized so a credit ≈ a real $-value event,
 *  and the monthly bundle covers a normal month while heavy use spills to
 *  overage. Drafting / ideas / research-only runs cost nothing. Tunable. */
export const OUTCOME_COST: Record<OutcomeEvent, number> = {
  outbound_positive_reply: 1,
  outbound_meeting_booked: 5,
  content_post_published: 1,
  content_post_winner: 2,
  contact_enriched: 1,
}

function workspaceId(userId: string, clientId: string | null): string {
  return clientId ?? userId
}

/**
 * Debit a value event. No-op (returns `{ skipped: true }`) if this exact
 * outcome was already charged. Allows the balance to go negative — we never
 * block an outcome that already happened; overage is the billing lever.
 */
export async function debitOutcome(
  supabase: SupabaseClient,
  opts: {
    userId: string
    clientId: string | null
    event: OutcomeEvent
    units?: number
    leadId?: string | null
    postId?: string | null
    note?: string
    metadata?: Record<string, unknown>
  },
): Promise<{ ok: boolean; skipped?: boolean; balanceAfter?: number; error?: string }> {
  const ws = workspaceId(opts.userId, opts.clientId)
  const units = opts.units ?? OUTCOME_COST[opts.event]

  // idempotency check
  if (opts.leadId || opts.postId) {
    let q = supabase.from('credit_ledger').select('id').eq('workspace_id', ws).eq('event_type', opts.event).limit(1)
    q = opts.leadId ? q.eq('lead_id', opts.leadId) : q.eq('post_id', opts.postId!)
    const { data: existing } = await q
    if (existing && existing.length > 0) return { ok: true, skipped: true }
  }

  // decrement the balance mirror
  const { data: profile } = await supabase.from('user_profiles').select('lead_credit_balance').eq('user_id', opts.userId).maybeSingle()
  const current = typeof profile?.lead_credit_balance === 'number' ? profile.lead_credit_balance : 0
  const next = Math.round((current - units) * 1000) / 1000
  const { error: updErr } = await supabase.from('user_profiles').update({ lead_credit_balance: next }).eq('user_id', opts.userId)
  if (updErr) return { ok: false, error: updErr.message }

  const { error: ledgerErr } = await supabase.from('credit_ledger').insert({
    workspace_id: ws,
    user_id: opts.userId,
    direction: 'debit',
    event_type: opts.event,
    units,
    balance_after: next,
    lead_id: opts.leadId ?? null,
    post_id: opts.postId ?? null,
    note: opts.note ?? null,
    metadata: opts.metadata ?? {},
  })
  if (ledgerErr) {
    // 23505 = unique violation → another path already charged it; roll the balance back
    if ((ledgerErr as { code?: string }).code === '23505') {
      await supabase.from('user_profiles').update({ lead_credit_balance: current }).eq('user_id', opts.userId)
      return { ok: true, skipped: true }
    }
    return { ok: false, error: ledgerErr.message }
  }
  return { ok: true, balanceAfter: next }
}

/** Grant credits (monthly renewal, overage purchase, manual top-up). */
export async function grantCredits(
  supabase: SupabaseClient,
  opts: { userId: string; clientId: string | null; units: number; event?: string; note?: string },
): Promise<{ ok: boolean; balanceAfter?: number; error?: string }> {
  const ws = workspaceId(opts.userId, opts.clientId)
  const { data: profile } = await supabase.from('user_profiles').select('lead_credit_balance').eq('user_id', opts.userId).maybeSingle()
  const current = typeof profile?.lead_credit_balance === 'number' ? profile.lead_credit_balance : 0
  const next = Math.round((current + opts.units) * 1000) / 1000
  const { error: updErr } = await supabase.from('user_profiles').update({ lead_credit_balance: next }).eq('user_id', opts.userId)
  if (updErr) return { ok: false, error: updErr.message }
  await supabase.from('credit_ledger').insert({
    workspace_id: ws, user_id: opts.userId, direction: 'grant',
    event_type: opts.event ?? 'manual_grant', units: opts.units, balance_after: next, note: opts.note ?? null,
  })
  return { ok: true, balanceAfter: next }
}

/** A post "won" if it crossed an engagement-rate bar (cheap heuristic for now). */
export function postCrossedEngagementBar(metrics: { impressions?: number; likes?: number; comments?: number; reposts?: number } | null | undefined): boolean {
  if (!metrics) return false
  const impressions = metrics.impressions ?? 0
  const eng = (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.reposts ?? 0)
  if (impressions >= 500 && eng / impressions >= 0.03) return true   // ≥3% engagement on ≥500 impressions
  if (impressions === 0 && eng >= 25) return true                    // no-impression platforms: raw engagement floor
  return false
}
