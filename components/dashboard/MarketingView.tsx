'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GtmContentIdea } from './types'

interface MarketingPayload {
  ideas: GtmContentIdea[]
  metrics: Record<string, number>
}

type ChannelTab = 'all' | 'social' | 'written' | 'video' | 'campaign'
type SourceMode = 'suggested' | 'custom'
type MarketingContentType = GtmContentIdea['content_type']
type HubTab = 'overview' | 'posts' | 'blogs' | 'videos'

const HUB_TABS: Array<{ id: HubTab; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Calendar, readiness, and distribution mix' },
  { id: 'posts', label: 'Posts', description: 'LinkedIn and X social distribution' },
  { id: 'blogs', label: 'Blogs', description: 'Articles and long-form written assets' },
  { id: 'videos', label: 'Videos', description: 'Short-form and explainer scripts' },
]

const CUSTOM_TYPES: Array<{ id: MarketingContentType; label: string; channel: ChannelTab }> = [
  { id: 'linkedin_post', label: 'LinkedIn post', channel: 'social' },
  { id: 'x_post', label: 'X post', channel: 'social' },
  { id: 'blog_article', label: 'Blog article', channel: 'written' },
  { id: 'video_script', label: 'Video script', channel: 'video' },
]

const PLATFORM_CARDS = [
  { id: 'linkedin', label: 'LinkedIn', category: 'Social', state: 'Ready for scheduling', tone: 'green' },
  { id: 'x', label: 'X', category: 'Social', state: 'Connect publishing account', tone: 'amber' },
  { id: 'blog', label: 'Blog/CMS', category: 'Articles', state: 'Export-ready drafts', tone: 'green' },
  { id: 'youtube', label: 'YouTube', category: 'Video', state: 'Script planning', tone: 'amber' },
] as const

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-[var(--color-accent)]/10 text-[var(--color-accent-ring)]',
  drafted: 'bg-[var(--color-sig-funding)]/10 text-[var(--color-sig-funding)]',
  approved: 'bg-[var(--color-sig-expansion)]/10 text-[var(--color-sig-expansion)]',
  dismissed: 'bg-[var(--color-ink-3)] text-[var(--color-text-3)]',
}

const TYPE_LABELS: Record<string, string> = {
  x_post: 'X Post',
  linkedin_post: 'LinkedIn Post',
  blog_article: 'Blog Article',
  video_script: 'Video Script',
  newsletter_blurb: 'Newsletter',
  campaign_brief: 'Campaign Brief',
  sales_enablement_note: 'Sales Note',
}

export default function MarketingView({ hub = 'overview' }: { hub?: HubTab }) {
  const [payload, setPayload] = useState<MarketingPayload>({ ideas: [], metrics: {} })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>('suggested')
  const [customType, setCustomType] = useState<MarketingContentType>('linkedin_post')
  const [customPrompt, setCustomPrompt] = useState('')
  const [assetText, setAssetText] = useState('')
  const [scheduleFor, setScheduleFor] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/gtm/content?limit=80')
    const data = await res.json().catch(() => null) as MarketingPayload & { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not load marketing content.')
    else setPayload({ ideas: data?.ideas ?? [], metrics: data?.metrics ?? {} })
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const activeIdeas = useMemo(() => payload.ideas.filter(idea => idea.status !== 'dismissed'), [payload.ideas])
  const hubIdeas = useMemo(() => filterIdeasForHub(activeIdeas, hub), [activeIdeas, hub])
  const effectiveCustomType = normalizeCustomTypeForHub(hub, customType)

  const calendarDays = useMemo(() => buildMarketingCalendar(activeIdeas), [activeIdeas])
  const scheduledThisMonth = activeIdeas.filter(idea => Boolean(idea.scheduled_for)).length
  const approvedReady = activeIdeas.filter(idea => idea.status === 'approved' && !idea.scheduled_for).length

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

  async function createCustomContent() {
    if (customPrompt.trim().length < 8 || busyId) return
    setBusyId('custom')
    setError(null)
    const assets = assetText
      .split(/\n{2,}/)
      .map((value, index) => ({ label: `Asset ${index + 1}`, value: value.trim() }))
      .filter(asset => asset.value)
    const res = await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_custom',
        content_type: effectiveCustomType,
        prompt: customPrompt,
        assets,
      }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not create custom content.')
    else {
      setCustomPrompt('')
      setAssetText('')
      setSourceMode('custom')
      await load()
    }
    setBusyId(null)
  }

  async function scheduleIdea(idea: GtmContentIdea) {
    const value = scheduleFor[idea.id]
    if (!value || busyId) return
    setBusyId(idea.id)
    setError(null)
    const res = await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idea_id: idea.id,
        action: 'schedule',
        scheduled_for: new Date(value).toISOString(),
      }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not schedule content.')
    await load()
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-[var(--color-sig-regulation)]/25 bg-[var(--color-sig-regulation)]/8 px-4 py-3 text-[13px] text-[var(--color-sig-regulation)]">
          {error}
        </div>
      )}

      <ContentHubHeader
        hub={hub}
        loading={loading}
        onRefresh={load}
      />

      {hub === 'overview' ? (
        <OverviewWorkspace
          ideas={activeIdeas}
          calendarDays={calendarDays}
          scheduledThisMonth={scheduledThisMonth}
          approvedReady={approvedReady}
          customDrafts={payload.metrics.custom ?? 0}
        />
      ) : (
        <ContentTypeWorkspace
          hub={hub}
          ideas={hubIdeas}
          sourceMode={sourceMode}
          customType={effectiveCustomType}
          customPrompt={customPrompt}
          assetText={assetText}
          loading={loading}
          busyId={busyId}
          scheduleFor={scheduleFor}
          onSourceMode={setSourceMode}
          onCustomType={setCustomType}
          onPrompt={setCustomPrompt}
          onAssets={setAssetText}
          onCreate={createCustomContent}
          onScheduleValue={(ideaId, value) => setScheduleFor(current => ({ ...current, [ideaId]: value }))}
          onSchedule={scheduleIdea}
          onDraft={ideaId => act(ideaId, 'draft')}
          onApprove={ideaId => act(ideaId, 'approve')}
          onDismiss={ideaId => act(ideaId, 'dismiss')}
        />
      )}
    </div>
  )
}

function ContentHubHeader({
  hub,
  loading,
  onRefresh,
}: {
  hub: HubTab
  loading: boolean
  onRefresh: () => void
}) {
  const tab = HUB_TABS.find(item => item.id === hub) ?? HUB_TABS[0]
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[var(--color-line-1)] bg-[linear-gradient(135deg,#f8fbff_0%,#f7f3ea_52%,#eef7f2_100%)] px-5 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-ring)]">Marketing workspace</p>
            <h2 className="mt-1 text-lg font-bold text-[var(--color-text-1)]">{tab.label}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-text-3)]">
              {tab.description}
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="h-8 rounded-lg border border-white/80 bg-white/80 px-3 text-[12px] font-semibold text-[var(--color-text-2)] shadow-sm hover:text-[var(--color-text-1)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>
      {hub !== 'overview' && (
        <div className="border-t border-[var(--color-line-1)] px-4 py-3 text-[11px] text-[var(--color-text-4)]">
          Suggested ideas come from Bombsell context. Custom items come from your prompt and assets.
        </div>
      )}
    </section>
  )
}

function OverviewWorkspace({
  ideas,
  calendarDays,
  scheduledThisMonth,
  approvedReady,
  customDrafts,
}: {
  ideas: GtmContentIdea[]
  calendarDays: Array<{ date: Date; items: GtmContentIdea[]; inMonth: boolean }>
  scheduledThisMonth: number
  approvedReady: number
  customDrafts: number
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Active items" value={ideas.length} />
          <Metric label="Scheduled" value={scheduledThisMonth} />
          <Metric label="Ready to schedule" value={approvedReady} />
          <Metric label="Custom drafts" value={customDrafts} />
        </div>
        <div className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Monthly distribution mix</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <MixCard label="Posts" value={filterIdeasForHub(ideas, 'posts').length} />
            <MixCard label="Blogs" value={filterIdeasForHub(ideas, 'blogs').length} />
            <MixCard label="Videos" value={filterIdeasForHub(ideas, 'videos').length} />
          </div>
        </div>
      </div>
      <aside className="space-y-4">
        <PlatformPanel />
        <CalendarPanel days={calendarDays} />
      </aside>
    </section>
  )
}

function ContentTypeWorkspace({
  hub,
  ideas,
  sourceMode,
  customType,
  customPrompt,
  assetText,
  loading,
  busyId,
  scheduleFor,
  onSourceMode,
  onCustomType,
  onPrompt,
  onAssets,
  onCreate,
  onScheduleValue,
  onSchedule,
  onDraft,
  onApprove,
  onDismiss,
}: {
  hub: Exclude<HubTab, 'overview'>
  ideas: GtmContentIdea[]
  sourceMode: SourceMode
  customType: MarketingContentType
  customPrompt: string
  assetText: string
  loading: boolean
  busyId: string | null
  scheduleFor: Record<string, string>
  onSourceMode: (value: SourceMode) => void
  onCustomType: (value: MarketingContentType) => void
  onPrompt: (value: string) => void
  onAssets: (value: string) => void
  onCreate: () => void
  onScheduleValue: (ideaId: string, value: string) => void
  onSchedule: (idea: GtmContentIdea) => void
  onDraft: (ideaId: string) => void
  onApprove: (ideaId: string) => void
  onDismiss: (ideaId: string) => void
}) {
  const suggested = ideas.filter(idea => (idea.origin ?? 'suggested') !== 'custom' && idea.status === 'new')
  const drafts = ideas.filter(idea => idea.status === 'drafted')
  const ready = ideas.filter(idea => idea.status === 'approved' || Boolean(idea.scheduled_for))
  const customItems = ideas.filter(idea => (idea.origin ?? 'suggested') === 'custom')
  const visibleSuggestions = sourceMode === 'suggested' ? suggested : customItems
  const availableTypes = CUSTOM_TYPES.filter(type => type.channel === hubToChannel(hub))

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">{HUB_TABS.find(tab => tab.id === hub)?.label}</h3>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">Move from ideas to drafts, then schedule the strongest assets.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onSourceMode('suggested')} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${sourceMode === 'suggested' ? 'bg-[var(--color-text-1)] text-white' : 'border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)]'}`}>Suggested</button>
            <button onClick={() => onSourceMode('custom')} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${sourceMode === 'custom' ? 'bg-[var(--color-text-1)] text-white' : 'border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)]'}`}>Custom</button>
          </div>
        </div>
      </div>

      {sourceMode === 'custom' && (
        <CustomContentPanel
          customType={availableTypes.some(type => type.id === customType) ? customType : availableTypes[0]?.id ?? customType}
          allowedTypes={availableTypes}
          customPrompt={customPrompt}
          assetText={assetText}
          busy={busyId === 'custom'}
          onType={onCustomType}
          onPrompt={onPrompt}
          onAssets={onAssets}
          onCreate={onCreate}
        />
      )}

      {loading ? (
        <EmptyPanel text="Loading content workflow." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <ContentLane
            title={sourceMode === 'suggested' ? 'Suggested ideas' : 'Custom items'}
            empty={sourceMode === 'suggested' ? 'No suggested ideas in this category yet.' : 'No custom drafts in this category yet.'}
            ideas={visibleSuggestions}
            busyId={busyId}
            scheduleFor={scheduleFor}
            onScheduleValue={onScheduleValue}
            onSchedule={onSchedule}
            onDraft={onDraft}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
          <ContentLane
            title="Drafts"
            empty="No drafts yet. Draft a suggestion or generate a custom item."
            ideas={drafts}
            busyId={busyId}
            scheduleFor={scheduleFor}
            onScheduleValue={onScheduleValue}
            onSchedule={onSchedule}
            onDraft={onDraft}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
          <ContentLane
            title="Ready and scheduled"
            empty="No approved or scheduled assets yet."
            ideas={ready}
            busyId={busyId}
            scheduleFor={scheduleFor}
            onScheduleValue={onScheduleValue}
            onSchedule={onSchedule}
            onDraft={onDraft}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
        </div>
      )}
    </section>
  )
}

function ContentLane({
  title,
  empty,
  ideas,
  busyId,
  scheduleFor,
  onScheduleValue,
  onSchedule,
  onDraft,
  onApprove,
  onDismiss,
}: {
  title: string
  empty: string
  ideas: GtmContentIdea[]
  busyId: string | null
  scheduleFor: Record<string, string>
  onScheduleValue: (ideaId: string, value: string) => void
  onSchedule: (idea: GtmContentIdea) => void
  onDraft: (ideaId: string) => void
  onApprove: (ideaId: string) => void
  onDismiss: (ideaId: string) => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-3)]">{title}</h4>
        <span className="text-[11px] font-semibold text-[var(--color-text-4)]">{ideas.length}</span>
      </div>
      {ideas.length === 0 ? (
        <EmptyPanel text={empty} />
      ) : (
        <div className="grid gap-3">
          {ideas.map(idea => (
            <ContentCard
              key={idea.id}
              idea={idea}
              busy={busyId === idea.id}
              scheduleValue={scheduleFor[idea.id] ?? toDateTimeLocal(idea.scheduled_for)}
              onScheduleValue={value => onScheduleValue(idea.id, value)}
              onSchedule={() => onSchedule(idea)}
              onDraft={() => onDraft(idea.id)}
              onApprove={() => onApprove(idea.id)}
              onDismiss={() => onDismiss(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CustomContentPanel({
  customType,
  allowedTypes,
  customPrompt,
  assetText,
  busy,
  onType,
  onPrompt,
  onAssets,
  onCreate,
}: {
  customType: MarketingContentType
  allowedTypes?: Array<{ id: MarketingContentType; label: string; channel: ChannelTab }>
  customPrompt: string
  assetText: string
  busy: boolean
  onType: (value: MarketingContentType) => void
  onPrompt: (value: string) => void
  onAssets: (value: string) => void
  onCreate: () => void
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Format</span>
          <select
            value={customType}
            onChange={event => onType(event.target.value as MarketingContentType)}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]"
          >
            {(allowedTypes ?? CUSTOM_TYPES).map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Prompt</span>
          <input
            value={customPrompt}
            onChange={event => onPrompt(event.target.value)}
            placeholder="Example: turn this funding signal into a founder-led LinkedIn post"
            className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Assets or notes</span>
        <textarea
          value={assetText}
          onChange={event => onAssets(event.target.value)}
          rows={4}
          placeholder="Paste notes, positioning, transcript snippets, customer proof, or source material. Separate assets with a blank line."
          className="mt-1 w-full resize-none rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-1)]"
        />
      </label>
      <div className="mt-3 flex justify-end">
        <button
          onClick={onCreate}
          disabled={busy || customPrompt.trim().length < 8}
          className="h-9 rounded-lg btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? 'Generating' : 'Generate draft'}
        </button>
      </div>
    </section>
  )
}

function ContentCard({
  idea,
  busy,
  scheduleValue,
  onScheduleValue,
  onSchedule,
  onDraft,
  onApprove,
  onDismiss,
}: {
  idea: GtmContentIdea
  busy: boolean
  scheduleValue: string
  onScheduleValue: (value: string) => void
  onSchedule: () => void
  onDraft: () => void
  onApprove: () => void
  onDismiss: () => void
}) {
  const channel = idea.channel ?? channelForType(idea.content_type)
  return (
    <article className="rounded-lg border border-[var(--color-line-1)] bg-white shadow-[0_1px_2px_#00000008] overflow-hidden">
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLES[idea.status] ?? STATUS_STYLES.new}`}>
            {idea.status}
          </span>
          <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
            {TYPE_LABELS[idea.content_type] ?? idea.content_type.replace(/_/g, ' ')}
          </span>
          <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
            {channel}
          </span>
          <span className="text-[11px] text-[var(--color-text-3)]">{idea.audience}</span>
          {typeof idea.score === 'number' && idea.score > 0 && (
            <span className="ml-auto rounded-full bg-[#eef6f1] px-2 py-0.5 text-[10.5px] font-semibold text-[#2f6d46]">
              {Math.round(idea.score)} fit
            </span>
          )}
        </div>

        <h3 className="mt-3 text-[14px] font-semibold leading-snug text-[var(--color-text-1)]">{idea.angle}</h3>

        {(idea.pillar || idea.idea_format || idea.why_now) && (
          <div className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <div className="flex flex-wrap gap-2 text-[10.5px] font-semibold text-[var(--color-text-3)]">
              {idea.pillar && <span>{idea.pillar}</span>}
              {idea.idea_format && <span>{idea.idea_format}</span>}
            </div>
            {idea.why_now && <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-2)] line-clamp-2">{idea.why_now}</p>}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(idea.source_insights?.length ? idea.source_insights : idea.proof_points).slice(0, 3).map(point => (
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
        <button onClick={onDraft} disabled={busy} className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50">Draft</button>
        <button onClick={onApprove} disabled={busy} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Approve</button>
        <input
          type="datetime-local"
          value={scheduleValue}
          onChange={event => onScheduleValue(event.target.value)}
          className="h-8 rounded-lg border border-[var(--color-line-1)] bg-white px-2 text-[11px] text-[var(--color-text-2)]"
        />
        <button onClick={onSchedule} disabled={busy || !scheduleValue} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Schedule</button>
        <button onClick={onDismiss} disabled={busy} className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[var(--color-text-3)] hover:bg-white hover:text-[var(--color-text-1)] disabled:opacity-50">Dismiss</button>
        {idea.scheduled_for && <span className="ml-auto text-[11px] text-[var(--color-text-3)]">Scheduled {formatShortDateTime(idea.scheduled_for)}</span>}
      </div>
    </article>
  )
}

function PlatformPanel() {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Distribution accounts</h3>
      <div className="mt-3 space-y-2">
        {PLATFORM_CARDS.map(platform => (
          <div key={platform.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <div>
              <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{platform.label}</p>
              <p className="text-[11px] text-[var(--color-text-4)]">{platform.category}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${platform.tone === 'green' ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : 'bg-[#fff4df] text-[#936014]'}`}>
              {platform.state}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CalendarPanel({ days }: { days: Array<{ date: Date; items: GtmContentIdea[]; inMonth: boolean }> }) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Distribution calendar</h3>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-[var(--color-text-4)]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}:${index}`}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map(day => (
          <div key={day.date.toISOString()} className={`min-h-14 rounded-md border px-1.5 py-1 ${day.inMonth ? 'border-[var(--color-line-1)] bg-white' : 'border-transparent bg-[var(--color-ink-1)] text-[var(--color-text-4)]'}`}>
            <p className="text-[10px] font-semibold text-[var(--color-text-3)]">{day.date.getDate()}</p>
            <div className="mt-1 flex flex-wrap gap-0.5">
              {day.items.slice(0, 3).map(item => (
                <span key={item.id} title={item.angle} className={`h-1.5 w-1.5 rounded-full ${dotClass(item.channel ?? channelForType(item.content_type))}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
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

function MixCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-3">
      <p className="text-[11px] font-semibold text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-8 text-center text-[13px] text-[var(--color-text-3)]">
      {text}
    </div>
  )
}

function filterIdeasForHub(ideas: GtmContentIdea[], hub: HubTab): GtmContentIdea[] {
  if (hub === 'overview') return ideas
  if (hub === 'posts') return ideas.filter(idea => ['x_post', 'linkedin_post'].includes(idea.content_type))
  if (hub === 'blogs') return ideas.filter(idea => ['blog_article', 'newsletter_blurb'].includes(idea.content_type))
  return ideas.filter(idea => idea.content_type === 'video_script')
}

function hubToChannel(hub: Exclude<HubTab, 'overview'>): ChannelTab {
  if (hub === 'posts') return 'social'
  if (hub === 'blogs') return 'written'
  return 'video'
}

function normalizeCustomTypeForHub(hub: HubTab, value: MarketingContentType): MarketingContentType {
  if (hub === 'posts') return value === 'x_post' || value === 'linkedin_post' ? value : 'linkedin_post'
  if (hub === 'blogs') return 'blog_article'
  if (hub === 'videos') return 'video_script'
  return value
}

function buildMarketingCalendar(ideas: GtmContentIdea[]) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const cursor = new Date(start)
  cursor.setDate(cursor.getDate() - cursor.getDay())
  const last = new Date(end)
  last.setDate(last.getDate() + (6 - last.getDay()))
  const days: Array<{ date: Date; items: GtmContentIdea[]; inMonth: boolean }> = []
  while (cursor <= last) {
    const date = new Date(cursor)
    const items = ideas.filter(idea => {
      if (!idea.scheduled_for) return false
      const scheduled = new Date(idea.scheduled_for)
      return scheduled.getFullYear() === date.getFullYear() &&
        scheduled.getMonth() === date.getMonth() &&
        scheduled.getDate() === date.getDate()
    })
    days.push({ date, items, inMonth: date.getMonth() === now.getMonth() })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function channelForType(value: string): string {
  if (value === 'x_post' || value === 'linkedin_post') return 'social'
  if (value === 'blog_article' || value === 'newsletter_blurb') return 'written'
  if (value === 'video_script') return 'video'
  return 'campaign'
}

function dotClass(channel: string): string {
  if (channel === 'social') return 'bg-[var(--color-accent)]'
  if (channel === 'written') return 'bg-[var(--color-sig-funding)]'
  if (channel === 'video') return 'bg-[var(--color-sig-expansion)]'
  return 'bg-[var(--color-text-4)]'
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatShortDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function hasDraft(value: Record<string, unknown>): boolean {
  return Object.keys(value ?? {}).length > 0
}
