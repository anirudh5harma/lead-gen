'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { UserProfile } from './types'
import type { SubscriptionTier } from '@/lib/lead-credits'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'

interface Props { profile: UserProfile; userTier: SubscriptionTier }

type AutomationMode = 'research_only' | 'approve_first' | 'autopilot'

/**
 * Settings — minimal, single-column.
 * Profile · ICP · Automation · Billing · Sign out.
 * (Integrations live on their own first-class view.)
 */
export default function SettingsView({ profile }: Props) {
  const router = useRouter()
  const toast = useToast()
  const canUseAutopilot = true   // autopilot available on every plan
  const [mode, setMode] = useState<AutomationMode>(profile.automation_mode ?? 'approve_first')
  const [savingMode, setSavingMode] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)

  async function saveMode(next: AutomationMode) {
    if (next === mode) return
    const previous = mode
    setMode(next)            // optimistic
    setSavingMode(true)
    const res = await fetch('/api/profile/field', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation_mode: next }),
    })
    setSavingMode(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error || 'Could not save automation mode.')
      setMode(previous)      // revert
    }
  }

  async function openBillingPortal() {
    setBillingBusy(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (res.ok && data.url) {
        window.location.assign(data.url)
        return
      }
      toast.error(data.error || 'Could not open billing portal.')
    } catch {
      toast.error('Could not open billing portal.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function signOut() {
    setSessionBusy(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="space-y-12 max-w-3xl">
      <div>
        <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Account</p>
        <h2 className="font-h1-editorial text-display-sm text-on-surface">
          Workspace <span className="italic text-primary">settings</span>.
        </h2>
      </div>

      <Block id="settings-profile" label="01" title="Profile">
        <Row k="Workspace" v={profile.client_name || profile.company_name} />
        <Row k="Email" v={profile.email ?? '—'} />
        <Row k="Website" v={profile.website_url ?? '—'} />
      </Block>

      <Block id="settings-icp" label="02" title="ICP">
        <Row k="Description" v={profile.services_description || '—'} multiline />
        <Row k="Keywords" v={(profile.icp_keywords ?? []).join(' · ') || '—'} />
        <Row k="Industries" v={(profile.target_industries ?? []).join(' · ') || '—'} />
        <div className="pt-2"><Link href="/onboarding" className="text-[12.5px] text-[var(--color-accent)] hover:underline">Edit ICP →</Link></div>
      </Block>

      <Block id="settings-automation" label="03" title="Automation">
        <p className="text-[13px] text-[var(--color-text-3)] mb-4">Choose how much agency you give the fleet. Available on every plan; change it any time.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([
            ['research_only', 'Research only', 'Surface accounts. No drafts, no sends.'],
            ['approve_first', 'Approve first', 'Drafts written, you approve before sending.'],
            ['autopilot', 'Autopilot', 'Drafts and sends automatically with safety checks.'],
          ] as Array<[AutomationMode, string, string]>).map(([id, t, d]) => (
            <button
              key={id}
              onClick={() => void saveMode(id)}
              disabled={savingMode || (id === 'autopilot' && !canUseAutopilot)}
              className={`card text-left p-4 transition-colors disabled:opacity-50 ${
                mode === id ? 'border-[var(--color-text-1)]' : 'hover:border-[var(--color-line-3)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`dot ${mode === id ? 'dot-running' : 'dot-idle'}`} />
                <span className="text-[13.5px] font-medium">{t}</span>
                {id === 'autopilot' && !canUseAutopilot && <span className="pill ml-auto">Growth</span>}
              </div>
              <p className="text-[12.5px] text-[var(--color-text-3)] mt-2">{d}</p>
            </button>
          ))}
        </div>
        {savingMode && <p className="mono mt-3">Saving…</p>}
      </Block>

      <Block id="settings-billing" label="04" title="Billing">
        <Row k="Plan" v={<span className="capitalize">{profile.plan ?? 'free'}</span>} />
        <Row k="Credits" v={String(profile.lead_credit_balance ?? 0)} />
        <Row k="Used this month" v={String(profile.leads_used_this_month ?? 0)} />
        <div className="pt-3 flex items-center gap-2">
          <Link href="/pricing" className="btn-accent h-8 px-4 text-[12.5px] inline-flex items-center">Manage plan</Link>
          <button onClick={() => void openBillingPortal()} disabled={billingBusy} className="btn-ghost h-8 px-4 text-[12.5px] disabled:opacity-50">
            {billingBusy ? 'Opening...' : 'Billing portal'}
          </button>
        </div>
      </Block>

      <Block id="settings-credits" label="05" title="Credits & outcomes">
        <CreditLedger />
      </Block>

      <Block id="settings-session" label="06" title="Session">
        <button onClick={() => void signOut()} disabled={sessionBusy} className="btn-ghost h-8 px-4 text-[12.5px] disabled:opacity-50">
          {sessionBusy ? 'Signing out...' : 'Sign out'}
        </button>
      </Block>
    </div>
  )
}

function CreditLedger() {
  const [data, setData] = useState<{ balance: number; monthlyGrant: number; entries: Array<{ id: string; direction: string; event_type: string; units: number; balance_after: number | null; note: string | null; created_at: string }> } | null>(null)
  useEffect(() => { void fetch('/api/credit-ledger?limit=20').then(r => r.json()).then(setData).catch(() => setData(null)) }, [])
  if (!data) return <p className="mono">Loading…</p>
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[var(--color-text-3)]">
        Plan price covers features. Variable usage is charged in credits on <em>outcomes</em> — a positive reply, a booked meeting, a published post (and a bonus when it performs) — plus hard third-party costs (verified contacts). Drafting, ideas, and research-only runs are free.
      </p>
      <div className="flex items-center gap-6">
        <div><div className="mono">Balance</div><div className="text-[18px] text-[var(--color-text-1)]">{data.balance}</div></div>
        <div><div className="mono">Monthly grant</div><div className="text-[18px] text-[var(--color-text-1)]">{data.monthlyGrant}</div></div>
      </div>
      {data.entries.length === 0 ? (
        <p className="text-[12.5px] text-[var(--color-text-3)]">No ledger activity yet.</p>
      ) : (
        <div className="border-t border-[var(--color-line-1)]">
          {data.entries.map((e) => (
            <div key={e.id} className="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline border-b border-[var(--color-line-1)] py-2">
              <span className="text-[12.5px] text-[var(--color-text-1)]">{e.event_type.replace(/_/g, ' ')}{e.note ? ` — ${e.note}` : ''}</span>
              <span className={`mono ${e.direction === 'grant' ? 'text-[var(--color-pos,#2a7)]' : 'text-[var(--color-text-3)]'}`}>{e.direction === 'grant' ? '+' : '−'}{e.units}</span>
              <span className="mono">{fmtDate(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '—' }
}

function Block({ id, label, title, children }: { id?: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-[var(--color-line-1)] pt-8">
      <div className="grid grid-cols-[60px_1fr] gap-6">
        <div className="mono pt-1">{label}</div>
        <div>
          <h3 className="text-[18px] leading-tight font-semibold mb-5 text-[var(--color-text-1)]">{title}</h3>
          <div className="space-y-3">{children}</div>
        </div>
      </div>
    </section>
  )
}

function Row({ k, v, multiline }: { k: string; v: React.ReactNode; multiline?: boolean }) {
  return (
    <div className={`grid ${multiline ? 'grid-cols-1 md:grid-cols-[160px_1fr]' : 'grid-cols-[160px_1fr]'} gap-3 items-baseline border-b border-[var(--color-line-1)] pb-3`}>
      <span className="mono">{k}</span>
      <span className="text-[13.5px] text-[var(--color-text-1)] break-words">{v}</span>
    </div>
  )
}
