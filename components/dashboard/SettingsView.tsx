'use client'

import Link from 'next/link'
import { useState, useCallback, useEffect, useRef } from 'react'
import { MAX_CONNECTED_SENDING_ACCOUNTS } from '@/lib/oauth/connected-accounts'
import WatchlistManager from '@/components/WatchlistManager'
import type { UserProfile, ConnectedAccount, BlockedCompany } from './types'
import { SectionHeader } from './shared'

interface Props {
  profile: UserProfile
}

const CREDIT_TOP_UPS = [
  { amount: 5, credits: 20 },
  { amount: 20, credits: 80 },
  { amount: 50, credits: 200 },
  { amount: 100, credits: 400 },
]

export default function SettingsView({ profile }: Props) {
  return (
    <div className="w-full space-y-6">
      {/* Workspace */}
      <div className="space-y-1">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          Workspace
        </h2>
        <div className="space-y-4">
          <CreditsPanel balance={profile.lead_credit_balance ?? 0} />
          <TargetingPanel profile={profile} />
          <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
            <SectionHeader title="Watched Accounts" subtitle="Companies to keep in memory and boost." />
            <div className="px-5 py-4"><WatchlistManager /></div>
          </div>
          <BlockedCompaniesPanel />
        </div>
      </div>

      {/* Outreach */}
      <div className="space-y-1">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Outreach
        </h2>
        <div className="space-y-4">
          <ConnectedAccountsPanel />
        </div>
      </div>

      {/* Integrations */}
      <div className="space-y-1">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Integrations
        </h2>
        <div className="space-y-4">
          <SlackPanel profile={profile} />
        </div>
      </div>
    </div>
  )
}

function CreditsPanel({ balance }: { balance: number }) {
  const [selectedIndex, setSelectedIndex] = useState(1)
  const [checkoutAmount, setCheckoutAmount] = useState<number | null>(null)
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null)
  const selected = CREDIT_TOP_UPS[selectedIndex] ?? CREDIT_TOP_UPS[1]

  const startCheckout = useCallback(async (amountDollars: number) => {
    setCheckoutAmount(amountDollars)
    setCheckoutMsg(null)
    try {
      const res = await fetch('/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_dollars: amountDollars }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) { setCheckoutMsg(data?.error ?? 'Unable to start checkout.'); return }
      window.location.assign(data.url)
    } catch { setCheckoutMsg('Unable to start checkout.') }
    finally { setCheckoutAmount(null) }
  }, [])

  return (
    <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between bg-[var(--color-ink-2)]/30">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Credits</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Pay-as-you-go. 1 credit = 1 lead unlock.</p>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] text-[var(--color-accent-ring)]">PAYG</span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-1)]">Add lead credits</p>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">New workspaces start with 20 credits. Each $1 adds 4 lead unlocks.</p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--color-accent-ring)]">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {balance} credits
          </span>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--color-line-1)] bg-white px-4 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Top up</p><p className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text-1)]">${selected.amount}</p></div>
            <div className="text-right"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Unlocks</p><p className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-accent-ring)]">{selected.credits}</p></div>
          </div>
          <input type="range" min={0} max={CREDIT_TOP_UPS.length - 1} step={1} value={selectedIndex} onChange={e => setSelectedIndex(Number(e.target.value))} className="mt-4 w-full accent-[var(--color-accent)]" aria-label="Credit top up amount" />
          <div className="mt-2 grid grid-cols-4 gap-2">
            {CREDIT_TOP_UPS.map((opt, i) => (
              <button key={opt.amount} type="button" onClick={() => setSelectedIndex(i)} className={`rounded-xl border px-2 py-2 text-left transition-all duration-200 ${selectedIndex === i ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] shadow-sm' : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40 hover:shadow-sm'}`}>
                <span className="block text-[11.5px] font-semibold text-[var(--color-text-1)]">${opt.amount}</span>
                <span className="block text-[10.5px] text-[var(--color-text-4)]">{opt.credits}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-[var(--color-text-4)]">Checkout opens securely.</p>
            <button onClick={() => startCheckout(selected.amount)} disabled={checkoutAmount !== null} className="inline-flex items-center gap-1.5 rounded-full btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {checkoutAmount !== null ? 'Starting…' : 'Top Up'}
            </button>
          </div>
        </div>
        {checkoutMsg && <p className="mt-2 text-[11px] text-[var(--color-sig-regulation)]">{checkoutMsg}</p>}
      </div>
    </div>
  )
}

function TargetingPanel({ profile }: { profile: UserProfile }) {
  return (
    <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
      <SectionHeader title="Targeting" subtitle="The ICP and offer Bombsell uses to judge account fit." />
      <div className="divide-y divide-[var(--color-line-1)]">
        <Row label="Company">{profile.company_name || '—'}</Row>
        <Row label="Workspace">{profile.client_name || profile.company_name || '—'}</Row>
        <Row label="Website">{profile.website_url || '—'}</Row>
        <Row label="What you sell"><span className="text-[var(--color-text-2)] leading-relaxed">{profile.services_description || '—'}</span></Row>
        <Row label="ICP keywords">
          <div className="flex flex-wrap gap-1.5">
            {(profile.icp_keywords ?? []).length === 0 ? <span className="text-[var(--color-text-4)]">—</span> :
              (profile.icp_keywords ?? []).map(k => <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-ink-2)] border border-[var(--color-line-1)] text-[var(--color-text-2)]">{k}</span>)}
          </div>
        </Row>
      </div>
      <div className="px-5 py-4">
        <Link href="/onboarding" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full btn-primary transition-colors hover:scale-[1.02] active:scale-[0.98]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Edit targeting
        </Link>
      </div>
    </div>
  )
}

function ConnectedAccountsPanel() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [loaded, setLoaded] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeAccounts = accounts.filter(a => a.is_active)
  const limitReached = activeAccounts.length >= MAX_CONNECTED_SENDING_ACCOUNTS
  const enableGmail = process.env.NEXT_PUBLIC_ENABLE_GMAIL_CONNECT === 'true'

  useEffect(() => {
    fetch('/api/connected-accounts', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ accounts?: ConnectedAccount[] }>)
      .then(d => { setAccounts(d.accounts ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('ca_connected')
    const error = params.get('ca_error')
    if (connected) showBanner('ok', `${connected} connected successfully.`)
    else if (error) {
      const msgs: Record<string, string> = { google_denied: 'Google sign-in was cancelled.', microsoft_denied: 'Microsoft sign-in was cancelled.', max_accounts: `You can connect up to ${MAX_CONNECTED_SENDING_ACCOUNTS} inboxes.` }
      showBanner('err', msgs[error] ?? 'Connection failed.')
    }
  }, [])

  function showBanner(type: 'ok' | 'err', msg: string) {
    setBanner({ type, msg })
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 5000)
  }

  const remove = useCallback(async (id: string) => {
    setRemoving(id)
    try {
      await fetch('/api/connected-accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      setAccounts(prev => prev.filter(a => a.id !== id))
    } finally { setRemoving(null) }
  }, [])

  return (
    <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
      <SectionHeader title="Sending Accounts" subtitle="Emails send from your own inbox. Multiple accounts rotate automatically." />
      {banner && <div className={`px-5 py-2.5 text-xs ${banner.type === 'ok' ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : 'bg-red-50 text-red-600'}`}>{banner.msg}</div>}
      {loaded && accounts.length > 0 && (
        <ul className="divide-y divide-[var(--color-line-1)]">
          {accounts.map(a => (
            <li key={a.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--color-ink-2)]/30 transition-colors">
              <div className="min-w-0 flex items-center gap-2.5">
                {a.provider === 'gmail' ? (
                  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-ink-2)] border border-[var(--color-line-1)] text-[var(--color-text-3)]">{a.provider}</span>
                    <span className="text-xs text-[var(--color-text-1)] truncate">{a.display_name ? `${a.display_name} · ${a.email}` : a.email}</span>
                  </div>
                  <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">{a.is_active ? 'Active' : 'Inactive'}{a.last_used_at ? ` · Last used ${new Date(a.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · Not used yet'}</p>
                </div>
              </div>
              <button onClick={() => remove(a.id)} disabled={removing === a.id} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] disabled:opacity-50 transition-colors shrink-0">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                {removing === a.id ? 'Removing…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {loaded && accounts.length === 0 && <div className="px-5 py-4 text-xs text-[var(--color-text-4)]">No sending inboxes connected.</div>}
      <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
        {limitReached && <span className="text-[11px] text-[var(--color-text-4)]">Disconnect an inbox before adding another.</span>}
        {enableGmail && !limitReached && (
          <a href="/api/auth/google-mail" className="inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-full btn-ghost transition-colors hover:scale-[1.02] active:scale-[0.98]">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Connect Gmail
          </a>
        )}
        {!limitReached && (
          <a href="/api/auth/microsoft-mail" className="inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-full btn-ghost transition-colors hover:scale-[1.02] active:scale-[0.98]">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>
            Connect Outlook
          </a>
        )}
      </div>
    </div>
  )
}

function SlackPanel({ profile }: { profile: UserProfile }) {
  const [url, setUrl] = useState(profile.slack_webhook_url ?? '')
  const [minScore, setMinScore] = useState(profile.slack_min_score ?? 7)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/settings/slack-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slack_webhook_url: url || null, slack_min_score: minScore }),
      })
      if (!res.ok) { setMsg('Failed to save.'); return }
      setMsg('Saved.')
    } catch { setMsg('Failed to save.') }
    finally { setSaving(false) }
  }

  return (
    <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
      <SectionHeader title="Slack Alerts" subtitle="Get notified when a high-quality lead is ready for review." />
      <div className="px-5 py-4 space-y-3">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--color-text-1)]">Webhook URL</span>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--color-text-1)]">Minimum score</span>
          <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] focus:border-[var(--color-accent)]/40 focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(s => <option key={s} value={s}>{s}+</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--color-text-4)]">{msg ?? ''}</span>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BlockedCompaniesPanel() {
  const [blocked, setBlocked] = useState<BlockedCompany[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await fetch('/api/blocked-companies'); const data = await res.json() as { blocked?: BlockedCompany[] }; setBlocked(data.blocked ?? []) }
    finally { setLoading(false) }
  }, [])

  const unblock = useCallback(async (id: string) => {
    await fetch(`/api/blocked-companies/${id}`, { method: 'DELETE' })
    setBlocked(prev => prev?.filter(b => b.id !== id) ?? [])
  }, [])

  return (
    <div className="card divide-y divide-[var(--color-line-1)] shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between bg-[var(--color-ink-2)]/30">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Blocked Companies</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">No signals from these companies will appear in your feed.</p>
        </div>
        {blocked === null && <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 text-xs text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:opacity-50 transition-colors">{loading ? 'Loading…' : 'Show'}</button>}
      </div>
      {blocked !== null && (blocked.length === 0 ? <div className="px-5 py-4 text-xs text-[var(--color-text-4)]">No companies blocked.</div> : (
        <ul className="divide-y divide-[var(--color-line-1)]">
          {blocked.map(b => (
            <li key={b.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--color-ink-2)]/30 transition-colors">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-[var(--color-text-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <div>
                  <span className="text-xs text-[var(--color-text-1)]">{b.company_name}</span>
                  {b.company_domain && <span className="ml-2 text-[10px] text-[var(--color-text-4)]">{b.company_domain}</span>}
                </div>
              </div>
              <button onClick={() => unblock(b.id)} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] transition-colors shrink-0">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                Unblock
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3 text-xs">
      <dt className="text-[10px] uppercase tracking-widest text-[var(--color-text-4)] pt-0.5 font-semibold">{label}</dt>
      <dd className="text-[var(--color-text-1)]">{children}</dd>
    </div>
  )
}
