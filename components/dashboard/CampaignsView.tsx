'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lead } from '@/lib/leads'
import { useToast } from '@/components/Toast'
import {
  type CampaignMetrics,
  type CampaignReadiness,
  type CampaignTargetLike,
} from '@/lib/gtm/campaigns'
import type { UserProfile } from './types'

interface Props {
  profile: UserProfile
  leads: Lead[]
}

type Campaign = {
  id: string
  name: string
  objective?: string | null
  segment: string | null
  trigger: string | null
  narrative: string | null
  offer?: string | null
  success_metric?: string | null
  channels?: string[] | null
  status: string
  learnings?: Record<string, unknown> | null
  created_at: string
  updated_at?: string | null
  readiness?: CampaignReadiness
  target_counts?: { total: number; sent: number; replied: number; booked: number; enrolled: number; proposed: number; approved?: number; drafted?: number; blocked?: number; dismissed?: number }
  content_counts?: { total: number; published: number; drafted: number; linked: number; approved?: number; scheduled?: number; dismissed?: number }
  asset_counts?: { total: number; published: number; approved: number; draft: number; dismissed?: number }
}

type CampaignTarget = CampaignTargetLike & {
  id: string
  lead_id: string
  rationale?: string | null
  created_at?: string | null
  lead?: Partial<Lead> | null
}

type CampaignContentLink = {
  id: string
  campaign_id: string
  content_idea_id?: string | null
  post_id?: string | null
  gtm_content_idea_id?: string | null
  gtm_campaign_asset_id?: string | null
  channel?: string | null
  status?: string | null
  rationale?: string | null
  created_at?: string | null
}

type CampaignAsset = {
  id: string
  campaign_id: string
  title?: string | null
  body?: string | null
  asset_type?: string | null
  channel?: string | null
  status?: string | null
  created_at?: string | null
}

type CampaignDetailResponse = {
  campaign?: Campaign
  targets?: CampaignTarget[]
  content_links?: CampaignContentLink[]
  assets?: CampaignAsset[]
  error?: string
}

type CampaignResponse = {
  campaigns?: Campaign[]
  metrics?: CampaignMetrics
  error?: string
}

const EMPTY_METRICS: CampaignMetrics = {
  total: 0,
  draft: 0,
  active: 0,
  paused: 0,
  completed: 0,
  targets: 0,
  sent: 0,
  replied: 0,
  booked: 0,
  content: 0,
  content_published: 0,
}

const INPUT_CLS = 'w-full bg-surface border border-outline-variant/40 rounded px-3 py-2 font-body-main text-[13px] text-on-surface outline-none focus:border-primary transition-colors'
const PRIMARY_BTN = 'bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] px-5 py-2.5 hover:bg-primary-container transition-all disabled:opacity-50'
const GHOST_BTN = 'border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2 hover:bg-surface-container transition-all disabled:opacity-50'
const BADGE = 'font-label-mono text-[9px] uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded'
const BADGE_ACCENT = 'font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded'

export default function CampaignsView({ profile }: Props) {
  const toast = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [metrics, setMetrics] = useState<CampaignMetrics>(EMPTY_METRICS)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignDetailResponse | null>(null)
  const [promptDraft, setPromptDraft] = useState({
    prompt: '',
    target_count: 10,
  })
  const [buildingFromPrompt, setBuildingFromPrompt] = useState(false)
  const [discoveringId, setDiscoveringId] = useState<string | null>(null)
  const [removeCampaign, setRemoveCampaign] = useState<Campaign | null>(null)

  const loadCampaigns = useCallback(async function loadCampaigns() {
    setLoading(true)
    try {
      const res = await fetch('/api/gtm/campaigns')
      const data = await res.json().catch(() => ({})) as CampaignResponse
      if (!res.ok) throw new Error(data.error ?? 'Campaigns could not load')
      const nextCampaigns = Array.isArray(data.campaigns) ? data.campaigns : []
      setCampaigns(nextCampaigns)
      setMetrics(data.metrics ?? EMPTY_METRICS)
      setSelectedId(current => {
        if (!current && nextCampaigns[0]?.id) return nextCampaigns[0].id
        if (current && !nextCampaigns.some(campaign => campaign.id === current)) return nextCampaigns[0]?.id ?? null
        return current
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaigns could not load')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadCampaignDetail = useCallback(async function loadCampaignDetail(campaignId: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/gtm/campaigns/${campaignId}`)
      const data = await res.json().catch(() => ({})) as CampaignDetailResponse
      if (!res.ok) throw new Error(data.error ?? 'Campaign detail could not load')
      setDetail(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign detail could not load')
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadCampaigns() }, [loadCampaigns])
  useEffect(() => {
    if (selectedId) void loadCampaignDetail(selectedId)
    else setDetail(null)
  }, [loadCampaignDetail, selectedId])

  async function createCampaignFromPrompt() {
    const prompt = promptDraft.prompt.trim()
    if (prompt.length < 12) return toast.error('Describe the campaign requirement in a little more detail.')
    setBuildingFromPrompt(true)
    try {
      const res = await fetch('/api/gtm/campaigns/from-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promptDraft),
      })
      const data = await res.json().catch(() => ({})) as {
        campaign?: Campaign
        discovery?: { status?: string; mode?: string; generated?: number; inserted?: number; credit_blocked?: number; error?: string | null }
        error?: string
      }
      if (!res.ok || !data.campaign) throw new Error(data.error ?? 'Campaign could not be built from prompt')
      setPromptDraft({ prompt: '', target_count: 10 })
      setSelectedId(data.campaign.id)
      await loadCampaigns()
      await loadCampaignDetail(data.campaign.id)
      const generated = data.discovery?.generated ?? 0
      const inserted = data.discovery?.inserted ?? 0
      if (data.discovery?.status === 'not_configured') {
        toast.success('Campaign draft created. Exa is not configured yet, so no targets were discovered.')
      } else if (data.discovery?.mode === 'webset' && data.discovery.status === 'running') {
        toast.success('Campaign draft created. Webset discovery is running; sync it from the campaign detail.')
      } else if (data.discovery?.credit_blocked) {
        toast.success(`Campaign built with ${inserted} proposed targets. Lead credits stopped additional target creation.`)
      } else {
        toast.success(`Campaign built with ${inserted || generated} proposed targets from Exa.`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign could not be built from prompt')
    } finally {
      setBuildingFromPrompt(false)
    }
  }

  async function discoverMore(campaign: Campaign) {
    setDiscoveringId(campaign.id)
    try {
      const requested = requestedTargetCount(campaign)
      const res = await fetch(`/api/gtm/campaigns/${campaign.id}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_count: requested }),
      })
      const data = await res.json().catch(() => ({})) as {
        discovery?: { mode?: string; status?: string; inserted?: number; generated?: number; credit_blocked?: number; error?: string | null }
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Campaign discovery could not run')
      await loadCampaigns()
      await loadCampaignDetail(campaign.id)
      if (data.discovery?.error) {
        toast.error(data.discovery.error)
      } else if (data.discovery?.mode === 'webset' && data.discovery.status === 'running') {
        toast.success('Webset discovery is still running. Newly available targets were synced.')
      } else if (data.discovery?.credit_blocked) {
        toast.success(`Synced ${data.discovery.inserted ?? 0} targets before lead credits stopped discovery.`)
      } else {
        toast.success(`Synced ${data.discovery?.inserted ?? data.discovery?.generated ?? 0} campaign targets.`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign discovery could not run')
    } finally {
      setDiscoveringId(null)
    }
  }

  async function updateStatus(campaignId: string, action: 'activate' | 'pause' | 'complete' | 'dismiss') {
    try {
      const res = await fetch(`/api/gtm/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Campaign status could not be updated')
      if (action === 'dismiss') {
        setDetail(null)
        setSelectedId(null)
        setRemoveCampaign(null)
        toast.success('Campaign removed from the dashboard.')
        await loadCampaigns()
        return
      }
      await loadCampaigns()
      await loadCampaignDetail(campaignId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign status could not be updated')
    }
  }

  const selected = detail?.campaign ?? campaigns.find(c => c.id === selectedId) ?? campaigns[0] ?? null
  const currentTargets = useMemo(() => detail?.targets ?? [], [detail?.targets])
  const activeWorkspace = profile.client_name || profile.company_name || 'this workspace'
  const activeOrDraft = metrics.active + metrics.draft

  return (
    <div className="space-y-section-gap font-body-main text-on-surface">
      {/* Header */}
      <div>
        <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Workspace · {activeWorkspace}</p>
        <h2 className="font-h1-editorial text-display-sm text-on-surface">
          Run your <span className="italic text-primary">GTM motions</span>.
        </h2>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-outline-variant/30 border border-outline-variant/30">
        <Stat label="Live / Draft" value={activeOrDraft} />
        <Stat label="Targets" value={metrics.targets} />
        <Stat label="Replied" value={metrics.replied} />
        <Stat label="Booked" value={metrics.booked} />
      </div>

      {/* Prompt motion */}
      <section>
        <div className="flex items-end justify-between mb-stack-lg hairline-b pb-2 gap-3 flex-wrap">
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Prompt to campaign</p>
            <h3 className="font-h1-editorial text-h1-editorial text-on-surface mt-1">What do you want to sell, and to whom?</h3>
          </div>
          <button onClick={() => void createCampaignFromPrompt()} disabled={buildingFromPrompt || !promptDraft.prompt.trim()} className={PRIMARY_BTN}>
            {buildingFromPrompt ? 'Building…' : 'Build campaign'}
          </button>
        </div>
        <div className="hairline-border bg-surface-container-lowest rounded-lg p-5 grid gap-stack-md">
          <label className="block">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant block mb-1.5">Campaign prompt</span>
            <textarea
              value={promptDraft.prompt}
              onChange={event => setPromptDraft(current => ({ ...current, prompt: event.target.value }))}
              placeholder="Find Series A/B vertical SaaS companies in the US that are hiring RevOps leaders, and build a campaign around reducing outbound waste with signal-based prospecting."
              className={`${INPUT_CLS} min-h-[108px] resize-y`}
            />
          </label>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <label className="flex items-center gap-3">
              <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Targets</span>
              <input
                type="number"
                min={1}
                max={100}
                value={promptDraft.target_count}
                onChange={event => setPromptDraft(current => ({ ...current, target_count: Math.max(1, Math.min(100, Number(event.target.value) || 10)) }))}
                className={`${INPUT_CLS} w-24`}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Board + detail */}
      <div className="grid lg:grid-cols-[minmax(300px,360px)_1fr] gap-stack-lg items-start">
        <section className="lg:sticky lg:top-6">
          <div className="flex items-baseline justify-between mb-stack-lg hairline-b pb-2 gap-3 flex-wrap">
            <h3 className="font-h1-editorial text-h1-editorial">Campaigns</h3>
            <span className={BADGE_ACCENT}>{campaigns.length} Motions</span>
          </div>
          {loading ? (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">
              No campaigns yet. Describe the first motion above.
            </div>
          ) : (
            <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
              <div className="divide-y divide-[rgba(26,24,22,0.07)]">
                {campaigns.map(campaign => {
                  const active = selected?.id === campaign.id
                  const targets = campaign.target_counts?.total ?? 0
                  const sent = campaign.target_counts?.sent ?? 0
                  const replies = campaign.target_counts?.replied ?? 0
                  const content = (campaign.content_counts?.total ?? 0) + (campaign.asset_counts?.total ?? 0)
                  return (
                    <button
                      key={campaign.id}
                      onClick={() => setSelectedId(campaign.id)}
                      aria-current={active}
                      className={`relative w-full text-left px-5 py-4 transition-colors ${active ? 'bg-surface-container-low' : 'hover:bg-surface-container-low/60'}`}
                    >
                      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] bg-primary rounded-r" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-body-main font-medium text-on-surface truncate">{campaign.name}</span>
                          <span className={BADGE}>{campaign.status}</span>
                        </div>
                        <p className="font-body-main text-on-surface-variant truncate text-[12.5px]">
                          {campaign.objective || campaign.narrative || campaign.trigger || campaign.segment || '—'}
                        </p>
                        <div className="mt-2 flex items-center gap-3 font-label-mono text-[10px] uppercase tracking-widest text-outline">
                          <span>{targets} tgt</span>
                          <span>{sent} sent</span>
                          <span>{replies} rep</span>
                          <span>{content} cnt</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {selected ? (
          <CampaignDetail
            campaign={selected}
            loading={detailLoading}
            targets={currentTargets}
            links={detail?.content_links ?? []}
            assets={detail?.assets ?? []}
            onStatus={action => void updateStatus(selected.id, action)}
            onRemove={() => setRemoveCampaign(selected)}
            onDiscover={() => void discoverMore(selected)}
            discovering={discoveringId === selected.id}
          />
        ) : (
          <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">
            Select or create a campaign to see execution lanes.
          </div>
        )}
      </div>
      {removeCampaign && (
        <RemoveCampaignModal
          campaign={removeCampaign}
          onClose={() => setRemoveCampaign(null)}
          onConfirm={() => void updateStatus(removeCampaign.id, 'dismiss')}
        />
      )}
    </div>
  )
}

function CampaignDetail({ campaign, loading, targets, links, assets, onStatus, onRemove, onDiscover, discovering }: { campaign: Campaign; loading: boolean; targets: CampaignTarget[]; links: CampaignContentLink[]; assets: CampaignAsset[]; onStatus: (action: 'activate' | 'pause' | 'complete') => void; onRemove: () => void; onDiscover: () => void; discovering: boolean }) {
  const readiness = campaign.readiness
  const discovery = campaign.learnings ?? {}
  const contentItems = [
    ...links.map(link => ({ id: link.id, title: linkedContentLabel(link), meta: `${link.channel ?? 'content'} · ${link.status ?? 'linked'}` })),
    ...assets.map(asset => ({ id: asset.id, title: asset.title || asset.asset_type || 'Campaign asset', meta: `${asset.channel ?? 'content'} · ${asset.status ?? 'draft'}` })),
  ]
  const campaignLearning = buildCampaignLearning(campaign, targets, contentItems.length)
  const airCover = contentItems.length > 0
    ? contentItems.slice(0, 3).map(item => ({ title: item.title, meta: item.meta }))
    : buildContentAirCover(campaign, campaignLearning)
  const discoveryStatus = typeof discovery.discovery_status === 'string' ? discovery.discovery_status : null
  const discoveryError = typeof discovery.discovery_error === 'string' ? discovery.discovery_error : null
  const discoveryMode = typeof discovery.discovery_mode === 'string' ? discovery.discovery_mode : null
  const discoveredCount = typeof discovery.discovered_count === 'number' ? discovery.discovered_count : null
  const requestedCount = requestedTargetCount(campaign)
  const needsDiscovery = requestedCount > targets.length || discoveryStatus === 'running' || Boolean(discoveryError)
  const progress = typeof discovery.exa_webset_progress === 'object' && discovery.exa_webset_progress !== null
    ? discovery.exa_webset_progress as { found?: unknown; completion?: unknown }
    : null
  const progressLabel = progress?.completion !== undefined
    ? ` · ${Math.round(Number(progress.completion) || 0)}%`
    : ''
  return (
    <section className="bg-surface-container-lowest hairline-border rounded-lg p-stack-lg">
      <div className="flex items-start justify-between gap-stack-md flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">
            Selected campaign {loading ? '· syncing…' : ''}
          </p>
          <h3 className="font-h1-editorial text-h1-editorial text-on-surface mt-2">{campaign.name}</h3>
          <p className="font-body-main text-on-surface-variant mt-2 text-[13px] max-w-prose">
            {readiness?.nextAction ?? 'Choose the next GTM constraint to remove.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={BADGE}>{campaign.status}</span>
          {campaign.status !== 'active' && (
            <button onClick={() => onStatus('activate')} disabled={!readiness?.canLaunch} className={PRIMARY_BTN}>
              Activate
            </button>
          )}
          {campaign.status === 'active' && (
            <button onClick={() => onStatus('pause')} className={GHOST_BTN}>Pause</button>
          )}
        </div>
      </div>

      <div className="mt-stack-lg grid md:grid-cols-2 gap-x-stack-lg gap-y-stack-md">
        <Field label="Objective" value={campaign.objective || campaign.name} />
        <Field label="Audience" value={campaign.segment} />
        <Field label="Trigger" value={campaign.trigger} />
        <Field label="Narrative" value={campaign.narrative} />
        <Field label="Offer" value={campaign.offer} />
        <Field label="Success metric" value={campaign.success_metric} />
      </div>

      <div className="mt-6 hairline-border bg-surface-container-low/40 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-body-main font-medium text-on-surface text-[13px]">
              Readiness: {readiness?.stage ?? 'strategy'}
            </div>
            <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">
              {readiness?.canLaunch ? 'Launchable' : 'Blocked'}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end">
            {(readiness?.missing ?? []).map(item => <span key={item} className={BADGE}>{item.replaceAll('_', ' ')}</span>)}
            {(readiness?.recommendations ?? []).map(item => <span key={item} className={BADGE_ACCENT}>{item.replaceAll('_', ' ')}</span>)}
          </div>
        </div>
      </div>

      {(discoveryStatus || discoveryError || discoveredCount !== null) && (
        <div className="mt-3 hairline-border bg-surface-container-low/40 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-body-main font-medium text-on-surface text-[13px]">
                Discovery: {discoveryStatus ?? 'pending'}{discoveryMode ? ` · ${discoveryMode}` : ''}
              </div>
              <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">
                {targets.length || discoveredCount || 0} / {requestedCount} targets{progressLabel}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {discoveryError && <span className={BADGE}>needs retry</span>}
              {needsDiscovery && (
                <button onClick={onDiscover} disabled={discovering} className={GHOST_BTN}>
                  {discovering ? 'Syncing…' : discoveryMode === 'webset' ? 'Sync targets' : 'Find more'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-4 gap-stack-sm">
        <Tiny label="Enrolled" value={campaign.target_counts?.enrolled ?? targets.length} />
        <Tiny label="Sent" value={campaign.target_counts?.sent ?? 0} />
        <Tiny label="Replied" value={campaign.target_counts?.replied ?? 0} />
        <Tiny label="Booked" value={campaign.target_counts?.booked ?? 0} />
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-stack-md">
        <LearningPanel learning={campaignLearning} />
        <AirCoverPanel items={airCover} hasContent={contentItems.length > 0} />
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-stack-md">
        <Lane
          title="Targets"
          empty="No targets enrolled yet."
          items={targets.map(target => ({
            id: target.id,
            title: target.lead?.target_company ?? target.lead_id,
            meta: `${target.status ?? 'enrolled'} · ${targetNextAction(target)}`,
          }))}
        />
        <Lane
          title="Content"
          empty="No content attached yet."
          items={contentItems}
        />
      </div>

      <div className="mt-stack-lg pt-stack-md hairline-t flex flex-wrap items-center justify-end gap-2">
        {campaign.status !== 'completed' && (
          <button onClick={() => onStatus('complete')} className={GHOST_BTN}>Mark complete</button>
        )}
        <button onClick={onRemove} className={`${GHOST_BTN} text-on-surface-variant hover:text-error`}>Remove</button>
      </div>
    </section>
  )
}

function linkedContentLabel(link: CampaignContentLink) {
  if (link.content_idea_id) return `Content idea ${link.content_idea_id.slice(0, 8)}`
  if (link.post_id) return `Post ${link.post_id.slice(0, 8)}`
  if (link.gtm_content_idea_id) return `GTM idea ${link.gtm_content_idea_id.slice(0, 8)}`
  if (link.gtm_campaign_asset_id) return `Campaign asset ${link.gtm_campaign_asset_id.slice(0, 8)}`
  return 'Linked content'
}

type CampaignLearning = {
  replyRate: number
  bookingRate: number
  bestSignal: string
  bestPersona: string
  stage: string
  nextMove: string
  bullets: Array<{ label: string; value: string }>
}

function LearningPanel({ learning }: { learning: CampaignLearning }) {
  return (
    <div className="hairline-border bg-surface-container-low/40 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Learning loop</p>
          <p className="font-body-main font-medium text-on-surface text-[13px] mt-1">{learning.stage}</p>
        </div>
        <span className={BADGE_ACCENT}>{learning.replyRate}% reply</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {learning.bullets.map(item => (
          <div key={item.label} className="bg-surface-container-lowest hairline-border rounded p-2 min-w-0">
            <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant">{item.label}</div>
            <div className="font-body-main text-on-surface text-[13px] mt-0.5 truncate">{item.value}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 font-body-main text-on-surface-variant text-[12.5px] leading-relaxed">{learning.nextMove}</p>
    </div>
  )
}

function AirCoverPanel({ items, hasContent }: { items: Array<{ title: string; meta: string }>; hasContent: boolean }) {
  return (
    <div className="hairline-border bg-surface-container-low/40 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Content air cover</p>
          <p className="font-body-main font-medium text-on-surface text-[13px] mt-1">{hasContent ? 'Assets attached' : 'Suggested companion assets'}</p>
        </div>
        <span className={hasContent ? BADGE_ACCENT : BADGE}>campaign support</span>
      </div>
      <div className="mt-3 space-y-2">
        {items.map(item => (
          <div key={item.title} className="bg-surface-container-lowest hairline-border rounded p-2">
            <div className="font-body-main font-medium text-on-surface text-[13px] truncate">{item.title}</div>
            <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">{item.meta}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildCampaignLearning(campaign: Campaign, targets: CampaignTarget[], contentCount: number): CampaignLearning {
  const counts = campaign.target_counts
  const sent = counts?.sent ?? targets.filter(target => target.status === 'sent' || target.lead?.sent_at).length
  const replied = counts?.replied ?? targets.filter(target => target.status === 'replied' || target.lead?.replied_at).length
  const booked = counts?.booked ?? targets.filter(target => target.status === 'booked' || target.lead?.booked_at).length
  const denominator = Math.max(1, sent + replied + booked)
  const replyRate = Math.round((replied / denominator) * 100)
  const bookingRate = Math.round((booked / denominator) * 100)
  const signal = campaign.trigger || mostCommon(targets.map(target => target.lead?.signal_type ?? null)) || 'Signal fit pending'
  const persona = mostCommon(targets.map(target => inferPersona(target.lead?.contact_title))) || 'Target persona pending'
  const hasOutcomes = sent + replied + booked > 0
  const hasContent = contentCount > 0
  return {
    replyRate,
    bookingRate,
    bestSignal: signal,
    bestPersona: persona,
    stage: hasOutcomes ? 'Outcome data is shaping the next batch.' : 'Awaiting first send outcomes.',
    nextMove: hasOutcomes
      ? 'Use replies, bookings, and dismissals to tighten the next target batch before scaling.'
      : hasContent
        ? 'Launch a small batch, then compare reply quality against the attached content support.'
        : 'Add light content support or launch a small batch and let reply quality decide the next move.',
    bullets: [
      { label: 'Signal', value: signal },
      { label: 'Persona', value: persona },
      { label: 'Booked', value: `${bookingRate}%` },
      { label: 'Content', value: hasContent ? `${contentCount} attached` : 'none yet' },
    ],
  }
}

function buildContentAirCover(campaign: Campaign, learning: CampaignLearning): Array<{ title: string; meta: string }> {
  const trigger = campaign.trigger || learning.bestSignal
  const audience = campaign.segment || learning.bestPersona
  const offer = campaign.offer || 'the campaign offer'
  return [
    { title: `${trigger}: why this buying moment matters`, meta: `LinkedIn · ${audience}` },
    { title: `The hidden cost behind ${offer}`, meta: 'Founder post · pain hypothesis' },
    { title: `Common objection: why teams wait too long`, meta: 'Objection post · reply support' },
  ]
}

function targetNextAction(target: CampaignTarget): string {
  const lead = target.lead
  if (target.status === 'booked' || lead?.booked_at) return 'record outcome'
  if (target.status === 'replied' || lead?.replied_at) return 'handle reply'
  if (target.status === 'sent' || lead?.sent_at) return 'watch reply'
  if (target.status === 'drafted' || target.status === 'approved') return 'approve send'
  if (target.status === 'blocked') return 'review block'
  return 'prepare outreach'
}

function mostCommon(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function inferPersona(title?: string | null): string | null {
  const value = (title ?? '').toLowerCase()
  if (!value) return null
  if (value.includes('founder') || value.includes('ceo') || value.includes('chief')) return 'Executive'
  if (value.includes('sales') || value.includes('revenue') || value.includes('growth')) return 'Revenue'
  if (value.includes('marketing') || value.includes('demand')) return 'Marketing'
  if (value.includes('ops') || value.includes('operations')) return 'Operations'
  return 'GTM'
}

function Lane({ title, empty, items }: { title: string; empty: string; items: Array<{ id: string; title: string; meta: string }> }) {
  return (
    <div className="hairline-border bg-surface-container-low/40 rounded-lg p-3">
      <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="font-body-main text-on-surface-variant text-[12.5px]">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map(item => (
            <div key={item.id} className="bg-surface-container-lowest hairline-border rounded p-2">
              <div className="font-body-main font-medium text-on-surface text-[13px] truncate">{item.title}</div>
              <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">{item.meta}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-container-lowest px-5 py-4">
      <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</div>
      <div className="font-display-sm text-display-sm text-on-surface mt-1">{value}</div>
    </div>
  )
}

function Tiny({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-container-low/40 hairline-border rounded p-2">
      <div className="font-body-main font-semibold text-on-surface text-[14px]">{value}</div>
      <div className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant mt-0.5">{label}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">{label}</div>
      <div className="font-body-main text-on-surface text-[13.5px] leading-relaxed">{value || <span className="text-on-surface-variant italic">Not set</span>}</div>
    </div>
  )
}

function RemoveCampaignModal({ campaign, onClose, onConfirm }: { campaign: Campaign; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8">
      <button className="absolute inset-0 bg-on-surface/45 backdrop-blur-sm cursor-default" onClick={onClose} aria-label="Close remove campaign confirmation" />
      <section className="relative w-full max-w-[460px] bg-surface-container-lowest hairline-border rounded-lg p-6 shadow-xl max-h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant">Remove campaign</p>
            <h3 className="font-h1-editorial text-h1-editorial text-on-surface mt-2">{campaign.name}</h3>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface text-[20px] leading-none" aria-label="Close">×</button>
        </div>
        <p className="font-body-main text-on-surface-variant text-[13.5px] leading-relaxed mt-4">
          This removes the campaign from the dashboard. Existing leads, target history, replies, and bookings are preserved.
        </p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} className={GHOST_BTN}>Cancel</button>
          <button onClick={onConfirm} className={PRIMARY_BTN}>Remove</button>
        </div>
      </section>
    </div>
  )
}

function requestedTargetCount(campaign: Campaign): number {
  const value = campaign.learnings?.requested_count
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed))) : 10
}
