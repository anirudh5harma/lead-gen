'use client'

import { useState } from 'react'
import type { Lead } from '@/lib/leads'
import type { View } from './types'
import { SectionHeader } from './shared'
import SpotlightCard from '@/components/landing/SpotlightCard'

interface Props {
  leads: Lead[]
  onNavigate: (view: View) => void
}

export default function HomeView({ leads, onNavigate }: Props) {
  const [now] = useState(() => Date.now())

  const day = 24 * 60 * 60 * 1000
  const last24h = now - day
  const last7d = now - 7 * day
  const last30d = now - 30 * day

  const found24h = leads.filter(l => inWindow(l.created_at, last24h)).length
  const found7d = leads.filter(l => inWindow(l.created_at, last7d)).length
  const sent7d = leads.filter(l => inWindow(l.sent_at, last7d)).length
  const replied7d = leads.filter(l => inWindow(l.replied_at, last7d)).length
  const booked7d = leads.filter(l => inWindow(l.booked_at, last7d)).length
  const sent30d = leads.filter(l => inWindow(l.sent_at, last30d)).length
  const replied30d = leads.filter(l => inWindow(l.replied_at, last30d)).length
  const booked30d = leads.filter(l => inWindow(l.booked_at, last30d)).length

  const replyRate7d = sent7d > 0 ? Math.round((replied7d / sent7d) * 100) : 0
  const replyRate30d = sent30d > 0 ? Math.round((replied30d / sent30d) * 100) : 0

  const liveSent7d = leads.filter(l => l.origin === 'live' && inWindow(l.sent_at, last7d)).length
  const exploreSent7d = leads.filter(l => l.origin === 'explore' && inWindow(l.sent_at, last7d)).length
  const liveReplied7d = leads.filter(l => l.origin === 'live' && inWindow(l.replied_at, last7d)).length
  const exploreReplied7d = leads.filter(l => l.origin === 'explore' && inWindow(l.replied_at, last7d)).length

  const pendingApprovals = leads.filter(
    l => l.status === 'drafted' || (l.status !== 'viewed' && l.is_unlocked === true && Boolean(l.contact_email) && !l.sent_at)
  ).length

  return (
    <div className="space-y-8">
      {/* KPI Grid */}
      <section>
        <SectionHeader
          title="This week at a glance"
          subtitle="Account movement, outreach, and outcomes."
          label="Overview"
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
          <KPICard
            label="Leads found (24h)"
            value={found24h}
            subtitle={`${found7d} this week`}
            icon={<IconSearch />}
          />
          <KPICard
            label="Sent (7 days)"
            value={sent7d}
            subtitle={`${replyRate7d}% reply rate`}
            icon={<IconSend />}
          />
          <KPICard
            label="Replies (7 days)"
            value={replied7d}
            subtitle={`${booked7d} booked`}
            icon={<IconReply />}
          />
          <KPICard
            label="Reply rate (30d)"
            value={`${replyRate30d}%`}
            subtitle={`${sent30d} sent, ${booked30d} booked`}
            icon={<IconChart />}
          />
        </div>

        {/* Origin Breakdown */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Live signals</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[var(--color-text-1)]">{liveSent7d} sent · {liveReplied7d} replies</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          </div>
          <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Explore batches</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[var(--color-text-1)]">{exploreSent7d} sent · {exploreReplied7d} replies</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-[var(--color-text-3)]" />
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <SectionHeader
          title="Quick actions"
          subtitle="Jump to the views you use most."
          label="Navigate"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
          <QuickActionCard
            title="Review work inbox"
            description={`${pendingApprovals} leads need your attention`}
            action="Open inbox"
            onClick={() => onNavigate('sales/inbox')}
            highlight={pendingApprovals > 0}
          />
          <QuickActionCard
            title="Manage outreach"
            description="Review drafts and sent messages"
            action="Outreach"
            onClick={() => onNavigate('sales/outreach')}
          />
          <QuickActionCard
            title="Search & explore"
            description="Find companies and import from CRM"
            action="Explore"
            onClick={() => onNavigate('sales/explore')}
          />
          <QuickActionCard
            title="Check pipeline"
            description="View deal stages and revenue forecast"
            action="Pipeline"
            onClick={() => onNavigate('revenue/pipeline')}
          />
          <QuickActionCard
            title="Content ideas"
            description="Signal-backed marketing content"
            action="Content Hub"
            onClick={() => onNavigate('marketing/content')}
          />
          <QuickActionCard
            title="Engine settings"
            description="Autopilot, coverage, and sequences"
            action="Engine"
            onClick={() => onNavigate('engine/autopilot')}
          />
        </div>
      </section>
    </div>
  )
}

function KPICard({ label, value, subtitle, icon }: { label: string; value: number | string; subtitle: string; icon: React.ReactNode }) {
  return (
    <SpotlightCard className="card px-4 py-4 card-hover">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
        <span className="text-[var(--color-text-3)]">{icon}</span>
      </div>
      <p className="mt-2 text-[26px] font-bold tracking-tight tabular-nums text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{subtitle}</p>
    </SpotlightCard>
  )
}

function QuickActionCard({ title, description, action, onClick, highlight }: {
  title: string
  description: string
  action: string
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`group rounded-xl border text-left px-4 py-4 transition-all duration-200 card-hover ${
        highlight ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)]' : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-line-3)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-[var(--color-text-1)]">{title}</h4>
        <svg className="w-4 h-4 text-[var(--color-text-4)] group-hover:text-[var(--color-accent)] transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <p className="mt-1 text-[11.5px] text-[var(--color-text-3)]">{description}</p>
      <span className="inline-block mt-3 text-[11px] font-semibold text-[var(--color-accent-ring)] group-hover:text-[var(--color-accent)] transition-colors">
        {action} →
      </span>
    </button>
  )
}

function IconSearch() {
  return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" /></svg>
}
function IconSend() {
  return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
}
function IconReply() {
  return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
}
function IconChart() {
  return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" /><path strokeLinecap="round" strokeLinejoin="round" d="M7 15l3-3 3 2 5-7" /><path strokeLinecap="round" strokeLinejoin="round" d="M18 7h-4" /></svg>
}

function PillarBadge({ color, bg, label, desc, icon }: {
  color: string
  bg: string
  label: string
  desc: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
        style={{ background: bg, color }}
      >
        {icon}
      </span>
      <div>
        <p className="text-[12px] font-semibold text-[var(--color-text-1)] leading-tight">{label}</p>
        <p className="text-[10.5px] text-[var(--color-text-3)] leading-tight">{desc}</p>
      </div>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
