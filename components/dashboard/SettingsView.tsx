'use client'

import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'
import { getMaxInboxesForTier } from '@/lib/oauth/connected-accounts'
import WatchlistManager from '@/components/WatchlistManager'
import type { UserProfile, ConnectedAccount, BlockedCompany } from './types'
import { SectionHeader } from './shared'
import SpotlightCard from '@/components/landing/SpotlightCard'
import { getTierConfig, type SubscriptionTier } from '@/lib/lead-credits'
import { hasPlanAccess } from '@/lib/plan-access'
import PlanGate from '@/components/PlanGate'

interface Props {
  profile: UserProfile
}

const PAYG_PACKS = [
  { amount: 20, credits: 25 },
  { amount: 50, credits: 75 },
  { amount: 100, credits: 200 },
]

export default function SettingsView({ profile }: Props) {
  return (
    <div className="w-full space-y-8">
      {/* Workspace */}
      <section>
        <SectionHeader
          title="Workspace"
          subtitle="Company profile, targeting, and account preferences."
          label="Settings"
        />
        <div className="space-y-5">
          <SubscriptionPanel profile={profile} />
          <PlanGate userTier={(profile.plan as SubscriptionTier) || 'free'} requiredTier="scale" featureName="Team features">
            <TeamPanel profile={profile} />
          </PlanGate>
          <TargetingPanel profile={profile} />
          <WatchlistPanel />
          <BlockedCompaniesPanel />
        </div>
      </section>

      {/* Outreach */}
      <section>
        <SectionHeader
          title="Outreach"
          subtitle="Connected sending inboxes and delivery settings."
          label="Channels"
        />
        <ConnectedAccountsPanel profile={profile} />
      </section>

      {/* Integrations */}
      <section>
        <SectionHeader
          title="Integrations"
          subtitle="Connect external tools for notifications and alerts."
          label="Connect"
        />
        <PlanGate userTier={(profile.plan as SubscriptionTier) || 'free'} requiredTier="scale" featureName="Slack alerts & CRM sync">
          <SlackPanel profile={profile} />
        </PlanGate>
      </section>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Subscription + Credits
   ───────────────────────────────────────────── */
function SubscriptionPanel({ profile }: { profile: UserProfile }) {
  const tier = (profile.plan as SubscriptionTier) || 'free'
  const config = getTierConfig(tier)
  const leadsUsed = profile.leads_used_this_month ?? 0
  const includedLeads = config.includedLeads
  const remainingIncluded = Math.max(0, includedLeads - leadsUsed)
  const creditBalance = profile.lead_credit_balance ?? 0
  const isSubscribed = profile.subscription_status === 'active' && tier !== 'free'
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null)

  const startSubscriptionCheckout = useCallback(async (selectedTier: 'growth' | 'scale', period: 'monthly' | 'annual') => {
    setCheckoutLoading(`${selectedTier}-${period}`)
    setCheckoutMsg(null)
    try {
      const res = await fetch('/api/billing/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier, period }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) { setCheckoutMsg(data?.error ?? 'Unable to start checkout.'); return }
      window.location.assign(data.url)
    } catch { setCheckoutMsg('Unable to start checkout.') }
    finally { setCheckoutLoading(null) }
  }, [])

  const startCreditCheckout = useCallback(async (amountDollars: number) => {
    setCheckoutLoading(`credit-${amountDollars}`)
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
    finally { setCheckoutLoading(null) }
  }, [])

  return (
    <SpotlightCard className="card divide-y divide-[var(--color-line-1)] overflow-hidden card-hover">
      <div className="px-5 py-4 flex items-center justify-between bg-[var(--color-ink-2)]/30">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Plan & Credits</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            {isSubscribed
              ? `${config.name} plan — ${remainingIncluded} of ${includedLeads} included leads remaining this month`
              : `Pay-as-you-go — ${creditBalance} credits available`}
          </p>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
          isSubscribed
            ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
            : 'border-[var(--color-line-2)] bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
        }`}>
          {isSubscribed ? config.name.toUpperCase() : 'PAYG'}
        </span>
      </div>

      {/* Subscription usage bar */}
      {isSubscribed && (
        <div className="px-5 py-4">
          <div className="flex items-center justify-between text-[11px] text-[var(--color-text-3)] mb-1.5">
            <span>Monthly usage</span>
            <span>{leadsUsed} / {includedLeads} leads</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${Math.min(100, (leadsUsed / Math.max(1, includedLeads)) * 100)}%` }}
            />
          </div>
          {remainingIncluded === 0 && (
            <p className="mt-2 text-[11px] text-[var(--color-sig-regulation)]">
              You have used all included leads this month. Additional unlocks will consume PAYG credits at ${config.overageRate}/lead.
            </p>
          )}
        </div>
      )}

      {/* PAYG credits */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-1)]">PAYG credits</p>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              {isSubscribed
                ? 'Backup credits for when you exceed your monthly included leads.'
                : 'Buy credits to unlock leads. Credits never expire.'}
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--color-accent-ring)]">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {creditBalance} credits
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {PAYG_PACKS.map(pack => (
            <button
              key={pack.amount}
              type="button"
              onClick={() => startCreditCheckout(pack.amount)}
              disabled={checkoutLoading === `credit-${pack.amount}`}
              className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-2.5 text-left transition-all hover:border-[var(--color-accent)]/40 hover:shadow-sm disabled:opacity-50"
            >
              <span className="block text-[11.5px] font-semibold text-[var(--color-text-1)]">${pack.amount}</span>
              <span className="block text-[10.5px] text-[var(--color-text-4)]">{pack.credits} unlocks</span>
            </button>
          ))}
        </div>
      </div>

      {/* Change plan */}
      <div className="px-5 py-4">
        <p className="text-xs font-semibold text-[var(--color-text-1)] mb-3">Change plan</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button
            onClick={() => startSubscriptionCheckout('growth', 'monthly')}
            disabled={checkoutLoading === 'growth-monthly'}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-sm disabled:opacity-50 ${
              tier === 'growth' ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)]' : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40'
            }`}
          >
            <span className="block text-[11.5px] font-semibold text-[var(--color-text-1)]">Growth — $49/mo</span>
            <span className="block text-[10.5px] text-[var(--color-text-4)]">60 leads/mo · 3 inboxes</span>
          </button>
          <button
            onClick={() => startSubscriptionCheckout('scale', 'monthly')}
            disabled={checkoutLoading === 'scale-monthly'}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-sm disabled:opacity-50 ${
              tier === 'scale' ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)]' : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40'
            }`}
          >
            <span className="block text-[11.5px] font-semibold text-[var(--color-text-1)]">Scale — $99/mo</span>
            <span className="block text-[10.5px] text-[var(--color-text-4)]">200 leads/mo · 10 inboxes</span>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Link href="/pricing" className="text-[11px] text-[var(--color-accent-ring)] hover:underline">
            View all plans and annual billing →
          </Link>
          {profile.subscription_renews_at && (
            <span className="text-[11px] text-[var(--color-text-4)]">
              Renews {new Date(profile.subscription_renews_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {checkoutMsg && <p className="px-5 pb-4 text-[11px] text-[var(--color-sig-regulation)]">{checkoutMsg}</p>}
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Team
   ───────────────────────────────────────────── */
interface Member {
  id: string
  client_id: string
  user_id: string | null
  role: 'owner' | 'admin' | 'member'
  invited_email: string
  invited_at: string
  accepted_at: string | null
  name?: string | null
}

interface ActivityItem {
  id: string
  action_type: string
  entity_type: string | null
  entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  user_name?: string | null
}

function TeamPanel({ profile }: { profile: UserProfile }) {
  const clientId = profile.active_client_id
  const [members, setMembers] = useState<Member[] | null>(null)
  const [activities, setActivities] = useState<ActivityItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [removeLoading, setRemoveLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const [membersRes, activityRes] = await Promise.all([
        fetch(`/api/team/members?client_id=${encodeURIComponent(clientId)}`),
        fetch(`/api/team/activity?client_id=${encodeURIComponent(clientId)}&limit=20`),
      ])
      const membersData = await membersRes.json().catch(() => ({ members: [] })) as { members: Member[] }
      const activityData = await activityRes.json().catch(() => ({ activities: [] })) as { activities: ActivityItem[] }
      setMembers(membersData.members ?? [])
      setActivities(activityData.activities ?? [])
    } catch {
      setMembers([])
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const sendInvite = useCallback(async () => {
    if (!clientId || !inviteEmail.trim()) return
    setInviteLoading(true)
    setInviteMsg(null)
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null
      if (!res.ok || !data?.ok) {
        setInviteMsg(data?.error ?? 'Failed to send invite.')
      } else {
        setInviteMsg(data.message ?? 'Invite sent.')
        setInviteEmail('')
        load()
      }
    } catch {
      setInviteMsg('Failed to send invite.')
    } finally {
      setInviteLoading(false)
    }
  }, [clientId, inviteEmail, inviteRole, load])

  const removeMember = useCallback(async (memberId: string) => {
    if (!clientId) return
    setRemoveLoading(memberId)
    try {
      const res = await fetch('/api/team/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, member_id: memberId }),
      })
      if (res.ok) {
        setMembers(prev => prev?.filter(m => m.id !== memberId) ?? [])
      }
    } catch {
      // ignore
    } finally {
      setRemoveLoading(null)
    }
  }, [clientId])

  const isOwner = members?.some(m => m.user_id && m.role === 'owner')
  const canManage = isOwner || members?.some(m => m.user_id && m.role === 'admin')

  function activityLabel(action: string): string {
    const labels: Record<string, string> = {
      member_joined: 'joined the workspace',
      member_removed: 'removed a member',
      lead_unlocked: 'unlocked a lead',
      lead_assigned: 'assigned a lead',
      email_sent: 'sent an email',
      reply_received: 'received a reply',
      meeting_booked: 'booked a meeting',
      outreach_drafted: 'drafted outreach',
      sequence_created: 'created a sequence',
      explore_run: 'ran explore',
      source_added: 'added a source',
    }
    return labels[action] ?? action.replace(/_/g, ' ')
  }

  return (
    <div className="space-y-5">
      {/* Members Card */}
      <SpotlightCard className="card overflow-hidden card-hover">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Collaboration</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Team</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">Invite team members and manage workspace access.</p>
        </div>

        {/* Invite */}
        {canManage && (
          <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                onKeyDown={e => { if (e.key === 'Enter') sendInvite() }}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                className="text-[12px] px-2 py-2 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] text-[var(--color-text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={sendInvite}
                disabled={inviteLoading || !inviteEmail.trim()}
                className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-full btn-primary transition-colors disabled:opacity-50"
              >
                {inviteLoading ? 'Sending…' : 'Invite'}
              </button>
            </div>
            {inviteMsg && (
              <p className={`mt-2 text-[11px] ${inviteMsg.includes('sent') ? 'text-[var(--color-pillar-accuracy)]' : 'text-[var(--color-pillar-quality)]'}`}>{inviteMsg}</p>
            )}
          </div>
        )}

        {/* Members */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
              <span className="w-3.5 h-3.5 border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)] rounded-full animate-spin" />
              Loading…
            </div>
          ) : members && members.length > 0 ? (
            <ul className="space-y-2">
              {members.map(member => (
                <li key={member.id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--color-accent-hi)] to-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {(member.name || member.invited_email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-[var(--color-text-1)] truncate">{member.name || member.invited_email}</p>
                      <p className="text-[10.5px] text-[var(--color-text-3)] truncate">
                        {member.invited_email}
                        {member.role !== 'member' && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--color-ink-2)] border border-[var(--color-line-1)] text-[10px] font-medium uppercase">
                            {member.role}
                          </span>
                        )}
                        {!member.accepted_at && (
                          <span className="ml-1.5 text-[var(--color-pillar-timing)] text-[10px]">Pending</span>
                        )}
                      </p>
                    </div>
                  </div>
                  {canManage && member.role !== 'owner' && (
                    <button
                      onClick={() => removeMember(member.id)}
                      disabled={removeLoading === member.id}
                      className="text-[11px] text-[var(--color-text-4)] hover:text-[var(--color-pillar-quality)] disabled:opacity-50 shrink-0 transition-colors"
                    >
                      {removeLoading === member.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--color-text-3)]">No team members yet.</p>
          )}
        </div>
      </SpotlightCard>

      {/* Activity Card */}
      <SpotlightCard className="card overflow-hidden card-hover">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Log</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Workspace Activity</h3>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
              <span className="w-3.5 h-3.5 border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)] rounded-full animate-spin" />
              Loading…
            </div>
          ) : activities && activities.length > 0 ? (
            <ul className="space-y-3">
              {activities.map(activity => (
                <li key={activity.id} className="flex items-start gap-3">
                  <div className="mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--color-line-3)]" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-[var(--color-text-2)]">
                      <span className="font-medium text-[var(--color-text-1)]">{activity.user_name || 'Team member'}</span>{' '}
                      {activityLabel(activity.action_type)}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-[var(--color-text-4)]">
                      {new Date(activity.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {activity.entity_type && <span className="ml-2 text-[var(--color-text-3)]">{activity.entity_type}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--color-text-3)]">No recent activity.</p>
          )}
        </div>
      </SpotlightCard>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Targeting
   ───────────────────────────────────────────── */
function TargetingPanel({ profile }: { profile: UserProfile }) {
  return (
    <SpotlightCard className="card overflow-hidden card-hover">
      <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Profile</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Targeting</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">The ICP and offer Bombsell uses to judge account fit.</p>
      </div>
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
      <div className="px-5 py-4 border-t border-[var(--color-line-1)]">
        <Link href="/onboarding" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full btn-primary transition-colors hover:scale-[1.02] active:scale-[0.98]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Edit targeting
        </Link>
      </div>
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Watchlist
   ───────────────────────────────────────────── */
function WatchlistPanel() {
  return (
    <SpotlightCard className="card overflow-hidden card-hover">
      <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Boost</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Watched Accounts</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">Companies to keep in memory and boost.</p>
      </div>
      <div className="px-5 py-4">
        <WatchlistManager />
      </div>
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Blocked Companies
   ───────────────────────────────────────────── */
function BlockedCompaniesPanel() {
  const [blocked, setBlocked] = useState<BlockedCompany[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/blocked-companies')
      const data = await res.json().catch(() => ({ companies: [] })) as { companies: BlockedCompany[] }
      setBlocked(data.companies ?? [])
    } catch {
      setBlocked([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/blocked-companies/${id}`, { method: 'DELETE' })
    setBlocked(prev => prev?.filter(c => c.id !== id) ?? null)
  }, [])

  return (
    <SpotlightCard className="card overflow-hidden card-hover">
      <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Guardrails</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Blocked Companies</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">Accounts Bombsell will skip in outreach and research.</p>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
            <span className="w-3.5 h-3.5 border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            Loading…
          </div>
        ) : blocked && blocked.length > 0 ? (
          <ul className="space-y-2">
            {blocked.map(company => (
              <li key={company.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[var(--color-text-1)]">{company.company_name}</span>
                <button
                  onClick={() => remove(company.id)}
                  className="text-[11px] text-[var(--color-sig-regulation)] hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--color-text-3)]">No blocked companies.</p>
        )}
      </div>
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Connected Accounts
   ───────────────────────────────────────────── */
function ConnectedAccountsPanel({ profile }: { profile: UserProfile }) {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null)
  const [loading, setLoading] = useState(false)
  const tier = (profile.plan as SubscriptionTier) || 'free'
  const maxInboxes = getMaxInboxesForTier(tier)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/connected-accounts')
      const data = await res.json().catch(() => ({ accounts: [] })) as { accounts: ConnectedAccount[] }
      setAccounts(data.accounts ?? [])
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const disconnect = useCallback(async (id: string) => {
    await fetch(`/api/connected-accounts?id=${id}`, { method: 'DELETE' })
    setAccounts(prev => prev?.filter(a => a.id !== id) ?? null)
  }, [])

  const count = accounts?.length ?? 0
  const atLimit = count >= maxInboxes

  return (
    <SpotlightCard className="card overflow-hidden card-hover">
      <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Channels</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Connected Accounts</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">
          Gmail and Outlook inboxes used for sending and reply tracking.
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
            <span className="w-3.5 h-3.5 border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            Loading…
          </div>
        ) : accounts && accounts.length > 0 ? (
          accounts.map(account => (
            <div key={account.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${account.is_active ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                <span className="text-[13px] text-[var(--color-text-1)]">{account.email}</span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] bg-[var(--color-ink-2)] px-1.5 py-0.5 rounded">{account.provider}</span>
              </div>
              <button
                onClick={() => disconnect(account.id)}
                className="text-[11px] text-[var(--color-sig-regulation)] hover:underline"
              >
                Disconnect
              </button>
            </div>
          ))
        ) : (
          <p className="text-[13px] text-[var(--color-text-3)]">No connected accounts.</p>
        )}

        <div className="pt-2 flex flex-wrap gap-2">
          <a
            href="/api/auth/google-mail"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              atLimit
                ? 'border-[var(--color-line-2)] text-[var(--color-text-4)] cursor-not-allowed pointer-events-none'
                : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40 hover:shadow-sm text-[var(--color-text-1)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Connect Gmail
          </a>
          <a
            href="/api/auth/microsoft-mail"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              atLimit
                ? 'border-[var(--color-line-2)] text-[var(--color-text-4)] cursor-not-allowed pointer-events-none'
                : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40 hover:shadow-sm text-[var(--color-text-1)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Connect Outlook
          </a>
        </div>
        {atLimit && (
          <p className="text-[11px] text-[var(--color-sig-regulation)]">
            You have reached the maximum of {maxInboxes} connected accounts for your plan. Upgrade to connect more.
          </p>
        )}
      </div>
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Slack
   ───────────────────────────────────────────── */
function SlackPanel({ profile }: { profile: UserProfile }) {
  const [url, setUrl] = useState(profile.slack_webhook_url ?? '')
  const [minScore, setMinScore] = useState(profile.slack_min_score ?? 7)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = useCallback(async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/settings/slack-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: url || null, min_score: minScore }),
      })
      if (!res.ok) throw new Error()
      setMsg('Saved.')
    } catch {
      setMsg('Failed to save.')
    } finally {
      setSaving(false)
    }
  }, [url, minScore])

  return (
    <SpotlightCard className="card overflow-hidden card-hover">
      <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Connect</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Slack Notifications</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">Get alerts for high-relevance signals and replies.</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-3)]">Webhook URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="mt-1 w-full text-[13px] px-3 py-2 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-3)]">Minimum relevance score ({minScore})</label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--color-accent)]"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full btn-primary transition-colors hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && <span className="text-[11px] text-[var(--color-text-3)]">{msg}</span>}
        </div>
      </div>
    </SpotlightCard>
  )
}

/* ─────────────────────────────────────────────
   Shared
   ───────────────────────────────────────────── */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-start justify-between gap-4">
      <span className="text-[11px] font-medium text-[var(--color-text-3)] shrink-0 w-28">{label}</span>
      <span className="text-[13px] text-[var(--color-text-1)] text-right">{children}</span>
    </div>
  )
}
