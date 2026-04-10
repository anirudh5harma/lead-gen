import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeadFeed from '@/components/LeadFeed'
import WatchlistManager from '@/components/WatchlistManager'

export const revalidate = 0

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name, services_description, icp_keywords')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  // Initial leads (server-rendered)
  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id,
      target_company,
      relevance_score,
      relevance_reason,
      status,
      created_at,
      sent_at,
      replied_at,
      booked_at,
      signals (
        signal_type,
        headline,
        summary,
        funding_amount,
        source_url,
        published_at
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  // Weekly stats
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: statsRows } = await supabase
    .from('leads')
    .select('status, sent_at, booked_at, created_at')
    .eq('user_id', user.id)
    .gte('created_at', sevenDaysAgo)

  const weeklyStats = {
    signals: statsRows?.length ?? 0,
    drafted: statsRows?.filter(r => ['drafted', 'sent', 'replied', 'booked'].includes(r.status)).length ?? 0,
    sent:    statsRows?.filter(r => r.sent_at !== null).length ?? 0,
    booked:  statsRows?.filter(r => r.booked_at !== null).length ?? 0,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typedLeads = (leads ?? []) as any[]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="font-semibold text-white">ProspectSignal</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400 hidden sm:block">
            Watching for <span className="text-gray-200">{profile.company_name}</span>
          </span>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Hourly
          </div>
          <a href="/onboarding" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            Edit profile
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Signal Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Companies with a recent trigger event matched to your profile.
            </p>
          </div>
        </div>

        {/* Watchlist (collapsible) */}
        <WatchlistManager />

        {/* Lead feed — metrics, filters, table */}
        <LeadFeed
          initialLeads={typedLeads}
          userId={user.id}
          weeklyStats={weeklyStats}
        />
      </main>
    </div>
  )
}
