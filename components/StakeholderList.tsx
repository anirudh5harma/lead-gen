'use client'

import { useState } from 'react'

export interface Stakeholder {
  name: string
  title: string
  email: string
  confidence: 'high' | 'medium' | 'low'
  source: 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
}

const CONFIDENCE_CONFIG: Record<
  Stakeholder['confidence'],
  { label: string; dot: string; text: string }
> = {
  high:   { label: 'Verified', dot: 'var(--color-sig-funding)',   text: 'text-[var(--color-sig-funding)]' },
  medium: { label: 'Likely',   dot: 'var(--color-sig-expansion)', text: 'text-[var(--color-sig-expansion)]' },
  low:    { label: 'Guessed',  dot: 'var(--color-text-4)',        text: 'text-[var(--color-text-3)]' },
}

const SOURCE_LABEL: Record<Stakeholder['source'], string> = {
  fullenrich: 'FullEnrich',
  hunter:  'Hunter',
  pattern: 'Pattern',
  scrape:  'Web',
}

export default function StakeholderList({ stakeholders }: { stakeholders: Stakeholder[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  if (stakeholders.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-4)] py-4 text-center border border-dashed border-[var(--color-line-1)] rounded-md">
        Oops, no verified contacts right now.
      </div>
    )
  }

  async function copyEmail(email: string) {
    await navigator.clipboard.writeText(email)
    setCopied(email)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-1.5">
      {stakeholders.map((s) => {
        const conf = CONFIDENCE_CONFIG[s.confidence] || CONFIDENCE_CONFIG.low
        return (
          <div
            key={s.email}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-[var(--color-text-1)] truncate">
                  {s.name || 'Unknown'}
                </span>
                <span className="text-[11px] text-[var(--color-text-4)] shrink-0">{s.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[11px] text-[var(--color-text-2)] truncate">{s.email}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: conf.dot }}
                  />
                  <span className={`text-[11px] ${conf.text}`}>{conf.label}</span>
                  <span className="text-[var(--color-text-4)]">·</span>
                  <span className="text-[11px] text-[var(--color-text-4)]">
                    {SOURCE_LABEL[s.source]}
                  </span>
                </span>
              </div>
            </div>
            <button
              onClick={() => copyEmail(s.email)}
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-line-2)] bg-white hover:border-[var(--color-line-3)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors"
            >
              {copied === s.email ? 'Copied' : 'Copy'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
