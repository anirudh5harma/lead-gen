'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'
import Icon from '@/components/Icon'
import { useToast } from '@/components/Toast'

interface LeadDrawerProps {
  lead: Lead | null
  mode?: 'open' | 'review'
  onClose: () => void
}

interface DraftState {
  subject: string
  body: string
  to: string | null
  to_name?: string | null
  cc?: Array<{ name?: string; email: string }>
  quality_eval?: { score?: number; failed?: string[]; checks?: Array<{ id: string; passed: boolean; detail: string }> }
  contact_resolution?: Record<string, unknown>
}

/**
 * Review Drawer — styled after the Stitch "Internal Ops & Review Drawer":
 * slide-in panel · verified intelligence · outreach composition · approve & dispatch.
 */
export default function LeadDrawer({ lead, mode = 'open', onClose }: LeadDrawerProps) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [sent, setSent] = useState(false)
  const [editing, setEditing] = useState(false)

  const open = lead != null

  useEffect(() => { setDraft(null); setSent(false); setEditing(false) }, [lead?.id])

  useEffect(() => {
    if (!lead || draft || busy) return
    void generateDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id])

  useEffect(() => {
    if (!lead) return
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lead, onClose])

  const signal = useMemo(() => normalizeSignal(lead?.feed_snapshot ?? lead?.signals ?? null), [lead])
  const cc = draft?.cc?.filter(item => item.email).map(item => item.email) ?? []
  const proof = useMemo(() => buildLeadProof(lead, signal), [lead, signal])
  const messageReasoning = useMemo(() => buildMessageReasoning(lead, signal, draft), [lead, signal, draft])
  const nextAction = useMemo(() => buildNextAction(lead, draft), [lead, draft])

  async function request<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init)
    const json = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new Error(json.error || `Request failed with ${response.status}`)
    return json
  }

  async function unlockLead() {
    if (!lead) return
    setBusy('unlock')
    try {
      const result = await request<{ contact?: { email?: string | null; name?: string | null; title?: string | null } | null }>(
        `/api/leads/${lead.id}/unlock`, { method: 'POST' },
      )
      if (result.contact?.email) {
        setDraft(current => current ? { ...current, to: current.to ?? result.contact?.email ?? null } : current)
      }
      toast.success('Lead unlocked.')
      router.refresh()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not unlock lead.') }
    finally { setBusy(null) }
  }

  async function generateDraft() {
    if (!lead) return
    setBusy('draft')
    try {
      const result = await request<{ draft: DraftState }>(`/api/leads/${lead.id}/draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      setDraft(result.draft)
      toast.success('Draft prepared.')
      router.refresh()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not prepare draft.') }
    finally { setBusy(null) }
  }

  async function sendDraft() {
    if (!lead || !draft?.to || !draft.subject || !draft.body) return
    setBusy('send')
    try {
      await request('/api/outreach/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, to: draft.to, cc, subject: draft.subject, body: draft.body }),
      })
      setSent(true)
      toast.success('Outreach dispatched. The fleet will watch for replies and bookings.')
      router.refresh()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not send outreach.') }
    finally { setBusy(null) }
  }

  async function updateStatus(status: 'viewed' | 'dismissed' | 'booked') {
    if (!lead) return
    setBusy(status)
    try {
      await request(`/api/leads/${lead.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      const messages: Record<typeof status, string> = { viewed: 'Marked as viewed.', dismissed: 'Lead dismissed.', booked: 'Marked as booked.' }
      toast.success(messages[status])
      router.refresh()
      if (status === 'dismissed') onClose()
    } catch (err) { toast.error(err instanceof Error ? err.message : `Could not mark ${status}.`) }
    finally { setBusy(null) }
  }

  const contactState = lead?.contact_email ? 'Ready' : lead?.is_unlocked ? 'Unlocked' : 'Locked'
  const fitScore = Math.round(lead?.relevance_score ?? 0)
  const recipientEmail = draft?.to || lead?.contact_email || null
  const isReview = mode === 'review' && !sent

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-on-surface/10 backdrop-blur-sm z-[60] transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {/* Drawer */}
      <aside
        data-open={open}
        className="drawer-panel fixed top-0 right-0 h-full w-full max-w-xl bg-surface border-l border-outline-variant z-[70] shadow-2xl flex flex-col font-body-main text-on-surface"
      >
        {/* Header */}
        <div className="p-8 border-b border-outline-variant flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="font-h1-editorial text-3xl">{lead?.sent_at ? 'Sent Outreach' : isReview ? 'Review Outreach' : 'Outreach Detail'}</h4>
            <p className="font-label-mono text-[10px] uppercase tracking-[0.2em] text-primary mt-2 truncate">
              {lead?.contact_name || lead?.target_company || '—'}{lead?.target_company && lead?.contact_name ? ` · ${lead.target_company}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors p-2 shrink-0" aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-12">
          {/* Verified Intelligence */}
          <section>
            <div className="flex items-center justify-between gap-4 mb-6">
              <h5 className="font-label-mono text-[10px] uppercase tracking-[0.3em] text-on-surface-variant">Evidence</h5>
              <span className={proof.sourceBadgeClass}>{proof.sourceLabel}</span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <IntelRow icon="mail" accent value={recipientEmail || 'Unlock or prepare a draft to resolve email'}
                badge={lead?.is_unlocked || lead?.contact_email ? 'Verified' : 'Locked'} />
              <IntelRow icon="badge" value={`${lead?.contact_name || draft?.to_name || 'Contact unresolved'} · ${lead?.contact_title || 'Target stakeholder'}`} />
              <IntelRow icon="link" value={lead?.company_domain || 'No domain on file'} />
              <IntelRow icon="insights" value={`Fit ${fitScore}/10 · ${proof.signalType} · ${relTime(proof.publishedAt ?? lead?.created_at)}`} badge={`Contact: ${contactState}`} />
            </div>
            <div className="mt-5 border-t border-outline-variant/30 pt-5">
              <p className="font-label-mono text-[10px] uppercase tracking-[0.3em] text-on-surface-variant mb-3">Why now</p>
              <p className="font-body-main text-on-surface-variant leading-relaxed">
                {proof.summary}
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {proof.evidence.map(item => (
                  <EvidenceItem key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
              {proof.sourceUrl && (
                <a href={proof.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 font-label-mono text-[10px] uppercase tracking-widest text-primary hover:underline">
                  <Icon name="open_in_new" size={14} /> Open source
                </a>
              )}
            </div>
          </section>

          <section className="hairline-border bg-surface-container-low/40 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <Icon name={nextAction.icon} size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-label-mono text-[10px] uppercase tracking-[0.3em] text-on-surface-variant">Next best action</p>
                <p className="font-body-main font-medium text-on-surface mt-2">{nextAction.label}</p>
                <p className="font-body-main text-on-surface-variant text-[13px] leading-relaxed mt-1">{nextAction.reason}</p>
              </div>
            </div>
          </section>

          {/* Outreach Composition */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h5 className="font-label-mono text-[10px] uppercase tracking-[0.3em] text-on-surface-variant">Outreach Composition</h5>
              <div className="flex items-center gap-4">
                {!lead?.is_unlocked && (
                  <button onClick={() => void unlockLead()} disabled={busy != null}
                    className="text-on-surface-variant font-label-mono text-[10px] uppercase tracking-widest flex items-center gap-1.5 hover:text-primary disabled:opacity-40">
                    <Icon name="lock_open" size={14} /> {busy === 'unlock' ? 'Unlocking…' : 'Unlock'}
                  </button>
                )}
                {draft && !lead?.sent_at && (
                  <button onClick={() => setEditing(e => !e)}
                    className="text-primary font-label-mono text-[10px] uppercase tracking-widest flex items-center gap-1.5 hover:underline">
                    <Icon name="edit" size={14} /> {editing ? 'Done editing' : 'Manual edit'}
                  </button>
                )}
              </div>
            </div>

            {draft ? (
              <div className="bg-surface-container-lowest border border-outline-variant p-8 font-body-main text-on-surface-variant leading-relaxed shadow-sm rounded-lg">
                <div className="mb-8 pb-4 border-b border-outline-variant/30">
                  <span className="font-label-mono text-[10px] uppercase text-on-surface-variant">Subject:</span>
                  {editing ? (
                    <input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })}
                      className="ml-2 bg-transparent border-b border-outline-variant text-on-surface outline-none focus:border-primary w-[calc(100%-5rem)]" />
                  ) : (
                    <span className="ml-2 text-on-surface">{draft.subject}</span>
                  )}
                  {draft.quality_eval?.score != null && (
                    <span className="ml-3 font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-2 py-0.5 rounded">Q {draft.quality_eval.score}</span>
                  )}
                </div>
                {editing ? (
                  <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })}
                    className="w-full min-h-[280px] resize-y bg-transparent border border-outline-variant/40 rounded p-4 text-on-surface outline-none focus:border-primary leading-relaxed" />
                ) : (
                  <div className="space-y-4 whitespace-pre-wrap text-on-surface-variant">{draft.body}</div>
                )}
                {cc.length > 0 && <p className="mt-6 font-label-mono text-[10px] uppercase text-on-surface-variant">cc · {cc.join(', ')}</p>}
                <MessageReasoningPanel items={messageReasoning} failedChecks={draft.quality_eval?.failed ?? []} />
                {!lead?.sent_at && (
                  <button onClick={() => void generateDraft()} disabled={busy != null}
                    className="mt-4 font-label-mono text-[9px] uppercase tracking-wider text-on-surface-variant/60 hover:text-primary disabled:opacity-40">
                    {busy === 'draft' ? 'Regenerating…' : 'Regenerate draft'}
                  </button>
                )}
              </div>
            ) : busy === 'draft' ? (
              <div className="bg-surface-container-lowest border border-outline-variant p-10 text-center rounded-lg">
                <p className="font-body-main text-on-surface-variant">Preparing draft…</p>
              </div>
            ) : (
              <div className="bg-surface-container-lowest border border-outline-variant p-10 text-center rounded-lg">
                <p className="font-body-main text-on-surface-variant">Could not load draft. Try closing and reopening this lead.</p>
              </div>
            )}

            {/* Secondary actions */}
            <div className="mt-6 flex items-center gap-5">
              <button onClick={() => void updateStatus('dismissed')} disabled={busy != null}
                className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-error disabled:opacity-40">Dismiss lead</button>
              <button onClick={() => void updateStatus('booked')} disabled={busy != null}
                className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-tertiary disabled:opacity-40">Mark booked</button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-outline-variant bg-surface-container-low/50 flex gap-4">
          <button onClick={onClose}
            className="flex-1 border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] py-4 hover:bg-surface-container transition-all">
            {sent || !isReview ? 'Close' : 'Cancel'}
          </button>
          {isReview && (
            <button onClick={() => void sendDraft()} disabled={busy != null || !draft?.to || !draft.subject || !draft.body}
              className="flex-[2] bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] py-4 hover:bg-primary-container transition-all shadow-lg disabled:opacity-50">
              {busy === 'send' ? 'Dispatching…' : 'Approve & Dispatch'}
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

function IntelRow({ icon, value, badge, accent }: { icon: string; value: string; badge?: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded">
      <div className="flex items-center gap-4 min-w-0">
        <Icon name={icon} size={20} className={accent ? 'text-primary shrink-0' : 'text-on-surface-variant shrink-0'} />
        <span className="font-body-main text-on-surface truncate">{value}</span>
      </div>
      {badge && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-2 py-0.5 rounded shrink-0">{badge}</span>}
    </div>
  )
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded p-3 min-w-0">
      <p className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="font-body-main text-[13px] text-on-surface mt-1 truncate">{value}</p>
    </div>
  )
}

function MessageReasoningPanel({ items, failedChecks }: { items: Array<{ label: string; value: string }>; failedChecks: string[] }) {
  return (
    <div className="mt-6 border-t border-outline-variant/30 pt-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-label-mono text-[10px] uppercase tracking-[0.3em] text-on-surface-variant">Message reasoning</p>
        {failedChecks.length > 0 && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-error/10 text-error px-2 py-0.5 rounded">{failedChecks.length} check{failedChecks.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(item => <EvidenceItem key={item.label} label={item.label} value={item.value} />)}
      </div>
      {failedChecks.length > 0 && (
        <p className="mt-3 font-body-main text-[12.5px] text-on-surface-variant">
          Improve before sending: {failedChecks.map(item => item.replaceAll('_', ' ')).join(', ')}.
        </p>
      )}
    </div>
  )
}

type NormalizedSignal = {
  headline?: string | null
  summary?: string | null
  signal_type?: string | null
  source_name?: string | null
  source_url?: string | null
  published_at?: string | null
  provider?: string | null
}

function normalizeSignal(value: unknown): NormalizedSignal | null {
  if (Array.isArray(value)) return normalizeSignal(value[0])
  if (!value || typeof value !== 'object') return null
  return value as NormalizedSignal
}

function buildLeadProof(lead: Lead | null, signal: NormalizedSignal | null) {
  const sourceName = signal?.source_name || signal?.provider || lead?.origin || 'lead feed'
  const sourceUrl = signal?.source_url ?? null
  const sourceScore = scoreSource(sourceName, sourceUrl)
  const sourceLabel = sourceScore >= 78 ? 'Strong source' : sourceScore >= 62 ? 'Review source' : 'Low confidence'
  const sourceBadgeClass = sourceScore >= 78
    ? 'font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-2 py-0.5 rounded shrink-0'
    : sourceScore >= 62
      ? 'font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-2 py-0.5 rounded shrink-0'
      : 'font-label-mono text-[9px] uppercase tracking-widest bg-error/10 text-error px-2 py-0.5 rounded shrink-0'
  return {
    sourceLabel,
    sourceBadgeClass,
    sourceUrl,
    signalType: humanize(signal?.signal_type || lead?.signal_type || 'signal'),
    publishedAt: signal?.published_at ?? null,
    summary: signal?.summary || signal?.headline || lead?.relevance_reason || 'No signal summary is attached to this lead yet.',
    evidence: [
      { label: 'Trigger', value: humanize(signal?.signal_type || lead?.signal_type || 'signal') },
      { label: 'Source', value: sourceName },
      { label: 'Signal age', value: relTime(signal?.published_at ?? lead?.created_at) },
      { label: 'Confidence', value: `${sourceScore}/100 source` },
    ],
  }
}

function buildMessageReasoning(lead: Lead | null, signal: NormalizedSignal | null, draft: DraftState | null) {
  const failed = draft?.quality_eval?.failed ?? []
  return [
    { label: 'Subject', value: draft?.subject ? subjectReason(draft.subject) : 'Preparing subject' },
    { label: 'Personalization', value: signal?.headline || signal?.summary ? 'Anchored to the lead trigger' : 'Uses account and contact context' },
    { label: 'CTA', value: draft?.body && /\?|15[- ]?minute|quick call|quick chat|compare notes|worth a quick/i.test(draft.body) ? 'Low-friction ask detected' : 'CTA needs review' },
    { label: 'Quality gate', value: draft?.quality_eval?.score != null ? `${draft.quality_eval.score}/100${failed.length ? ` · ${failed.length} open` : ' · passed'}` : 'Not evaluated yet' },
    { label: 'Recipient', value: draft?.to || lead?.contact_email || 'Recipient unresolved' },
    { label: 'Avoided', value: failed.includes('no_corporate_filler') ? 'Generic filler detected' : 'No known filler flags' },
  ]
}

function buildNextAction(lead: Lead | null, draft: DraftState | null) {
  if (!lead) return { icon: 'sensors', label: 'Select a lead', reason: 'Choose a lead to review the next move.' }
  if (lead.booked_at || lead.status === 'booked') return { icon: 'event_available', label: 'Record meeting outcome', reason: 'This account has a booking signal. Capture what happened so future campaigns learn from it.' }
  if (lead.replied_at || lead.status === 'replied') return { icon: 'mark_email_read', label: 'Handle reply', reason: lead.reply_summary || 'Review the reply and route it to booking, follow-up, or stop.' }
  if (lead.sent_at || lead.status === 'sent') return { icon: 'schedule_send', label: 'Watch for reply quality', reason: 'Outreach has already been sent. The next useful signal is reply intent or booking.' }
  if (!lead.is_unlocked && !lead.contact_email) return { icon: 'lock_open', label: 'Unlock contact', reason: 'Resolve a verified recipient before approving outreach.' }
  if (!draft) return { icon: 'edit_note', label: 'Prepare draft', reason: 'Generate the next move using this signal and the available account context.' }
  if ((draft.quality_eval?.score ?? 0) < 70) return { icon: 'rule', label: 'Edit or regenerate', reason: 'The quality gate is warning. Fix the failed checks before dispatch.' }
  return { icon: 'outgoing_mail', label: 'Approve and dispatch', reason: 'The recipient, evidence, and draft are ready for human approval.' }
}

function subjectReason(subject: string): string {
  const words = subject.trim().split(/\s+/).filter(Boolean).length
  if (words >= 2 && words <= 9) return 'Concise and scannable'
  return words > 9 ? 'May be too long' : 'May be too vague'
}

function scoreSource(sourceName: string | null | undefined, sourceUrl?: string | null): number {
  const source = `${sourceName ?? ''} ${sourceUrl ?? ''}`.toLowerCase()
  if (!source.trim()) return 54
  if (source.includes('sec.gov') || source.includes('crunchbase') || source.includes('linkedin')) return 88
  if (source.includes('prnewswire') || source.includes('businesswire') || source.includes('globenewswire')) return 78
  if (source.includes('company') || source.includes('official') || source.includes('crm_import')) return 72
  if (source.includes('explore_generated')) return 58
  if (source.includes('blog') || source.includes('newsletter')) return 62
  return 66
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function relTime(iso?: string | null): string {
  if (!iso) return 'Unknown'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.round(ms / 60_000); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
