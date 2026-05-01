'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AutoSendAccount, PendingFollowup } from './types'
import { TabLoadingState, formatDateTime } from './shared'

export default function AutopilotView() {
  const [liveAutopilotOn, setLiveAutopilotOn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AutoSendAccount[]>([])
  const [accountId, setAccountId] = useState<string | null>(null)
  const [requireVerified, setRequireVerified] = useState(true)
  const [minScore, setMinScore] = useState(7)
  const [maxAge, setMaxAge] = useState(30)
  const [dailyLimit, setDailyLimit] = useState(10)
  const [spacing, setSpacing] = useState(15)
  const [followups, setFollowups] = useState<PendingFollowup[]>([])
  const [followupsLoaded, setFollowupsLoaded] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [activityLog, setActivityLog] = useState<Array<{ id: string; action: string; company: string; time: string }>>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/auto-send', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as {
          error?: string
          policy?: {
            enabled?: boolean
            connected_account_id?: string | null
            target_origins?: Array<'live' | 'explore'>
            require_verified_contact?: boolean
            min_relevance_score?: number
            max_lead_age_days?: number
            daily_send_limit?: number
            min_minutes_between_sends?: number
          }
          accounts?: AutoSendAccount[]
        } | null
        if (cancelled || !data) return
        if (!res.ok) { setMsg(data.error ?? 'Failed to load settings.'); setLoaded(true); return }
        const origins = data.policy?.target_origins ?? []
        setLiveAutopilotOn(Boolean(data.policy?.enabled && origins.includes('live')))
        setAccountId(data.policy?.connected_account_id ?? null)
        setRequireVerified(data.policy?.require_verified_contact !== false)
        setMinScore(data.policy?.min_relevance_score ?? 7)
        setMaxAge(data.policy?.max_lead_age_days ?? 30)
        setDailyLimit(data.policy?.daily_send_limit ?? 10)
        setSpacing(data.policy?.min_minutes_between_sends ?? 15)
        setAccounts(data.accounts ?? [])
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) { setMsg('Failed to load settings.'); setLoaded(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/leads/pending-followups', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ followups?: PendingFollowup[] }>)
      .then(data => { if (!cancelled) { setFollowups(data.followups ?? []); setFollowupsLoaded(true) } })
      .catch(() => { if (!cancelled) setFollowupsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    fetch('/api/gtm/ops', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as { workflow_runs?: Array<{ id: string; workflow_type: string; status: string; started_at: string; completed_at?: string | null; error_message: string | null; input?: Record<string, unknown> | null }>; error?: string } | null
        if (cancelled || !res.ok || !data) return
        setActivityLog((data.workflow_runs ?? []).slice(0, 8).map(run => ({
          id: run.id,
          action: labelWorkflowRun(run.workflow_type, run.status),
          company: companyFromRun(run.input) ?? 'Account agent',
          time: run.completed_at ?? run.started_at,
        })))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [loaded])

  const cancelFollowup = useCallback(async (leadId: string, followupId: string) => {
    setCancellingId(followupId)
    try {
      await fetch(`/api/leads/${leadId}/followup`, { method: 'DELETE' })
      setFollowups(prev => prev.filter(f => f.id !== followupId))
    } finally { setCancellingId(null) }
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/settings/auto-send', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: liveAutopilotOn,
          connected_account_id: accountId,
          target_origins: liveAutopilotOn ? ['live' as const] : [],
          target_explore_session_ids: [],
          require_verified_contact: requireVerified,
          min_relevance_score: minScore,
          max_lead_age_days: maxAge,
          daily_send_limit: dailyLimit,
          min_minutes_between_sends: spacing,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setMsg(data?.error ?? 'Failed to save settings.'); return }
      setMsg('GTM engine settings saved')
    } catch { setMsg('Failed to save settings.') }
    finally { setSaving(false) }
  }, [liveAutopilotOn, accountId, requireVerified, minScore, maxAge, dailyLimit, spacing])

  if (!loaded || !followupsLoaded) return <TabLoadingState title="Loading GTM Engine" detail="Fetching market coverage, sending mode, and scheduled follow-ups." />

  return (
    <div className="w-full space-y-4">
      <div className="card overflow-hidden">
        <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-1)]">GTM Engine</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">Choose how account agents move from signal to next action.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${
              liveAutopilotOn ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : 'bg-[var(--color-ink-3)] text-[var(--color-text-4)]'
            }`}>
              {liveAutopilotOn ? 'On' : 'Off'}
            </span>
            <button
              role="switch"
              aria-checked={liveAutopilotOn}
              disabled={saving || !loaded}
              onClick={() => setLiveAutopilotOn(e => !e)}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none disabled:opacity-50 ${
                liveAutopilotOn ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-3)] border-[var(--color-line-2)]'
              }`}
            >
              <span className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md ring-0 transition-transform ${liveAutopilotOn ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Recent agent work</h3>
        </div>
        {activityLog.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-[var(--color-text-4)]">No agent work yet. New signals and approved sends will appear here.</div>
        ) : (
          <div className="divide-y divide-[var(--color-line-1)]">
            {activityLog.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                  <span className="text-[12.5px] text-[var(--color-text-1)]">{item.action}</span>
                  <span className="text-[11px] text-[var(--color-text-3)]">{item.company}</span>
                </div>
                <span className="text-[10.5px] text-[var(--color-text-4)]">{formatDateTime(item.time)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className={`px-5 py-5 space-y-5 transition-all duration-200 ${liveAutopilotOn ? 'opacity-100' : 'opacity-60 saturate-75'}`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-[var(--color-text-1)]">Sending from</span>
              <select value={accountId ?? ''} onChange={e => setAccountId(e.target.value || null)} className="w-full h-10 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px] text-[var(--color-text-1)]">
                  <option value="">Rotate across connected inboxes</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name || a.email} · {a.provider}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[var(--color-text-1)]">Daily limit</span>
                <select value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} className="w-full h-10 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px]">
                  {[5, 10, 15, 20, 30, 50].map(v => <option key={v} value={v}>{v}/day</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[var(--color-text-1)]">Gap between sends</span>
                <select value={spacing} onChange={e => setSpacing(Number(e.target.value))} className="w-full h-10 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px]">
                  {[15, 30, 60, 120, 240].map(v => <option key={v} value={v}>{v} min</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
            <p className="text-[12px] font-semibold text-[var(--color-text-1)]">Operating loop</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {['Monitor account', 'Build context', 'Pick next move', 'Send or queue'].map((step, i) => (
                <div key={step} className="flex items-center gap-2 text-[11px] text-[var(--color-text-3)]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[var(--color-accent-ring)] border border-[var(--color-line-1)]">{i + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>

          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-[var(--color-text-2)]">
              <span className="transition-transform group-open:rotate-90">▸</span>
              Advanced settings
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-[var(--color-text-1)]">Minimum lead score</span>
                  <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-full h-10 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px]">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(s => <option key={s} value={s}>{s}+</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-[var(--color-text-1)]">Max lead age</span>
                  <select value={maxAge} onChange={e => setMaxAge(Number(e.target.value))} className="w-full h-10 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px]">
                    {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
                  <span>
                    <span className="block text-[12px] font-semibold text-[var(--color-text-1)]">Verified contacts only</span>
                    <span className="block text-[10.5px] text-[var(--color-text-4)]">Skip unverified emails.</span>
                  </span>
                  <input type="checkbox" checked={requireVerified} onChange={e => setRequireVerified(e.target.checked)} />
                </label>
              </div>
            </div>
          </details>

          <div className="rounded-xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3 text-[11.5px] leading-5 text-[var(--color-text-3)]">
            The engine only spends credits on contact unlocks. It skips unsubscribed and bounced recipients, rotates inboxes, and respects your daily limit and spacing.
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[var(--color-text-4)]">{msg ?? 'Start with approve-first until your targeting, inbox, and credits are ready.'}</div>
            <button onClick={save} disabled={saving || !loaded} className="inline-flex items-center gap-1.5 rounded-full btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : liveAutopilotOn ? 'Save and run' : 'Save approve-first'}
            </button>
          </div>
        </div>

        {/* Followups */}
        {followups.length > 0 && (
          <>
            <div className="px-5 py-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-4)] font-semibold">Scheduled · {followups.length}</p>
            </div>
            <ul className="divide-y divide-[var(--color-line-1)]">
              {followups.map(f => (
                <li key={f.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--color-text-1)] truncate">{f.leads?.target_company ?? 'Unknown'}</p>
                    <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">{formatDateTime(f.scheduled_for)}</p>
                  </div>
                  <button onClick={() => f.leads && cancelFollowup(f.leads.id, f.id)} disabled={cancellingId === f.id} className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] disabled:opacity-50 transition-colors shrink-0">
                    {cancellingId === f.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function labelWorkflowRun(workflowType: string, status: string): string {
  const base = workflowType
    .replace(/^manual_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
  if (status === 'failed') return `${base} blocked`
  if (status === 'completed') return `${base} completed`
  if (status === 'waiting') return `${base} waiting`
  return `${base} running`
}

function companyFromRun(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) return null
  const value = input.target_company ?? input.company ?? input.account_name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
