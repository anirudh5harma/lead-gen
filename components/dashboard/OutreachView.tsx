'use client'

import { useState } from 'react'
import type { Lead } from '@/lib/leads'
import { formatDateTime, StatusBadge, SectionHeader, EmptyState } from './shared'
import SpotlightCard from '@/components/landing/SpotlightCard'

interface Props {
  leads: Lead[]
}

type OriginFilter = 'all' | 'live' | 'explore'

export default function OutreachView({ leads }: Props) {
  const [now] = useState(() => Date.now())
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const day = 24 * 60 * 60 * 1000
  const last24h = now - day
  const last7d = now - 7 * day

  const filteredLeads = originFilter === 'all' ? leads : leads.filter(l => l.origin === originFilter)
  const sent = filteredLeads.filter(l => l.status === 'sent')
  const replied = filteredLeads.filter(l => l.status === 'replied' || l.status === 'booked')

  const found24h = filteredLeads.filter(l => inWindow(l.created_at, last24h)).length
  const sent7d = filteredLeads.filter(l => inWindow(l.sent_at, last7d)).length
  const replied7d = filteredLeads.filter(l => inWindow(l.replied_at, last7d)).length
  const booked7d = filteredLeads.filter(l => inWindow(l.booked_at, last7d)).length
  const replyRate = sent7d > 0 ? Math.round((replied7d / sent7d) * 100) : 0

  const originCounts = {
    all: leads.length,
    live: leads.filter(l => l.origin === 'live').length,
    explore: leads.filter(l => l.origin === 'explore').length,
  }

  return (
    <div className="space-y-8">
      {/* Performance */}
      <section>
        <SectionHeader
          title="Performance"
          subtitle="Recent account flow and outcomes."
          label="Metrics"
        />
        <SpotlightCard className="card overflow-hidden card-hover">
          <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 flex-1">
              <Pill label="24h found" value={found24h} />
              <Pill label="7d sent" value={sent7d} />
              <Pill label="7d replies" value={replied7d} />
              <Pill label="7d booked" value={booked7d} />
              <Pill label="Reply rate" value={`${replyRate}%`} />
            </div>
          </div>
        </SpotlightCard>
      </section>

      {/* Origin Filter */}
      <section>
        <SectionHeader
          title="Outreach history"
          subtitle="Track sent outreach and replies by source."
          label="Activity"
        />
        <div className="flex gap-1 mb-4">
          {([
            { id: 'all' as const, label: 'All' },
            { id: 'live' as const, label: `Live signals (${originCounts.live})` },
            { id: 'explore' as const, label: `Explore (${originCounts.explore})` },
          ]).map(option => (
            <button
              key={option.id}
              onClick={() => setOriginFilter(option.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                originFilter === option.id
                  ? 'bg-[var(--color-text-1)] text-white'
                  : 'bg-white text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] border border-[var(--color-line-1)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          {sent.length === 0 ? (
            <EmptyState
              title="No sent messages yet"
              body="Outreach is sent from the work inbox when leads are approved and drafted."
            />
          ) : (
            <div className="divide-y divide-[var(--color-line-1)]">
              {sent.slice(0, 20).map(lead => (
                <SentRow key={lead.id} lead={lead} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Replied */}
      {replied.length > 0 && (
        <section>
          <SectionHeader
            title="Replied & booked"
            subtitle="Accounts that responded to outreach."
          />
          <div className="card overflow-hidden">
            <div className="divide-y divide-[var(--color-line-1)]">
              {replied.slice(0, 15).map(lead => (
                <RepliedRow key={lead.id} lead={lead} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function Pill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-[86px] rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}

function SentRow({ lead }: { lead: Lead }) {
  return (
    <div className="px-5 py-3 hover:bg-[var(--color-ink-2)]/20 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-text-1)]">{lead.target_company}</span>
            <StatusBadge status={lead.status} />
            {lead.origin && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                lead.origin === 'live' ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : 'bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
              }`}>
                {lead.origin}
              </span>
            )}
          </div>
          {lead.contact_email && <p className="text-[11px] text-[var(--color-text-4)] mt-0.5">{lead.contact_email}</p>}
        </div>
        <span className="text-[10px] text-[var(--color-text-4)] shrink-0">{formatDateTime(lead.sent_at)}</span>
      </div>
    </div>
  )
}

function RepliedRow({ lead }: { lead: Lead }) {
  return (
    <div className="px-5 py-3 hover:bg-[var(--color-ink-2)]/20 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-text-1)]">{lead.target_company}</span>
            <StatusBadge status={lead.status} />
            {lead.reply_intent && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                lead.reply_intent === 'interested' || lead.reply_intent === 'meeting_requested' || lead.reply_intent === 'meeting_booked' ? 'bg-green-50 text-green-600' :
                lead.reply_intent === 'not_interested' || lead.reply_intent === 'out_of_office' ? 'bg-red-50 text-red-600' :
                'bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
              }`}>{lead.reply_intent.replace(/_/g, ' ')}</span>
            )}
          </div>
          {lead.reply_summary && <p className="text-[11px] text-[var(--color-text-3)] mt-1 line-clamp-2">{lead.reply_summary}</p>}
        </div>
        <span className="text-[10px] text-[var(--color-text-4)] shrink-0">{formatDateTime(lead.replied_at)}</span>
      </div>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
