import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { upsertGtmAction } from './actions'
import { eventIdempotencyKey, recordGtmEvent } from './events'
import { upsertGtmEntityEmbedding } from './semantic-context'

export interface GtmContentIdea {
  id: string
  lead_id: string | null
  account_id: string | null
  content_type: 'linkedin_post' | 'newsletter_blurb' | 'campaign_brief' | 'sales_enablement_note'
  audience: string
  angle: string
  proof_points: Array<{ label: string; value: string }>
  pain_category: string
  status: 'new' | 'drafted' | 'approved' | 'dismissed'
  draft: Record<string, unknown>
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

interface ContentIdeaRow extends Omit<GtmContentIdea, 'proof_points'> {
  proof_points: unknown
}

export async function listMarketingContent(
  supabase: SupabaseClient,
  input: { userId: string; clientId?: string | null; limit?: number },
): Promise<{ ideas: GtmContentIdea[]; metrics: Record<string, number> }> {
  const clientId = input.clientId ?? null
  await generateContentIdeas(supabase, { userId: input.userId, clientId })

  let query = supabase
    .from('gtm_content_ideas')
    .select('id, lead_id, account_id, content_type, audience, angle, proof_points, pain_category, status, draft, created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(80, input.limit ?? 40)))
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const ideas = ((data ?? []) as ContentIdeaRow[]).map(row => ({
    ...row,
    proof_points: normalizeProofPoints(row.proof_points),
  }))

  return {
    ideas,
    metrics: {
      total: ideas.length,
      new: ideas.filter(idea => idea.status === 'new').length,
      drafted: ideas.filter(idea => idea.status === 'drafted').length,
      approved: ideas.filter(idea => idea.status === 'approved').length,
      campaign_briefs: ideas.filter(idea => idea.content_type === 'campaign_brief').length,
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
    .select('id, lead_id, account_id, content_type, audience, angle, proof_points, pain_category, status, draft')
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data: idea, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!idea) throw new Error('Content idea not found')

  const nextStatus = input.action === 'approve' ? 'approved' : input.action === 'dismiss' ? 'dismissed' : 'drafted'
  const draft = input.action === 'draft' && !hasDraft((idea as { draft?: unknown }).draft)
    ? buildDraft(idea as ContentIdeaRow)
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
}

async function generateContentIdeas(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<void> {
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
    return
  }

  const candidates = ((data ?? []) as LeadSignalRow[])
    .filter(lead => (lead.relevance_score ?? 0) >= 7 || Boolean(normalizeLeadFeedSnapshot(lead.feed_snapshot)))
    .slice(0, 24)

  const rows = candidates.flatMap(lead => buildIdeaRows(input.userId, input.clientId, lead))
  if (rows.length === 0) return

  const ideaKeys = rows.map(row => row.idea_key)
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
  const insertRows = rows.filter(row => !existingKeys.has(row.idea_key))
  if (insertRows.length === 0) return

  const { error: insertError } = await supabase.from('gtm_content_ideas').insert(insertRows)
  if (insertError) {
    console.error('[content-workflow] idea insert failed:', insertError.message)
  }
}

function buildIdeaRows(userId: string, clientId: string | null, lead: LeadSignalRow) {
  const snapshot = normalizeLeadFeedSnapshot(lead.feed_snapshot)
  const signalType = snapshot?.signal_type ?? 'market_signal'
  const painCategory = painCategoryForSignal(signalType, `${snapshot?.summary ?? ''} ${lead.relevance_reason ?? ''}`)
  const proof = [
    { label: 'Account', value: lead.target_company },
    { label: 'Signal', value: snapshot?.headline ?? lead.relevance_reason ?? `${lead.target_company} matched the ICP` },
    snapshot?.source_name ? { label: 'Source', value: snapshot.source_name } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))

  const base = {
    user_id: userId,
    client_id: clientId,
    account_id: null,
    lead_id: lead.id,
    source_signal_ids: lead.signal_id ? [lead.signal_id] : [],
    proof_points: proof,
    pain_category: painCategory,
  }

  return [
    {
      ...base,
      idea_key: `lead:${lead.id}:linkedin_post`,
      content_type: 'linkedin_post',
      audience: audienceForSignal(signalType),
      angle: `${lead.target_company}'s ${labelForSignal(signalType)} is a useful public example of ${painCategory.replace(/_/g, ' ')}.`,
    },
    {
      ...base,
      idea_key: `lead:${lead.id}:campaign_brief`,
      content_type: 'campaign_brief',
      audience: 'GTM operators and revenue leaders',
      angle: `Turn the ${labelForSignal(signalType)} pattern into a short campaign for accounts showing similar timing pressure.`,
    },
  ]
}

function buildDraft(idea: ContentIdeaRow): Record<string, unknown> {
  const proof = normalizeProofPoints(idea.proof_points)
  if (idea.content_type === 'campaign_brief') {
    return {
      title: idea.angle,
      body: [
        `Audience: ${idea.audience}`,
        `Trigger: ${proof[1]?.value ?? idea.angle}`,
        `Narrative: teams with this signal are likely deciding what needs attention now.`,
        'CTA: Review accounts with similar signals and choose the strongest proof point.',
      ].join('\n\n'),
    }
  }

  return {
    title: idea.angle,
    body: [
      `${proof[1]?.value ?? idea.angle}`,
      `The useful lesson is not the announcement itself. It is the timing pressure it creates for ${idea.audience}.`,
      'That is where GTM teams can move from generic outreach to signal-backed action.',
    ].join('\n\n'),
  }
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

function painCategoryForSignal(signalType: string, text: string): string {
  const lower = `${signalType} ${text}`.toLowerCase()
  if (/\b(security|soc 2|iso|compliance|breach|risk)\b/.test(lower)) return 'trust_and_compliance'
  if (/\b(hiring|vp|chief|head of|joined)\b/.test(lower)) return 'org_change'
  if (/\b(funding|series|raised|growth)\b/.test(lower)) return 'growth_investment'
  if (/\b(launch|integration|product|platform)\b/.test(lower)) return 'product_momentum'
  if (/\b(expand|market|office|partnership)\b/.test(lower)) return 'market_expansion'
  return 'market_timing'
}

function audienceForSignal(signalType: string): string {
  if (signalType === 'hiring') return 'revenue and people leaders'
  if (signalType === 'regulation') return 'operations and compliance leaders'
  if (signalType === 'funding') return 'founders and GTM leaders'
  return 'GTM operators'
}

function labelForSignal(signalType: string): string {
  return signalType.replace(/_/g, ' ')
}

function labelForContentType(value: string): string {
  return value.replace(/_/g, ' ')
}
