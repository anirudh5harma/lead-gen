'use client'

import { useState, useEffect, useCallback } from 'react'
import { TabLoadingState, formatDateTime } from './shared'

interface Campaign {
  id: string
  name: string
  segment: string
  trigger: string
  narrative: string
  status: string
  created_at: string
  updated_at: string
  asset_counts: { total: number; draft: number; approved: number; published: number }
}

interface CampaignsPayload {
  campaigns: Campaign[]
  metrics: Record<string, number>
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-[var(--color-ink-3)] text-[var(--color-text-3)]',
  active: 'bg-[var(--color-accent)]/10 text-[var(--color-accent-ring)]',
  paused: 'bg-[#fff4df] text-[#936014]',
  completed: 'bg-[var(--color-sig-expansion)]/10 text-[var(--color-sig-expansion)]',
  dismissed: 'bg-[var(--color-ink-3)] text-[var(--color-text-4)]',
}

export default function CampaignsView() {
  const [payload, setPayload] = useState<CampaignsPayload>({ campaigns: [], metrics: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSegment, setNewSegment] = useState('')
  const [newTrigger, setNewTrigger] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/gtm/campaigns')
      const data = await res.json().catch(() => null) as CampaignsPayload & { error?: string } | null
      if (!res.ok) setError(data?.error ?? 'Could not load campaigns.')
      else setPayload({ campaigns: data?.campaigns ?? [], metrics: data?.metrics ?? {} })
    } catch { setError('Failed to load campaigns.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const updateStatus = useCallback(async (id: string, action: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/gtm/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        setError(data?.error ?? 'Failed to update campaign.')
      }
    } catch { setError('Failed to update campaign.') }
    finally { setBusyId(null); await load() }
  }, [])

  async function createCampaign() {
    if (!newName.trim() || creating) return
    setCreating(true)
    setCreateMsg(null)
    try {
      const res = await fetch('/api/gtm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          segment: newSegment.trim() || undefined,
          trigger: newTrigger.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setCreateMsg(data?.error ?? 'Failed to create campaign.'); return }
      setNewName(''); setNewSegment(''); setNewTrigger(''); setShowCreate(false)
      await load()
    } catch { setCreateMsg('Failed to create campaign.') }
    finally { setCreating(false) }
  }

  if (loading) return <TabLoadingState title="Loading Campaigns" detail="Fetching campaign data and asset counts." />

  const visibleCampaigns = payload.campaigns.filter(c => c.status !== 'dismissed')

  return (
    <div className="space-y-5">
      {/* Header + Create */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-[var(--color-ink-2)]/30 border-b border-[var(--color-line-1)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-1)]">Campaigns</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              {payload.metrics.active ?? 0} active · {payload.metrics.total ?? 0} total · {payload.metrics.assets ?? 0} assets
            </p>
          </div>
          <button
            onClick={() => setShowCreate(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg btn-primary px-4 py-2 text-xs font-semibold hover:scale-[1.02] active:scale-[0.98] transition-transform"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {showCreate ? 'Cancel' : 'New Campaign'}
          </button>
        </div>

        {showCreate && (
          <div className="px-5 py-4 space-y-3 border-b border-[var(--color-line-1)]">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Campaign name (e.g. Q2 Expansion Play)"
              className="w-full h-9 px-3 rounded-lg border border-[var(--color-line-2)] bg-white text-[13px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
            />
            <input
              value={newSegment}
              onChange={e => setNewSegment(e.target.value)}
              placeholder="Target segment (e.g. Series A SaaS)"
              className="w-full h-9 px-3 rounded-lg border border-[var(--color-line-2)] bg-white text-[13px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
            />
            <input
              value={newTrigger}
              onChange={e => setNewTrigger(e.target.value)}
              placeholder="Trigger signal (e.g. Recent funding)"
              className="w-full h-9 px-3 rounded-lg border border-[var(--color-line-2)] bg-white text-[13px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--color-text-4)]">{createMsg ?? ''}</span>
              <button
                onClick={createCampaign}
                disabled={!newName.trim() || creating}
                className="inline-flex items-center gap-1.5 rounded-lg btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                {creating ? 'Creating…' : 'Create Campaign'}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-[var(--color-sig-regulation)]/25 bg-[var(--color-sig-regulation)]/8 px-4 py-3 text-[13px] text-[var(--color-sig-regulation)]">
          {error}
        </div>
      )}

      {/* Campaign List */}
      {visibleCampaigns.length === 0 ? (
        <section className="card px-5 py-12 text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-[var(--color-ink-2)] mb-4">
            <svg className="w-7 h-7 text-[var(--color-text-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">No campaigns yet</h3>
          <p className="text-xs text-[var(--color-text-3)] mt-2 max-w-md mx-auto">
            Create your first campaign to group content ideas around a common segment, trigger, and narrative.
            Link campaign briefs from the Content Hub to build multi-channel campaigns.
          </p>
        </section>
      ) : (
        <section className="grid gap-3">
          {visibleCampaigns.map(campaign => (
            <article key={campaign.id} className="rounded-lg border border-[var(--color-line-1)] bg-white shadow-[0_1px_2px_#00000008] overflow-hidden">
              <div className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-[var(--color-text-1)]">{campaign.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft}`}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-4)]">{campaign.segment} · triggered by {campaign.trigger}</p>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-4)] shrink-0">{formatDateTime(campaign.created_at)}</span>
                </div>

                <p className="mt-2 text-xs text-[var(--color-text-2)] line-clamp-2">{campaign.narrative}</p>

                {/* Asset counts */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-4)]">
                    {campaign.asset_counts.total} asset{campaign.asset_counts.total !== 1 ? 's' : ''}
                  </span>
                  {campaign.asset_counts.draft > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-4)]">
                      {campaign.asset_counts.draft} draft
                    </span>
                  )}
                  {campaign.asset_counts.published > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]">
                      {campaign.asset_counts.published} published
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--color-line-1)]">
                  {campaign.status === 'draft' && (
                    <button onClick={() => updateStatus(campaign.id, 'activate')} disabled={busyId === campaign.id} className="h-7 px-3 rounded-lg btn-primary text-[11px] font-semibold disabled:opacity-50">Activate</button>
                  )}
                  {campaign.status === 'active' && (
                    <button onClick={() => updateStatus(campaign.id, 'pause')} disabled={busyId === campaign.id} className="h-7 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[11px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Pause</button>
                  )}
                  {campaign.status === 'paused' && (
                    <button onClick={() => updateStatus(campaign.id, 'activate')} disabled={busyId === campaign.id} className="h-7 px-3 rounded-lg btn-primary text-[11px] font-semibold disabled:opacity-50">Resume</button>
                  )}
                  {(campaign.status === 'active' || campaign.status === 'paused') && (
                    <button onClick={() => updateStatus(campaign.id, 'complete')} disabled={busyId === campaign.id} className="h-7 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[11px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Complete</button>
                  )}
                  <button onClick={() => updateStatus(campaign.id, 'dismiss')} disabled={busyId === campaign.id} className="h-7 px-3 rounded-lg text-[11px] font-semibold text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Dismiss</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
