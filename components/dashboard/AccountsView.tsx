'use client'

import { useState, useEffect } from 'react'
import type { AccountMemoryListItem, AccountStateSnapshot } from './types'
import { TabLoadingState, EmptyState, formatShortDate } from './shared'

export default function AccountsView() {
  const [accounts, setAccounts] = useState<AccountMemoryListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accountState, setAccountState] = useState<AccountStateSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/accounts?limit=50', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as { accounts?: AccountMemoryListItem[]; error?: string } | null
        if (cancelled) return
        if (!res.ok || !data) {
          setError(data?.error ?? 'Unable to load accounts.')
          setLoaded(true)
          return
        }
        const next = data.accounts ?? []
        setAccounts(next)
        setSelectedId(next[0]?.id ?? null)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) { setError('Unable to load accounts.'); setLoaded(true) }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    fetch(`/api/gtm/accounts/${selectedId}/state`, { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (AccountStateSnapshot & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) { setError(data?.error ?? 'Unable to load account state.'); return }
        setAccountState(data)
      })
      .catch(() => { if (!cancelled) setError('Unable to load account state.') })
    return () => { cancelled = true }
  }, [selectedId])

  if (!loaded) return <TabLoadingState title="Loading Accounts" detail="Building account context and next actions." />
  if (error && accounts.length === 0) return <EmptyState title="Error" body={error} />

  const filtered = accounts.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.domain ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)] h-[calc(100vh-7rem)] min-h-[520px]">
      {/* Left: Account list */}
      <section className="card overflow-hidden flex flex-col h-full shadow-sm">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4 bg-[var(--color-ink-2)]/30 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Account Agents</h2>
              <p className="mt-1 text-xs text-[var(--color-text-4)]">{accounts.length} accounts in memory</p>
            </div>
          </div>
          <div className="relative mt-3">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[var(--color-line-2)] bg-white text-[12.5px] text-[var(--color-text-1)] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <EmptyState title="No accounts found" body="Try a different search term." />
          ) : filtered.map(account => (
            <button
              key={account.id}
              onClick={() => setSelectedId(account.id)}
              className={`group w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
                selectedId === account.id
                  ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)] shadow-sm'
                  : 'border-transparent bg-white hover:border-[var(--color-line-1)] hover:bg-[var(--color-ink-2)] hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[var(--color-text-1)]">{account.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{account.domain ?? account.lifecycle_stage}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-4)] border border-[var(--color-line-1)]">
                  {formatShortDate(account.last_seen_at)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full px-2 py-0.5 text-[10px] text-[var(--color-text-4)] bg-white border border-[var(--color-line-1)]">{account.counts.signals} signals</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] text-[var(--color-text-4)] bg-white border border-[var(--color-line-1)]">{account.counts.memories} notes</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Right: Account detail */}
      <section className="card h-full overflow-hidden flex flex-col shadow-sm">
        <div className="flex-1 overflow-y-auto">
          {accountState ? (
            <AccountDetail state={accountState} />
          ) : (
            <EmptyState title="Select an account" body="Choose an account to see why it matters and what to do next." />
          )}
        </div>
      </section>
    </div>
  )
}

function AccountDetail({ state }: { state: AccountStateSnapshot }) {
  return (
    <div>
      <div className="border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/40 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-1)]">{state.account.name}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">{state.account.domain ?? 'No domain'} · Updated {formatShortDate(state.account.last_seen_at)}</p>
          </div>
          <span className="rounded-full border border-[var(--color-line-1)] bg-white px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-3)]">{state.account.lifecycle_stage}</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {[
            { label: 'Signals', value: state.state_health.signal_count, icon: <IconRadarSmall /> },
            { label: 'People', value: state.state_health.person_count, icon: <IconPeopleSmall /> },
            { label: 'Touches', value: state.state_health.touchpoint_count, icon: <IconTouchSmall /> },
            { label: 'Context', value: state.state_health.memory_count, icon: <IconMemorySmall /> },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-2.5 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-1.5 text-[var(--color-text-4)]">
                {s.icon}
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{s.label}</p>
              </div>
              <p className="mt-1 text-lg font-bold tracking-tight text-[var(--color-text-1)]">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-6">
        <Section title="Why now" icon={<IconSignal />}>
          {state.signals.length === 0 ? (
            <EmptyState title="No signals" body="No account movement recorded yet." />
          ) : state.signals.slice(0, 8).map(signal => (
            <TimelineItem key={signal.id} title={signal.headline} meta={`${signal.signal_type} · ${formatShortDate(signal.observed_at)}`} body={signal.summary ?? signal.source_name ?? 'Signal captured.'} />
          ))}
        </Section>

        <Section title="Conversation history" icon={<IconChat />}>
          {state.touchpoints.length === 0 ? (
            <EmptyState title="No touchpoints" body="No emails or interactions recorded yet." />
          ) : state.touchpoints.slice(0, 6).map(t => (
            <div key={t.id} className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{t.subject || t.type}</p>
                <span className="text-[10px] text-[var(--color-text-4)] shrink-0">{formatShortDate(t.occurred_at)}</span>
              </div>
              {t.body_preview && <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{t.body_preview}</p>}
            </div>
          ))}
        </Section>

        <Section title="People" icon={<IconPeople />}>
          {state.people.length === 0 ? (
            <EmptyState title="No contacts" body="No people recorded for this account yet." />
          ) : state.people.slice(0, 6).map(person => (
            <div key={person.id} className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[var(--color-accent-bg)] to-[var(--color-ink-3)] flex items-center justify-center text-[10px] font-bold text-[var(--color-accent-ring)] shrink-0">
                  {(person.name ?? person.email ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-[var(--color-text-1)]">{person.name ?? person.email ?? 'Unknown contact'}</p>
                  <p className="truncate text-[11px] text-[var(--color-text-4)]">{person.title ?? 'No title'}{person.verified ? ' · verified' : ''}</p>
                </div>
              </div>
            </div>
          ))}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">
        {icon}
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TimelineItem({ title, meta, body }: { title: string; meta: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3 hover:shadow-sm transition-shadow">
      <p className="line-clamp-1 text-[12.5px] font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-0.5 text-[10.5px] text-[var(--color-text-4)]">{meta}</p>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{body}</p>
    </div>
  )
}

/* Small icons for stats */
function IconRadarSmall() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" strokeOpacity="0.5" /><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /></svg>
}
function IconPeopleSmall() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75" /></svg>
}
function IconTouchSmall() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
}
function IconMemorySmall() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
}

/* Section header icons */
function IconSignal() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
}
function IconChat() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
}
function IconPeople() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75" /></svg>
}
