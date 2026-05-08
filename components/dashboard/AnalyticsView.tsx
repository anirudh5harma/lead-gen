'use client'

import type { Lead } from '@/lib/leads'
import { buildRevenueSnapshot } from '@/lib/revenue-ux'

interface Props {
  leads: Lead[]
}

export default function AnalyticsView({ leads }: Props) {
  const snapshot = buildRevenueSnapshot(leads)

  const replyRate7 = ratio(snapshot.windows.replied7d, snapshot.windows.sent7d)
  const replyRate30 = snapshot.rates.replyRate30
  const bookRate7 = ratio(snapshot.windows.booked7d, snapshot.windows.sent7d)
  const bookRate30 = snapshot.rates.bookRate30
  const sendVelocity = velocity(snapshot.windows.sent7d * 4, snapshot.windows.sent30d)
  const replyVelocity = velocity(replyRate7, replyRate30)
  const bookingVelocity = velocity(bookRate7, bookRate30)

  const trendRows = [
    {
      id: 'send-velocity',
      label: 'Outbound velocity',
      current: `${snapshot.windows.sent7d} sent (7d)`,
      baseline: `${snapshot.windows.sent30d} sent (30d)`,
      status: sendVelocity,
    },
    {
      id: 'reply-velocity',
      label: 'Reply efficiency',
      current: `${replyRate7}% (7d)`,
      baseline: `${replyRate30}% (30d)`,
      status: replyVelocity,
    },
    {
      id: 'booking-velocity',
      label: 'Meeting conversion',
      current: `${bookRate7}% (7d)`,
      baseline: `${bookRate30}% (30d)`,
      status: bookingVelocity,
    },
  ]

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-1)]">Revenue Signal Summary</h2>
        <p className="mt-1 text-[12px] text-[var(--color-text-4)]">Current state, failure points, and the next action queue.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricBox label="Leads found (30d)" value={snapshot.windows.found30d} detail={`${snapshot.rates.sendCoverage30}% converted to sent`} />
          <MetricBox label="Replies (30d)" value={snapshot.windows.replied30d} detail={`${snapshot.rates.replyRate30}% reply rate`} />
          <MetricBox label="Booked (30d)" value={snapshot.windows.booked30d} detail={`${snapshot.rates.bookRate30}% book rate`} />
          <MetricBox label="Booked (90d)" value={snapshot.windows.booked90d} detail="Longer-term conversion baseline" />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-3)]">Trend Check</h3>
        <div className="mt-3 space-y-2">
          {trendRows.map(row => (
            <div key={row.id} className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{row.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${trendTone(row.status)}`}>{trendLabel(row.status)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">{row.current} vs {row.baseline}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <SignalList title="Working" tone="positive" items={snapshot.working} emptyText="No strong wins detected yet." />
        <SignalList title="Not Working" tone="negative" items={snapshot.notWorking} emptyText="No major risk signals right now." />
        <ActionQueue actions={snapshot.actions} />
      </section>
    </div>
  )
}

function MetricBox({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{detail}</p>
    </div>
  )
}

function SignalList({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string
  tone: 'positive' | 'negative'
  items: Array<{ id: string; label: string; detail: string }>
  emptyText: string
}) {
  const border = tone === 'positive' ? 'border-[var(--color-sig-expansion)]/30' : 'border-[var(--color-sig-regulation)]/28'
  const badge = tone === 'positive' ? 'bg-[var(--color-sig-expansion-bg)] text-[var(--color-sig-expansion)]' : 'bg-[var(--color-sig-regulation)]/12 text-[var(--color-sig-regulation)]'
  return (
    <section className={`rounded-lg border ${border} bg-white px-4 py-4`}>
      <h3 className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{title}</h3>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? items.map(item => (
          <div key={item.id} className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{item.label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">{item.detail}</p>
          </div>
        )) : (
          <p className="text-[11px] text-[var(--color-text-4)]">{emptyText}</p>
        )}
      </div>
    </section>
  )
}

function ActionQueue({ actions }: { actions: Array<{ id: string; label: string; reason: string; href: string }> }) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
      <h3 className="inline-flex rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent-ring)]">Action Queue</h3>
      <div className="mt-2 space-y-2">
        {actions.length > 0 ? actions.map(action => (
          <a
            key={action.id}
            href={action.href}
            className="block rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 hover:border-[var(--color-accent)]/35"
          >
            <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{action.label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">{action.reason}</p>
          </a>
        )) : (
          <p className="text-[11px] text-[var(--color-text-4)]">No immediate action required.</p>
        )}
      </div>
    </section>
  )
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function velocity(current: number, baseline: number): 'up' | 'flat' | 'down' {
  if (baseline <= 0) return current > 0 ? 'up' : 'flat'
  const delta = ((current - baseline) / baseline) * 100
  if (delta >= 15) return 'up'
  if (delta <= -15) return 'down'
  return 'flat'
}

function trendLabel(value: 'up' | 'flat' | 'down'): string {
  if (value === 'up') return 'improving'
  if (value === 'down') return 'declining'
  return 'stable'
}

function trendTone(value: 'up' | 'flat' | 'down'): string {
  if (value === 'up') return 'bg-[var(--color-sig-expansion-bg)] text-[var(--color-sig-expansion)]'
  if (value === 'down') return 'bg-[var(--color-sig-regulation)]/12 text-[var(--color-sig-regulation)]'
  return 'bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
}
