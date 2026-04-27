'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import StakeholderList, { type Stakeholder } from './StakeholderList'
import type { Lead } from './LeadFeed'

interface Props {
  lead: Lead
  plan?: 'free' | 'pro'
  onClose: () => void
  onEmailSent: () => void
  onStatusChange?: (status: string) => void
  onDraftCreated?: () => void
}

interface Draft {
  id?: string
  subject: string
  body: string
  stakeholders: Stakeholder[]
}

interface FollowUp {
  followup_subject: string
  followup_body: string
}

type Tab = 'initial' | 'followup'

type SendState = 'idle' | 'sending' | 'success' | 'error'

const ANGLE_LABELS: Record<string, string> = {
  funding:     'Hormozi value framing',
  acquisition: 'Challenger insight-led',
  expansion:   'Predictable Revenue',
  regulation:  'Voss tactical empathy',
  hiring:      'Challenger 90-day angle',
  crm_import:  'CRM account-based angle',
}

const SIGNAL_META: Record<string, { label: string; color: string }> = {
  funding:     { label: 'Funding',     color: 'var(--color-sig-funding)' },
  acquisition: { label: 'Acquisition', color: 'var(--color-sig-acquisition)' },
  expansion:   { label: 'Expansion',   color: 'var(--color-sig-expansion)' },
  hiring:      { label: 'Hiring',      color: 'var(--color-sig-hiring)' },
  regulation:  { label: 'Regulation',  color: 'var(--color-sig-regulation)' },
  crm_import:  { label: 'CRM Import',  color: 'var(--color-accent)' },
}

export default function OutreachDrawer({ lead, plan = 'free', onClose, onEmailSent, onStatusChange, onDraftCreated }: Props) {
  const [mounted, setMounted]   = useState(false)
  const [draft, setDraft]       = useState<Draft | null>(null)
  const [followUp, setFollowUp] = useState<FollowUp | null>(null)
  const [tab, setTab]           = useState<Tab>('initial')
  const [loading, setLoading]   = useState(true)
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [followupCancelling, setFollowupCancelling] = useState(false)
  const [followupCancelled, setFollowupCancelled] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load initial draft
  useEffect(() => {
    async function loadDraft() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/outreach/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: lead.id }),
        })
        if (!res.ok) throw new Error('Failed to generate draft')
        const data = await res.json()
        setDraft(data)
        onDraftCreated?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error loading draft')
      } finally {
        setLoading(false)
      }
    }
    loadDraft()
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFollowUp() {
    if (followUp) { setTab('followup'); return }
    setFollowUpLoading(true)
    try {
      const res = await fetch('/api/outreach/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to generate follow-up')
      }
      const data = await res.json()
      setFollowUp(data)
      setTab('followup')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating follow-up')
    } finally {
      setFollowUpLoading(false)
    }
  }

  async function copyFullEmail() {
    if (tab === 'initial' && draft) {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
    } else if (tab === 'followup' && followUp) {
      await navigator.clipboard.writeText(`Subject: ${followUp.followup_subject}\n\n${followUp.followup_body}`)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function cancelFollowup() {
    setFollowupCancelling(true)
    try {
      await fetch(`/api/leads/${lead.id}/followup`, { method: 'DELETE' })
      setFollowupCancelled(true)
    } finally {
      setFollowupCancelling(false)
    }
  }

  async function sendEmail() {
    if (!draft) return
    if (plan === 'free') {
      setSendError('Direct inbox sending is available on Pro. Use Gmail or Copy on Free.')
      return
    }
    const recipient = draft.stakeholders.find(s => s.email)
    if (!recipient?.email) {
      setSendError('No email address found for any contact.')
      return
    }
    const currentSubject = tab === 'followup' && followUp ? followUp.followup_subject : draft.subject
    const currentBody    = tab === 'followup' && followUp ? followUp.followup_body    : draft.body

    setSendState('sending')
    setSendError(null)
    try {
      const res = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, to: recipient.email, subject: currentSubject, body: currentBody, isFollowUp: tab === 'followup' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setSendState('success')
      setTimeout(() => onEmailSent(), 1500)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send email')
      setSendState('error')
    }
  }

  function openInGmail() {
    if (!draft) return
    const recipients = Array.from(new Set(
      draft.stakeholders
        .map(stakeholder => stakeholder.email?.trim())
        .filter((email): email is string => Boolean(email))
    ))
    const to = recipients.join(';')
    const subject = tab === 'followup' && followUp ? followUp.followup_subject : draft.subject
    const body    = tab === 'followup' && followUp ? followUp.followup_body    : draft.body
    const params  = new URLSearchParams({ to, su: subject, body })
    window.open(`https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1&${params.toString()}`, '_blank')
    // Don't close or mark as sent — user must confirm via "Mark as" buttons after sending from Gmail
  }

  const sig = normalizeLeadFeedSnapshot(lead.feed_snapshot)
    ?? (Array.isArray(lead.signals) ? lead.signals[0] : lead.signals)
  const sigType = sig?.signal_type ?? ''
  const sigMeta = SIGNAL_META[sigType]
  const canSendDirect = plan === 'pro'

  const drawer = (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/25 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className="
          fixed right-0 top-0 bottom-0 h-dvh max-h-dvh w-full max-w-lg
          bg-white border-l border-[var(--color-line-1)]
          z-50 flex flex-col shadow-[0_20px_60px_-20px_#00000033] drawer-enter
        "
      >
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between px-6 py-4 border-b border-[var(--color-line-1)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {sigMeta && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-3)]">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: sigMeta.color }}
                  />
                  {sigMeta.label}
                </span>
              )}
              <h2 className="text-sm font-semibold text-[var(--color-text-1)] truncate">
                Outreach to {lead.target_company}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {(sig?.funding_amount || sig?.summary) && (
                <span className="text-[11px] text-[var(--color-text-4)] truncate max-w-[280px]">
                  {sig?.funding_amount || sig?.summary?.slice(0, 60) || ''}
                </span>
              )}
              {ANGLE_LABELS[sigType] && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] border border-[var(--color-accent)]/25">
                  {ANGLE_LABELS[sigType]}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-4)] hover:text-[var(--color-text-1)] transition-colors p-1 shrink-0"
            aria-label="Close drawer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar (underline style) */}
        {!loading && draft && (
          <div className="shrink-0 flex px-6 border-b border-[var(--color-line-1)]">
            <button
              onClick={() => setTab('initial')}
              className={`
                relative text-xs font-medium h-9 px-3 -mb-px border-b-2 transition-colors
                ${tab === 'initial'
                  ? 'border-[var(--color-text-1)] text-[var(--color-text-1)]'
                  : 'border-transparent text-[var(--color-text-4)] hover:text-[var(--color-text-2)]'}
              `}
            >
              Initial email
            </button>
            <button
              onClick={loadFollowUp}
              disabled={followUpLoading}
              className={`
                relative text-xs font-medium h-9 px-3 -mb-px border-b-2 transition-colors flex items-center gap-1.5
                ${tab === 'followup'
                  ? 'border-[var(--color-text-1)] text-[var(--color-text-1)]'
                  : 'border-transparent text-[var(--color-text-4)] hover:text-[var(--color-text-2)]'}
              `}
            >
              {followUpLoading ? (
                <>
                  <span className="w-3 h-3 border border-[var(--color-text-4)] border-t-[var(--color-accent-ring)] rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                'Follow-up (day 4)'
              )}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && (
            <div className="space-y-3">
              <div className="h-3 rounded w-1/3 skeleton" />
              <div className="h-10 rounded skeleton" />
              <div className="h-3 rounded w-1/4 mt-4 skeleton" />
              <div className="h-32 rounded skeleton" />
              <div className="h-3 rounded w-1/4 mt-4 skeleton" />
              <div className="h-16 rounded skeleton" />
            </div>
          )}

          {error && (
            <div className="text-sm text-[var(--color-sig-regulation)] bg-[var(--color-sig-regulation-bg)] border border-[var(--color-sig-regulation)]/20 rounded-md px-3 py-2 text-center">
              {error}
            </div>
          )}

          {/* Initial email */}
          {draft && !loading && tab === 'initial' && (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">Subject</label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={e => setDraft(d => d ? { ...d, subject: e.target.value } : d)}
                  className="w-full px-3 py-2.5 bg-white border border-[var(--color-line-2)] rounded-lg text-sm text-[var(--color-text-1)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">Body</label>
                <textarea
                  rows={14}
                  value={draft.body}
                  onChange={e => setDraft(d => d ? { ...d, body: e.target.value } : d)}
                  className="w-full px-3 py-2.5 bg-white border border-[var(--color-line-2)] rounded-lg text-sm text-[var(--color-text-1)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 resize-y leading-relaxed transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">
                  Send to · {draft.stakeholders.length} contact{draft.stakeholders.length !== 1 ? 's' : ''} found
                </label>
                <StakeholderList stakeholders={draft.stakeholders} />
              </div>
            </>
          )}

          {/* Follow-up email */}
          {tab === 'followup' && followUp && (
            <>
              <div className="text-xs text-[var(--color-sig-expansion)] bg-[var(--color-sig-expansion-bg)] border border-[var(--color-sig-expansion)]/20 rounded-md px-3 py-2">
                Send ~3 days after the initial email with no reply. Short by design.
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">Subject</label>
                <input
                  type="text"
                  value={followUp.followup_subject}
                  onChange={e => setFollowUp(f => f ? { ...f, followup_subject: e.target.value } : f)}
                  className="w-full px-3 py-2.5 bg-white border border-[var(--color-line-2)] rounded-lg text-sm text-[var(--color-text-1)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">Body</label>
                <textarea
                  rows={8}
                  value={followUp.followup_body}
                  onChange={e => setFollowUp(f => f ? { ...f, followup_body: e.target.value } : f)}
                  className="w-full px-3 py-2.5 bg-white border border-[var(--color-line-2)] rounded-lg text-sm text-[var(--color-text-1)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/15 resize-y leading-relaxed transition-colors"
                />
              </div>
              {draft && (
                <div className="space-y-2">
                  <label className="text-[10px] font-medium text-[var(--color-text-4)] uppercase tracking-widest">Send to</label>
                  <StakeholderList stakeholders={draft.stakeholders} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {(draft && !loading) && (
          <div className="shrink-0 px-6 py-4 border-t border-[var(--color-line-1)] space-y-3">
            {/* Send error */}
            {sendError && (
              <p className="text-xs text-[var(--color-sig-regulation)] bg-[var(--color-sig-regulation-bg)] border border-[var(--color-sig-regulation)]/20 rounded-md px-3 py-2">
                {sendError}
              </p>
            )}

            {!canSendDirect && (
              <p className="text-xs text-[var(--color-text-4)] bg-[var(--color-ink-2)] border border-[var(--color-line-1)] rounded-lg px-3 py-2">
                Free includes personalized drafts. Upgrade to Pro for one-click Gmail/Outlook sending, follow-ups, and reply detection.
              </p>
            )}

            {/* Primary actions */}
            <div className="flex items-center gap-2">
              {canSendDirect ? (
                <button
                  onClick={sendEmail}
                  disabled={sendState === 'sending' || sendState === 'success'}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 h-10 rounded-full disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                >
                  {sendState === 'sending' && (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  )}
                  {sendState === 'success' ? 'Sent' : sendState === 'sending' ? 'Sending…' : 'Send Email'}
                </button>
              ) : (
                <button
                  onClick={openInGmail}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 h-10 rounded-full text-sm"
                >
                  <GmailIcon />
                  Open in Gmail
                </button>
              )}
              {canSendDirect && (
                <button
                  onClick={openInGmail}
                  title="Open in Gmail instead"
                  className="btn-ghost flex items-center justify-center gap-1.5 h-10 px-3 rounded-full text-xs"
                >
                  <GmailIcon />
                  <span className="hidden sm:inline">Gmail</span>
                </button>
              )}
              {!canSendDirect && (
                <a
                  href="/pricing"
                  className="btn-ghost h-10 px-3 rounded-full text-xs font-medium inline-flex items-center"
                >
                  Upgrade
                </a>
              )}
              <button
                onClick={copyFullEmail}
                className="btn-ghost h-10 px-3 rounded-full text-xs font-medium"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* Manual status progression */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-4)] shrink-0">Mark as</span>
              {(['sent', 'replied', 'booked'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => onStatusChange ? onStatusChange(s) : onEmailSent()}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-line-2)] bg-white text-[var(--color-text-3)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent-ring)] hover:bg-[var(--color-accent-bg)] transition-colors capitalize"
                  title={`Mark this lead as ${s}`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Per-lead follow-up cancellation */}
            {canSendDirect && lead.status === 'sent' && !followupCancelled && (
              <div className="flex items-center justify-between pt-1 border-t border-[var(--color-line-1)]">
                <span className="text-[11px] text-[var(--color-text-4)]">Auto follow-up in ~3 days</span>
                <button
                  onClick={cancelFollowup}
                  disabled={followupCancelling}
                  className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] disabled:opacity-50 transition-colors"
                >
                  {followupCancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
            )}
            {canSendDirect && followupCancelled && (
              <p className="text-[11px] text-[var(--color-text-4)] pt-1 border-t border-[var(--color-line-1)]">
                Auto follow-up cancelled.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )

  if (!mounted) return null

  return createPortal(drawer, document.body)
}

function GmailIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path fill="#EA4335" d="M6 18V8.4L3 6v12a1 1 0 001 1h2z"/>
      <path fill="#34A853" d="M18 18V8.4l3-2v12a1 1 0 01-1 1h-2z"/>
      <path fill="#4285F4" d="M18 6l-6 4.8L6 6H3l9 7.2L21 6z"/>
      <path fill="#FBBC05" d="M3 6l3 2.4V6z"/>
      <path fill="#EA4335" d="M21 6l-3 2.4V6z"/>
    </svg>
  )
}
