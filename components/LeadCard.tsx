'use client'

import { useEffect, useRef, useState } from 'react'

export type SignalType = 'funding' | 'acquisition' | 'expansion' | 'hiring' | 'regulation'
export type LeadStatus = 'new' | 'viewed' | 'drafted' | 'sent' | 'replied' | 'booked' | 'dismissed'

export interface LeadCardSignal {
  signal_type: SignalType
  headline: string
  summary: string
  published_at: string
  company_domain?: string
}

export interface LeadCardLead {
  id: string
  target_company: string
  company_domain?: string
  relevance_score: number
  relevance_reason: string
  status: LeadStatus
  is_unlocked: boolean
  created_at: string
  signals: LeadCardSignal
}

export interface LeadCardProps {
  lead: LeadCardLead
  rowIndex: number
  isSelected: boolean
  actionBusy?: boolean
  onSelect: () => void
  onDraftOutreach: (leadId: string) => void
  onStatusChange: (leadId: string, status: string) => void
  onOpenTimeline: (companyName: string, companyDomain?: string) => void
  onDelete: (leadId: string) => void
  onBlock: (leadId: string, companyName: string, companyDomain?: string) => void
  isWatchlisted: boolean
}

const SIGNAL_DOT: Record<SignalType, { label: string; dot: string }> = {
  funding:     { label: 'Funding',     dot: 'bg-[var(--color-sig-funding)]' },
  acquisition: { label: 'Acquisition', dot: 'bg-[var(--color-sig-acquisition)]' },
  expansion:   { label: 'Expansion',   dot: 'bg-[var(--color-sig-expansion)]' },
  hiring:      { label: 'Hiring',      dot: 'bg-[var(--color-sig-hiring)]' },
  regulation:  { label: 'Regulation',  dot: 'bg-[var(--color-sig-regulation)]' },
}

const STATUS_OPTIONS: { value: LeadStatus; label: string; style: string }[] = [
  { value: 'new',       label: 'New',       style: 'text-[var(--color-text-3)]' },
  { value: 'viewed',    label: 'Viewed',    style: 'text-[var(--color-text-2)]' },
  { value: 'drafted',   label: 'Drafted',   style: 'text-[var(--color-accent-ring)]' },
  { value: 'sent',      label: 'Sent',      style: 'text-[var(--color-accent)]' },
  { value: 'replied',   label: 'Replied',   style: 'text-[var(--color-sig-funding)]' },
  { value: 'booked',    label: 'Booked',    style: 'text-[var(--color-sig-funding)]' },
  { value: 'dismissed', label: 'Dismissed', style: 'text-[var(--color-text-4)]' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return `${Math.floor(d / 30)}mo`
}

export default function LeadCard({
  lead,
  rowIndex,
  isSelected,
  actionBusy = false,
  onSelect,
  onDraftOutreach,
  onStatusChange,
  onOpenTimeline,
  onDelete,
  onBlock,
  isWatchlisted,
}: LeadCardProps) {
  const [showReason, setShowReason] = useState(false)
  const reasonRef = useRef<HTMLDivElement | null>(null)
  const scoreBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!showReason) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        reasonRef.current && !reasonRef.current.contains(t) &&
        scoreBtnRef.current && !scoreBtnRef.current.contains(t)
      ) setShowReason(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [showReason])

  const sig = SIGNAL_DOT[lead.signals.signal_type] ?? SIGNAL_DOT.funding
  const statusOption = STATUS_OPTIONS.find(s => s.value === lead.status) ?? STATUS_OPTIONS[0]

  return (
    <tr
      onClick={onSelect}
      className={`
        group cursor-pointer border-b border-[var(--color-line-1)]/60
        transition-colors duration-100
        ${isSelected
          ? 'bg-[var(--color-accent-soft)]'
          : 'hover:bg-[var(--color-ink-2)]'}
      `}
    >
      {/* # */}
      <td className="w-8 pl-5 pr-2 py-3.5">
        <span className="text-[11px] font-mono text-[var(--color-text-4)]">{rowIndex}</span>
      </td>

      {/* Company */}
      <td className="px-3 py-3.5 min-w-[160px] max-w-[220px]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={e => {
              e.stopPropagation()
              onOpenTimeline(lead.target_company, lead.company_domain ?? lead.signals.company_domain)
            }}
            className="text-sm font-medium text-[var(--color-text-1)] hover:text-[var(--color-accent-ring)] transition-colors text-left truncate"
            title="View signal history"
          >
            {lead.target_company}
          </button>
          {isWatchlisted && (
            <svg className="w-3 h-3 text-[var(--color-sig-hiring)] shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.968 6.058a1 1 0 00.95.69h6.37c.969 0 1.371 1.24.588 1.81l-5.15 3.742a1 1 0 00-.364 1.118l1.968 6.058c.3.922-.755 1.688-1.54 1.118L12 17.79l-5.148 3.73c-.785.57-1.84-.196-1.54-1.117l1.967-6.058a1 1 0 00-.364-1.118L1.765 11.485c-.783-.57-.38-1.81.588-1.81h6.37a1 1 0 00.95-.69l1.968-6.058z" />
            </svg>
          )}
          {!lead.is_unlocked && (
            <span className="inline-flex items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-3)]">
              Preview
            </span>
          )}
        </div>
        {lead.company_domain && (
          <div className="text-[10px] text-[var(--color-text-4)] mt-0.5 truncate">
            {lead.company_domain}
          </div>
        )}
      </td>

      {/* Signal */}
      <td className="px-3 py-3.5 w-[220px]">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sig.dot}`} />
          <span className="text-[11px] font-medium text-[var(--color-text-2)]">{sig.label}</span>
        </div>
        <p className="text-[11px] text-[var(--color-text-4)] mt-0.5 truncate max-w-[200px]">
          {lead.signals.headline}
        </p>
      </td>

      {/* Score */}
      <td className="px-3 py-3.5 w-16 text-center">
        <div className="relative inline-flex flex-col items-center gap-1">
          <button
            ref={scoreBtnRef}
            onClick={e => { e.stopPropagation(); setShowReason(s => !s) }}
            className="text-sm font-mono font-semibold text-[var(--color-text-1)] hover:text-[var(--color-accent-ring)] transition-colors"
          >
            {lead.relevance_score}
          </button>
          <div className="w-8 h-0.5 rounded-full bg-[var(--color-line-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${(lead.relevance_score / 10) * 100}%` }}
            />
          </div>

          {showReason && (
            <div
              ref={reasonRef}
              onClick={e => e.stopPropagation()}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 z-50 rounded-xl border border-[var(--color-line-2)] bg-white p-3 shadow-[0_20px_40px_-16px_#00000024,0_4px_12px_-6px_#00000014] fade-in text-left"
            >
              <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-4)] mb-1.5">
                Why this matched
              </p>
              <p className="text-xs text-[var(--color-text-1)] leading-relaxed">
                {lead.relevance_reason || 'No reason recorded.'}
              </p>
            </div>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-3 py-3.5 w-[110px]">
        {lead.is_unlocked ? (
          <select
            value={lead.status}
            onClick={e => e.stopPropagation()}
            onChange={e => onStatusChange(lead.id, e.target.value)}
            className={`text-[11px] font-medium bg-transparent border-0 outline-none cursor-pointer ${statusOption.style}`}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value} className="bg-white text-[var(--color-text-1)]">
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] font-medium text-[var(--color-text-4)]">Preview</span>
        )}
      </td>

      {/* Time */}
      <td className="px-3 py-3.5 w-14">
        <span className="text-[11px] font-mono text-[var(--color-text-4)]">
          {timeAgo(lead.created_at)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5 w-[130px] text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={e => { e.stopPropagation(); onDraftOutreach(lead.id) }}
            disabled={actionBusy}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] border border-[var(--color-accent)]/25 hover:bg-[var(--color-accent)] hover:text-white hover:border-transparent transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {actionBusy ? 'Unlocking…' : lead.is_unlocked ? 'Draft' : 'Unlock'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(lead.id) }}
            title="Delete lead"
            className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-text-4)] hover:text-[var(--color-sig-regulation)] hover:bg-[var(--color-sig-regulation)]/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onBlock(lead.id, lead.target_company, lead.company_domain) }}
            title="Block this company"
            className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-text-4)] hover:text-[var(--color-sig-hiring)] hover:bg-[var(--color-sig-hiring)]/15 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}
