'use client'

import { useEffect, useRef, useState } from 'react'

export default function HeroVisual() {
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-[540px] mx-auto lg:mx-0"
    >
      {/* Ambient glow behind */}
      <div className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-[var(--color-accent-bg)] via-[var(--color-ink-3)] to-[var(--color-accent-glow)] opacity-50 blur-3xl animate-breathe pointer-events-none" />

      {/* Browser chrome frame */}
      <div className="card overflow-hidden shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/40 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]/70" />
          <span className="ml-auto text-[11px] font-medium text-[var(--color-text-4)]">Bombsell — Account Agents</span>
        </div>

        {/* Bento grid */}
        <div className="p-4 grid grid-cols-2 gap-3 bg-[var(--color-ink-1)]">
          {/* Main pipeline chart tile */}
          <BentoTile
            mounted={mounted}
            delay={0}
            className="col-span-2"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Pipeline this week</span>
              <span className="text-[13px] font-bold text-[var(--color-accent)]">+128%</span>
            </div>
            <AnimatedBars />
          </BentoTile>

          {/* Active agents tile */}
          <BentoTile mounted={mounted} delay={100}>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Active agents</span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-[var(--color-text-1)]">18</div>
            <div className="mt-1 text-[11px] text-[var(--color-text-3)]">Monitoring 50K+ companies</div>
            {/* Mini avatar row */}
            <div className="mt-3 flex -space-x-1.5">
              {['bg-[#c49a8a]', 'bg-[#a0b096]', 'bg-[#c4b896]', 'bg-[#9c5a45]'].map((color, i) => (
                <div key={i} className={`h-5 w-5 rounded-full ${color} border-2 border-white`} />
              ))}
              <div className="h-5 w-5 rounded-full bg-[var(--color-ink-3)] border-2 border-white flex items-center justify-center text-[8px] font-bold text-[var(--color-text-3)]">
                +14
              </div>
            </div>
          </BentoTile>

          {/* Signals tile */}
          <BentoTile mounted={mounted} delay={200}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">New signals</span>
            <div className="mt-2 text-3xl font-bold tracking-tight text-[var(--color-text-1)]">47</div>
            <div className="mt-2 space-y-1.5">
              {[
                { label: 'Funding', count: 12, color: 'bg-[var(--color-sig-funding)]' },
                { label: 'Hiring', count: 18, color: 'bg-[var(--color-sig-hiring)]' },
                { label: 'Expansion', count: 17, color: 'bg-[var(--color-sig-expansion)]' },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
                  <span className="text-[10px] text-[var(--color-text-3)] flex-1">{s.label}</span>
                  <span className="text-[10px] font-semibold text-[var(--color-text-2)]">{s.count}</span>
                </div>
              ))}
            </div>
          </BentoTile>

          {/* Account card tile */}
          <BentoTile mounted={mounted} delay={300} className="col-span-2">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[var(--color-accent-bg)] to-[var(--color-ink-3)] flex items-center justify-center text-[13px] font-bold text-[var(--color-accent-ring)] shrink-0">
                AR
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--color-text-1)]">Acme Robotics</span>
                  <span className="pill chip-funding text-[9px]">Why now</span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-3)]">
                  Series B signal matched your ICP. Verified contact found. Recommended action: founder outreach.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-[10px] text-[var(--color-accent)] font-medium">+$12M raised</span>
                  <span className="text-[10px] text-[var(--color-text-4)]">2h ago</span>
                </div>
              </div>
            </div>
          </BentoTile>

          {/* Bottom stats row */}
          <BentoTile mounted={mounted} delay={400}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Replies</span>
            <div className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text-1)]">7</div>
            <div className="mt-1 flex items-center gap-1">
              <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span className="text-[10px] text-green-600 font-medium">+3 this week</span>
            </div>
          </BentoTile>

          <BentoTile mounted={mounted} delay={500}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Meetings booked</span>
            <div className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text-1)]">3</div>
            <div className="mt-1 flex items-center gap-1">
              <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span className="text-[10px] text-green-600 font-medium">+2 this week</span>
            </div>
          </BentoTile>
        </div>
      </div>
    </div>
  )
}

function BentoTile({
  children,
  mounted,
  delay,
  className = '',
}: {
  children: React.ReactNode
  mounted: boolean
  delay: number
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-line-2)] bg-white p-4 hover:border-[var(--color-accent)]/20 hover:shadow-lg transition-all duration-300 cursor-default ${className}`}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
        transitionProperty: 'opacity, transform, box-shadow, border-color',
        transitionDuration: '600ms, 600ms, 300ms, 300ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1), cubic-bezier(0.22, 1, 0.36, 1), ease, ease',
        transitionDelay: mounted ? `${delay}ms, ${delay}ms, 0ms, 0ms` : '0ms, 0ms, 0ms, 0ms',
      }}
    >
      {children}
    </div>
  )
}

function AnimatedBars() {
  const bars = [
    { h: '28%', delay: '0ms' },
    { h: '45%', delay: '80ms' },
    { h: '35%', delay: '160ms' },
    { h: '62%', delay: '240ms' },
    { h: '48%', delay: '320ms' },
    { h: '78%', delay: '400ms' },
    { h: '65%', delay: '480ms' },
    { h: '92%', delay: '560ms' },
    { h: '85%', delay: '640ms' },
    { h: '100%', delay: '720ms' },
  ]

  return (
    <div className="flex items-end gap-[6px] h-[80px]">
      {bars.map((bar, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm bg-gradient-to-t from-[var(--color-accent)] to-[var(--color-accent-hi)] opacity-80"
          style={{
            height: bar.h,
            animation: 'bar-grow 1s cubic-bezier(0.22, 1, 0.36, 1) forwards',
            animationDelay: bar.delay,
            opacity: 0,
          }}
        />
      ))}
    </div>
  )
}
