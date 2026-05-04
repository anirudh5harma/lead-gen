'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GtmContentIdea } from './types'

interface MarketingPayload {
  ideas: GtmContentIdea[]
  metrics: Record<string, number>
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-[var(--color-accent)]/10 text-[var(--color-accent-ring)]',
  drafted: 'bg-[var(--color-sig-funding)]/10 text-[var(--color-sig-funding)]',
  approved: 'bg-[var(--color-sig-expansion)]/10 text-[var(--color-sig-expansion)]',
  dismissed: 'bg-[var(--color-ink-3)] text-[var(--color-text-3)]',
}

export default function MarketingView() {
  const [payload, setPayload] = useState<MarketingPayload>({ ideas: [], metrics: {} })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/gtm/content?limit=50')
    const data = await res.json().catch(() => null) as MarketingPayload & { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not load marketing content.')
    else setPayload({ ideas: data?.ideas ?? [], metrics: data?.metrics ?? {} })
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const visibleIdeas = useMemo(
    () => payload.ideas.filter(idea => idea.status !== 'dismissed'),
    [payload.ideas],
  )

  async function act(ideaId: string, action: 'draft' | 'approve' | 'dismiss') {
    setBusyId(ideaId)
    setError(null)
    const res = await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea_id: ideaId, action }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not update content idea.')
    await load()
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Ideas" value={payload.metrics.total ?? 0} />
        <Metric label="New" value={payload.metrics.new ?? 0} />
        <Metric label="Drafted" value={payload.metrics.drafted ?? 0} />
        <Metric label="Campaigns" value={payload.metrics.campaign_briefs ?? 0} />
      </section>

      {error && (
        <div className="rounded-lg border border-[var(--color-sig-regulation)]/25 bg-[var(--color-sig-regulation)]/8 px-4 py-3 text-[13px] text-[var(--color-sig-regulation)]">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--color-text-1)]">Content Ideas</h2>
            <p className="text-[12px] text-[var(--color-text-3)]">Generated from recent account signals and lead context.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-8 text-center text-[13px] text-[var(--color-text-3)]">
            Loading content workflow.
          </div>
        ) : visibleIdeas.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-8 text-center text-[13px] text-[var(--color-text-3)]">
            No content ideas yet. New signal-backed ideas will appear as leads and account signals arrive.
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleIdeas.map(idea => (
              <article
                key={idea.id}
                className="rounded-lg border border-[var(--color-line-1)] bg-white shadow-[0_1px_2px_#00000008] overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLES[idea.status] ?? STATUS_STYLES.new}`}>
                      {idea.status}
                    </span>
                    <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
                      {idea.content_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-3)]">{idea.audience}</span>
                  </div>

                  <h3 className="mt-3 text-[14px] font-semibold leading-snug text-[var(--color-text-1)]">{idea.angle}</h3>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {idea.proof_points.slice(0, 3).map(point => (
                      <div key={`${idea.id}:${point.label}`} className="rounded-md bg-[var(--color-ink-2)] px-3 py-2">
                        <p className="text-[10.5px] font-semibold uppercase text-[var(--color-text-3)]">{point.label}</p>
                        <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-2)] line-clamp-2">{point.value}</p>
                      </div>
                    ))}
                  </div>

                  {hasDraft(idea.draft) && (
                    <div className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-3">
                      <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{String(idea.draft.title ?? 'Draft')}</p>
                      <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-[var(--color-text-2)]">{String(idea.draft.body ?? '')}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-4 py-3">
                  <button
                    onClick={() => act(idea.id, 'draft')}
                    disabled={busyId === idea.id}
                    className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50"
                  >
                    Draft
                  </button>
                  <button
                    onClick={() => act(idea.id, 'approve')}
                    disabled={busyId === idea.id}
                    className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => act(idea.id, 'dismiss')}
                    disabled={busyId === idea.id}
                    className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[var(--color-text-3)] hover:bg-white hover:text-[var(--color-text-1)] disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <span className="ml-auto text-[11px] text-[var(--color-text-3)]">{idea.pain_category.replace(/_/g, ' ')}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}

function hasDraft(value: Record<string, unknown>): boolean {
  return Object.keys(value ?? {}).length > 0
}
