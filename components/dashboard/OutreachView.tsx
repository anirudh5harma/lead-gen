'use client'

import { useState } from 'react'
import type { Lead } from '@/lib/leads'
import { formatDateTime, StatusBadge } from './shared'

interface Props {
  leads: Lead[]
}

export default function OutreachView({ leads }: Props) {
  const [now] = useState(() => Date.now())
  const day = 24 * 60 * 60 * 1000
  const last24h = now - day
  const last7d = now - 7 * day

  const sent = leads.filter(l => l.status === 'sent')
  const replied = leads.filter(l => l.status === 'replied' || l.status === 'booked')
  const dismissed = leads.filter(l => l.status === 'dismissed')

  const found24h = leads.filter(l => inWindow(l.created_at, last24h)).length
  const sent7d = leads.filter(l => inWindow(l.sent_at, last7d)).length
  const replied7d = leads.filter(l => inWindow(l.replied_at, last7d)).length
  const booked7d = leads.filter(l => inWindow(l.booked_at, last7d)).length
  const replyRate = sent7d > 0 ? Math.round((replied7d / sent7d) * 100) : 0

  return (
    <div className="space-y-5">
      {/* Performance */}
      <section className="card overflow-hidden shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Performance</h3>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">Recent account flow and outcomes.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Pill label="24h found" value={found24h} />
            <Pill label="7d sent" value={sent7d} />
            <Pill label="7d replies" value={replied7d} />
            <Pill label="7d booked" value={booked7d} />
            <Pill label="Reply rate" value={`${replyRate}%`} />
          </div>
        </div>
      </section>

      {/* Metrics */}
      {/* <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Metric label="Sent" value={sent.length} />
        <Metric label="Replies" value={replied.length} />
        <Metric label="Dismissed" value={dismissed.length} />
      </section> */}

      {/* Sent */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Recently Sent</h3>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Track sent outreach and replies.</p>
        </div>
        {sent.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[var(--color-text-3)]">
            No sent messages yet. Outreach is sent from the work inbox when leads are approved and drafted.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-line-1)]">
            {sent.slice(0, 20).map(lead => (
              <SentRow key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </section>

      {/* Replied */}
      {replied.length > 0 && (
        <section className="card overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Replied & Booked</h3>
          </div>
          <div className="divide-y divide-[var(--color-line-1)]">
            {replied.slice(0, 15).map(lead => (
              <RepliedRow key={lead.id} lead={lead} />
            ))}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
