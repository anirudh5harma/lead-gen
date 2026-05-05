import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueDistributionJobForIdea } from '@/lib/distribution'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { completePrompt } from '@/lib/deepseek'
import { upsertGtmAction } from './actions'
import { eventIdempotencyKey, recordGtmEvent } from './events'
import { recordGtmMemory } from './memory'
import { upsertGtmEntityEmbedding } from './semantic-context'

export type MarketingContentType = 'x_post' | 'linkedin_post' | 'blog_article' | 'video_script' | 'newsletter_blurb' | 'campaign_brief' | 'sales_enablement_note'

export interface GtmContentIdea {
  id: string
  lead_id: string | null
  account_id: string | null
  content_type: MarketingContentType
  channel: string
  target_platform: string | null
  origin: 'suggested' | 'custom'
  audience: string
  angle: string
  pillar: string | null
  idea_format: string | null
  why_now: string | null
  proof_points: Array<{ label: string; value: string }>
  source_insights: Array<{ label: string; value: string }>
  pain_category: string
  score: number
  scoring_debug: Record<string, unknown>
  status: 'new' | 'drafted' | 'approved' | 'dismissed'
  draft: Record<string, unknown>
  custom_prompt: string | null
  source_assets: Array<{ label: string; value: string }>
  scheduled_for: string | null
  published_at: string | null
  created_at: string
}

interface LeadSignalRow {
  id: string
  client_id: string | null
  signal_id: string | null
  target_company: string
  company_domain: string | null
  relevance_score: number | null
  relevance_reason: string | null
  status: string
  created_at: string
  feed_snapshot: unknown
}

interface ContentIdeaRow extends Omit<GtmContentIdea, 'proof_points' | 'source_insights' | 'scoring_debug'> {
  proof_points: unknown
  source_insights: unknown
  scoring_debug: unknown
}

interface ContentContextSnapshot {
  company: {
    name: string
    industry: string
    websiteUrl: string | null
    description: string
  }
  icp: {
    keywords: string[]
    targetIndustries: string[]
    signalTypes: string[]
    minRelevanceScore: number | null
  }
  memoryInsights: Array<{ type: string; content: string; confidence: number }>
  recentSignals: Array<{
    company: string
    signalType: string
    headline: string
    summary: string
    relevanceReason: string
    score: number
  }>
  previousIdeas: Array<{ title: string; status: string; contentType: string; pillar: string | null }>
  feedback: Array<{ eventType: string; contentType: string | null; pillar: string | null; ideaFormat: string | null }>
}

interface ContentPillar {
  title: string
  audience: string
  pain: string
  belief: string
  proofSources: string[]
  formats: string[]
  confidence: number
}

interface GeneratedContentIdea {
  title: string
  contentType: MarketingContentType
  format: string
  pillar: string
  audience: string
  pain: string
  sourceInsights: Array<{ label: string; value: string }>
  whyNow: string
  angle: string
  draftBrief: string
  confidence: number
}

export async function listMarketingContent(
  supabase: SupabaseClient,
  input: { userId: string; clientId?: string | null; limit?: number; refresh?: boolean },
): Promise<{ ideas: GtmContentIdea[]; metrics: Record<string, number> }> {
  const clientId = input.clientId ?? null
  if (input.refresh) {
    await generateContentIdeas(supabase, { userId: input.userId, clientId })
  }

  let query = supabase
    .from('gtm_content_ideas')
    .select('id, lead_id, account_id, content_type, channel, target_platform, origin, audience, angle, pillar, idea_format, why_now, proof_points, source_insights, pain_category, score, scoring_debug, status, draft, custom_prompt, source_assets, scheduled_for, published_at, created_at')
    .eq('user_id', input.userId)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(80, input.limit ?? 40)))
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const ideas = ((data ?? []) as ContentIdeaRow[]).map(row => ({
    ...row,
    proof_points: normalizeProofPoints(row.proof_points),
    source_insights: normalizeProofPoints(row.source_insights),
    scoring_debug: normalizeRecord(row.scoring_debug),
    score: Number(row.score ?? 0),
    source_assets: normalizeProofPoints((row as { source_assets?: unknown }).source_assets),
    channel: (row as { channel?: string | null }).channel ?? channelForContentType(row.content_type),
    target_platform: (row as { target_platform?: string | null }).target_platform ?? platformForContentType(row.content_type),
    origin: ((row as { origin?: string | null }).origin === 'custom' ? 'custom' : 'suggested') as 'suggested' | 'custom',
    custom_prompt: (row as { custom_prompt?: string | null }).custom_prompt ?? null,
    scheduled_for: (row as { scheduled_for?: string | null }).scheduled_for ?? null,
    published_at: (row as { published_at?: string | null }).published_at ?? null,
  }))

  return {
    ideas,
    metrics: {
      total: ideas.length,
      new: ideas.filter(idea => idea.status === 'new').length,
      drafted: ideas.filter(idea => idea.status === 'drafted').length,
      approved: ideas.filter(idea => idea.status === 'approved').length,
      campaign_briefs: ideas.filter(idea => idea.content_type === 'campaign_brief').length,
      social: ideas.filter(idea => idea.channel === 'social').length,
      written: ideas.filter(idea => idea.channel === 'written').length,
      video: ideas.filter(idea => idea.channel === 'video').length,
      scheduled: ideas.filter(idea => Boolean(idea.scheduled_for)).length,
      custom: ideas.filter(idea => idea.origin === 'custom').length,
    },
  }
}

export async function updateMarketingContentIdea(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    ideaId: string
    action: 'draft' | 'approve' | 'dismiss'
  },
): Promise<void> {
  const clientId = input.clientId ?? null
  let query = supabase
    .from('gtm_content_ideas')
    .select('id, lead_id, account_id, content_type, audience, angle, pillar, idea_format, why_now, proof_points, source_insights, pain_category, score, scoring_debug, status, draft')
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data: idea, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!idea) throw new Error('Content idea not found')

  const nextStatus = input.action === 'approve' ? 'approved' : input.action === 'dismiss' ? 'dismissed' : 'drafted'
  const draft = input.action === 'draft' && !hasDraft((idea as { draft?: unknown }).draft)
    ? await generateDraftForIdea(idea as ContentIdeaRow)
    : (idea as { draft?: Record<string, unknown> | null }).draft ?? {}

  const { error: updateError } = await supabase
    .from('gtm_content_ideas')
    .update({ status: nextStatus, draft })
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  if (updateError) throw new Error(updateError.message)

  await upsertGtmAction(supabase, {
    userId: input.userId,
    clientId,
    accountId: (idea as { account_id?: string | null }).account_id ?? null,
    leadId: (idea as { lead_id?: string | null }).lead_id ?? null,
    actionType: `content.${input.action}`,
    channel: 'marketing',
    title: `${labelForContentType((idea as { content_type: string }).content_type)} ${input.action}`,
    body: (idea as { angle?: string }).angle ?? 'Marketing content workflow action.',
    priority: input.action === 'draft' ? 66 : 58,
    status: 'completed',
    payload: { content_idea_id: input.ideaId },
    result: { status: nextStatus },
    source: 'marketing_content',
    sourceItemKey: `content:${input.ideaId}:${input.action}`,
  })

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'content_idea',
    entityId: input.ideaId,
    eventType: `content.${nextStatus}`,
    source: 'marketing_content',
    payload: { content_idea_id: input.ideaId, action: input.action },
    idempotencyKey: eventIdempotencyKey(['content', input.ideaId, input.action]),
  })

  await recordContentFeedback(supabase, {
    userId: input.userId,
    clientId,
    idea: idea as ContentIdeaRow,
    eventType: nextStatus,
    metadata: { action: input.action, score: (idea as { score?: number | null }).score ?? null },
  })

  await upsertGtmEntityEmbedding(supabase, {
    userId: input.userId,
    clientId,
    accountId: (idea as { account_id?: string | null }).account_id ?? null,
    entityType: 'content_idea',
    entityId: input.ideaId,
    content: [
      (idea as { content_type?: string }).content_type,
      (idea as { audience?: string }).audience,
      (idea as { pain_category?: string }).pain_category,
      (idea as { angle?: string }).angle,
      hasDraft(draft) ? JSON.stringify(draft).slice(0, 1000) : '',
    ].filter(Boolean).join('\n'),
    source: 'marketing_content',
    metadata: {
      action: input.action,
      status: nextStatus,
      lead_id: (idea as { lead_id?: string | null }).lead_id ?? null,
      content_type: (idea as { content_type?: string }).content_type ?? null,
    },
  })

  await recordContentPreferenceMemory(supabase, {
    userId: input.userId,
    clientId,
    idea: idea as ContentIdeaRow,
    action: input.action,
  })
}

export async function createCustomMarketingContentIdea(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    contentType: MarketingContentType
    prompt: string
    assets?: Array<{ label: string; value: string }>
  },
): Promise<string> {
  const clientId = input.clientId ?? null
  const prompt = input.prompt.trim().slice(0, 2000)
  if (prompt.length < 8) throw new Error('Add a clearer content prompt.')

  const assets = (input.assets ?? [])
    .map(asset => ({
      label: asset.label.trim().slice(0, 80) || 'Asset',
      value: asset.value.trim().slice(0, 1200),
    }))
    .filter(asset => asset.value)
    .slice(0, 6)
  const draft = await generateCustomDraft(input.contentType, prompt, assets)
  const title = typeof draft.title === 'string' && draft.title.trim() ? draft.title.trim() : titleForContentType(input.contentType, prompt)
  const now = new Date().toISOString()
  const ideaKey = `custom:${input.contentType}:${stableSlug(`${prompt}:${now}`)}`

  const { data, error } = await supabase
    .from('gtm_content_ideas')
    .insert({
      user_id: input.userId,
      client_id: clientId,
      idea_key: ideaKey,
      content_type: input.contentType,
      channel: channelForContentType(input.contentType),
      target_platform: platformForContentType(input.contentType),
      origin: 'custom',
      custom_prompt: prompt,
      source_assets: assets,
      audience: audienceForContentType(input.contentType),
      angle: title,
      pillar: 'User-directed content',
      idea_format: 'custom',
      why_now: 'The user requested this item from their own context.',
      proof_points: assets.length > 0 ? assets : [{ label: 'Prompt', value: prompt }],
      source_insights: assets.length > 0 ? assets : [{ label: 'User prompt', value: prompt }],
      pain_category: 'custom_prompt',
      score: 72,
      scoring_debug: { user_requested: true, source_assets: assets.length },
      status: 'drafted',
      draft,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  const ideaId = (data as { id: string }).id

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'content_idea',
    entityId: ideaId,
    eventType: 'content.custom_created',
    source: 'marketing_content',
    payload: { content_idea_id: ideaId, content_type: input.contentType },
    idempotencyKey: eventIdempotencyKey(['content', 'custom', ideaId]),
  })

  await recordContentFeedback(supabase, {
    userId: input.userId,
    clientId,
    idea: {
      id: ideaId,
      content_type: input.contentType,
      pillar: 'User-directed content',
      idea_format: 'custom',
      angle: title,
    } as ContentIdeaRow,
    eventType: 'custom_created',
    metadata: { prompt: prompt.slice(0, 500), source_assets: assets.length },
  })

  await recordGtmMemory(supabase, {
    userId: input.userId,
    clientId,
    scope: 'workspace',
    memoryType: 'content_preference',
    content: `User created a custom ${labelForContentType(input.contentType)} around "${title}". Prefer content ideas that preserve this kind of user-directed angle when relevant.`,
    source: 'marketing_content',
    confidence: 0.72,
    provenance: { content_idea_id: ideaId, content_type: input.contentType },
  })

  return ideaId
}

export async function scheduleMarketingContentIdea(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    ideaId: string
    scheduledFor: string | null
  },
): Promise<void> {
  const clientId = input.clientId ?? null
  let ideaQuery = supabase
    .from('gtm_content_ideas')
    .select('id, content_type')
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  ideaQuery = clientId ? ideaQuery.eq('client_id', clientId) : ideaQuery.is('client_id', null)
  const { data: idea, error: ideaError } = await ideaQuery.maybeSingle()
  if (ideaError) throw new Error(ideaError.message)
  if (!idea) throw new Error('Content idea not found')

  let query = supabase
    .from('gtm_content_ideas')
    .update({ scheduled_for: input.scheduledFor })
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { error } = await query
  if (error) throw new Error(error.message)

  await enqueueDistributionJobForIdea(supabase, {
    userId: input.userId,
    clientId,
    ideaId: input.ideaId,
    contentType: (idea as { content_type: string }).content_type,
    scheduledFor: input.scheduledFor,
  })

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'content_idea',
    entityId: input.ideaId,
    eventType: input.scheduledFor ? 'content.scheduled' : 'content.unscheduled',
    source: 'marketing_content',
    payload: { content_idea_id: input.ideaId, scheduled_for: input.scheduledFor },
    idempotencyKey: eventIdempotencyKey(['content', input.ideaId, 'schedule', input.scheduledFor ?? 'none']),
  })

  await recordContentFeedback(supabase, {
    userId: input.userId,
    clientId,
    idea: { id: input.ideaId } as ContentIdeaRow,
    eventType: input.scheduledFor ? 'scheduled' : 'unscheduled',
    metadata: { scheduled_for: input.scheduledFor },
  })
}

async function generateContentIdeas(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<void> {
  const shouldRun = await shouldGenerateContentIdeas(supabase, input)
  if (!shouldRun) return

  const context = await buildContentContextSnapshot(supabase, input)
  await storeContentContextSnapshot(supabase, input, context)

  const pillars = await ensureContentPillars(supabase, input, context)
  const generatedIdeas = await generateCreativeIdeas(context, pillars)
  if (generatedIdeas.length === 0) return

  const scoredIdeas = scoreAndDedupeIdeas(generatedIdeas, context)
    .slice(0, 18)
    .map(({ idea, score, debug }) => buildGeneratedIdeaRow(input.userId, input.clientId, idea, score, debug))

  if (scoredIdeas.length === 0) return

  const ideaKeys = scoredIdeas.map(row => row.idea_key)
  let existingQuery = supabase
    .from('gtm_content_ideas')
    .select('idea_key')
    .eq('user_id', input.userId)
    .in('idea_key', ideaKeys)
  existingQuery = input.clientId ? existingQuery.eq('client_id', input.clientId) : existingQuery.is('client_id', null)

  const { data: existing, error: existingError } = await existingQuery
  if (existingError) {
    console.error('[content-workflow] existing idea lookup failed:', existingError.message)
    return
  }

  const existingKeys = new Set(((existing ?? []) as Array<{ idea_key: string }>).map(row => row.idea_key))
  const insertRows = scoredIdeas.filter(row => !existingKeys.has(row.idea_key))
  if (insertRows.length === 0) return

  const { error: insertError } = await supabase.from('gtm_content_ideas').insert(insertRows)
  if (insertError) {
    console.error('[content-workflow] idea insert failed:', insertError.message)
  }
}

async function shouldGenerateContentIdeas(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<boolean> {
  let query = supabase
    .from('gtm_content_context_snapshots')
    .select('created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(1)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return true
  const latest = (data?.[0] as { created_at?: string } | undefined)?.created_at
  if (!latest) return true
  return Date.now() - new Date(latest).getTime() > 12 * 60 * 60 * 1000
}

async function buildContentContextSnapshot(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<ContentContextSnapshot> {
  const [profile, memories, leads, previousIdeas, feedback] = await Promise.all([
    fetchContentProfile(supabase, input),
    fetchContentMemories(supabase, input),
    fetchRecentSignals(supabase, input),
    fetchPreviousIdeas(supabase, input),
    fetchContentFeedback(supabase, input),
  ])

  return {
    company: profile.company,
    icp: profile.icp,
    memoryInsights: memories,
    recentSignals: leads,
    previousIdeas,
    feedback,
  }
}

async function fetchContentProfile(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<Pick<ContentContextSnapshot, 'company' | 'icp'>> {
  if (input.clientId) {
    const { data } = await supabase
      .from('client_accounts')
      .select('name, industry, website_url, services_description, icp_keywords, target_industries, target_signal_types, min_relevance_score')
      .eq('id', input.clientId)
      .eq('user_id', input.userId)
      .maybeSingle()
    const row = (data ?? {}) as Record<string, unknown>
    return profileFromRow(row, 'Client workspace')
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('company_name, industry, website_url, services_description, icp_keywords, target_industries, target_signal_types, min_relevance_score')
    .eq('user_id', input.userId)
    .maybeSingle()
  return profileFromRow((data ?? {}) as Record<string, unknown>, 'Workspace')
}

function profileFromRow(row: Record<string, unknown>, fallbackName: string): Pick<ContentContextSnapshot, 'company' | 'icp'> {
  const name = stringValue(row.name) || stringValue(row.company_name) || fallbackName
  return {
    company: {
      name,
      industry: stringValue(row.industry) || 'unknown',
      websiteUrl: stringValue(row.website_url) || null,
      description: stringValue(row.services_description),
    },
    icp: {
      keywords: stringArray(row.icp_keywords),
      targetIndustries: stringArray(row.target_industries),
      signalTypes: stringArray(row.target_signal_types),
      minRelevanceScore: numberValue(row.min_relevance_score),
    },
  }
}

async function fetchContentMemories(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<ContentContextSnapshot['memoryInsights']> {
  let query = supabase
    .from('gtm_memories')
    .select('memory_type, content, confidence, observed_at')
    .eq('user_id', input.userId)
    .in('memory_scope', ['workspace', 'performance', 'entity'])
    .order('observed_at', { ascending: false })
    .limit(28)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return []
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    type: stringValue(row.memory_type) || 'memory',
    content: stringValue(row.content).slice(0, 500),
    confidence: numberValue(row.confidence) ?? 0.7,
  })).filter(memory => memory.content)
}

async function fetchRecentSignals(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<ContentContextSnapshot['recentSignals']> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  let query = supabase
    .from('leads')
    .select('id, client_id, signal_id, target_company, company_domain, relevance_score, relevance_reason, status, created_at, feed_snapshot')
    .eq('user_id', input.userId)
    .neq('status', 'dismissed')
    .gte('created_at', since)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(80)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) {
    console.error('[content-workflow] lead query failed:', error.message)
    return []
  }

  return ((data ?? []) as LeadSignalRow[])
    .filter(lead => (lead.relevance_score ?? 0) >= 7 || Boolean(normalizeLeadFeedSnapshot(lead.feed_snapshot)))
    .slice(0, 28)
    .map(lead => {
      const snapshot = normalizeLeadFeedSnapshot(lead.feed_snapshot)
      return {
        company: lead.target_company,
        signalType: snapshot?.signal_type ?? 'market_signal',
        headline: snapshot?.headline ?? lead.relevance_reason ?? `${lead.target_company} matched the ICP`,
        summary: snapshot?.summary ?? '',
        relevanceReason: lead.relevance_reason ?? '',
        score: lead.relevance_score ?? 0,
      }
    })
}

async function fetchPreviousIdeas(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<ContentContextSnapshot['previousIdeas']> {
  let query = supabase
    .from('gtm_content_ideas')
    .select('angle, status, content_type, pillar, created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(40)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return []
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    title: stringValue(row.angle).slice(0, 220),
    status: stringValue(row.status),
    contentType: stringValue(row.content_type),
    pillar: stringValue(row.pillar) || null,
  })).filter(idea => idea.title)
}

async function fetchContentFeedback(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<ContentContextSnapshot['feedback']> {
  let query = supabase
    .from('gtm_content_feedback_events')
    .select('event_type, content_type, pillar, idea_format, created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(50)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return []
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    eventType: stringValue(row.event_type),
    contentType: stringValue(row.content_type) || null,
    pillar: stringValue(row.pillar) || null,
    ideaFormat: stringValue(row.idea_format) || null,
  }))
}

async function storeContentContextSnapshot(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
  context: ContentContextSnapshot,
): Promise<void> {
  const snapshotKey = new Date().toISOString().slice(0, 13)
  let existingQuery = supabase
    .from('gtm_content_context_snapshots')
    .select('id')
    .eq('user_id', input.userId)
    .eq('snapshot_key', snapshotKey)
    .limit(1)
  existingQuery = input.clientId ? existingQuery.eq('client_id', input.clientId) : existingQuery.is('client_id', null)
  const { data: existing } = await existingQuery
  if ((existing ?? []).length > 0) return

  const { error } = await supabase
    .from('gtm_content_context_snapshots')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      snapshot_key: snapshotKey,
      context,
    })
  if (error) console.error('[content-workflow] context snapshot insert failed:', error.message)
}

async function ensureContentPillars(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
  context: ContentContextSnapshot,
): Promise<ContentPillar[]> {
  let query = supabase
    .from('gtm_content_pillars')
    .select('pillar_key, title, audience, pain, belief, proof_sources, formats, confidence')
    .eq('user_id', input.userId)
    .order('updated_at', { ascending: false })
    .limit(8)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)

  const { data, error } = await query
  const existing = error ? [] : ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    title: stringValue(row.title),
    audience: stringValue(row.audience),
    pain: stringValue(row.pain),
    belief: stringValue(row.belief),
    proofSources: stringArray(row.proof_sources),
    formats: stringArray(row.formats),
    confidence: numberValue(row.confidence) ?? 0.7,
  })).filter(pillar => pillar.title && pillar.pain)
  if (existing.length >= 4) return existing

  const generated = await generateContentPillars(context)
  if (generated.length > 0) {
    const existingKeys = new Set(((data ?? []) as Array<Record<string, unknown>>).map(row => stringValue(row.pillar_key)).filter(Boolean))
    const rows = generated.map(pillar => ({
      user_id: input.userId,
      client_id: input.clientId,
      pillar_key: stableKey(pillar.title),
      title: pillar.title.slice(0, 180),
      audience: pillar.audience.slice(0, 180),
      pain: pillar.pain.slice(0, 240),
      belief: pillar.belief.slice(0, 300),
      proof_sources: pillar.proofSources.slice(0, 8),
      formats: pillar.formats.slice(0, 8),
      confidence: clampNumber(pillar.confidence, 0, 1),
    })).filter(row => !existingKeys.has(row.pillar_key))
    if (rows.length === 0) return generated
    const { error: upsertError } = await supabase
      .from('gtm_content_pillars')
      .insert(rows)
    if (upsertError) console.error('[content-workflow] pillar insert failed:', upsertError.message)
  }

  return generated.length > 0 ? generated : fallbackPillars(context)
}

async function generateContentPillars(context: ContentContextSnapshot): Promise<ContentPillar[]> {
  try {
    const text = await completePrompt({
      system: 'You design durable B2B content pillars from GTM context. Return only valid JSON.',
      prompt: [
        'Create 5 to 8 content pillars for this workspace.',
        'Each pillar must connect the company position, ICP pain, memory insights, and recent market signals.',
        'Avoid generic AI/SaaS thought leadership.',
        `Context JSON:\n${JSON.stringify(trimContextForPrompt(context)).slice(0, 9000)}`,
        'Return JSON: {"pillars":[{"title":"","audience":"","pain":"","belief":"","proofSources":[],"formats":[],"confidence":0.8}]}',
      ].join('\n\n'),
      maxTokens: 1600,
      timeoutMs: 25_000,
      temperature: 0.48,
      responseFormat: { type: 'json_object' },
      thinking: { type: 'disabled' },
    })
    const parsed = JSON.parse(text) as { pillars?: unknown }
    return normalizePillars(parsed.pillars).slice(0, 8)
  } catch (error) {
    console.error('[content-workflow] pillar generation failed:', error)
    return []
  }
}

async function generateCreativeIdeas(context: ContentContextSnapshot, pillars: ContentPillar[]): Promise<GeneratedContentIdea[]> {
  try {
    const text = await completePrompt({
      system: [
        'You are Bombsell’s creative GTM content strategist.',
        'Generate original, useful content ideas grounded only in supplied context.',
        'Every idea must cite a memory insight, ICP pain, or recent signal. Avoid templates, empty thought leadership, and invented claims.',
        'Return only valid JSON.',
      ].join(' '),
      prompt: [
        'Generate 14 to 18 varied content ideas across LinkedIn posts, X posts, blog articles, and video scripts.',
        'Use different creative patterns: opinion, tactical, contrarian, signal-led, story, data-backed, objection-handling, comparison, playbook, founder note.',
        'Do not repeat previous ideas. Do not start from a fixed template.',
        `Context JSON:\n${JSON.stringify(trimContextForPrompt(context)).slice(0, 9000)}`,
        `Pillars JSON:\n${JSON.stringify(pillars).slice(0, 4500)}`,
        'Return JSON: {"ideas":[{"title":"","contentType":"linkedin_post|x_post|blog_article|video_script","format":"","pillar":"","audience":"","pain":"","sourceInsights":[{"label":"","value":""}],"whyNow":"","angle":"","draftBrief":"","confidence":0.8}]}',
      ].join('\n\n'),
      maxTokens: 3200,
      timeoutMs: 35_000,
      temperature: 0.72,
      responseFormat: { type: 'json_object' },
      thinking: { type: 'disabled' },
    })
    const parsed = JSON.parse(text) as { ideas?: unknown }
    return normalizeGeneratedIdeas(parsed.ideas)
  } catch (error) {
    console.error('[content-workflow] creative idea generation failed:', error)
    return fallbackIdeas(context, pillars)
  }
}

function scoreAndDedupeIdeas(
  ideas: GeneratedContentIdea[],
  context: ContentContextSnapshot,
): Array<{ idea: GeneratedContentIdea; score: number; debug: Record<string, unknown> }> {
  const previousTitles = context.previousIdeas.map(idea => idea.title)
  const approvedFeedback = context.feedback.filter(event => event.eventType === 'approved' || event.eventType === 'scheduled')
  const dismissedFeedback = context.feedback.filter(event => event.eventType === 'dismissed')
  const seen = new Set<string>()

  return ideas.map(idea => {
    const noveltyPenalty = Math.max(...previousTitles.map(title => titleSimilarity(title, idea.title)), 0) * 22
    const genericPenalty = isGenericIdea(idea) ? 18 : 0
    const sourceBoost = Math.min(18, idea.sourceInsights.length * 5)
    const signalBoost = idea.sourceInsights.some(insight => /signal|funding|hiring|launch|market|reply|objection|memory/i.test(`${insight.label} ${insight.value}`)) ? 8 : 0
    const preferenceBoost = approvedFeedback.some(event => event.contentType === idea.contentType || event.pillar === idea.pillar || event.ideaFormat === idea.format) ? 7 : 0
    const dismissalPenalty = dismissedFeedback.some(event => event.contentType === idea.contentType && event.pillar === idea.pillar) ? 6 : 0
    const confidence = clampNumber(idea.confidence, 0, 1) * 18
    const score = clampNumber(42 + sourceBoost + signalBoost + preferenceBoost + confidence - noveltyPenalty - genericPenalty - dismissalPenalty, 0, 100)
    return {
      idea,
      score,
      debug: {
        sourceBoost,
        signalBoost,
        preferenceBoost,
        noveltyPenalty: Number(noveltyPenalty.toFixed(2)),
        genericPenalty,
        dismissalPenalty,
        confidence: idea.confidence,
      },
    }
  })
    .filter(item => item.score >= 48)
    .filter(item => {
      const key = stableKey(`${item.idea.contentType}:${item.idea.title}`)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.score - a.score)
}

function buildGeneratedIdeaRow(
  userId: string,
  clientId: string | null,
  idea: GeneratedContentIdea,
  score: number,
  debug: Record<string, unknown>,
) {
  return {
    user_id: userId,
    client_id: clientId,
    account_id: null,
    lead_id: null,
    idea_key: `intel:${idea.contentType}:${stableKey(`${idea.title}:${idea.pillar}`)}`,
    source_signal_ids: [],
    content_type: idea.contentType,
    channel: channelForContentType(idea.contentType),
    target_platform: platformForContentType(idea.contentType),
    origin: 'suggested',
    audience: idea.audience.slice(0, 240) || audienceForContentType(idea.contentType),
    angle: (idea.angle || idea.title).slice(0, 500),
    pillar: idea.pillar.slice(0, 180) || null,
    idea_format: idea.format.slice(0, 120) || null,
    why_now: idea.whyNow.slice(0, 800) || null,
    proof_points: [
      { label: 'Content brief', value: idea.draftBrief || idea.angle || idea.title },
      ...idea.sourceInsights,
    ].slice(0, 6),
    source_insights: idea.sourceInsights.slice(0, 8),
    pain_category: stableKey(idea.pain || 'market_timing').replace(/-/g, '_').slice(0, 80) || 'market_timing',
    score,
    scoring_debug: debug,
    status: 'new',
    draft: {},
  }
}

async function generateDraftForIdea(idea: ContentIdeaRow): Promise<Record<string, unknown>> {
  const proof = normalizeProofPoints(idea.proof_points)
  const insights = normalizeProofPoints(idea.source_insights)
  try {
    const text = await completePrompt({
      system: [
        'You are Bombsell’s senior B2B content strategist.',
        'Write original, specific marketing copy from the provided idea brief.',
        'Do not use a reusable template. Do not invent proof, customer claims, metrics, or named examples.',
        'Return only valid JSON with "title" and "body" string fields.',
      ].join(' '),
      prompt: [
        `Content type: ${labelForContentType(idea.content_type)}`,
        `Audience: ${idea.audience}`,
        `Pillar: ${stringValue(idea.pillar) || 'not specified'}`,
        `Format: ${stringValue(idea.idea_format) || 'not specified'}`,
        `Angle: ${idea.angle}`,
        `Pain: ${idea.pain_category}`,
        stringValue(idea.why_now) ? `Why now: ${stringValue(idea.why_now)}` : '',
        `Proof points:\n${proof.map(point => `- ${point.label}: ${point.value}`).join('\n') || '- none'}`,
        `Source insights:\n${insights.map(point => `- ${point.label}: ${point.value}`).join('\n') || '- none'}`,
        'Write in a sharp, useful, non-generic voice. Make it feel like a real operator wrote it from market context.',
      ].filter(Boolean).join('\n\n'),
      maxTokens: idea.content_type === 'blog_article' ? 1800 : 1000,
      timeoutMs: 25_000,
      temperature: 0.58,
      responseFormat: { type: 'json_object' },
      thinking: { type: 'disabled' },
    })
    const parsed = JSON.parse(text) as { title?: unknown; body?: unknown }
    if (typeof parsed.title === 'string' && typeof parsed.body === 'string') {
      return { title: parsed.title.slice(0, 240), body: parsed.body.slice(0, 7000) }
    }
  } catch (error) {
    console.error('[content-workflow] suggested draft generation failed:', error)
  }

  return {
    title: idea.angle,
    body: [
      idea.angle,
      stringValue(idea.why_now),
      insights.map(point => `${point.label}: ${point.value}`).join('\n'),
    ].filter(Boolean).join('\n\n'),
  }
}

async function generateCustomDraft(
  contentType: MarketingContentType,
  prompt: string,
  assets: Array<{ label: string; value: string }>,
): Promise<Record<string, unknown>> {
  const assetContext = assets.map(asset => `${asset.label}: ${asset.value}`).join('\n')
  try {
    const text = await completePrompt({
      system: 'You create concise B2B marketing assets. Return only valid JSON with "title" and "body" string fields.',
      prompt: [
        `Content type: ${labelForContentType(contentType)}`,
        `User prompt: ${prompt}`,
        assetContext ? `Assets/context:\n${assetContext}` : '',
        'Keep the output ready to edit, specific, and distribution-friendly.',
      ].filter(Boolean).join('\n\n'),
      maxTokens: 1200,
      timeoutMs: 25_000,
      temperature: 0.35,
      responseFormat: { type: 'json_object' },
      thinking: { type: 'disabled' },
    })
    const parsed = JSON.parse(text) as { title?: unknown; body?: unknown }
    if (typeof parsed.title === 'string' && typeof parsed.body === 'string') {
      return { title: parsed.title.slice(0, 240), body: parsed.body.slice(0, 6000) }
    }
  } catch (error) {
    console.error('[content-workflow] custom draft generation failed:', error)
  }

  return {
    title: titleForContentType(contentType, prompt),
    body: [
      prompt,
      assets.length > 0 ? `Context: ${assets.map(asset => asset.value).join(' ')}` : '',
      `Format this as a ${labelForContentType(contentType)} for ${audienceForContentType(contentType)}.`,
    ].filter(Boolean).join('\n\n'),
  }
}

function channelForContentType(value: string): string {
  if (value === 'x_post' || value === 'linkedin_post') return 'social'
  if (value === 'blog_article' || value === 'newsletter_blurb') return 'written'
  if (value === 'video_script') return 'video'
  return 'campaign'
}

function platformForContentType(value: string): string {
  if (value === 'x_post') return 'x'
  if (value === 'linkedin_post') return 'linkedin'
  if (value === 'blog_article') return 'blog'
  if (value === 'video_script') return 'youtube'
  if (value === 'newsletter_blurb') return 'newsletter'
  return 'campaign'
}

function audienceForContentType(value: string): string {
  if (value === 'x_post' || value === 'linkedin_post') return 'GTM operators and revenue leaders'
  if (value === 'blog_article') return 'buyers researching GTM execution'
  if (value === 'video_script') return 'founders and revenue teams'
  return 'GTM leaders'
}

function titleForContentType(contentType: string, prompt: string): string {
  const firstLine = prompt.split(/\n+/)[0]?.trim() || labelForContentType(contentType)
  return `${labelForContentType(contentType)}: ${firstLine}`.slice(0, 180)
}

function stableSlug(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return `${Date.now().toString(36)}-${Math.abs(hash).toString(36)}`
}

function hasDraft(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
}

function normalizeProofPoints(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item !== 'object' || item === null) return null
      const label = (item as { label?: unknown }).label
      const pointValue = (item as { value?: unknown }).value
      return typeof label === 'string' && typeof pointValue === 'string'
        ? { label, value: pointValue }
        : null
    })
    .filter((item): item is { label: string; value: string } => Boolean(item))
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function normalizePillars(value: unknown): ContentPillar[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const title = stringValue(row.title)
      const audience = stringValue(row.audience)
      const pain = stringValue(row.pain)
      const belief = stringValue(row.belief)
      if (!title || !pain || !belief) return null
      return {
        title,
        audience: audience || 'Revenue leaders and operators',
        pain,
        belief,
        proofSources: stringArray(row.proofSources).concat(stringArray(row.proof_sources)).slice(0, 8),
        formats: stringArray(row.formats).slice(0, 8),
        confidence: numberValue(row.confidence) ?? 0.72,
      }
    })
    .filter((pillar): pillar is ContentPillar => Boolean(pillar))
}

function normalizeGeneratedIdeas(value: unknown): GeneratedContentIdea[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const contentType = normalizeContentType(stringValue(row.contentType) || stringValue(row.content_type))
      const title = stringValue(row.title)
      const angle = stringValue(row.angle) || title
      const pain = stringValue(row.pain)
      const sourceInsights = normalizeProofPoints(row.sourceInsights).concat(normalizeProofPoints(row.source_insights)).slice(0, 8)
      if (!contentType || !title || !angle || !pain || sourceInsights.length === 0) return null
      return {
        title,
        contentType,
        format: stringValue(row.format) || 'signal-led',
        pillar: stringValue(row.pillar) || 'Market timing',
        audience: stringValue(row.audience) || audienceForContentType(contentType),
        pain,
        sourceInsights,
        whyNow: stringValue(row.whyNow) || stringValue(row.why_now),
        angle,
        draftBrief: stringValue(row.draftBrief) || stringValue(row.draft_brief) || angle,
        confidence: numberValue(row.confidence) ?? 0.7,
      }
    })
    .filter((idea): idea is GeneratedContentIdea => Boolean(idea))
}

function normalizeContentType(value: string): MarketingContentType | null {
  if (value === 'x_post' || value === 'linkedin_post' || value === 'blog_article' || value === 'video_script') return value
  return null
}

function fallbackPillars(context: ContentContextSnapshot): ContentPillar[] {
  const pains = [
    ...context.icp.keywords,
    ...context.recentSignals.map(signal => painCategoryForSignal(signal.signalType, `${signal.summary} ${signal.relevanceReason}`).replace(/_/g, ' ')),
    ...context.memoryInsights.map(memory => memory.type.replace(/_/g, ' ')),
  ].filter(Boolean).slice(0, 6)
  return (pains.length > 0 ? pains : ['market timing', 'buyer prioritization', 'signal-led GTM']).map(pain => ({
    title: titleCase(pain),
    audience: 'Revenue leaders and GTM operators',
    pain,
    belief: `${context.company.name} should educate buyers around ${pain} using live market evidence and operational lessons.`,
    proofSources: context.recentSignals.slice(0, 3).map(signal => signal.headline),
    formats: ['opinion', 'tactical', 'signal-led'],
    confidence: 0.62,
  })).slice(0, 6)
}

function fallbackIdeas(context: ContentContextSnapshot, pillars: ContentPillar[]): GeneratedContentIdea[] {
  const signals = context.recentSignals.slice(0, 4)
  const memories = context.memoryInsights.slice(0, 4)
  return pillars.slice(0, 4).flatMap((pillar, index) => {
    const signal = signals[index % Math.max(signals.length, 1)]
    const memory = memories[index % Math.max(memories.length, 1)]
    const insight = signal
      ? { label: 'Recent signal', value: `${signal.company}: ${signal.headline}` }
      : { label: 'Memory insight', value: memory?.content ?? pillar.belief }
    const whyNow = signal ? `Recent account movement around ${signal.signalType} makes this pain current.` : 'Workspace memory shows this theme is recurring.'
    return [
      {
        title: `${pillar.title}: what buyers are really reacting to`,
        contentType: index % 2 === 0 ? 'linkedin_post' : 'blog_article',
        format: index % 2 === 0 ? 'opinion' : 'playbook',
        pillar: pillar.title,
        audience: pillar.audience,
        pain: pillar.pain,
        sourceInsights: [insight],
        whyNow,
        angle: `A specific take on ${pillar.pain}: buyers do not need more vendor noise, they need a clear way to interpret the timing pressure behind it.`,
        draftBrief: pillar.belief,
        confidence: pillar.confidence,
      },
    ] satisfies GeneratedContentIdea[]
  })
}

function trimContextForPrompt(context: ContentContextSnapshot): ContentContextSnapshot {
  return {
    company: {
      ...context.company,
      description: context.company.description.slice(0, 1200),
    },
    icp: {
      ...context.icp,
      keywords: context.icp.keywords.slice(0, 24),
      targetIndustries: context.icp.targetIndustries.slice(0, 16),
      signalTypes: context.icp.signalTypes.slice(0, 12),
    },
    memoryInsights: context.memoryInsights.slice(0, 16),
    recentSignals: context.recentSignals.slice(0, 18),
    previousIdeas: context.previousIdeas.slice(0, 24),
    feedback: context.feedback.slice(0, 30),
  }
}

async function recordContentFeedback(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    idea: ContentIdeaRow
    eventType: 'drafted' | 'approved' | 'dismissed' | 'scheduled' | 'unscheduled' | 'custom_created'
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('gtm_content_feedback_events').insert({
    user_id: input.userId,
    client_id: input.clientId,
    content_idea_id: input.idea.id,
    event_type: input.eventType,
    content_type: stringValue(input.idea.content_type) || null,
    pillar: stringValue(input.idea.pillar) || null,
    idea_format: stringValue(input.idea.idea_format) || null,
    metadata: input.metadata ?? {},
  })
  if (error) console.error('[content-workflow] feedback insert failed:', error.message)
}

async function recordContentPreferenceMemory(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    idea: ContentIdeaRow
    action: 'draft' | 'approve' | 'dismiss'
  },
): Promise<void> {
  const actionText = input.action === 'approve' ? 'approved' : input.action === 'dismiss' ? 'dismissed' : 'drafted'
  const confidence = input.action === 'approve' ? 0.82 : input.action === 'dismiss' ? 0.68 : 0.6
  await recordGtmMemory(supabase, {
    userId: input.userId,
    clientId: input.clientId,
    scope: 'workspace',
    memoryType: 'content_preference',
    content: `User ${actionText} ${labelForContentType(stringValue(input.idea.content_type))} idea "${input.idea.angle}". Pillar: ${stringValue(input.idea.pillar) || 'none'}. Format: ${stringValue(input.idea.idea_format) || 'none'}.`,
    source: 'marketing_content',
    confidence,
    provenance: {
      content_idea_id: input.idea.id,
      content_type: stringValue(input.idea.content_type) || null,
      pillar: stringValue(input.idea.pillar) || null,
      action: input.action,
    },
  })
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function stableKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'content'
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, letter => letter.toUpperCase())
}

function titleTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 3))
}

function titleSimilarity(a: string, b: string): number {
  const left = titleTokens(a)
  const right = titleTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  const overlap = [...left].filter(token => right.has(token)).length
  return overlap / Math.max(left.size, right.size)
}

function isGenericIdea(idea: GeneratedContentIdea): boolean {
  const text = `${idea.title} ${idea.angle}`.toLowerCase()
  return /\b(future of|ultimate guide|everything you need|ai is changing|transform your|revolutionize)\b/.test(text) ||
    idea.sourceInsights.length === 0 ||
    idea.angle.length < 40
}

function painCategoryForSignal(signalType: string, text: string): string {
  const lower = `${signalType} ${text}`.toLowerCase()
  if (/\b(security|soc 2|iso|compliance|breach|risk)\b/.test(lower)) return 'trust_and_compliance'
  if (/\b(hiring|vp|chief|head of|joined)\b/.test(lower)) return 'org_change'
  if (/\b(funding|series|raised|growth)\b/.test(lower)) return 'growth_investment'
  if (/\b(launch|integration|product|platform)\b/.test(lower)) return 'product_momentum'
  if (/\b(expand|market|office|partnership)\b/.test(lower)) return 'market_expansion'
  return 'market_timing'
}

function labelForContentType(value: string): string {
  return value.replace(/_/g, ' ')
}
