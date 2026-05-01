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
    <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <section className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Account Agents</h2>
              <p className="mt-1 text-xs text-[var(--color-text-4)]">{accounts.length} accounts in memory</p>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="mt-3 w-full h-9 px-3 rounded-lg border border-[var(--color-line-2)] bg-white text-[12.5px] text-[var(--color-text-1)]"
          />
        </div>
        <div className="space-y-1 p-2">
          {filtered.length === 0 ? (
            <EmptyState title="No accounts found" body="Try a different search term." />
          ) : filtered.map(account => (
            <button
              key={account.id}
              onClick={() => setSelectedId(account.id)}
              className={`group w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                selectedId === account.id
                  ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)]'
                  : 'border-transparent bg-white hover:border-[var(--color-line-1)] hover:bg-[var(--color-ink-2)]'
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

      <section className="card min-h-[520px] overflow-hidden">
        {accountState ? (
          <AccountDetail state={accountState} />
        ) : (
          <EmptyState title="Select an account" body="Choose an account to see why it matters and what to do next." />
        )}
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
            { label: 'Signals', value: state.state_health.signal_count },
            { label: 'People', value: state.state_health.person_count },
            { label: 'Touches', value: state.state_health.touchpoint_count },
            { label: 'Context', value: state.state_health.memory_count },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-2.5">
              <p className="text-lg font-bold tracking-tight text-[var(--color-text-1)]">{s.value}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-6">
        <Section title="Why now">
          {state.signals.length === 0 ? (
            <EmptyState title="No signals" body="No account movement recorded yet." />
          ) : state.signals.slice(0, 8).map(signal => (
            <TimelineItem key={signal.id} title={signal.headline} meta={`${signal.signal_type} · ${formatShortDate(signal.observed_at)}`} body={signal.summary ?? signal.source_name ?? 'Signal captured.'} />
          ))}
        </Section>

        <Section title="Conversation history">
          {state.touchpoints.length === 0 ? (
            <EmptyState title="No touchpoints" body="No emails or interactions recorded yet." />
          ) : state.touchpoints.slice(0, 6).map(t => (
            <div key={t.id} className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{t.subject || t.type}</p>
                <span className="text-[10px] text-[var(--color-text-4)]">{formatShortDate(t.occurred_at)}</span>
              </div>
              {t.body_preview && <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{t.body_preview}</p>}
            </div>
          ))}
        </Section>

        <Section title="People">
          {state.people.length === 0 ? (
            <EmptyState title="No contacts" body="No people recorded for this account yet." />
          ) : state.people.slice(0, 6).map(person => (
            <div key={person.id} className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3">
              <p className="truncate text-[12.5px] font-semibold text-[var(--color-text-1)]">{person.name ?? person.email ?? 'Unknown contact'}</p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{person.title ?? 'No title'}{person.verified ? ' · verified' : ''}</p>
            </div>
          ))}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TimelineItem({ title, meta, body }: { title: string; meta: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="line-clamp-1 text-[12.5px] font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-0.5 text-[10.5px] text-[var(--color-text-4)]">{meta}</p>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{body}</p>
    </div>
  )
}
