import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { accountKey, normalizeDomain, normalizeEntityName, personKey, signalKey } from './identity'
import { recordGtmMemory } from './memory'
import { buildSignalIntelligence } from './signal-intelligence'
import { upsertSignalCluster } from './signal-clusters'
import { recordSourceReliabilityOutcome } from './source-reliability'
import { eventIdempotencyKey, recordGtmEvent } from './events'
import { upsertGtmEntityEmbedding } from './semantic-context'

export interface LeadGraphInput {
  id: string
  user_id: string
  client_id?: string | null
  target_company: string
  company_domain?: string | null
  relevance_score?: number | null
  relevance_reason?: string | null
  status?: string | null
  is_unlocked?: boolean | null
  contact_email?: string | null
  contact_name?: string | null
  contact_title?: string | null
  contact_verified?: boolean | null
  origin?: string | null
  source_kind?: string | null
  feed_snapshot?: unknown
  created_at?: string | null
}

export interface LeadGraphResult {
  accountId: string
  personId: string | null
  signalId: string | null
}

export async function upsertLeadIntoGtmGraph(
  supabase: SupabaseClient,
  lead: LeadGraphInput,
  context: {
    agentRunId?: string | null
    workflowRunId?: string | null
  } = {},
): Promise<LeadGraphResult | null> {
  const companyName = normalizeEntityName(lead.target_company)
  if (!companyName) return null

  const snapshot = normalizeLeadFeedSnapshot(lead.feed_snapshot)
  const domain = normalizeDomain(lead.company_domain ?? snapshot?.company_domain ?? null)
  const key = accountKey({ name: companyName, domain })
  const signalIntelligence = snapshot
    ? buildSignalIntelligence({
        leadId: lead.id,
        accountKey: key,
        targetCompany: companyName,
        companyDomain: domain,
        relevanceScore: lead.relevance_score ?? null,
        relevanceReason: lead.relevance_reason ?? null,
        contactEmail: lead.contact_email ?? null,
        contactVerified: lead.contact_verified ?? null,
        createdAt: lead.created_at ?? null,
        snapshot,
      })
    : null
  const accountId = await upsertAccount(supabase, {
    userId: lead.user_id,
    clientId: lead.client_id ?? null,
    accountKey: key,
    name: companyName,
    domain,
    sourceKind: lead.source_kind ?? lead.origin ?? 'lead',
    attributes: {
      lead_id: lead.id,
      relevance_score: lead.relevance_score ?? null,
      relevance_reason: lead.relevance_reason ?? null,
      origin: lead.origin ?? null,
      signal_intelligence: signalIntelligence,
      agent_checkpoints: {
        last_signal_at: signalIntelligence?.event.published_at ?? lead.created_at ?? null,
        last_signal_type: signalIntelligence?.event.event_type ?? null,
        last_signal_cluster_key: signalIntelligence?.cluster_key ?? null,
        last_memory_update_at: new Date().toISOString(),
      },
    },
  })
  if (!accountId) return null

  let signalId: string | null = null
  if (snapshot) {
    signalId = await upsertSignal(supabase, {
      userId: lead.user_id,
      clientId: lead.client_id ?? null,
      accountId,
      leadId: lead.id,
      signalKey: signalIntelligence?.cluster_key ?? signalKey({
        leadId: lead.id,
        sourceUrl: snapshot.source_url,
        headline: snapshot.headline,
        accountKey: key,
      }),
      signalType: snapshot.signal_type,
      headline: snapshot.headline,
      summary: snapshot.summary,
      sourceUrl: snapshot.source_url,
      sourceName: snapshot.source_name,
      publishedAt: snapshot.published_at,
      confidence: signalIntelligence ? signalIntelligence.scores.quality / 100 : undefined,
      attributes: {
        ...snapshot,
        structured_event: signalIntelligence?.event ?? null,
        cluster_key: signalIntelligence?.cluster_key ?? null,
        duplicate_key: signalIntelligence?.duplicate_key ?? null,
        scores: signalIntelligence?.scores ?? null,
        weighted_score: signalIntelligence?.weighted_score ?? null,
        reasoning: signalIntelligence?.reasoning ?? [],
      },
    })
    if (signalId) {
      if (signalIntelligence) {
        await Promise.all([
          upsertSignalCluster(supabase, {
            userId: lead.user_id,
            clientId: lead.client_id ?? null,
            accountId,
            signalId,
            intelligence: signalIntelligence,
            observedAt: snapshot.published_at ?? lead.created_at ?? null,
          }),
          recordSourceReliabilityOutcome(supabase, {
            userId: lead.user_id,
            clientId: lead.client_id ?? null,
            sourceName: signalIntelligence.event.source_name,
            signalType: signalIntelligence.event.event_type,
            outcome: 'signal',
            observedAt: snapshot.published_at ?? lead.created_at ?? null,
            metadata: { cluster_key: signalIntelligence.cluster_key },
          }),
        ])
      }
      await upsertRelationship(supabase, {
        userId: lead.user_id,
        clientId: lead.client_id ?? null,
        fromEntityType: 'signal',
        fromEntityId: signalId,
        relationshipType: 'mentions_account',
        toEntityType: 'account',
        toEntityId: accountId,
        source: 'lead_graph_adapter',
        metadata: { lead_id: lead.id },
      })
      await recordGtmMemory(supabase, {
        userId: lead.user_id,
        clientId: lead.client_id ?? null,
        scope: 'entity',
        entityType: 'account',
        entityId: accountId,
        memoryType: 'buying_signal',
        content: `${snapshot.headline}${snapshot.summary ? `: ${snapshot.summary}` : ''}`,
        source: snapshot.source_name ?? 'lead_feed',
        confidence: signalIntelligence ? signalIntelligence.scores.quality / 100 : 0.9,
        observedAt: snapshot.published_at ?? lead.created_at ?? null,
        provenance: {
          lead_id: lead.id,
          signal_id: signalId,
          source_url: snapshot.source_url ?? null,
          signal_intelligence: signalIntelligence,
        },
        agentRunId: context.agentRunId ?? null,
        workflowRunId: context.workflowRunId ?? null,
      })
    }
  }

  let personId: string | null = null
  if (lead.contact_email || lead.contact_name) {
    personId = await upsertPerson(supabase, {
      userId: lead.user_id,
      clientId: lead.client_id ?? null,
      accountId,
      email: lead.contact_email ?? null,
      name: lead.contact_name ?? null,
      title: lead.contact_title ?? null,
      verified: lead.contact_verified === true,
      sourceKind: 'lead_contact',
      attributes: { lead_id: lead.id },
    })
    if (personId) {
      await upsertRelationship(supabase, {
        userId: lead.user_id,
        clientId: lead.client_id ?? null,
        fromEntityType: 'person',
        fromEntityId: personId,
        relationshipType: 'works_at',
        toEntityType: 'account',
        toEntityId: accountId,
        source: 'lead_graph_adapter',
        confidence: lead.contact_verified ? 0.95 : 0.6,
        metadata: { lead_id: lead.id },
      })
    }
  }

  return { accountId, personId, signalId }
}

async function upsertAccount(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    accountKey: string
    name: string
    domain: string | null
    sourceKind: string
  attributes: Record<string, unknown>
  },
): Promise<string | null> {
  const existing = await findScopedRow(supabase, 'gtm_accounts', input.userId, input.clientId, input.accountKey, 'account_key')
  const now = new Date().toISOString()
  const attributes = mergeAccountAttributes(existing?.attributes, input.attributes)

  if (existing?.id) {
    const { error } = await supabase
      .from('gtm_accounts')
      .update({
        name: input.name,
        domain: input.domain,
        source_kind: input.sourceKind,
        attributes,
        last_seen_at: now,
      })
      .eq('id', existing.id)
    if (error) console.error('[gtm-graph] account update failed:', error.message)
    await upsertGtmEntityEmbedding(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      accountId: existing.id as string,
      entityType: 'account',
      entityId: existing.id as string,
      content: buildAccountEmbeddingContent(input.name, input.domain, input.sourceKind, attributes),
      source: 'gtm_accounts',
      metadata: { account_key: input.accountKey, source_kind: input.sourceKind },
    })
    return existing.id as string
  }

  const { data, error } = await supabase
    .from('gtm_accounts')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      account_key: input.accountKey,
      name: input.name,
      domain: input.domain,
      source_kind: input.sourceKind,
      attributes,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[gtm-graph] account insert failed:', error.message)
    return null
  }
  const accountId = data?.id ?? null
  if (accountId) {
    await upsertGtmEntityEmbedding(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      accountId,
      entityType: 'account',
      entityId: accountId,
      content: buildAccountEmbeddingContent(input.name, input.domain, input.sourceKind, attributes),
      source: 'gtm_accounts',
      metadata: { account_key: input.accountKey, source_kind: input.sourceKind },
    })
  }
  return accountId
}

async function upsertPerson(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    accountId: string
    email: string | null
    name: string | null
    title: string | null
    verified: boolean
    sourceKind: string
    attributes: Record<string, unknown>
  },
): Promise<string | null> {
  const key = personKey({ email: input.email, name: input.name, accountId: input.accountId })
  const existing = await findScopedRow(supabase, 'gtm_people', input.userId, input.clientId, key, 'person_key')
  const now = new Date().toISOString()
  if (existing?.id) {
    const { error } = await supabase
      .from('gtm_people')
      .update({
        account_id: input.accountId,
        email: input.email,
        name: normalizeEntityName(input.name),
        title: normalizeEntityName(input.title),
        verified: input.verified,
        source_kind: input.sourceKind,
        attributes: input.attributes,
        last_seen_at: now,
      })
      .eq('id', existing.id)
    if (error) console.error('[gtm-graph] person update failed:', error.message)
    return existing.id as string
  }

  const { data, error } = await supabase
    .from('gtm_people')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      account_id: input.accountId,
      person_key: key,
      email: input.email,
      name: normalizeEntityName(input.name) || null,
      title: normalizeEntityName(input.title) || null,
      verified: input.verified,
      source_kind: input.sourceKind,
      attributes: input.attributes,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[gtm-graph] person insert failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function upsertSignal(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    accountId: string
    leadId: string
    signalKey: string
    signalType: string
    headline: string
    summary: string | null
    sourceUrl?: string | null
    sourceName?: string | null
    publishedAt?: string | null
    confidence?: number
    attributes: Record<string, unknown>
  },
): Promise<string | null> {
  const existing = await findScopedRow(supabase, 'gtm_signals', input.userId, input.clientId, input.signalKey, 'signal_key')
  const row = {
    account_id: input.accountId,
    lead_id: input.leadId,
    signal_type: input.signalType,
    headline: input.headline,
    summary: input.summary,
    source_url: input.sourceUrl ?? null,
    source_name: input.sourceName ?? null,
    published_at: input.publishedAt ?? null,
    confidence: input.confidence ?? null,
    attributes: input.attributes,
    observed_at: input.publishedAt ?? new Date().toISOString(),
  }

  if (existing?.id) {
    const { error } = await supabase.from('gtm_signals').update(row).eq('id', existing.id)
    if (error) console.error('[gtm-graph] signal update failed:', error.message)
    await upsertGtmEntityEmbedding(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      accountId: input.accountId,
      entityType: 'signal',
      entityId: existing.id as string,
      content: buildSignalEmbeddingContent(input),
      source: 'gtm_signals',
      metadata: { lead_id: input.leadId, signal_type: input.signalType, source_url: input.sourceUrl ?? null },
    })
    return existing.id as string
  }

  const { data, error } = await supabase
    .from('gtm_signals')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      signal_key: input.signalKey,
      ...row,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[gtm-graph] signal insert failed:', error.message)
    return null
  }
  const signalId = data?.id ?? null
  if (signalId) {
    await upsertGtmEntityEmbedding(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      accountId: input.accountId,
      entityType: 'signal',
      entityId: signalId,
      content: buildSignalEmbeddingContent(input),
      source: 'gtm_signals',
      metadata: { lead_id: input.leadId, signal_type: input.signalType, source_url: input.sourceUrl ?? null },
    })
  }
  return signalId
}

export async function recordGtmTouchpoint(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    accountId?: string | null
    personId?: string | null
    leadId?: string | null
    workflowRunId?: string | null
    type: 'email' | 'followup' | 'reply' | 'crm_update' | 'approval'
    status: 'planned' | 'sent' | 'received' | 'blocked' | 'failed' | 'queued'
    subject?: string | null
    bodyPreview?: string | null
    fromEmail?: string | null
    toEmail?: string | null
    provider?: string | null
    messageId?: string | null
    occurredAt?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('gtm_touchpoints').insert({
    user_id: input.userId,
    client_id: input.clientId ?? null,
    account_id: input.accountId ?? null,
    person_id: input.personId ?? null,
    lead_id: input.leadId ?? null,
    workflow_run_id: input.workflowRunId ?? null,
    type: input.type,
    status: input.status,
    subject: input.subject ?? null,
    body_preview: input.bodyPreview ?? null,
    from_email: input.fromEmail ?? null,
    to_email: input.toEmail ?? null,
    provider: input.provider ?? null,
    message_id: input.messageId ?? null,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  })
  if (error) console.error('[gtm-graph] touchpoint insert failed:', error.message)

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType: input.leadId ? 'lead' : input.accountId ? 'account' : null,
    entityId: input.leadId ?? input.accountId ?? null,
    eventType: `touchpoint.${input.type}.${input.status}`,
    eventTime: input.occurredAt ?? new Date().toISOString(),
    source: 'gtm_touchpoints',
    payload: {
      account_id: input.accountId ?? null,
      person_id: input.personId ?? null,
      lead_id: input.leadId ?? null,
      workflow_run_id: input.workflowRunId ?? null,
      type: input.type,
      status: input.status,
      subject: input.subject ?? null,
      from_email: input.fromEmail ?? null,
      to_email: input.toEmail ?? null,
      provider: input.provider ?? null,
      message_id: input.messageId ?? null,
      metadata: input.metadata ?? {},
    },
    idempotencyKey: eventIdempotencyKey(['touchpoint', input.messageId, input.leadId, input.type, input.status, input.occurredAt]),
  })
}

async function upsertRelationship(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    fromEntityType: string
    fromEntityId: string
    relationshipType: string
    toEntityType: string
    toEntityId: string
    source: string
    confidence?: number
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('gtm_relationships').upsert({
    user_id: input.userId,
    client_id: input.clientId,
    from_entity_type: input.fromEntityType,
    from_entity_id: input.fromEntityId,
    relationship_type: input.relationshipType,
    to_entity_type: input.toEntityType,
    to_entity_id: input.toEntityId,
    source: input.source,
    confidence: input.confidence ?? 1,
    metadata: input.metadata ?? {},
    observed_at: new Date().toISOString(),
  }, {
    onConflict: 'user_id,from_entity_type,from_entity_id,relationship_type,to_entity_type,to_entity_id',
  })
  if (error) console.error('[gtm-graph] relationship upsert failed:', error.message)
}

async function findScopedRow(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  clientId: string | null,
  key: string,
  keyColumn: string,
): Promise<{ id?: string; attributes?: unknown } | null> {
  let query = supabase
    .from(table)
    .select('id, attributes')
    .eq('user_id', userId)
    .eq(keyColumn, key)
    .limit(1)

  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error(`[gtm-graph] ${table} lookup failed:`, error.message)
    return null
  }
  return data as { id?: string; attributes?: unknown } | null
}

function mergeAccountAttributes(existing: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const base = isRecord(existing) ? existing : {}
  const incomingCheckpoints = isRecord(incoming.agent_checkpoints) ? incoming.agent_checkpoints : {}
  const existingCheckpoints = isRecord(base.agent_checkpoints) ? base.agent_checkpoints : {}
  return {
    ...base,
    ...incoming,
    agent_checkpoints: {
      ...existingCheckpoints,
      ...incomingCheckpoints,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildAccountEmbeddingContent(
  name: string,
  domain: string | null,
  sourceKind: string,
  attributes: Record<string, unknown>,
): string {
  return [
    `Account: ${name}`,
    domain ? `Domain: ${domain}` : '',
    `Source: ${sourceKind}`,
    typeof attributes.relevance_reason === 'string' ? `Reason: ${attributes.relevance_reason}` : '',
    isRecord(attributes.signal_intelligence) ? `Signal intelligence: ${JSON.stringify(attributes.signal_intelligence).slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n')
}

function buildSignalEmbeddingContent(input: {
  signalType: string
  headline: string
  summary: string | null
  sourceName?: string | null
  publishedAt?: string | null
}): string {
  return [
    `Signal type: ${input.signalType}`,
    `Headline: ${input.headline}`,
    input.summary ? `Summary: ${input.summary}` : '',
    input.sourceName ? `Source: ${input.sourceName}` : '',
    input.publishedAt ? `Published: ${input.publishedAt}` : '',
  ].filter(Boolean).join('\n')
}
