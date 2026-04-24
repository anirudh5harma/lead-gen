import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isInternalOpsEmailAllowed } from '@/lib/internal-ops-auth'
import { getInternalOpsSummary } from '@/lib/internal-ops'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function InternalOpsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')
  if (!isInternalOpsEmailAllowed(user.email)) notFound()

  const service = await createServiceClient()
  const summary = await getInternalOpsSummary(service)

  return (
    <main className="min-h-screen bg-[var(--color-ink-1)] text-[var(--color-text-1)] px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-4)]">Internal Ops</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Ranking And Supply Diagnostics</h1>
              <p className="text-sm text-[var(--color-text-3)]">
                Generated {new Date(summary.generated_at).toLocaleString()}
              </p>
            </div>
            <a
              href="/api/internal/ops/ranking"
              className="inline-flex h-10 items-center rounded-full border border-[var(--color-line-1)] px-4 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:border-[var(--color-line-2)] transition-colors"
            >
              JSON
            </a>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
          <StatCard label="Queued · 30d" value={String(summary.funnel_30d.queued)} />
          <StatCard label="Delivered · 30d" value={String(summary.funnel_30d.delivered)} />
          <StatCard label="Unlocked · 30d" value={String(summary.funnel_30d.unlocked)} />
          <StatCard label="Sent · 30d" value={String(summary.funnel_30d.sent)} />
          <StatCard label="Replied · 30d" value={String(summary.funnel_30d.replied)} />
          <StatCard label="Booked · 30d" value={String(summary.funnel_30d.booked)} />
          <StatCard label="Dismissed · 30d" value={String(summary.funnel_30d.dismissed)} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <Panel title="Weekly Review">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DeltaStat
                label="Signals"
                value={summary.weekly_review.current.signals}
                delta={summary.weekly_review.deltas.signals}
              />
              <DeltaStat
                label="Queued"
                value={summary.weekly_review.current.queued}
                delta={summary.weekly_review.deltas.queued}
              />
              <DeltaStat
                label="Delivered"
                value={summary.weekly_review.current.delivered}
                delta={summary.weekly_review.deltas.delivered}
              />
              <DeltaStat
                label="Replies"
                value={summary.weekly_review.current.replied}
                delta={summary.weekly_review.deltas.replied}
              />
              <DeltaStat
                label="Booked"
                value={summary.weekly_review.current.booked}
                delta={summary.weekly_review.deltas.booked}
              />
              <DeltaStat
                label="Expired"
                value={summary.weekly_review.current.expired}
                delta={summary.weekly_review.deltas.expired}
              />
            </div>
            <div className="mt-5 space-y-2 text-sm text-[var(--color-text-3)]">
              {summary.weekly_review.recommendations.map(item => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </Panel>

          <Panel title="Top Sources · 7d">
            {summary.weekly_review.top_sources.length === 0 ? (
              <p className="text-sm text-[var(--color-text-4)]">No delivered leads in the current weekly window.</p>
            ) : (
              <div className="space-y-3">
                {summary.weekly_review.top_sources.map(source => (
                  <div key={source.source} className="flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="text-[var(--color-text-2)]">{source.source}</p>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-4)]">
                        {source.delivered} delivered · {source.replied} replied · {source.booked} booked
                      </p>
                    </div>
                    <span className="font-medium text-[var(--color-text-1)]">{source.booked + source.replied}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <Panel title="Queue Health">
            <MiniStat label="Pending now" value={String(summary.queue_health.pending_now)} />
            <MiniStat label="Due now" value={String(summary.queue_health.due_now)} />
            <MiniStat label="Delivered 30d" value={String(summary.queue_health.delivered_30d)} />
            <MiniStat label="Expired 30d" value={String(summary.queue_health.expired_30d)} />
            <MiniStat label="Duplicate 30d" value={String(summary.queue_health.duplicate_30d)} />
            <MiniStat label="Avg attempts pending" value={summary.queue_health.avg_attempts_pending.toFixed(2)} />
          </Panel>

          <Panel title="Monitored Accounts">
            <MiniStat label="Total" value={String(summary.monitored_accounts.total)} />
            <MiniStat label="Watchlist-seeded" value={String(summary.monitored_accounts.watchlist_seeded)} />
            <MiniStat label="Polled 7d" value={String(summary.monitored_accounts.polled_7d)} />
            <MiniStat label="Signaled 7d" value={String(summary.monitored_accounts.signaled_7d)} />
          </Panel>

          <Panel title="Cron 30d">
            <MiniStat label="Poll runs" value={String(summary.cron_30d.poll_signals.runs)} />
            <MiniStat label="Signals inserted" value={String(summary.cron_30d.poll_signals.inserted)} />
            <MiniStat label="ANN candidates" value={String(summary.cron_30d.match_leads.ann_candidates)} />
            <MiniStat label="Claude reranks" value={String(summary.cron_30d.match_leads.scored_by_claude)} />
            <MiniStat label="Queue delivered" value={String(summary.cron_30d.deliver_leads.delivered)} />
            <MiniStat label="Feedback reorders" value={String(summary.cron_30d.deliver_leads.feedback_reordered)} />
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <TablePanel
            title="Source Yield · 30d"
            columns={['Source', 'Signals', 'Queued', 'Delivered', 'Unlocked', 'Sent', 'Replied', 'Booked']}
            rows={summary.source_yield_30d.map(row => [
              row.source,
              String(row.signals),
              String(row.queued),
              String(row.delivered),
              String(row.unlocked),
              String(row.sent),
              String(row.replied),
              String(row.booked),
            ])}
          />

          <TablePanel
            title="Signal Type Yield · 30d"
            columns={['Signal', 'Delivered', 'Sent', 'Replied', 'Booked']}
            rows={summary.signal_type_yield_30d.map(row => [
              row.signal_type,
              String(row.delivered),
              String(row.sent),
              String(row.replied),
              String(row.booked),
            ])}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <ListPanel title="Top Feedback · Companies" items={summary.feedback.companies} />
          <ListPanel title="Top Feedback · Signal Types" items={summary.feedback.signal_types} />
          <ListPanel title="Top Feedback · Sources" items={summary.feedback.sources} />
        </section>
      </div>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/70 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60 p-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--color-text-3)]">{label}</span>
      <span className="font-medium text-[var(--color-text-1)]">{value}</span>
    </div>
  )
}

function DeltaStat({ label, value, delta }: { label: string; value: number; delta: number }) {
  const deltaLabel = delta === 0 ? 'flat' : `${delta > 0 ? '+' : ''}${delta}`
  const deltaClass = delta > 0
    ? 'text-emerald-400'
    : delta < 0
      ? 'text-rose-400'
      : 'text-[var(--color-text-4)]'

  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-1)]/60 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-4)]">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-2xl font-semibold tracking-tight text-[var(--color-text-1)]">{value}</span>
        <span className={`text-sm font-medium ${deltaClass}`}>{deltaLabel}</span>
      </div>
    </div>
  )
}

function TablePanel({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60 p-5 overflow-hidden">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line-1)] text-left text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-4)]">
              {columns.map(column => (
                <th key={column} className="pb-3 pr-4 font-medium">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`} className="border-b border-[var(--color-line-1)]/60 last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${title}-${index}-${cellIndex}`}
                    className={`py-3 pr-4 ${cellIndex === 0 ? 'text-[var(--color-text-2)]' : 'text-[var(--color-text-1)]'}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ListPanel({ title, items }: { title: string; items: Array<{ label: string; score: number }> }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60 p-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-4)]">No meaningful feedback yet.</p>
        ) : items.map(item => (
          <div key={`${title}-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-[var(--color-text-2)]">{item.label}</span>
            <span className={`font-medium ${item.score >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {item.score >= 0 ? '+' : ''}{item.score.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
