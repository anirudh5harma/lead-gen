import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    recentLeadsRes,
    pendingEnrichmentRes,
    pendingFollowupsRes,
    sendingAccountsRes,
    leadDebugRes,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('contact_email', null)
      .eq('is_unlocked', true)
      .neq('status', 'dismissed'),
    supabase
      .from('scheduled_followups')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('sent_at', null)
      .lte('scheduled_for', new Date().toISOString()),
    supabase
      .from('connected_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true),
    supabase
      .from('leads')
      .select(`
        id,
        target_company,
        relevance_score,
        status,
        created_at,
        match_debug,
        feed_snapshot,
        signals(signal_type, headline)
      `)
      .eq('user_id', user.id)
      .not('match_debug', 'is', null)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  return NextResponse.json({
    counts: {
      user_leads_last_24h: recentLeadsRes.count ?? 0,
      pending_enrichment: pendingEnrichmentRes.count ?? 0,
      pending_followups: pendingFollowupsRes.count ?? 0,
      active_sending_accounts: sendingAccountsRes.count ?? 0,
    },
    lead_diagnostics: (leadDebugRes.data ?? []).map(lead => {
      const snapshot = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)
      const fallbackSignal = Array.isArray(lead.signals) ? lead.signals[0] ?? null : lead.signals

      return {
        id: lead.id,
        target_company: lead.target_company,
        relevance_score: lead.relevance_score,
        status: lead.status,
        created_at: lead.created_at,
        match_debug: lead.match_debug,
        signal: snapshot
          ? { signal_type: snapshot.signal_type, headline: snapshot.headline }
          : fallbackSignal,
      }
    }),
  })
}
