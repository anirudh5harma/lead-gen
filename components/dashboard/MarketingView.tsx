'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GtmContentIdea } from './types'

interface MarketingPayload {
  ideas: GtmContentIdea[]
  metrics: Record<string, number>
  preferences?: Array<{ tab: Exclude<HubTab, 'overview'>; settings: Partial<DraftSettings>; time_zone: string }>
}

interface DistributionProvider {
  id: string
  label: string
  category: string
  direct: boolean
  supported: string[]
  manualReason?: string
  connect: { enabled: boolean; reason: string | null }
}

interface DistributionAccount {
  id: string
  provider: string
  display_name: string | null
  handle: string | null
  status: string
  publish_mode: string
  last_publish_at: string | null
}

interface DistributionPayload {
  providers: DistributionProvider[]
  accounts: DistributionAccount[]
}

type ChannelTab = 'all' | 'social' | 'written' | 'video' | 'campaign'
type SourceMode = 'suggested' | 'custom'
type MarketingContentType = GtmContentIdea['content_type']
type HubTab = 'overview' | 'posts' | 'blogs' | 'videos'
type DraftSettings = {
  platform: string
  wordTarget: number
  tone: string
  cta: string
  emojiLevel: 'none' | 'light' | 'expressive'
  linkMode: 'none' | 'inline' | 'end'
  imageMode: 'none' | 'optional' | 'required'
  voice: 'founder' | 'company' | 'operator'
  seoIntent?: string
  outlineDepth?: 'brief' | 'standard' | 'detailed'
  durationSeconds?: number
  avatarStyle?: string
  hookType?: string
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9'
  aiLabel?: boolean
}

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
  const [refreshingIdeas, setRefreshingIdeas] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>('suggested')
  const [customType, setCustomType] = useState<MarketingContentType>('linkedin_post')
  const [customPrompt, setCustomPrompt] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [assetText, setAssetText] = useState('')
  const [customScheduleAt, setCustomScheduleAt] = useState('')
  const [showBacklog, setShowBacklog] = useState(false)
  const [scheduleFor, setScheduleFor] = useState<Record<string, string>>({})
  const [draftSettings, setDraftSettings] = useState<Record<Exclude<HubTab, 'overview'>, DraftSettings>>({
    posts: defaultDraftSettings('posts'),
    blogs: defaultDraftSettings('blogs'),
    videos: defaultDraftSettings('videos'),
  })
  const [distribution, setDistribution] = useState<DistributionPayload>({ providers: [], accounts: [] })

  async function load(options?: { refresh?: boolean; initial?: boolean }) {
    const refresh = options?.refresh ?? false
    if (options?.initial ?? !refresh) setLoading(true)
    if (refresh) setRefreshingIdeas(true)
    setError(null)
    const params = new URLSearchParams({ limit: hub === 'overview' ? '80' : '40', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
    if (refresh) params.set('refresh', '1')
    if (hub !== 'overview') params.set('tab', hub)
    if (hub !== 'overview' && showBacklog) params.set('today', '0')
    const res = await fetch(`/api/gtm/content?${params.toString()}`)
    const data = await res.json().catch(() => null) as MarketingPayload & { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not load marketing content.')
    else {
      setPayload({ ideas: data?.ideas ?? [], metrics: data?.metrics ?? {}, preferences: data?.preferences ?? [] })
      if (data?.preferences?.length) {
        setDraftSettings(current => {
          const next = { ...current }
          for (const pref of data.preferences ?? []) {
            if (pref.tab === 'posts' || pref.tab === 'blogs' || pref.tab === 'videos') {
              next[pref.tab] = { ...next[pref.tab], ...pref.settings }
            }
          }
          return next
        })
      }
    }
    setLoading(false)
    if (refresh) setRefreshingIdeas(false)
    return data?.ideas ?? []
  }

  async function loadDistribution() {
    const res = await fetch('/api/distribution/accounts')
    const data = await res.json().catch(() => null) as DistributionPayload & { error?: string } | null
    if (res.ok) setDistribution({ providers: data?.providers ?? [], accounts: data?.accounts ?? [] })
  }

  async function disconnectDistributionAccount(id: string) {
    if (busyId) return
    setBusyId(id)
    await fetch('/api/distribution/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await loadDistribution()
    setBusyId(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load({ initial: true }).then(ideas => {
        if (ideas.length === 0) void load({ refresh: true, initial: false })
      })
      void loadDistribution()
    }, 0)
    return () => window.clearTimeout(timer)
    // load is intentionally scoped to the active marketing hub/backlog mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, showBacklog])

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
      body: JSON.stringify({ idea_id: ideaId, action, draft_settings: hub === 'overview' ? undefined : draftSettings[hub] }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not update content idea.')
    await load()
    setBusyId(null)
  }

  async function createCustomContent() {
    if ((customPrompt.trim().length < 8 && customBody.trim().length < 2) || busyId) return
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
        raw_body: customBody,
        assets,
        draft_settings: hub === 'overview' ? undefined : draftSettings[hub],
        scheduled_for: customScheduleAt ? new Date(customScheduleAt).toISOString() : undefined,
      }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not create custom content.')
    else {
      setCustomPrompt('')
      setCustomBody('')
      setAssetText('')
      setCustomScheduleAt('')
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
        draft_settings: hub === 'overview' ? undefined : draftSettings[hub],
      }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not schedule content.')
    await load()
    setBusyId(null)
  }

  async function saveDraftSettings(tab: Exclude<HubTab, 'overview'>, settings: DraftSettings) {
    setDraftSettings(current => ({ ...current, [tab]: settings }))
    await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_draft_settings',
        tab,
        draft_settings: settings,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }),
    }).catch(() => null)
  }

  async function uploadAsset(file: File, ideaId?: string | null): Promise<string | null> {
    if (busyId) return null
    setBusyId(ideaId ?? 'asset')
    setError(null)
    const form = new FormData()
    form.set('file', file)
    form.set('label', file.name)
    if (ideaId) form.set('idea_id', ideaId)
    const res = await fetch('/api/gtm/content/assets', { method: 'POST', body: form })
    const data = await res.json().catch(() => null) as { error?: string; asset?: { url?: string | null } } | null
    if (!res.ok) {
      setError(data?.error ?? 'Could not upload asset.')
      setBusyId(null)
      return null
    }
    if (ideaId) await load()
    setBusyId(null)
    return data?.asset?.url ?? null
  }

  async function prepareAvatarVideo(ideaId: string) {
    if (busyId) return
    setBusyId(ideaId)
    setError(null)
    const res = await fetch('/api/gtm/content/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea_id: ideaId, settings: draftSettings.videos }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not prepare avatar video.')
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
        loading={loading || refreshingIdeas}
        refreshingIdeas={refreshingIdeas}
        onRefresh={() => { void load({ refresh: true, initial: false }) }}
      />

      {hub === 'overview' ? (
        <OverviewWorkspace
          ideas={activeIdeas}
          calendarDays={calendarDays}
          scheduledThisMonth={scheduledThisMonth}
          approvedReady={approvedReady}
          customDrafts={payload.metrics.custom ?? 0}
          distribution={distribution}
          busyId={busyId}
          onDisconnect={disconnectDistributionAccount}
        />
      ) : (
        <ContentTypeWorkspace
          hub={hub}
          ideas={hubIdeas}
          sourceMode={sourceMode}
          customType={effectiveCustomType}
          customPrompt={customPrompt}
          assetText={assetText}
          customBody={customBody}
          customScheduleAt={customScheduleAt}
          draftSettings={draftSettings[hub]}
          showBacklog={showBacklog}
          loading={loading}
          busyId={busyId}
          scheduleFor={scheduleFor}
          onSourceMode={setSourceMode}
          onCustomType={setCustomType}
          onPrompt={setCustomPrompt}
          onCustomBody={setCustomBody}
          onAssets={setAssetText}
          onCustomScheduleAt={setCustomScheduleAt}
          onDraftSettings={settings => { void saveDraftSettings(hub, settings) }}
          onShowBacklog={setShowBacklog}
          onUploadAsset={uploadAsset}
          onPrepareAvatarVideo={prepareAvatarVideo}
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
  refreshingIdeas,
  onRefresh,
}: {
  hub: HubTab
  loading: boolean
  refreshingIdeas: boolean
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
            {refreshingIdeas ? 'Refreshing ideas' : 'Refresh ideas'}
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
  distribution,
  busyId,
  onDisconnect,
}: {
  ideas: GtmContentIdea[]
  calendarDays: Array<{ date: Date; items: GtmContentIdea[]; inMonth: boolean }>
  scheduledThisMonth: number
  approvedReady: number
  customDrafts: number
  distribution: DistributionPayload
  busyId: string | null
  onDisconnect: (id: string) => void
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
        <CalendarPanel days={calendarDays} />
      </div>
      <aside className="space-y-4">
        <PlatformPanel distribution={distribution} busyId={busyId} onDisconnect={onDisconnect} />
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
  customBody,
  customScheduleAt,
  draftSettings,
  showBacklog,
  loading,
  busyId,
  scheduleFor,
  onSourceMode,
  onCustomType,
  onPrompt,
  onCustomBody,
  onAssets,
  onCustomScheduleAt,
  onDraftSettings,
  onShowBacklog,
  onUploadAsset,
  onPrepareAvatarVideo,
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
  customBody: string
  customScheduleAt: string
  draftSettings: DraftSettings
  showBacklog: boolean
  loading: boolean
  busyId: string | null
  scheduleFor: Record<string, string>
  onSourceMode: (value: SourceMode) => void
  onCustomType: (value: MarketingContentType) => void
  onPrompt: (value: string) => void
  onCustomBody: (value: string) => void
  onAssets: (value: string) => void
  onCustomScheduleAt: (value: string) => void
  onDraftSettings: (value: DraftSettings) => void
  onShowBacklog: (value: boolean) => void
  onUploadAsset: (file: File, ideaId?: string | null) => Promise<string | null>
  onPrepareAvatarVideo: (ideaId: string) => void
  onCreate: () => void
  onScheduleValue: (ideaId: string, value: string) => void
  onSchedule: (idea: GtmContentIdea) => void
  onDraft: (ideaId: string) => void
  onApprove: (ideaId: string) => void
  onDismiss: (ideaId: string) => void
}) {
  const today = localDateKey(new Date())
  const suggested = ideas.filter(idea =>
    (idea.origin ?? 'suggested') !== 'custom' &&
    idea.status === 'new' &&
    (showBacklog || !idea.batch_date || idea.batch_date === today),
  ).slice(0, showBacklog ? 20 : 5)
  const drafts = ideas.filter(idea => idea.status === 'drafted')
  const ready = ideas.filter(idea => idea.status === 'approved' || Boolean(idea.scheduled_for))
  const customItems = ideas.filter(idea => (idea.origin ?? 'suggested') === 'custom')
  const visibleSuggestions = sourceMode === 'suggested' ? suggested : customItems
  const availableTypes = CUSTOM_TYPES.filter(type => type.channel === hubToChannel(hub))
  const hiddenBacklogCount = ideas.filter(idea =>
    (idea.origin ?? 'suggested') !== 'custom' &&
    idea.status === 'new' &&
    idea.batch_date &&
    idea.batch_date !== today,
  ).length

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">{HUB_TABS.find(tab => tab.id === hub)?.label}</h3>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">Today shows at most 5 fresh ideas. Older ideas stay out of the way unless you open backlog.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onSourceMode('suggested')} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${sourceMode === 'suggested' ? 'bg-[var(--color-text-1)] text-white' : 'border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)]'}`}>Suggested</button>
            <button onClick={() => onSourceMode('custom')} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${sourceMode === 'custom' ? 'bg-[var(--color-text-1)] text-white' : 'border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)]'}`}>Custom</button>
            {sourceMode === 'suggested' && (
              <button onClick={() => onShowBacklog(!showBacklog)} className="rounded-lg border border-[var(--color-line-1)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)]">
                {showBacklog ? 'Hide backlog' : hiddenBacklogCount > 0 ? `Backlog ${hiddenBacklogCount}` : 'Backlog'}
              </button>
            )}
          </div>
        </div>
      </div>

      <DraftCustomizationPanel
        hub={hub}
        settings={draftSettings}
        onChange={onDraftSettings}
      />

      {sourceMode === 'custom' && (
        <CustomContentPanel
          customType={availableTypes.some(type => type.id === customType) ? customType : availableTypes[0]?.id ?? customType}
          allowedTypes={availableTypes}
          customPrompt={customPrompt}
          assetText={assetText}
          customBody={customBody}
          customScheduleAt={customScheduleAt}
          busy={busyId === 'custom'}
          onType={onCustomType}
          onPrompt={onPrompt}
          onCustomBody={onCustomBody}
          onAssets={onAssets}
          onCustomScheduleAt={onCustomScheduleAt}
          onUploadAsset={onUploadAsset}
          onCreate={onCreate}
        />
      )}

      {loading ? (
        <EmptyPanel text="Loading content workflow." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)]">
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
            onUploadAsset={onUploadAsset}
            onPrepareAvatarVideo={onPrepareAvatarVideo}
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
            onUploadAsset={onUploadAsset}
            onPrepareAvatarVideo={onPrepareAvatarVideo}
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
            onUploadAsset={onUploadAsset}
            onPrepareAvatarVideo={onPrepareAvatarVideo}
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
  onUploadAsset,
  onPrepareAvatarVideo,
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
  onUploadAsset: (file: File, ideaId?: string | null) => Promise<string | null>
  onPrepareAvatarVideo: (ideaId: string) => void
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
              onUploadAsset={file => onUploadAsset(file, idea.id)}
              onPrepareAvatarVideo={() => onPrepareAvatarVideo(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DraftCustomizationPanel({
  hub,
  settings,
  onChange,
}: {
  hub: Exclude<HubTab, 'overview'>
  settings: DraftSettings
  onChange: (value: DraftSettings) => void
}) {
  const platformOptions = hub === 'posts'
    ? ['linkedin', 'x']
    : hub === 'blogs'
      ? ['blog', 'linkedin', 'newsletter']
      : ['tiktok', 'instagram']
  const update = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => onChange({ ...settings, [key]: value })

  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Platform</span>
          <select value={settings.platform} onChange={event => update('platform', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
            {platformOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
          </select>
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">{hub === 'videos' ? 'Duration' : 'Words'}</span>
          <input
            type="number"
            min={hub === 'videos' ? 10 : 20}
            max={hub === 'blogs' ? 3000 : hub === 'videos' ? 120 : 600}
            value={hub === 'videos' ? settings.durationSeconds ?? 35 : settings.wordTarget}
            onChange={event => hub === 'videos' ? update('durationSeconds', Number(event.target.value)) : update('wordTarget', Number(event.target.value))}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]"
          />
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Tone</span>
          <input value={settings.tone} onChange={event => update('tone', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]" />
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">CTA</span>
          <input value={settings.cta} onChange={event => update('cta', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]" />
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Emoji</span>
          <select value={settings.emojiLevel} onChange={event => update('emojiLevel', event.target.value as DraftSettings['emojiLevel'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
            <option value="none">None</option>
            <option value="light">Light</option>
            <option value="expressive">Expressive</option>
          </select>
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Links</span>
          <select value={settings.linkMode} onChange={event => update('linkMode', event.target.value as DraftSettings['linkMode'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
            <option value="none">No links</option>
            <option value="inline">Inline</option>
            <option value="end">At end</option>
          </select>
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Images</span>
          <select value={settings.imageMode} onChange={event => update('imageMode', event.target.value as DraftSettings['imageMode'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
            <option value="none">None</option>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </label>
        <label>
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Voice</span>
          <select value={settings.voice} onChange={event => update('voice', event.target.value as DraftSettings['voice'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
            <option value="founder">Founder</option>
            <option value="company">Company</option>
            <option value="operator">Operator</option>
          </select>
        </label>
        {hub === 'blogs' && (
          <>
            <label>
              <span className="text-[11px] font-semibold text-[var(--color-text-2)]">SEO intent</span>
              <input value={settings.seoIntent ?? ''} onChange={event => update('seoIntent', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]" />
            </label>
            <label>
              <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Outline</span>
              <select value={settings.outlineDepth ?? 'standard'} onChange={event => update('outlineDepth', event.target.value as DraftSettings['outlineDepth'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
                <option value="brief">Brief</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
          </>
        )}
        {hub === 'videos' && (
          <>
            <label>
              <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Hook</span>
              <input value={settings.hookType ?? ''} onChange={event => update('hookType', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]" />
            </label>
            <label>
              <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Aspect</span>
              <select value={settings.aspectRatio ?? '9:16'} onChange={event => update('aspectRatio', event.target.value as DraftSettings['aspectRatio'])} className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]">
                <option value="9:16">9:16</option>
                <option value="4:5">4:5</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
          </>
        )}
      </div>
    </section>
  )
}

function CustomContentPanel({
  customType,
  allowedTypes,
  customPrompt,
  assetText,
  customBody,
  customScheduleAt,
  busy,
  onType,
  onPrompt,
  onCustomBody,
  onAssets,
  onCustomScheduleAt,
  onUploadAsset,
  onCreate,
}: {
  customType: MarketingContentType
  allowedTypes?: Array<{ id: MarketingContentType; label: string; channel: ChannelTab }>
  customPrompt: string
  assetText: string
  customBody: string
  customScheduleAt: string
  busy: boolean
  onType: (value: MarketingContentType) => void
  onPrompt: (value: string) => void
  onCustomBody: (value: string) => void
  onAssets: (value: string) => void
  onCustomScheduleAt: (value: string) => void
  onUploadAsset: (file: File, ideaId?: string | null) => Promise<string | null>
  onCreate: () => void
}) {
  async function uploadCustomFile(file: File | undefined) {
    if (!file) return
    const url = await onUploadAsset(file, null)
    if (url) onAssets([assetText.trim(), url].filter(Boolean).join('\n\n'))
  }

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
        <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Content</span>
        <textarea
          value={customBody}
          onChange={event => onCustomBody(event.target.value)}
          rows={6}
          placeholder="Type or paste your post, article, caption, or video notes. Leave empty if you want AI to draft from the prompt."
          className="mt-1 w-full resize-none rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-1)]"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Links, images, videos, or notes</span>
        <textarea
          value={assetText}
          onChange={event => onAssets(event.target.value)}
          rows={4}
          placeholder="Paste URLs, image links, public video links, transcript snippets, customer proof, or source material. Separate assets with a blank line."
          className="mt-1 w-full resize-none rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-1)]"
        />
      </label>
      <label className="mt-3 inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line-1)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)]">
        Upload asset
        <input
          type="file"
          accept="image/*,video/*,application/pdf,text/plain"
          className="sr-only"
          onChange={event => { void uploadCustomFile(event.target.files?.[0]); event.currentTarget.value = '' }}
        />
      </label>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <label className="w-full md:max-w-[240px]">
          <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Schedule</span>
          <input
            type="datetime-local"
            value={customScheduleAt}
            onChange={event => onCustomScheduleAt(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] text-[var(--color-text-1)]"
          />
        </label>
        <button
          onClick={onCreate}
          disabled={busy || (customPrompt.trim().length < 8 && customBody.trim().length < 2)}
          className="h-9 rounded-lg btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving' : customScheduleAt ? 'Save and schedule' : customBody.trim() ? 'Save custom draft' : 'Generate draft'}
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
  onUploadAsset,
  onPrepareAvatarVideo,
}: {
  idea: GtmContentIdea
  busy: boolean
  scheduleValue: string
  onScheduleValue: (value: string) => void
  onSchedule: () => void
  onDraft: () => void
  onApprove: () => void
  onDismiss: () => void
  onUploadAsset: (file: File) => Promise<string | null>
  onPrepareAvatarVideo: () => void
}) {
  const channel = idea.channel ?? channelForType(idea.content_type)
  const primaryInsight = (idea.source_insights?.length ? idea.source_insights : idea.proof_points)[0]
  const hasMedia = ((idea.media_assets?.length ?? 0) + (idea.source_assets?.length ?? 0)) > 0
  return (
    <article className="rounded-lg border border-[var(--color-line-1)] bg-white shadow-[0_1px_2px_#00000008] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(channel)}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[idea.status] ?? STATUS_STYLES.new}`}>
                {idea.status}
              </span>
              <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-3)]">
                {TYPE_LABELS[idea.content_type] ?? idea.content_type.replace(/_/g, ' ')}
              </span>
              {idea.batch_date && (
                <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-3)]">
                  {idea.batch_date}{idea.suggestion_rank ? ` #${idea.suggestion_rank}` : ''}
                </span>
              )}
              {typeof idea.score === 'number' && idea.score > 0 && (
                <span className="ml-auto rounded-full bg-[#eef6f1] px-2 py-0.5 text-[10px] font-semibold text-[#2f6d46]">
                  {Math.round(idea.score)} fit
                </span>
              )}
            </div>

            <h3 className="mt-2 text-[14px] font-semibold leading-snug text-[var(--color-text-1)]">{idea.angle}</h3>

            <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
              {idea.target_platform && <span>{titleCase(idea.target_platform)}</span>}
              {idea.idea_format && <span>{idea.idea_format}</span>}
              {hasMedia && <span>media</span>}
            </div>

            {primaryInsight && (
              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-text-2)]">
                <span className="font-semibold text-[var(--color-text-3)]">{primaryInsight.label}: </span>{primaryInsight.value}
              </p>
            )}

            {hasDraft(idea.draft) && (
              <details className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
                <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-text-1)]">{String(idea.draft.title ?? 'Draft')}</summary>
                <p className="mt-2 max-h-44 overflow-auto whitespace-pre-line text-[12px] leading-relaxed text-[var(--color-text-2)]">{String(idea.draft.body ?? '')}</p>
              </details>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-[var(--color-text-4)]">Details</summary>
              <div className="mt-2 space-y-2">
                {idea.why_now && <p className="text-[12px] leading-relaxed text-[var(--color-text-2)]">{idea.why_now}</p>}
                <div className="grid gap-2">
                  {(idea.source_insights?.length ? idea.source_insights : idea.proof_points).slice(0, 3).map((point, index) => (
                    <div key={`${idea.id}:${point.label}:${index}:${point.value.slice(0, 24)}`} className="rounded-md bg-[var(--color-ink-2)] px-3 py-2">
                      <p className="text-[10.5px] font-semibold uppercase text-[var(--color-text-3)]">{point.label}</p>
                      <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-2)] line-clamp-3">{point.value}</p>
                    </div>
                  ))}
                </div>
                {hasMedia && (
                  <div className="flex flex-wrap gap-2">
                    {[...(idea.media_assets ?? []), ...(idea.source_assets ?? [])].slice(0, 4).map(asset => (
                      <a
                        key={`${idea.id}:asset:${asset.label}:${asset.value}`}
                        href={/^https?:\/\//i.test(asset.value) ? asset.value : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-[var(--color-line-1)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
                      >
                        {assetLabel(asset)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <label className="mt-3 inline-flex h-7 cursor-pointer items-center rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">
              Attach media
              <input
                type="file"
                accept="image/*,video/*,application/pdf,text/plain"
                className="sr-only"
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void onUploadAsset(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-4 py-3">
        <button onClick={onDraft} disabled={busy} className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50">Draft</button>
        {idea.content_type === 'video_script' && (
          <button onClick={onPrepareAvatarVideo} disabled={busy || !hasDraft(idea.draft)} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Avatar video</button>
        )}
        <button onClick={onApprove} disabled={busy} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Approve</button>
        <input
          type="datetime-local"
          value={scheduleValue}
          onChange={event => onScheduleValue(event.target.value)}
          className="h-8 rounded-lg border border-[var(--color-line-1)] bg-white px-2 text-[11px] text-[var(--color-text-2)]"
        />
        <button onClick={onSchedule} disabled={busy || !scheduleValue} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">Schedule</button>
        <button onClick={onDismiss} disabled={busy} className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[var(--color-text-3)] hover:bg-white hover:text-[var(--color-text-1)] disabled:opacity-50">Reject</button>
        {idea.scheduled_for && <span className="ml-auto text-[11px] text-[var(--color-text-3)]">Scheduled {formatShortDateTime(idea.scheduled_for)}</span>}
      </div>
    </article>
  )
}

function PlatformPanel({
  distribution,
  busyId,
  onDisconnect,
}: {
  distribution: DistributionPayload
  busyId: string | null
  onDisconnect: (id: string) => void
}) {
  const providers = distribution.providers.length > 0 ? distribution.providers : fallbackDistributionProviders()
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Distribution accounts</h3>
      <div className="mt-3 space-y-2">
        {providers.map(provider => {
          const account = distribution.accounts.find(item => item.provider === provider.id)
          const connected = Boolean(account)
          const manual = !provider.direct
          return (
          <div key={provider.id} className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{provider.label}</p>
                <p className="text-[11px] text-[var(--color-text-4)]">
                  {connected
                    ? `${account?.display_name ?? provider.label}${account?.handle ? ` ${account.handle}` : ''}`
                    : manual ? 'Export-ready workflow' : provider.category}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${connected ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : manual ? 'bg-[#eef2f7] text-[#526070]' : 'bg-[#fff4df] text-[#936014]'}`}>
                {connected ? 'Connected' : manual ? 'Manual' : 'Connect'}
              </span>
            </div>

            <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-4)]">
              {connected
                ? `Schedules ${provider.supported.map(labelForContentType).join(', ')} from approved Content Hub items.`
                : provider.manualReason ?? provider.connect.reason ?? `Connect ${provider.label} to publish scheduled content.`}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {connected && account ? (
                <button
                  onClick={() => onDisconnect(account.id)}
                  disabled={busyId === account.id}
                  className="h-7 rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : provider.connect.enabled ? (
                <a
                  href={`/api/distribution/auth/${provider.id}`}
                  className="inline-flex h-7 items-center rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)]"
                >
                  Connect
                </a>
              ) : (
                <span className="inline-flex h-7 items-center rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-4)]">
                  {manual ? 'Copy/export' : 'Setup needed'}
                </span>
              )}
            </div>
          </div>
          )
        })}
      </div>
    </section>
  )
}

function CalendarPanel({ days }: { days: Array<{ date: Date; items: GtmContentIdea[]; inMonth: boolean }> }) {
  const upcoming = days.flatMap(day => day.items).sort((a, b) => new Date(a.scheduled_for ?? 0).getTime() - new Date(b.scheduled_for ?? 0).getTime()).slice(0, 8)
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Distribution calendar</h3>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-[var(--color-text-4)]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}:${index}`}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map(day => (
          <div key={day.date.toISOString()} className={`min-h-24 rounded-md border px-1.5 py-1 ${day.inMonth ? 'border-[var(--color-line-1)] bg-white' : 'border-transparent bg-[var(--color-ink-1)] text-[var(--color-text-4)]'}`}>
            <p className="text-[10px] font-semibold text-[var(--color-text-3)]">{day.date.getDate()}</p>
            <div className="mt-1 space-y-1">
              {day.items.slice(0, 2).map(item => (
                <div key={item.id} title={item.angle} className="min-w-0 rounded bg-[var(--color-ink-1)] px-1 py-0.5 text-left">
                  <div className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(item.channel ?? channelForType(item.content_type))}`} />
                    <span className="truncate text-[9.5px] font-semibold text-[var(--color-text-2)]">{formatCalendarTime(item.scheduled_for)} {platformLabel(item)}</span>
                  </div>
                  <p className="truncate text-[9.5px] text-[var(--color-text-4)]">{item.angle}</p>
                </div>
              ))}
              {day.items.length > 2 && <p className="text-[9.5px] font-semibold text-[var(--color-text-4)]">+{day.items.length - 2} more</p>}
            </div>
          </div>
        ))}
      </div>
      {upcoming.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-line-1)] pt-3">
          <h4 className="text-[12px] font-semibold text-[var(--color-text-2)]">Upcoming scheduled</h4>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {upcoming.map(item => (
              <div key={`upcoming:${item.id}`} className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
                <p className="truncate text-[12px] font-semibold text-[var(--color-text-1)]">{item.angle}</p>
                <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{formatShortDateTime(item.scheduled_for ?? '')} · {platformLabel(item)} · {item.status}</p>
              </div>
            ))}
          </div>
        </div>
      )}
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

function defaultDraftSettings(hub: Exclude<HubTab, 'overview'>): DraftSettings {
  if (hub === 'posts') {
    return { platform: 'linkedin', wordTarget: 180, tone: 'operator-led', cta: 'discussion prompt', emojiLevel: 'light', linkMode: 'end', imageMode: 'optional', voice: 'founder' }
  }
  if (hub === 'blogs') {
    return { platform: 'blog', wordTarget: 900, tone: 'useful and specific', cta: 'product-relevant next step', emojiLevel: 'none', linkMode: 'inline', imageMode: 'optional', voice: 'company', seoIntent: 'problem-aware', outlineDepth: 'standard' }
  }
  return { platform: 'tiktok', wordTarget: 120, tone: 'direct and visual', cta: 'comment or visit link', emojiLevel: 'light', linkMode: 'end', imageMode: 'required', voice: 'founder', durationSeconds: 35, avatarStyle: 'credible founder avatar', hookType: 'pattern interrupt', aspectRatio: '9:16', aiLabel: true }
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

function labelForContentType(value: string): string {
  return TYPE_LABELS[value] ?? value.replace(/_/g, ' ')
}

function titleCase(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase())
}

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function assetLabel(asset: { label: string; value: string }): string {
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(asset.value)) return `${asset.label}: image`
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(asset.value)) return `${asset.label}: video`
  if (/^https?:\/\//i.test(asset.value)) return `${asset.label}: link`
  return asset.label
}

function fallbackDistributionProviders(): DistributionProvider[] {
  return [
    { id: 'linkedin', label: 'LinkedIn', category: 'Social', direct: true, supported: ['linkedin_post', 'blog_article'], connect: { enabled: false, reason: 'Loading connection settings.' } },
    { id: 'x', label: 'X', category: 'Social', direct: true, supported: ['x_post'], connect: { enabled: false, reason: 'Loading connection settings.' } },
    { id: 'instagram', label: 'Instagram', category: 'Social', direct: true, supported: ['video_script'], connect: { enabled: false, reason: 'Loading connection settings.' } },
    { id: 'tiktok', label: 'TikTok', category: 'Video', direct: true, supported: ['video_script'], connect: { enabled: false, reason: 'Loading connection settings.' } },
    { id: 'medium', label: 'Medium', category: 'Articles', direct: false, supported: ['blog_article'], manualReason: 'Export-ready copy.', connect: { enabled: false, reason: null } },
    { id: 'substack', label: 'Substack', category: 'Newsletter', direct: false, supported: ['blog_article', 'newsletter_blurb'], manualReason: 'Export-ready copy.', connect: { enabled: false, reason: null } },
  ]
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatShortDateTime(value: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatCalendarTime(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function platformLabel(item: GtmContentIdea): string {
  return titleCase(item.target_platform ?? item.channel ?? channelForType(item.content_type))
}

function hasDraft(value: Record<string, unknown>): boolean {
  return Object.keys(value ?? {}).length > 0
}
