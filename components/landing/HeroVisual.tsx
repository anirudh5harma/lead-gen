'use client'

import { useEffect, useState } from 'react'

export default function HeroVisual() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="relative w-full">
      {/* Ambient glow */}
      <div className="absolute -inset-8 -z-10 rounded-[40px] bg-gradient-to-br from-[var(--color-accent-bg)] via-[var(--color-ink-3)] to-[var(--color-accent-glow)] opacity-40 blur-3xl animate-breathe pointer-events-none" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-7">
        {/* Sales Snapshot */}
        <SnapshotPanel mounted={mounted} delay={0} accent="var(--color-accent)">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Sales workflow</span>
              </div>
              <p className="mt-1 text-[13px] font-semibold text-[var(--color-text-1)]">Find who to work now</p>
            </div>
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-ring)]">Ready</span>
          </div>

          <div className="space-y-2">
            {[
              { label: 'Signal', value: 'Acme Robotics raised Series B', color: 'bg-[var(--color-sig-funding)]' },
              { label: 'Buyer', value: 'VP Revenue verified', color: 'bg-[var(--color-sig-acquisition)]' },
              { label: 'Draft', value: 'Personalized outreach ready', color: 'bg-[var(--color-sig-expansion)]' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 rounded-lg bg-[var(--color-ink-1)] px-2.5 py-2">
                <div className={`h-1.5 w-1.5 rounded-full ${row.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{row.label}</p>
                  <p className="truncate text-[11px] font-medium text-[var(--color-text-1)]">{row.value}</p>
                </div>
              </div>
            ))}
          </div>
          <ActionFooter label="Next action" value="Approve send" />
        </SnapshotPanel>

        {/* Marketing Snapshot */}
        <SnapshotPanel mounted={mounted} delay={120} accent="var(--color-pillar-timing)">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--color-pillar-timing)] animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Marketing workflow</span>
              </div>
              <p className="mt-1 text-[13px] font-semibold text-[var(--color-text-1)]">Turn signals into content</p>
            </div>
            <span className="rounded-full bg-[var(--color-pillar-timing-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--color-pillar-timing)]">5/day</span>
          </div>

          <div className="space-y-2.5">
            {[
              { type: 'Post', title: '"Hiring surge" founder POV' },
              { type: 'Blog', title: 'Why buyers act after funding' },
              { type: 'Video', title: '30-sec avatar script queued' },
            ].map((item) => (
              <div key={item.type} className="rounded-lg bg-[var(--color-ink-1)] px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{item.type}</p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--color-text-1)]">{item.title}</p>
              </div>
            ))}
          </div>

          <ActionFooter label="Calendar" value="Scheduled" />
        </SnapshotPanel>

        {/* Revenue Snapshot */}
        <SnapshotPanel mounted={mounted} delay={240} accent="var(--color-pillar-accuracy)">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--color-pillar-accuracy)] animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Revenue workflow</span>
              </div>
              <p className="mt-1 text-[13px] font-semibold text-[var(--color-text-1)]">Connect work to pipeline</p>
            </div>
            <span className="rounded-full bg-[var(--color-pillar-accuracy-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--color-pillar-accuracy)]">$84k</span>
          </div>

          <div className="rounded-lg bg-[var(--color-ink-1)] px-3 py-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-2)] mb-2">Account path</p>
            <div className="space-y-1.5">
              {[
                { label: 'Signal fit', pct: 92, color: 'bg-[var(--color-pillar-accuracy)]' },
                { label: 'Reply intent', pct: 74, color: 'bg-[var(--color-pillar-timing)]' },
                { label: 'Deal stage', pct: 48, color: 'bg-[var(--color-sig-expansion)]' },
              ].map((bar) => (
                <div key={bar.label} className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--color-text-3)] w-16 shrink-0">{bar.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bar.color}`}
                      style={{ width: `${bar.pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-medium text-[var(--color-text-2)] w-6 text-right">{bar.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          <ActionFooter label="Insights" value="Analysis · Memory updated" />
        </SnapshotPanel>
      </div>
    </div>
  )
}

function SnapshotPanel({
  children,
  mounted,
  delay,
  accent,
}: {
  children: React.ReactNode
  mounted: boolean
  delay: number
  accent: string
}) {
  return (
    <div
      className="relative card overflow-hidden p-5 md:p-6 hover:shadow-xl transition-shadow duration-300"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
        transitionProperty: 'opacity, transform, box-shadow',
        transitionDuration: '700ms, 700ms, 300ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1), cubic-bezier(0.22, 1, 0.36, 1), ease',
        transitionDelay: mounted ? `${delay}ms, ${delay}ms, 0ms` : '0ms, 0ms, 0ms',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: accent }}
      />
      {children}
    </div>
  )
}

function ActionFooter({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--color-line-1)] bg-white px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}
