'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lead } from '@/lib/leads'
import Icon from '@/components/Icon'
import { useToast } from '@/components/Toast'
import {
  rankCampaignLeadCandidates,
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

const CHANNELS = ['email', 'linkedin', 'content', 'founder-led']

const INPUT_CLS = 'w-full bg-surface border border-outline-variant/40 rounded px-3 py-2 font-body-main text-[13px] text-on-surface outline-none focus:border-primary transition-colors'
const PRIMARY_BTN = 'bg-primary text-on-primary font-label-mono text-[10px] uppercase tracking-[0.2em] px-5 py-2.5 hover:bg-primary-container transition-all disabled:opacity-50'
const GHOST_BTN = 'border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2 hover:bg-surface-container transition-all disabled:opacity-50'
const BADGE = 'font-label-mono text-[9px] uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded'
const BADGE_ACCENT = 'font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded'

export default function CampaignsView({ profile, leads }: Props) {
  const toast = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [metrics, setMetrics] = useState<CampaignMetrics>(EMPTY_METRICS)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignDetailResponse | null>(null)
  const [promptDraft, setPromptDraft] = useState({
    prompt: '',
    target_count: 10,
  })
  const [form, setForm] = useState({
    name: '',
    objective: '',
    segment: '',
    trigger: '',
    narrative: '',
    offer: '',
    success_metric: 'Meetings booked from this motion',
    channels: ['email', 'linkedin', 'content'],
  })
  const [contentForm, setContentForm] = useState({ kind: 'content_idea', id: '', channel: 'linkedin', rationale: '' })
  const [enrollingLeadId, setEnrollingLeadId] = useState<string | null>(null)
  const [linkingContent, setLinkingContent] = useState(false)
  const [buildingFromPrompt, setBuildingFromPrompt] = useState(false)

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

  async function createCampaign() {
    if (!form.name.trim()) return toast.error('Name the campaign first.')
    if (!form.objective.trim()) return toast.error('Define the campaign objective.')
    if (!form.segment.trim()) return toast.error('Define the audience.')
    if (!form.trigger.trim()) return toast.error('Define the why-now trigger.')
    if (!form.narrative.trim()) return toast.error('Write the narrative before creating the motion.')
    setSaving(true)
    try {
      const res = await fetch('/api/gtm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({})) as { campaign?: Campaign; error?: string }
      if (!res.ok || !data.campaign) throw new Error(data.error ?? 'Campaign could not be created')
      setForm({ name: '', objective: '', segment: '', trigger: '', narrative: '', offer: '', success_metric: 'Meetings booked from this motion', channels: ['email', 'linkedin', 'content'] })
      setSelectedId(data.campaign.id)
      toast.success('Campaign created as a draft motion.')
      await loadCampaigns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign could not be created')
    } finally {
      setSaving(false)
    }
  }

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
        discovery?: { status?: string; generated?: number; inserted?: number; credit_blocked?: number; error?: string | null }
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

  async function updateStatus(campaignId: string, action: 'activate' | 'pause' | 'complete') {
    try {
      const res = await fetch(`/api/gtm/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Campaign status could not be updated')
      await loadCampaigns()
      await loadCampaignDetail(campaignId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign status could not be updated')
    }
  }

  async function enrollLead(leadId: string) {
    if (!selectedId) return
    setEnrollingLeadId(leadId)
    try {
      const res = await fetch(`/api/gtm/campaigns/${selectedId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: [leadId] }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Lead could not be enrolled')
      toast.success('Lead enrolled into campaign.')
      await loadCampaigns()
      await loadCampaignDetail(selectedId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lead could not be enrolled')
    } finally {
      setEnrollingLeadId(null)
    }
  }

  async function attachContent() {
    if (!selectedId) return
    if (!contentForm.id.trim()) return toast.error('Paste a content or asset ID to attach.')
    setLinkingContent(true)
    try {
      const res = await fetch(`/api/gtm/campaigns/${selectedId}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contentForm),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Content could not be attached')
      setContentForm(form => ({ ...form, id: '', rationale: '' }))
      toast.success('Content attached to campaign.')
      await loadCampaigns()
      await loadCampaignDetail(selectedId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Content could not be attached')
    } finally {
      setLinkingContent(false)
    }
  }

  const selected = detail?.campaign ?? campaigns.find(c => c.id === selectedId) ?? campaigns[0] ?? null
  const currentTargets = useMemo(() => detail?.targets ?? [], [detail?.targets])
  const candidateLeads = useMemo(
    () => rankCampaignLeadCandidates(leads, currentTargets, selected?.id ?? '').slice(0, 7),
    [leads, currentTargets, selected?.id],
  )
  const activeWorkspace = profile.client_name || profile.company_name || 'this workspace'

  return (
    <div className="space-y-section-gap font-body-main text-on-surface">
      {/* Header */}
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-stack-lg items-start">
        <section>
          <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">GTM orchestration · {activeWorkspace}</p>
          <h2 className="font-h1-editorial text-display-sm text-on-surface">
            Campaigns
          </h2>
          <p className="font-body-main text-on-surface-variant mt-3 max-w-2xl leading-relaxed">
            Campaigns are the operating layer for Bombsell: one objective, one audience, one why-now trigger, one narrative, coordinated outbound targets, content air cover, and measured outcomes.
          </p>
        </section>
        <section className="hairline-border bg-surface-container-lowest rounded-lg p-5">
          <div className="grid grid-cols-3 gap-stack-md">
            <Metric label="Active" value={metrics.active} />
            <Metric label="Targets" value={metrics.targets} />
            <Metric label="Booked" value={metrics.booked} />
          </div>
          <div className="mt-stack-md grid grid-cols-3 gap-stack-md">
            <Metric label="Replies" value={metrics.replied} />
            <Metric label="Content" value={metrics.content} />
            <Metric label="Published" value={metrics.content_published} />
          </div>
        </section>
      </div>

      {/* Prompt motion */}
      <section>
        <div className="flex items-center justify-between mb-8 border-b border-outline-variant pb-2 gap-3 flex-wrap">
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Prompt to campaign</p>
            <h3 className="font-h1-editorial text-h1-editorial text-on-surface mt-2">Describe the motion</h3>
            <p className="font-body-main text-on-surface-variant mt-2 text-[13px]">Bombsell creates the draft, searches Exa for evidence-backed accounts, and stages proposed targets.</p>
          </div>
          <button onClick={() => void createCampaignFromPrompt()} disabled={buildingFromPrompt || !promptDraft.prompt.trim()} className={PRIMARY_BTN}>
            {buildingFromPrompt ? 'Building…' : 'Build with Exa'}
          </button>
        </div>
        <div className="hairline-border bg-surface-container-lowest rounded-lg p-5 grid gap-stack-md">
          <label className="block">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant block mb-1.5">Requirement</span>
            <textarea
              value={promptDraft.prompt}
              onChange={event => setPromptDraft(current => ({ ...current, prompt: event.target.value }))}
              placeholder="Find Series A/B vertical SaaS companies in the US that are hiring RevOps leaders, and build a campaign around reducing outbound waste with signal-based prospecting."
              className={`${INPUT_CLS} min-h-[118px] resize-y`}
            />
          </label>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <label className="flex items-center gap-3">
              <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Targets</span>
              <input
                type="number"
                min={1}
                max={20}
                value={promptDraft.target_count}
                onChange={event => setPromptDraft(current => ({ ...current, target_count: Math.max(1, Math.min(20, Number(event.target.value) || 10)) }))}
                className={`${INPUT_CLS} w-24`}
              />
            </label>
            <p className="font-body-main text-on-surface-variant text-[12px] max-w-xl">
              Proposed targets still stay behind campaign readiness, contact verification, and outreach approval gates.
            </p>
          </div>
        </div>
      </section>

      {/* Create motion */}
      <section>
        <div className="flex items-center justify-between mb-8 border-b border-outline-variant pb-2 gap-3 flex-wrap">
          <div>
            <p className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Create a motion</p>
            <h3 className="font-h1-editorial text-h1-editorial text-on-surface mt-2">Strategy before sequence</h3>
            <p className="font-body-main text-on-surface-variant mt-2 text-[13px]">A campaign starts as a draft until targets and content are attached.</p>
          </div>
          <button onClick={() => void createCampaign()} disabled={saving} className={PRIMARY_BTN}>
            {saving ? 'Creating…' : 'Create draft'}
          </button>
        </div>
        <div className="hairline-border bg-surface-container-lowest rounded-lg p-5 grid md:grid-cols-2 gap-stack-md">
          <Input label="Name" value={form.name} onChange={name => setForm(f => ({ ...f, name }))} placeholder="Series A pipeline acceleration" />
          <Input label="Objective" value={form.objective} onChange={objective => setForm(f => ({ ...f, objective }))} placeholder="Book 8 founder meetings in AI infra" />
          <Input label="Audience" value={form.segment} onChange={segment => setForm(f => ({ ...f, segment }))} placeholder="Seed/Series A AI infrastructure founders" />
          <Input label="Why-now trigger" value={form.trigger} onChange={trigger => setForm(f => ({ ...f, trigger }))} placeholder="Funding, hiring, launch, competitor movement" />
          <Input label="Offer" value={form.offer} onChange={offer => setForm(f => ({ ...f, offer }))} placeholder="Free GTM teardown / pipeline sprint / intro audit" />
          <Input label="Success metric" value={form.success_metric} onChange={success_metric => setForm(f => ({ ...f, success_metric }))} placeholder="Meetings booked, replies, qualified opps" />
          <label className="block md:col-span-2">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant block mb-1.5">Narrative</span>
            <textarea
              value={form.narrative}
              onChange={event => setForm(f => ({ ...f, narrative: event.target.value }))}
              placeholder="Pain hypothesis, proof, offer, CTA, and why this audience should care now."
              className={`${INPUT_CLS} min-h-[96px] resize-y`}
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant self-center mr-2">Channels</span>
            {CHANNELS.map(channel => {
              const checked = form.channels.includes(channel)
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, channels: checked ? f.channels.filter(item => item !== channel) : [...f.channels, channel] }))}
                  className={`font-label-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded transition-colors ${
                    checked
                      ? 'bg-primary-container/10 text-primary border border-primary/30'
                      : 'border border-outline-variant text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {channel}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Board + detail */}
      <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-stack-lg items-start">
        <section>
          <div className="flex items-center justify-between mb-8 border-b border-outline-variant pb-2">
            <h3 className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Campaign Board</h3>
            <span className={BADGE_ACCENT}>{campaigns.length} Motions</span>
          </div>
          {loading ? (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">
              No campaigns yet. Create the first motion to coordinate outbound and content around one GTM thesis.
            </div>
          ) : (
            <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
              <div className="divide-y divide-[rgba(26,24,22,0.07)]">
                {campaigns.map(campaign => {
                  const active = selected?.id === campaign.id
                  return (
                    <button
                      key={campaign.id}
                      onClick={() => setSelectedId(campaign.id)}
                      className={`w-full text-left px-6 py-5 transition-colors ${active ? 'bg-secondary-container/40' : 'hover:bg-surface-container-low'}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="font-body-main font-medium text-on-surface">{campaign.name}</span>
                            <span className={BADGE}>{campaign.status}</span>
                          </div>
                          <p className="font-body-main text-on-surface-variant truncate text-[13px]">
                            {campaign.objective || campaign.narrative || campaign.trigger || campaign.segment}
                          </p>
                          <p className="font-label-mono text-[10px] uppercase tracking-widest text-outline mt-2">
                            {campaign.readiness?.stage ?? 'strategy'} · {campaign.readiness?.missing.length ?? 0} constraints
                          </p>
                        </div>
                        <Icon name="chevron_right" size={18} className="text-on-surface-variant shrink-0 mt-1" />
                      </div>
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        <Tiny label="Targets" value={campaign.target_counts?.total ?? 0} />
                        <Tiny label="Sent" value={campaign.target_counts?.sent ?? 0} />
                        <Tiny label="Replies" value={campaign.target_counts?.replied ?? 0} />
                        <Tiny label="Content" value={(campaign.content_counts?.total ?? 0) + (campaign.asset_counts?.total ?? 0)} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-stack-lg">
          {selected ? (
            <CampaignDetail
              campaign={selected}
              loading={detailLoading}
              targets={currentTargets}
              links={detail?.content_links ?? []}
              assets={detail?.assets ?? []}
              onStatus={action => void updateStatus(selected.id, action)}
            />
          ) : (
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">
              Select or create a campaign to see execution lanes.
            </div>
          )}

          {/* Enroll leads */}
          <section>
            <div className="flex items-center justify-between mb-6 border-b border-outline-variant pb-2">
              <div>
                <p className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Outbound Targets</p>
                <h4 className="font-h1-editorial text-[20px] text-on-surface mt-1.5">Enroll priority leads</h4>
              </div>
              <span className={BADGE}>Pipeline bridge</span>
            </div>
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-4">
              {candidateLeads.length === 0 ? (
                <p className="font-body-main text-on-surface-variant text-[13px]">
                  No eligible pipeline leads available, or all visible leads are already in this campaign.
                </p>
              ) : (
                <div className="divide-y divide-[rgba(26,24,22,0.07)]">
                  {candidateLeads.map(lead => (
                    <div key={lead.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="font-body-main font-medium text-on-surface truncate">{lead.target_company}</div>
                        <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">
                          {lead.status ?? 'new'} · score {lead.relevance_score ?? 0}
                        </div>
                      </div>
                      <button
                        onClick={() => void enrollLead(lead.id)}
                        disabled={!selected || enrollingLeadId === lead.id}
                        className={GHOST_BTN}
                      >
                        {enrollingLeadId === lead.id ? 'Adding…' : 'Enroll'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Attach content */}
          <section>
            <div className="flex items-center justify-between mb-6 border-b border-outline-variant pb-2">
              <div>
                <p className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">Content Air Cover</p>
                <h4 className="font-h1-editorial text-[20px] text-on-surface mt-1.5">Attach assets to the same motion</h4>
              </div>
              <span className={BADGE}>Content bridge</span>
            </div>
            <div className="bg-surface-container-lowest hairline-border rounded-lg p-4 grid md:grid-cols-[0.75fr_1fr_0.7fr] gap-stack-sm">
              <select
                value={contentForm.kind}
                onChange={event => setContentForm(f => ({ ...f, kind: event.target.value }))}
                className={INPUT_CLS}
              >
                <option value="content_idea">Content idea</option>
                <option value="post">Post</option>
                <option value="gtm_content_idea">GTM idea</option>
                <option value="gtm_campaign_asset">Campaign asset</option>
              </select>
              <input
                value={contentForm.id}
                onChange={event => setContentForm(f => ({ ...f, id: event.target.value }))}
                placeholder="Paste content/asset ID"
                className={INPUT_CLS}
              />
              <select
                value={contentForm.channel}
                onChange={event => setContentForm(f => ({ ...f, channel: event.target.value }))}
                className={INPUT_CLS}
              >
                {CHANNELS.map(channel => <option key={channel} value={channel}>{channel}</option>)}
              </select>
              <input
                value={contentForm.rationale}
                onChange={event => setContentForm(f => ({ ...f, rationale: event.target.value }))}
                placeholder="Why this asset supports the narrative"
                className={`${INPUT_CLS} md:col-span-2`}
              />
              <button
                onClick={() => void attachContent()}
                disabled={!selected || linkingContent}
                className={GHOST_BTN}
              >
                {linkingContent ? 'Attaching…' : 'Attach content'}
              </button>
              <p className="md:col-span-3 font-body-main text-on-surface-variant text-[12px] mt-1">
                This bridges the current split content architecture safely instead of pretending all content lives in one table.
              </p>
            </div>
          </section>
        </section>
      </div>
    </div>
  )
}

function CampaignDetail({ campaign, loading, targets, links, assets, onStatus }: { campaign: Campaign; loading: boolean; targets: CampaignTarget[]; links: CampaignContentLink[]; assets: CampaignAsset[]; onStatus: (action: 'activate' | 'pause' | 'complete') => void }) {
  const readiness = campaign.readiness
  return (
    <section className="bg-surface-container-lowest hairline-border rounded-lg p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-label-mono text-label-mono uppercase tracking-[0.3em] text-on-surface-variant">
            Selected campaign {loading ? '· syncing…' : ''}
          </p>
          <h3 className="font-h1-editorial text-[22px] text-on-surface mt-2 tracking-[-0.02em]">{campaign.name}</h3>
          <p className="font-body-main text-on-surface-variant mt-2 text-[13px]">
            {readiness?.nextAction ?? 'Choose the next GTM constraint to remove.'}
          </p>
        </div>
        <span className={BADGE}>{campaign.status}</span>
      </div>

      <div className="mt-6 grid gap-stack-md">
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
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-stack-sm">
        <Tiny label="Enrolled" value={campaign.target_counts?.enrolled ?? targets.length} />
        <Tiny label="Sent" value={campaign.target_counts?.sent ?? 0} />
        <Tiny label="Replied" value={campaign.target_counts?.replied ?? 0} />
        <Tiny label="Booked" value={campaign.target_counts?.booked ?? 0} />
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-stack-md">
        <Lane
          title="Targets"
          empty="No targets enrolled yet."
          items={targets.map(target => ({ id: target.id, title: target.lead?.target_company ?? target.lead_id, meta: target.status ?? 'enrolled' }))}
        />
        <Lane
          title="Content"
          empty="No content attached yet."
          items={[
            ...links.map(link => ({ id: link.id, title: linkedContentLabel(link), meta: `${link.channel ?? 'content'} · ${link.status ?? 'linked'}` })),
            ...assets.map(asset => ({ id: asset.id, title: asset.title || asset.asset_type || 'Campaign asset', meta: `${asset.channel ?? 'content'} · ${asset.status ?? 'draft'}` })),
          ]}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {campaign.status !== 'active' && (
          <button onClick={() => onStatus('activate')} disabled={!readiness?.canLaunch} className={PRIMARY_BTN}>
            Activate
          </button>
        )}
        {campaign.status === 'active' && (
          <button onClick={() => onStatus('pause')} className={GHOST_BTN}>Pause</button>
        )}
        {campaign.status !== 'completed' && (
          <button onClick={() => onStatus('complete')} className={GHOST_BTN}>Complete</button>
        )}
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

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant block mb-1.5">{label}</span>
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={INPUT_CLS} />
    </label>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-display-sm text-[28px] leading-none text-on-surface">{value}</div>
      <div className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-1.5">{label}</div>
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
