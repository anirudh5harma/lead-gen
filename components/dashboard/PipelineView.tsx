'use client'

import type { Lead } from '@/lib/leads'
import { buildRevenueSnapshot } from '@/lib/revenue-ux'
import { SectionHeader } from './shared'

interface Props {
  leads: Lead[]
}

export default function PipelineView({ leads }: Props) {
  const snapshot = buildRevenueSnapshot(leads)
  const stageRows = [
    { label: 'Observed', value: snapshot.pipeline.observed, hint: `${snapshot.pipeline.staleObserved14d} stale` },
    { label: 'Drafted', value: snapshot.pipeline.qualified, hint: `${snapshot.pipeline.draftedBacklog} waiting` },
    { label: 'Sent', value: snapshot.pipeline.engaged, hint: `${snapshot.windows.sent30d} in 30d` },
    { label: 'Replied', value: snapshot.pipeline.opportunity, hint: `${snapshot.windows.replied30d} in 30d` },
    { label: 'Booked', value: snapshot.pipeline.customer, hint: `${snapshot.windows.booked30d} in 30d` },
  ]
  const maxStage = Math.max(...stageRows.map(stage => stage.value), 1)

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
        <SectionHeader
          label="Revenue"
          title="Control Center"
          subtitle={snapshot.summary.detail}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <KpiCard label="Active pipeline" value={snapshot.pipeline.active} detail="Observed + drafted + sent + replied" />
          <KpiCard label="Reply rate (30d)" value={`${snapshot.rates.replyRate30}%`} detail={`${snapshot.windows.replied30d}/${snapshot.windows.sent30d} from sent`} />
          <KpiCard label="Book rate (30d)" value={`${snapshot.rates.bookRate30}%`} detail={`${snapshot.windows.booked30d}/${snapshot.windows.sent30d} from sent`} />
          <KpiCard label="Dismissed share" value={`${snapshot.rates.dismissedShare}%`} detail={`${snapshot.pipeline.blocked} of ${leads.length} total leads`} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <SignalPanel title="What Is Working" tone="positive" items={snapshot.working} emptyText="No reliable wins yet." />
        <SignalPanel title="What Is Not Working" tone="negative" items={snapshot.notWorking} emptyText="No major blockers detected." />
        <ActionPanel actions={snapshot.actions} />
      </section>

      <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-3)]">Pipeline Snapshot</h3>
        <div className="mt-3 space-y-2.5">
          {stageRows.map(stage => (
            <div key={stage.label}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{stage.label}</p>
                <p className="text-[11px] text-[var(--color-text-4)]">
                  <span className="tabular-nums font-semibold text-[var(--color-text-2)]">{stage.value}</span> · {stage.hint}
                </p>
              </div>
              <div className="mt-1 h-2 rounded-full bg-[var(--color-ink-2)]">
                <div
                  className="h-2 rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.max(4, Math.round((stage.value / maxStage) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function KpiCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{detail}</p>
    </div>
  )
}

function SignalPanel({
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

function ActionPanel({ actions }: { actions: Array<{ id: string; label: string; reason: string; href: string }> }) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-4">
      <h3 className="inline-flex rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent-ring)]">Next Actions</h3>
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
