'use client'

import { useEffect, useState } from 'react'

interface TimelineSignal {
  id: string
  signal_type: string
  headline: string
  summary: string | null
  funding_amount: string | null
  source_url: string | null
  published_at: string | null
  company_name?: string
  company_domain?: string | null
}

interface Props {
  companyName: string
  companyDomain?: string
  onClose: () => void
}

const SIGNAL_META: Record<string, { label: string; className: string; dot: string }> = {
  funding:     { label: 'Funding',     className: 'chip-funding',     dot: 'var(--color-sig-funding)' },
  acquisition: { label: 'Acquisition', className: 'chip-acquisition', dot: 'var(--color-sig-acquisition)' },
  expansion:   { label: 'Expansion',   className: 'chip-expansion',   dot: 'var(--color-sig-expansion)' },
  hiring:      { label: 'Hiring',      className: 'chip-hiring',      dot: 'var(--color-sig-hiring)' },
  regulation:  { label: 'Regulation',  className: 'chip-regulation',  dot: 'var(--color-sig-regulation)' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SignalTimeline({ companyName, companyDomain, onClose }: Props) {
  const [signals, setSignals] = useState<TimelineSignal[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/signals/company?name=${encodeURIComponent(companyName)}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${res.status})`)
        }
        const data = await res.json() as { signals: TimelineSignal[] }
        if (!cancelled) setSignals(data.signals ?? [])
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load timeline')
          setSignals([])
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [companyName])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* Mobile full-screen overlay; desktop click-outside */}
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm md:bg-transparent md:backdrop-blur-none"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-label={`Signal history for ${companyName}`}
        onClick={(e) => e.stopPropagation()}
        className="
          fixed z-50 fade-in flex flex-col
          inset-x-4 top-16 bottom-16 rounded-2xl
          md:inset-auto md:top-24 md:right-8 md:bottom-auto md:w-[320px] md:max-h-96
          border border-[var(--color-line-2)] bg-white/95 backdrop-blur-xl
          shadow-[0_20px_60px_-12px_#00000033] overflow-hidden
        "
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line-1)] shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--color-text-1)] truncate">
              {companyName}
            </div>
            <div className="text-[10px] text-[var(--color-text-4)]">
              Signal history{companyDomain ? ` · ${companyDomain}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close timeline"
            className="p-1 rounded-md text-[var(--color-text-4)] hover:text-[var(--color-text-1)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {signals === null && !error && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-3 h-3 rounded-full bg-[var(--color-ink-4)] mt-1 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded bg-[var(--color-ink-4)]" />
                    <div className="h-3 w-full rounded bg-[var(--color-ink-4)]" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="text-xs text-[var(--color-sig-regulation)] py-4">{error}</p>
          )}

          {signals && signals.length === 0 && !error && (
            <p className="text-xs text-[var(--color-text-4)] py-8 text-center">
              No signals recorded for this company yet.
            </p>
          )}

          {signals && signals.length > 0 && (
            <ol className="relative space-y-4 pl-5 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-[var(--color-line-1)]">
              {signals.map((s) => {
                const meta = SIGNAL_META[s.signal_type] ?? {
                  label: s.signal_type,
                  className: 'bg-[var(--color-ink-2)] text-[var(--color-text-2)] border border-[var(--color-line-2)]',
                  dot: 'var(--color-text-3)',
                }
                return (
                  <li key={s.id} className="relative">
                    <span
                      className="absolute -left-[22px] top-1 w-3 h-3 rounded-full ring-4 ring-white"
                      style={{ background: meta.dot }}
                    />
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.className}`}>
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-4)]">
                        {formatDate(s.published_at)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-1)] leading-snug">{s.headline}</p>
                    {s.source_url && (
                      <a
                        href={s.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-accent-ring)] mt-1"
                      >
                        Source
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </a>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </>
  )
}
