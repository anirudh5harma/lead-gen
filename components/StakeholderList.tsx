'use client'

import { useState } from 'react'

export interface Stakeholder {
  name: string
  title: string
  email: string
  confidence: 'high' | 'medium' | 'low'
  source: 'apollo' | 'hunter' | 'pattern' | 'scrape'
}

const CONFIDENCE_CONFIG = {
  high:   { label: 'Verified',  color: 'text-green-400',  dot: 'bg-green-400' },
  medium: { label: 'Likely',    color: 'text-yellow-400', dot: 'bg-yellow-400' },
  low:    { label: 'Guessed',   color: 'text-gray-500',   dot: 'bg-gray-500' },
}

const SOURCE_LABEL = {
  apollo:  'Apollo',
  hunter:  'Hunter',
  pattern: 'Pattern',
  scrape:  'Web',
}

export default function StakeholderList({ stakeholders }: { stakeholders: Stakeholder[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  if (stakeholders.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center">
        No contacts found for this company.
      </div>
    )
  }

  async function copyEmail(email: string) {
    await navigator.clipboard.writeText(email)
    setCopied(email)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-2">
      {stakeholders.map((s) => {
        const conf = CONFIDENCE_CONFIG[s.confidence] || CONFIDENCE_CONFIG.low
        return (
          <div
            key={s.email}
            className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/60 px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">{s.name || 'Unknown'}</span>
                <span className="text-xs text-gray-500 shrink-0">{s.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400 truncate">{s.email}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
                  <span className={`text-xs ${conf.color}`}>{conf.label}</span>
                  <span className="text-gray-700">·</span>
                  <span className="text-xs text-gray-600">{SOURCE_LABEL[s.source]}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => copyEmail(s.email)}
              className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            >
              {copied === s.email ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
