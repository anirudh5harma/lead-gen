'use client'

import { useEffect, useState } from 'react'
import StakeholderList, { type Stakeholder } from './StakeholderList'
import type { Lead } from './LeadFeed'

interface Props {
  lead: Lead
  onClose: () => void
  onEmailSent: () => void
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

const ANGLE_LABELS: Record<string, string> = {
  funding:     'Hormozi value framing',
  acquisition: 'Challenger insight-led',
  expansion:   'Predictable Revenue',
  regulation:  'Voss tactical empathy',
  hiring:      'Challenger 90-day angle',
}

export default function OutreachDrawer({ lead, onClose, onEmailSent, onDraftCreated }: Props) {
  const [draft, setDraft]       = useState<Draft | null>(null)
  const [followUp, setFollowUp] = useState<FollowUp | null>(null)
  const [tab, setTab]           = useState<Tab>('initial')
  const [loading, setLoading]   = useState(true)
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

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

  function openInGmail() {
    if (!draft) return
    const to = draft.stakeholders[0]?.email || ''
    const subject = tab === 'followup' && followUp ? followUp.followup_subject : draft.subject
    const body    = tab === 'followup' && followUp ? followUp.followup_body    : draft.body
    const params  = new URLSearchParams({ to, su: subject, body })
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`, '_blank')
    onEmailSent()
  }

  const sig = Array.isArray(lead.signals) ? lead.signals[0] : lead.signals
  const sigType = sig?.signal_type ?? ''

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-white">Outreach to {lead.target_company}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-500">
                {sig?.funding_amount || sig?.summary?.slice(0, 50) || ''}
              </span>
              {ANGLE_LABELS[sigType] && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-400">
                  {ANGLE_LABELS[sigType]}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        {!loading && draft && (
          <div className="flex border-b border-gray-800 px-6">
            <button
              onClick={() => setTab('initial')}
              className={`py-2.5 text-sm font-medium border-b-2 mr-4 transition-colors ${
                tab === 'initial'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              Initial email
            </button>
            <button
              onClick={loadFollowUp}
              disabled={followUpLoading}
              className={`py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === 'followup'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {followUpLoading
                ? <><span className="w-3 h-3 border border-gray-500 border-t-indigo-400 rounded-full animate-spin" />Generating…</>
                : 'Follow-up (day 4)'
              }
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-gray-800 rounded w-1/3" />
              <div className="h-10 bg-gray-800 rounded" />
              <div className="h-4 bg-gray-800 rounded w-1/4 mt-4" />
              <div className="h-32 bg-gray-800 rounded" />
              <div className="h-4 bg-gray-800 rounded w-1/4 mt-4" />
              <div className="h-16 bg-gray-800 rounded" />
            </div>
          )}

          {error && <div className="text-sm text-red-400 text-center py-8">{error}</div>}

          {/* Initial email */}
          {draft && !loading && tab === 'initial' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Subject</label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={e => setDraft(d => d ? { ...d, subject: e.target.value } : d)}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Body</label>
                <textarea
                  rows={14}
                  value={draft.body}
                  onChange={e => setDraft(d => d ? { ...d, body: e.target.value } : d)}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y leading-relaxed"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Send to · {draft.stakeholders.length} contact{draft.stakeholders.length !== 1 ? 's' : ''} found
                </label>
                <StakeholderList stakeholders={draft.stakeholders} />
              </div>
            </>
          )}

          {/* Follow-up email */}
          {tab === 'followup' && followUp && (
            <>
              <div className="text-xs text-amber-400/80 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                Send ~4 days after the initial email with no reply. Short by design.
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Subject</label>
                <input
                  type="text"
                  value={followUp.followup_subject}
                  onChange={e => setFollowUp(f => f ? { ...f, followup_subject: e.target.value } : f)}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Body</label>
                <textarea
                  rows={8}
                  value={followUp.followup_body}
                  onChange={e => setFollowUp(f => f ? { ...f, followup_body: e.target.value } : f)}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y leading-relaxed"
                />
              </div>
              {draft && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Send to</label>
                  <StakeholderList stakeholders={draft.stakeholders} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {(draft && !loading) && (
          <div className="px-6 py-4 border-t border-gray-800 space-y-3">
            {/* Gmail + copy */}
            <div className="flex items-center gap-3">
              <button
                onClick={openInGmail}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
              >
                <GmailIcon />
                Open in Gmail
              </button>
              <button
                onClick={copyFullEmail}
                className="px-4 py-2.5 rounded-xl border border-gray-700 hover:border-gray-600 text-gray-300 text-sm font-medium transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy all'}
              </button>
            </div>

            {/* Manual status progression */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-gray-600 shrink-0">Mark as:</span>
              {['sent', 'replied', 'booked'].map(s => (
                <button
                  key={s}
                  onClick={() => onEmailSent()}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-400 hover:border-indigo-600 hover:text-indigo-400 transition-colors capitalize"
                  title={`Mark this lead as ${s}`}
                >
                  {s === 'sent' ? '✈ Sent' : s === 'replied' ? '↩ Replied' : '📅 Booked'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
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
