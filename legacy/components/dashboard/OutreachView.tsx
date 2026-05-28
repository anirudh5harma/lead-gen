'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Lead } from '@/lib/leads'
import type { UserProfile } from './types'
import LeadDrawer from './LeadDrawer'

interface Props { profile: UserProfile; leads: Lead[]; focusLeadId?: string | null }

/**
 * Lead Pipeline — styled after the Stitch "Internal Ops & Review Drawer":
 * editorial title · Priority Leads table · Sent Outreach table · Review Drawer.
 */
export default function OutreachView({ leads, focusLeadId }: Props) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [reviewMode, setReviewMode] = useState<'open' | 'review'>('open')

  const { priority, sentOut } = useMemo(() => ({
    priority: leads.filter(l => (l.status === 'drafted' || l.status === 'delivered' || l.status === 'unlocked') && !l.sent_at),
    sentOut: leads.filter(l => l.sent_at),
  }), [leads])

  useEffect(() => {
    if (!focusLeadId) return
    const handle = window.setTimeout(() => {
      const desktop = document.getElementById(`pipeline-lead-${focusLeadId}`)
      const mobile = document.getElementById(`pipeline-lead-${focusLeadId}-m`)
      const target = (desktop && desktop.offsetParent) ? desktop : mobile
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(handle)
  }, [focusLeadId])

  function open(l: Lead, mode: 'open' | 'review') { setReviewMode(mode); setSelectedLead(l) }

  return (
    <div className="space-y-section-gap font-body-main text-on-surface">
      <div>
        <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Outreach</p>
        <h2 className="font-h1-editorial text-display-sm text-on-surface">
          The <span className="italic text-primary">lead</span> pipeline.
        </h2>
        <p className="font-body-main text-on-surface-variant max-w-xl mt-stack-md">
          High-confidence targets surfaced by the fleet. Review and approve outreach before it ships.
        </p>
      </div>

      <div className="space-y-12 md:space-y-20">
        {/* Priority Leads */}
        <section>
          <div className="flex items-center justify-between mb-6 md:mb-8 hairline-b pb-2 gap-3 flex-wrap">
            <h3 className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Priority Leads</h3>
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-primary bg-primary-container/10 px-2 py-1 rounded">{priority.length} Candidates</span>
          </div>
          {priority.length === 0 ? (
            <EmptyRow text="No leads waiting for review. The fleet will surface fresh candidates as signals land." />
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="md:hidden space-y-3">
                {priority.slice(0, 50).map((l) => (
                  <div key={l.id} id={`pipeline-lead-${l.id}-m`} className="scroll-mt-24 bg-surface-container-lowest hairline-border rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-body-large text-on-surface truncate">{l.contact_name || 'Contact unresolved'}</div>
                        <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider truncate">{l.contact_title || 'Target stakeholder'}</div>
                      </div>
                      <span className="text-tertiary font-label-mono text-base shrink-0">{Math.round(l.relevance_score ?? 0)}%</span>
                    </div>
                    <div className="mt-2 font-body-main text-on-surface text-[14px] truncate">{l.target_company}</div>
                    {(l.company_domain || l.relevance_reason) && (
                      <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider truncate mt-0.5">{l.company_domain || l.relevance_reason}</div>
                    )}
                    <button onClick={() => open(l, 'review')}
                      className="mt-4 w-full bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] px-6 py-3 hover:bg-primary-container transition-all">
                      Review
                    </button>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left font-body-main border-collapse">
                  <thead>
                    <tr className="text-on-surface-variant border-b border-outline-variant/30">
                      <Th>Contact</Th><Th>Company</Th><Th className="text-center">Confidence</Th><Th className="text-right">Action</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {priority.slice(0, 50).map((l) => (
                      <tr key={l.id} id={`pipeline-lead-${l.id}`} className="scroll-mt-24 group hover:bg-surface-container-low/40 transition-colors">
                        <td className="py-6 px-2">
                          <div className="font-body-large text-on-surface">{l.contact_name || 'Contact unresolved'}</div>
                          <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider">{l.contact_title || 'Target stakeholder'}</div>
                        </td>
                        <td className="py-6 px-2">
                          <div className="font-body-main text-on-surface">{l.target_company}</div>
                          <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider truncate max-w-[260px]">{l.company_domain || l.relevance_reason || '—'}</div>
                        </td>
                        <td className="py-6 px-2 text-center">
                          <span className="text-tertiary font-label-mono text-lg">{Math.round(l.relevance_score ?? 0)}%</span>
                        </td>
                        <td className="py-6 px-2 text-right">
                          <button onClick={() => open(l, 'review')}
                            className="bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] px-6 py-2.5 hover:bg-primary-container transition-all shadow-sm">Review</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Sent Outreach */}
        <section>
          <div className="flex items-center justify-between mb-6 md:mb-8 hairline-b pb-2">
            <h3 className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Sent Outreach</h3>
          </div>
          {sentOut.length === 0 ? (
            <EmptyRow text="Nothing dispatched yet. Approved outreach will appear here with live reply tracking." />
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="md:hidden space-y-3">
                {sentOut.slice(0, 50).map((l) => {
                  const st = statusOf(l)
                  return (
                    <div key={l.id} id={`pipeline-lead-${l.id}-m`} className="scroll-mt-24 bg-surface-container-lowest hairline-border rounded-lg p-4">
                      <div className="font-body-large text-on-surface truncate">{l.contact_name || l.target_company}</div>
                      <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider truncate mt-0.5">
                        {l.contact_title ? `${l.contact_title} @ ${l.target_company}` : l.target_company}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-2 font-label-mono text-[10px] uppercase tracking-widest ${st.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${st.pulse ? 'animate-pulse' : ''}`} /> {st.label}
                        </span>
                        <span className="text-on-surface-variant font-label-mono text-xs">{fmtDate(l.sent_at)}</span>
                      </div>
                      <button onClick={() => open(l, 'open')}
                        className="mt-4 w-full border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-6 py-3 hover:bg-surface-container transition-all">
                        View
                      </button>
                    </div>
                  )
                })}
              </div>
              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left font-body-main border-collapse">
                  <thead>
                    <tr className="text-on-surface-variant border-b border-outline-variant/30">
                      <Th>Recipient</Th><Th>Status</Th><Th className="text-center">Sent Date</Th><Th className="text-right">Action</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {sentOut.slice(0, 50).map((l) => {
                      const st = statusOf(l)
                      return (
                        <tr key={l.id} id={`pipeline-lead-${l.id}`} className="scroll-mt-24 group hover:bg-surface-container-low/40 transition-colors">
                          <td className="py-6 px-2">
                            <div className="font-body-large text-on-surface">{l.contact_name || l.target_company}</div>
                            <div className="text-caption font-caption text-on-surface-variant uppercase tracking-wider">{l.contact_title ? `${l.contact_title} @ ${l.target_company}` : l.target_company}</div>
                          </td>
                          <td className="py-6 px-2">
                            <span className={`inline-flex items-center gap-2 font-label-mono text-[10px] uppercase tracking-widest ${st.cls}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${st.pulse ? 'animate-pulse' : ''}`} /> {st.label}
                            </span>
                          </td>
                          <td className="py-6 px-2 text-center text-on-surface-variant font-label-mono text-xs">{fmtDate(l.sent_at)}</td>
                          <td className="py-6 px-2 text-right">
                            <button onClick={() => open(l, 'open')}
                              className="border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-6 py-2.5 hover:bg-surface-container transition-all">View</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <LeadDrawer lead={selectedLead} mode={reviewMode} onClose={() => setSelectedLead(null)} />
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-4 px-2 font-label-mono text-[10px] uppercase tracking-widest ${className}`}>{children}</th>
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="bg-surface-container-lowest hairline-border rounded-lg px-6 py-12 text-center">
      <p className="font-body-main text-on-surface-variant max-w-md mx-auto">{text}</p>
    </div>
  )
}

function statusOf(l: Lead): { label: string; cls: string; dot: string; pulse: boolean } {
  if (l.replied_at) {
    if (l.reply_intent === 'meeting_requested') return { label: 'Meeting requested', cls: 'text-primary', dot: 'bg-primary', pulse: true }
    if (l.reply_intent === 'not_interested') return { label: 'Not interested', cls: 'text-on-surface-variant', dot: 'bg-outline-variant', pulse: false }
    return { label: 'Replied', cls: 'text-tertiary', dot: 'bg-tertiary', pulse: true }
  }
  return { label: 'Awaiting reply', cls: 'text-on-surface-variant', dot: 'bg-outline-variant', pulse: false }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}
