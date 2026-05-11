'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lead } from '@/lib/leads'
import type { UserProfile, View } from './types'
import LeadDrawer from './LeadDrawer'
import Icon from '@/components/Icon'

interface Props {
  profile: UserProfile
  leads: Lead[]
  onNavigate: (v: View) => void
}

/**
 * Loop — the primary workspace, styled in the Stitch editorial system.
 *   1. Command bar (filters the queue live; ⌘K to focus)
 *   2. Counters strip
 *   3. Today queue (top-priority accounts to act on)
 *   4. Loop status strip (which agents are live right now)
 */
export default function HomeView({ profile, leads, onNavigate }: Props) {
  const [q, setQ] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const today = useMemo(() => {
    const live = leads.filter(l => l.status !== 'archived' && l.status !== 'rejected')
    const k = q.trim().toLowerCase()
    const filtered = !k ? live : live.filter(l =>
      l.target_company.toLowerCase().includes(k)
      || (l.relevance_reason ?? '').toLowerCase().includes(k)
      || (l.contact_name ?? '').toLowerCase().includes(k)
      || (l.company_domain ?? '').toLowerCase().includes(k)
    )
    return filtered.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).slice(0, q.trim() ? 50 : 8)
  }, [leads, q])

  const counts = useMemo(() => {
    let drafts = 0, replies = 0, sent = 0
    for (const l of leads) {
      if (l.status === 'drafted') drafts++
      if (l.replied_at) replies++
      if (l.sent_at) sent++
    }
    return { drafts, replies, sent }
  }, [leads])

  return (
    <div className="space-y-section-gap font-body-main text-on-surface">
      {/* Greeting */}
      <div>
        <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Workspace · {profile.client_name || profile.company_name}</p>
        <h2 className="font-h1-editorial text-display-sm text-on-surface">
          What should the loop do <span className="italic text-primary">next</span>?
        </h2>
      </div>

      {/* Command bar */}
      <div className="hairline-border bg-surface-container-lowest px-6 py-4 flex items-center gap-4 rounded-lg max-w-3xl shadow-sm focus-within:border-primary/30 transition-colors">
        <Icon name="search" size={20} className="text-on-surface-variant" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter accounts: company, contact, signal reason…"
          className="bg-transparent border-none outline-none w-full font-body-large text-on-surface placeholder:text-outline"
        />
        <span className="font-label-mono text-[9px] border border-outline-variant px-1.5 py-0.5 rounded opacity-50 uppercase shrink-0">⌘K</span>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-outline-variant/30 border border-outline-variant/30">
        <Stat label="Queued for review" value={today.length} />
        <Stat label="Drafts ready" value={counts.drafts} />
        <Stat label="Replies this week" value={counts.replies} />
        <Stat label="Sent this month" value={counts.sent} />
      </div>

      {/* Today queue */}
      <section>
        <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2 gap-3 flex-wrap">
          <h3 className="font-h1-editorial text-h1-editorial">{q.trim() ? `Filtered · ${today.length} match${today.length === 1 ? '' : 'es'}` : 'Today’s Queue'}</h3>
          <button onClick={() => onNavigate('accounts')} className="font-label-mono text-label-mono uppercase tracking-widest text-primary hover:opacity-70 flex items-center gap-1.5">
            All accounts <Icon name="arrow_forward" size={14} />
          </button>
        </div>

        {today.length === 0 ? (
          q.trim() ? (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center">
              <p className="font-body-main text-on-surface-variant">No accounts match “{q.trim()}”.</p>
              <button onClick={() => setQ('')} className="mt-5 border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-5 py-2 hover:bg-surface-container transition-all">Clear filter</button>
            </div>
          ) : (
            <Empty title="No accounts yet" body="Connect an inbox or wait for the signal agent to surface its first batch — usually within an hour." action={['Open integrations', () => onNavigate('integrations')]} />
          )
        ) : (
          <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
            <div className="divide-y divide-[rgba(26,24,22,0.07)]">
              {today.map((l) => (
                <div key={l.id} className="flex items-center px-6 py-5 gap-4 hover:bg-surface-container-low transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-body-main font-medium text-on-surface">{l.target_company}</span>
                      {typeof l.relevance_score === 'number' && (
                        <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">{Math.round(l.relevance_score)} fit</span>
                      )}
                      {l.replied_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">Replied</span>}
                      {l.sent_at && !l.replied_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded">Sent</span>}
                    </div>
                    {l.relevance_reason && <p className="font-body-main text-on-surface-variant truncate mt-1">{l.relevance_reason}</p>}
                  </div>
                  <span className="font-label-mono text-[10px] text-outline shrink-0">{relTime(l.created_at)}</span>
                  <button onClick={() => setSelectedLead(l)} className="border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2 hover:bg-surface-container transition-all shrink-0">Open</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <WhatsWorking />
      <LoopStatusStrip onOpenAgents={() => onNavigate('agents')} />
      <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
    </div>
  )
}

function WhatsWorking() {
  const [cycles, setCycles] = useState<Array<{ id: string; engine: string; summary: string; changes: string[]; cycle_at: string }>>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void fetch('/api/workspace-tuning?limit=8').then(r => r.json()).then(d => {
      if (Array.isArray(d?.cycles)) setCycles(d.cycles)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])
  if (!loaded || cycles.length === 0) return null
  return (
    <section>
      <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2">
        <h3 className="font-h1-editorial text-h1-editorial">What&rsquo;s Working</h3>
        <span className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Reward loop · last {cycles.length} cycles</span>
      </div>
      <div className="space-y-px bg-outline-variant/30 hairline-border">
        {cycles.map((c) => (
          <div key={c.id} className="bg-surface-container-lowest px-stack-md py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-label-mono text-[9px] uppercase tracking-widest text-primary">{c.engine}</span>
              <span className="font-label-mono text-[9px] uppercase text-on-surface-variant">{relTime(c.cycle_at)}</span>
            </div>
            <p className="font-body-main text-on-surface">{c.summary}</p>
            {c.changes?.length ? <ul className="mt-1 space-y-0.5">{c.changes.slice(0, 5).map((ch, i) => <li key={i} className="font-body-main text-[12px] text-on-surface-variant">· {ch}</li>)}</ul> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function LoopStatusStrip({ onOpenAgents }: { onOpenAgents: () => void }) {
  const [agents, setAgents] = useState<Array<{ role: string; status: string; lastHeartbeat: string | null }>>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void fetch('/api/a2a/agents').then(r => r.json()).then(d => {
      const xs = Array.isArray(d?.agents) ? d.agents : []
      setAgents(xs.slice(0, 4).map((a: { role?: string; health?: { status?: string; lastHeartbeat?: string | null } }) => ({
        role: String(a.role ?? '—'),
        status: String(a.health?.status ?? 'idle'),
        lastHeartbeat: a.health?.lastHeartbeat ?? null,
      })))
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  return (
    <section>
      <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2">
        <h3 className="font-h1-editorial text-h1-editorial">The Loop, Right Now</h3>
        <button onClick={onOpenAgents} className="font-label-mono text-label-mono uppercase tracking-widest text-primary hover:opacity-70 flex items-center gap-1.5">
          Agent fleet <Icon name="arrow_forward" size={14} />
        </button>
      </div>
      {!loaded ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="hairline-border rounded-lg px-4 py-3"><div className="h-9 animate-pulse bg-surface-container-high rounded" /></div>)}
        </div>
      ) : agents.length === 0 ? (
        <div className="hairline-border rounded-lg p-6 text-center font-body-main text-on-surface-variant">
          Agent fleet is warming up. Open <button onClick={onOpenAgents} className="text-primary underline">Fleet</button> to see live status.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {agents.map((a) => (
            <div key={a.role} className="hairline-border bg-surface-container-lowest rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`agent-status-dot ${a.status === 'running' ? 'bg-tertiary' : a.status === 'degraded' ? 'bg-secondary' : 'bg-outline-variant'}`} />
                <span className="font-label-mono text-label-mono uppercase text-on-surface">{a.role}-agent</span>
              </div>
              <div className="font-label-mono text-[10px] text-on-surface-variant mt-1.5 uppercase">{a.lastHeartbeat ? `last ${relTime(a.lastHeartbeat)}` : a.status}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-container-lowest px-5 py-4">
      <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</div>
      <div className="font-display-sm text-display-sm text-on-surface mt-1">{value}</div>
    </div>
  )
}

function Empty({ title, body, action }: { title: string; body: string; action?: [string, () => void] }) {
  return (
    <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center">
      <h4 className="font-h1-editorial text-2xl text-on-surface">{title}</h4>
      <p className="font-body-main text-on-surface-variant mt-2 max-w-md mx-auto">{body}</p>
      {action && (
        <button onClick={action[1]} className="mt-6 bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] px-6 py-2.5 hover:bg-primary-container transition-colors">{action[0]}</button>
      )}
    </div>
  )
}

function relTime(iso?: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.round(ms / 60_000); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
