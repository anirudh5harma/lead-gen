'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { VIDEO_SCRIPT_MAX_CHARS, VIDEO_SCRIPT_MAX_SECONDS } from '@/lib/gtm/content-planning'
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
  new: 'bg-[var(--color-pillar-timing-bg)] text-[var(--color-pillar-timing)]',
  drafted: 'bg-[var(--color-sig-funding-bg)] text-[var(--color-sig-funding)]',
  approved: 'bg-[var(--color-sig-expansion-bg)] text-[var(--color-sig-expansion)]',
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
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
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
  const [pendingAvatarIdea, setPendingAvatarIdea] = useState<GtmContentIdea | null>(null)
  const [draftingIds, setDraftingIds] = useState<Set<string>>(() => new Set())
  const [avatarPreparingIds, setAvatarPreparingIds] = useState<Set<string>>(() => new Set())
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
    const params = new URLSearchParams({ limit: hub === 'overview' ? '80' : '40', tz: browserTimeZone })
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

  useEffect(() => {
    const hasPendingAvatarJob = payload.ideas.some(idea =>
      idea.latest_avatar_video_job?.status === 'queued' ||
      idea.latest_avatar_video_job?.status === 'rendering',
    )
    if (!hasPendingAvatarJob) return
    const timer = window.setInterval(() => {
      void load({ initial: false })
    }, 20_000)
    return () => window.clearInterval(timer)
    // load is scoped to the current marketing hub.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.ideas, hub, showBacklog])

  const activeIdeas = useMemo(() => payload.ideas.filter(idea => idea.status !== 'dismissed'), [payload.ideas])
  const hubIdeas = useMemo(() => filterIdeasForHub(activeIdeas, hub), [activeIdeas, hub])
  const effectiveCustomType = normalizeCustomTypeForHub(hub, customType)

  const calendarDays = useMemo(() => buildMarketingCalendar(activeIdeas), [activeIdeas])
  const scheduledThisMonth = activeIdeas.filter(idea => Boolean(idea.scheduled_for)).length
  const approvedReady = activeIdeas.filter(idea => idea.status === 'approved' && !idea.scheduled_for).length

  async function act(ideaId: string, action: 'draft' | 'approve' | 'dismiss') {
    if (busyId || (action === 'draft' && draftingIds.has(ideaId))) return
    if (action === 'draft') setDraftingIds(current => new Set(current).add(ideaId))
    setBusyId(ideaId)
    setError(null)
    const res = await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea_id: ideaId, action, draft_settings: hub === 'overview' ? undefined : draftSettings[hub] }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) {
      setError(data?.error ?? 'Could not update content idea.')
      if (action === 'draft') setDraftingIds(current => withoutSetValue(current, ideaId))
    }
    await load()
    if (res.ok && action === 'draft') setDraftingIds(current => withoutSetValue(current, ideaId))
    setBusyId(null)
  }

  async function createCustomContent() {
    const boundedBody = boundedCustomBodyForType(effectiveCustomType, customBody)
    if ((customPrompt.trim().length < 8 && boundedBody.trim().length < 2) || busyId) return
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
        raw_body: boundedBody,
        assets,
        draft_settings: hub === 'overview' ? undefined : draftSettings[hub],
        scheduled_for: customScheduleAt ? new Date(customScheduleAt).toISOString() : undefined,
        time_zone: browserTimeZone,
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

  async function saveDraft(ideaId: string, title: string, body: string) {
    if (busyId) return
    setBusyId(ideaId)
    setError(null)
    const res = await fetch('/api/gtm/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idea_id: ideaId,
        action: 'update_draft',
        title,
        raw_body: body,
      }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not save draft.')
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
    if (busyId || avatarPreparingIds.has(ideaId)) return
    setAvatarPreparingIds(current => new Set(current).add(ideaId))
    setBusyId(ideaId)
    setError(null)
    const res = await fetch('/api/gtm/content/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea_id: ideaId, settings: draftSettings.videos }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) {
      setError(data?.error ?? 'Could not prepare avatar video.')
      setAvatarPreparingIds(current => withoutSetValue(current, ideaId))
    } else {
      setPendingAvatarIdea(null)
    }
    await load()
    if (res.ok) setAvatarPreparingIds(current => withoutSetValue(current, ideaId))
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
          timeZone={browserTimeZone}
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
          onPrepareAvatarVideo={setPendingAvatarIdea}
          draftingIds={draftingIds}
          avatarPreparingIds={avatarPreparingIds}
          onSaveDraft={saveDraft}
          onCreate={createCustomContent}
          onScheduleValue={(ideaId, value) => setScheduleFor(current => ({ ...current, [ideaId]: value }))}
          onSchedule={scheduleIdea}
          onDraft={ideaId => act(ideaId, 'draft')}
          onApprove={ideaId => act(ideaId, 'approve')}
          onDismiss={ideaId => act(ideaId, 'dismiss')}
        />
      )}

      {pendingAvatarIdea && (
        <AvatarVideoCreditModal
          idea={pendingAvatarIdea}
          busy={busyId === pendingAvatarIdea.id}
          onCancel={() => {
            if (!busyId) setPendingAvatarIdea(null)
          }}
          onConfirm={() => { void prepareAvatarVideo(pendingAvatarIdea.id) }}
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

function AvatarVideoCreditModal({
  idea,
  busy,
  onCancel,
  onConfirm,
}: {
  idea: GtmContentIdea
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-line-1)] bg-white shadow-[0_20px_60px_#00000024]">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Avatar video</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--color-text-1)]">Generate this video for 1 credit?</h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <p className="line-clamp-2 text-[12px] font-semibold text-[var(--color-text-1)]">{idea.angle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-[var(--color-line-1)] bg-white px-4 text-[12px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="h-9 rounded-lg btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
          >
            {busy ? 'Generating' : 'Generate for 1 credit'}
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
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
  timeZone,
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
  draftingIds,
  avatarPreparingIds,
  onSaveDraft,
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
  timeZone: string
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
  onPrepareAvatarVideo: (idea: GtmContentIdea) => void
  draftingIds: Set<string>
  avatarPreparingIds: Set<string>
  onSaveDraft: (ideaId: string, title: string, body: string) => void
  onCreate: () => void
  onScheduleValue: (ideaId: string, value: string) => void
  onSchedule: (idea: GtmContentIdea) => void
  onDraft: (ideaId: string) => void
  onApprove: (ideaId: string) => void
  onDismiss: (ideaId: string) => void
}) {
  const [contentTab, setContentTab] = useState<'ideas' | 'drafts' | 'scheduled'>('ideas')
  const [showSettings, setShowSettings] = useState(false)
  const today = localDateKey(new Date(), timeZone)

  const suggested = ideas.filter(idea =>
    (idea.origin ?? 'suggested') !== 'custom' &&
    idea.status === 'new' &&
    (showBacklog || !idea.batch_date || idea.batch_date === today),
  ).slice(0, showBacklog ? 20 : 5)
  const drafts = ideas.filter(idea => idea.status === 'drafted')
  const ready = ideas.filter(idea => idea.status === 'approved' || Boolean(idea.scheduled_for))
  const customItems = ideas.filter(idea => (idea.origin ?? 'suggested') === 'custom' && idea.status === 'new')
  const visibleIdeas = contentTab === 'ideas'
    ? (sourceMode === 'suggested' ? suggested : customItems)
    : contentTab === 'drafts'
      ? drafts
      : ready

  const hiddenBacklogCount = ideas.filter(idea =>
    (idea.origin ?? 'suggested') !== 'custom' &&
    idea.status === 'new' &&
    idea.batch_date &&
    idea.batch_date !== today,
  ).length

  const availableTypes = CUSTOM_TYPES.filter(type => type.channel === hubToChannel(hub))

  const tabCounts = {
    ideas: suggested.length + customItems.length,
    drafts: drafts.length,
    scheduled: ready.length,
  }
  const suggestedLabel = hub === 'posts'
    ? 'No post ideas yet. Refresh ideas or adjust post settings.'
    : hub === 'blogs'
      ? 'No blog ideas yet. Refresh ideas or adjust blog settings.'
      : 'No video ideas yet. Refresh ideas or adjust video settings.'

  return (
    <section className="space-y-4">
      {/* Compact header bar */}
      <div className="card-flat px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">{HUB_TABS.find(tab => tab.id === hub)?.label}</h3>
            <span className="text-[11px] text-[var(--color-text-4)]">{ideas.length} items</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(s => !s)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors ${showSettings ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : 'border-[var(--color-line-2)] bg-white text-[var(--color-text-2)] hover:text-[var(--color-text-1)]'}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Settings
            </button>
            {contentTab === 'ideas' && sourceMode === 'suggested' && (
              <button
                onClick={() => onShowBacklog(!showBacklog)}
                className={`inline-flex h-8 items-center rounded-lg border px-3 text-[11px] font-semibold transition-colors ${showBacklog ? 'border-[var(--color-pillar-timing)]/30 bg-[var(--color-pillar-timing-bg)] text-[var(--color-pillar-timing)]' : 'border-[var(--color-line-2)] bg-white text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'}`}
              >
                {showBacklog ? 'Hide backlog' : hiddenBacklogCount > 0 ? `${hiddenBacklogCount} older` : 'Backlog'}
              </button>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="mt-3 border-t border-[var(--color-line-1)] pt-3">
            <DraftCustomizationPanel hub={hub} settings={draftSettings} onChange={onDraftSettings} />
          </div>
        )}
      </div>

      {/* Custom creation panel */}
      {contentTab === 'ideas' && sourceMode === 'custom' && (
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
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Sidebar tabs */}
          <div className="lg:w-[200px] shrink-0">
            <div className="flex lg:flex-col gap-1 p-1 rounded-xl bg-[var(--color-ink-2)]">
              <SidebarTab
                label="Ideas"
                count={tabCounts.ideas}
                active={contentTab === 'ideas'}
                onClick={() => setContentTab('ideas')}
                icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>}
              />
              <SidebarTab
                label="Drafts"
                count={tabCounts.drafts}
                active={contentTab === 'drafts'}
                onClick={() => setContentTab('drafts')}
                icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
              />
              <SidebarTab
                label="Scheduled"
                count={tabCounts.scheduled}
                active={contentTab === 'scheduled'}
                onClick={() => setContentTab('scheduled')}
                icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
              />
            </div>

            {/* Source toggle */}
            {contentTab === 'ideas' && (
              <div className="mt-3 px-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)] mb-1.5">Source</p>
                <div className="flex rounded-lg bg-[var(--color-ink-2)] p-0.5">
                  <button
                    onClick={() => onSourceMode('suggested')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all ${sourceMode === 'suggested' ? 'bg-white text-[var(--color-text-1)] shadow-sm' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'}`}
                  >
                    Suggested
                  </button>
                  <button
                    onClick={() => onSourceMode('custom')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all ${sourceMode === 'custom' ? 'bg-white text-[var(--color-text-1)] shadow-sm' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'}`}
                  >
                    Custom
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-[var(--color-text-4)] leading-relaxed">
                  {sourceMode === 'suggested'
                    ? 'AI-generated ideas from your signals and ICP.'
                    : 'Create your own content from a prompt.'}
                </p>
              </div>
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-3">
            {visibleIdeas.length === 0 ? (
              <EmptyPanel text={
                contentTab === 'ideas'
                  ? sourceMode === 'suggested' ? suggestedLabel : 'No custom items. Use the form above to create one.'
                  : contentTab === 'drafts'
                    ? 'No drafts yet. Draft an idea to get started.'
                    : 'Nothing scheduled yet. Approve or schedule items from the Ideas tab.'
              } />
            ) : (
              visibleIdeas.map(idea => (
                <ContentCard
                  key={idea.id}
                  idea={idea}
                  busy={busyId === idea.id}
                  drafting={draftingIds.has(idea.id)}
                  avatarPreparing={avatarPreparingIds.has(idea.id)}
                  scheduleValue={scheduleFor[idea.id] ?? toDateTimeLocal(idea.scheduled_for)}
                  onScheduleValue={value => onScheduleValue(idea.id, value)}
                  onSchedule={() => onSchedule(idea)}
                  onDraft={() => onDraft(idea.id)}
                  onApprove={() => onApprove(idea.id)}
                  onDismiss={() => onDismiss(idea.id)}
                  onPrepareAvatarVideo={() => onPrepareAvatarVideo(idea)}
                  onSaveDraft={(title, body) => onSaveDraft(idea.id, title, body)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function SidebarTab({ label, count, active, onClick, icon }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full rounded-lg px-3 py-2.5 text-left transition-all ${
        active
          ? 'bg-white text-[var(--color-accent)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]'
          : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-3)]'
      }`}
    >
      <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{icon}</span>
      <span className="text-[12.5px] font-medium">{label}</span>
      <span className={`ml-auto text-[11px] font-semibold tabular-nums ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-4)]'}`}>{count}</span>
    </button>
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={settings.platform} onChange={e => update('platform', e.target.value)} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
          {platformOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
        </select>
        <input
          type="number"
          min={hub === 'videos' ? 10 : 20}
          max={hub === 'blogs' ? 3000 : hub === 'videos' ? VIDEO_SCRIPT_MAX_SECONDS : 600}
          value={hub === 'videos' ? Math.min(settings.durationSeconds ?? VIDEO_SCRIPT_MAX_SECONDS, VIDEO_SCRIPT_MAX_SECONDS) : settings.wordTarget}
          onChange={e => hub === 'videos' ? update('durationSeconds', Math.min(Number(e.target.value), VIDEO_SCRIPT_MAX_SECONDS)) : update('wordTarget', Number(e.target.value))}
          className="h-8 w-20 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]"
        />
        <input value={settings.tone} onChange={e => update('tone', e.target.value)} placeholder="Tone" className="h-8 w-32 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)]" />
        <input value={settings.cta} onChange={e => update('cta', e.target.value)} placeholder="CTA" className="h-8 w-32 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)]" />
        <select value={settings.voice} onChange={e => update('voice', e.target.value as DraftSettings['voice'])} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
          <option value="founder">Founder</option>
          <option value="company">Company</option>
          <option value="operator">Operator</option>
        </select>
        <select value={settings.emojiLevel} onChange={e => update('emojiLevel', e.target.value as DraftSettings['emojiLevel'])} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
          <option value="none">No emoji</option>
          <option value="light">Light</option>
          <option value="expressive">Expressive</option>
        </select>
        <select value={settings.linkMode} onChange={e => update('linkMode', e.target.value as DraftSettings['linkMode'])} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
          <option value="none">No links</option>
          <option value="inline">Inline</option>
          <option value="end">End</option>
        </select>
        {hub === 'blogs' && (
          <>
            <input value={settings.seoIntent ?? ''} onChange={e => update('seoIntent', e.target.value)} placeholder="SEO intent" className="h-8 w-28 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)]" />
            <select value={settings.outlineDepth ?? 'standard'} onChange={e => update('outlineDepth', e.target.value as DraftSettings['outlineDepth'])} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
              <option value="brief">Brief</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </>
        )}
        {hub === 'videos' && (
          <>
            <select value={settings.aspectRatio ?? '9:16'} onChange={e => update('aspectRatio', e.target.value as DraftSettings['aspectRatio'])} className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] text-[var(--color-text-1)]">
              <option value="9:16">9:16</option>
              <option value="4:5">4:5</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
            </select>
          </>
        )}
      </div>
    </div>
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
  const videoMode = customType === 'video_script'
  const customBodyValue = videoMode ? customBody.slice(0, VIDEO_SCRIPT_MAX_CHARS) : customBody
  const remainingVideoChars = VIDEO_SCRIPT_MAX_CHARS - customBodyValue.length

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
          value={customBodyValue}
          onChange={event => onCustomBody(videoMode ? event.target.value.slice(0, VIDEO_SCRIPT_MAX_CHARS) : event.target.value)}
          rows={6}
          maxLength={videoMode ? VIDEO_SCRIPT_MAX_CHARS : undefined}
          placeholder={videoMode ? 'Type or paste a concise avatar script. Keep it under 30 seconds.' : 'Type or paste your post, article, caption, or video notes. Leave empty if you want AI to draft from the prompt.'}
          className="mt-1 w-full resize-none rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-1)]"
        />
        {videoMode && (
          <span className="mt-1 block text-[10.5px] font-medium text-[var(--color-text-4)]">
            30 seconds max. {remainingVideoChars} characters left.
          </span>
        )}
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
          disabled={busy || (customPrompt.trim().length < 8 && customBodyValue.trim().length < 2)}
          className="h-9 rounded-lg btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving' : customScheduleAt ? 'Save and schedule' : customBodyValue.trim() ? 'Save custom draft' : 'Generate draft'}
        </button>
      </div>
    </section>
  )
}

function ContentCard({
  idea,
  busy,
  drafting,
  avatarPreparing,
  scheduleValue,
  onScheduleValue,
  onSchedule,
  onDraft,
  onApprove,
  onDismiss,
  onPrepareAvatarVideo,
  onSaveDraft,
}: {
  idea: GtmContentIdea
  busy: boolean
  drafting: boolean
  avatarPreparing: boolean
  scheduleValue: string
  onScheduleValue: (value: string) => void
  onSchedule: () => void
  onDraft: () => void
  onApprove: () => void
  onDismiss: () => void
  onPrepareAvatarVideo: () => void
  onSaveDraft: (title: string, body: string) => void
}) {
  const channel = idea.channel ?? channelForType(idea.content_type)
  const primaryInsight = (idea.source_insights?.length ? idea.source_insights : idea.proof_points)[0]
  const hasMedia = ((idea.media_assets?.length ?? 0) + (idea.source_assets?.length ?? 0)) > 0
  const heading = suggestionHeading(idea, primaryInsight)
  const conciseInsight = compactInsightText(primaryInsight)
  const avatarStatus = idea.latest_avatar_video_job?.status
  const avatarLocked = avatarPreparing || avatarStatus === 'queued' || avatarStatus === 'rendering' || avatarStatus === 'ready'
  const draftLocked = drafting || hasDraft(idea.draft) || idea.status === 'drafted' || idea.status === 'approved'
  const draftTitle = String(idea.draft?.title ?? 'Draft')
  const draftBody = String(idea.final_body ?? idea.draft?.body ?? '')
  const [editingDraft, setEditingDraft] = useState(false)
  const [editedTitle, setEditedTitle] = useState(draftTitle)
  const [editedBody, setEditedBody] = useState(draftBody)
  const [copied, setCopied] = useState(false)

  async function copyDraft() {
    const text = editedBody || draftBody || idea.angle
    await navigator.clipboard?.writeText(text).catch(() => null)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

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

            <h3 className="mt-2 text-[14px] font-semibold leading-snug text-[var(--color-text-1)]">{heading}</h3>

            <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
              {idea.target_platform && <span>{titleCase(idea.target_platform)}</span>}
              {idea.idea_format && <span>{idea.idea_format}</span>}
              {hasMedia && <span>media</span>}
            </div>

            {conciseInsight && (
              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-text-2)]">
                <span className="font-semibold text-[var(--color-text-3)]">Signal:</span> {conciseInsight}
              </p>
            )}

            {hasDraft(idea.draft) && (
              <details className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
                <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-text-1)]">{draftTitle}</summary>
                {editingDraft ? (
                  <div className="mt-2 space-y-2">
                    <input
                      value={editedTitle}
                      onChange={event => setEditedTitle(event.target.value)}
                      className="h-8 w-full rounded-md border border-[var(--color-line-2)] bg-white px-2 text-[12px] text-[var(--color-text-1)]"
                    />
                    <textarea
                      value={editedBody}
                      onChange={event => setEditedBody(event.target.value)}
                      rows={8}
                      className="w-full resize-y rounded-md border border-[var(--color-line-2)] bg-white px-2 py-2 text-[12px] leading-relaxed text-[var(--color-text-1)]"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { onSaveDraft(editedTitle, editedBody); setEditingDraft(false) }} disabled={busy || editedBody.trim().length < 2} className="h-7 rounded-md btn-primary px-2.5 text-[11px] font-semibold disabled:opacity-50">Save draft</button>
                      <button onClick={() => { setEditingDraft(false); setEditedTitle(draftTitle); setEditedBody(draftBody) }} className="h-7 rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 max-h-44 overflow-auto whitespace-pre-line text-[12px] leading-relaxed text-[var(--color-text-2)]">{draftBody}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => { setEditedTitle(draftTitle); setEditedBody(draftBody); setEditingDraft(true) }} className="h-7 rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Edit</button>
                      <button onClick={() => { void copyDraft() }} className="h-7 rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">{copied ? 'Copied' : 'Copy/export'}</button>
                    </div>
                  </>
                )}
              </details>
            )}

            {idea.latest_avatar_video_job && (
              <div className="mt-2 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Avatar video</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-3)]">{idea.latest_avatar_video_job.status}</span>
                  <span className="text-[10px] text-[var(--color-text-4)]">{idea.latest_avatar_video_job.provider}</span>
                </div>
                {idea.latest_avatar_video_job.video_url && (
                  <a href={idea.latest_avatar_video_job.video_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[11px] font-semibold text-[var(--color-accent)] hover:underline">
                    Open video
                  </a>
                )}
                {idea.latest_avatar_video_job.error_message && (
                  <p className="mt-1 text-[11px] text-[var(--color-sig-regulation)]">{idea.latest_avatar_video_job.error_message}</p>
                )}
              </div>
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

          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-4 py-3">
        <button onClick={onDraft} disabled={busy || draftLocked} className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50">{drafting ? 'Drafting' : hasDraft(idea.draft) ? 'Drafted' : 'Draft'}</button>
        {idea.content_type === 'video_script' && (
          <button onClick={onPrepareAvatarVideo} disabled={busy || avatarLocked || !hasDraft(idea.draft)} className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50">{avatarPreparing ? 'Preparing video' : avatarStatus === 'ready' ? 'Video ready' : avatarStatus === 'queued' || avatarStatus === 'rendering' ? 'Video queued' : 'Avatar video'}</button>
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
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-4)]">
        Connect once, then schedule directly from approved drafts.
      </p>
      <div className="mt-3 space-y-2">
        {providers.map(provider => {
          const account = selectPreferredDistributionAccountForProvider(distribution.accounts, provider.id)
          const connected = Boolean(account && account.status === 'connected')
          const needsReconnect = Boolean(account && account.status !== 'connected')
          const manual = !provider.direct
          return (
          <div key={provider.id} className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[var(--color-text-1)]">{provider.label}</p>
                <p className="text-[11px] text-[var(--color-text-4)]">
                  {connected
                    ? `${account?.display_name ?? provider.label}${account?.handle ? ` ${account.handle}` : ''}`
                    : needsReconnect
                      ? `${account?.display_name ?? provider.label} needs reconnect`
                    : manual ? 'Export-ready workflow' : provider.category}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${connected ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' : needsReconnect ? 'bg-[#fff4df] text-[#936014]' : manual ? 'bg-[#eef2f7] text-[#526070]' : 'bg-[#fff4df] text-[#936014]'}`}>
                {connected ? 'Connected' : needsReconnect ? 'Reconnect' : manual ? 'Manual' : 'Connect'}
              </span>
            </div>

            <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-4)]">
              {connected
                ? `Schedules ${provider.supported.map(labelForContentType).join(', ')} from approved Content Hub items.`
                : needsReconnect
                  ? `Reconnect ${provider.label} to resume scheduled publishing for ${provider.supported.map(labelForContentType).join(', ')}.`
                : provider.manualReason ?? provider.connect.reason ?? `Connect ${provider.label} to publish scheduled content.`}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {(connected || needsReconnect) && account && (
                <button
                  onClick={() => onDisconnect(account.id)}
                  disabled={busyId === account.id}
                  className="h-7 rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
              {(!connected || needsReconnect) && provider.connect.enabled ? (
                <a
                  href={`/api/distribution/auth/${provider.id}`}
                  className="inline-flex h-7 items-center rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)]"
                >
                  {needsReconnect ? 'Reconnect' : 'Connect'}
                </a>
              ) : (
                !connected && (
                  <span className="inline-flex h-7 items-center rounded-md border border-[var(--color-line-1)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-4)]">
                    {manual ? 'Copy/export' : 'Setup needed'}
                  </span>
                )
              )}
            </div>
          </div>
          )
        })}
      </div>
      <div className="mt-3 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
        <p className="text-[11px] font-semibold text-[var(--color-text-2)]">Connect in 3 steps</p>
        <ol className="mt-1 space-y-1 text-[10.5px] leading-relaxed text-[var(--color-text-4)]">
          <li>1. Click <span className="font-semibold text-[var(--color-text-3)]">Connect</span> for your channel.</li>
          <li>2. Sign in and approve permissions on the provider page.</li>
          <li>3. Return to Bombsell and confirm the channel shows <span className="font-semibold text-[var(--color-text-3)]">Connected</span>.</li>
        </ol>
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
  return { platform: 'tiktok', wordTarget: 75, tone: 'direct and visual', cta: 'comment or visit link', emojiLevel: 'light', linkMode: 'end', imageMode: 'required', voice: 'founder', durationSeconds: VIDEO_SCRIPT_MAX_SECONDS, avatarStyle: 'credible founder avatar', hookType: 'pattern interrupt', aspectRatio: '9:16', aiLabel: true }
}

function boundedCustomBodyForType(contentType: MarketingContentType, body: string): string {
  return contentType === 'video_script' ? body.slice(0, VIDEO_SCRIPT_MAX_CHARS) : body
}

function withoutSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  next.delete(value)
  return next
}

function suggestionHeading(idea: GtmContentIdea, insight?: { label: string; value: string } | null): string {
  const baseHeading = normalizeHeadingText(idea.angle)
  const isCustom = (idea.origin ?? 'suggested') === 'custom'
  if (isCustom) return clampHeading(baseHeading || fallbackHeadingForType(idea.content_type), 84)
  const signal = signalSnippet(insight?.value ?? '')
  const cleaned = stripHeadingFluff(baseHeading)
  const chosen = cleaned.length >= 18 ? cleaned : signal || cleaned || fallbackHeadingForType(idea.content_type)
  const prefix = prefixForContentType(idea.content_type)
  const candidate = chosen.toLowerCase().startsWith(prefix.toLowerCase())
    ? chosen
    : `${prefix}: ${chosen}`
  return clampHeading(candidate, 84)
}

function signalSnippet(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  const afterColon = cleaned.includes(':') ? cleaned.split(':').slice(1).join(':').trim() : cleaned
  return (afterColon || cleaned)
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
}

function compactInsightText(insight?: { label: string; value: string } | null): string {
  if (!insight) return ''
  const label = normalizeHeadingText(insight.label).replace(/signal|inspiration/gi, '').trim()
  const value = signalSnippet(insight.value)
  if (!value) return label || ''
  const combined = label ? `${titleCase(label)}: ${value}` : value
  return clampHeading(combined, 120)
}

function normalizeHeadingText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim()
}

function stripHeadingFluff(value: string): string {
  const compact = normalizeHeadingText(value)
    .replace(/^(create|draft|write|build|prepare|generate|publish|share)\s+/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/\b(for linkedin|for x|for twitter|for blog|for newsletter|for tiktok|for instagram)\b/ig, '')
    .replace(/\b(based on|inspired by|around)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
  return compact || normalizeHeadingText(value)
}

function prefixForContentType(contentType: string): string {
  if (contentType === 'linkedin_post' || contentType === 'x_post') return 'Post'
  if (contentType === 'blog_article' || contentType === 'newsletter_blurb') return 'Article'
  if (contentType === 'video_script') return 'Video'
  return 'Idea'
}

function fallbackHeadingForType(contentType: string): string {
  if (contentType === 'linkedin_post' || contentType === 'x_post') return 'Post angle from fresh signal'
  if (contentType === 'blog_article' || contentType === 'newsletter_blurb') return 'Article angle from fresh signal'
  if (contentType === 'video_script') return 'Video angle from fresh signal'
  return 'Content angle from fresh signal'
}

function clampHeading(value: string, max = 84): string {
  const text = normalizeHeadingText(value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(20, max - 1)).trimEnd()}…`
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

function localDateKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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

function selectPreferredDistributionAccountForProvider(
  accounts: DistributionAccount[],
  provider: string,
): DistributionAccount | null {
  const candidates = accounts.filter(account => account.provider === provider)
  if (candidates.length === 0) return null
  const [preferred] = [...candidates].sort((left, right) => distributionAccountScore(right) - distributionAccountScore(left))
  return preferred ?? null
}

function distributionAccountScore(account: DistributionAccount): number {
  let score = 0
  if (account.status === 'connected') score += 100
  else if (account.status === 'needs_reconnect') score += 30
  if (account.publish_mode === 'scheduled' || account.publish_mode === 'auto_publish') score += 20
  else if (account.publish_mode === 'manual_review') score += 5
  return score
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
