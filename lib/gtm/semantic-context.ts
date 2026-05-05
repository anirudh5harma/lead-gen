import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '../lead-sources.ts'
import { embed, toVectorLiteral } from '../embeddings.ts'
import { accountKey, bodyPreview, normalizeDomain, normalizeEntityName } from './identity.ts'
import { getGtmAccountState } from './account-state.ts'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const MAX_CONTEXT_ITEMS = 12

export interface UpsertGtmEntityEmbeddingInput {
  userId: string
  clientId?: string | null
  accountId?: string | null
  entityType: string
  entityId: string
  content: string
  source: string
  metadata?: Record<string, unknown>
}

export interface GtmSemanticMatch {
  id: string
  entity_type: string
  entity_id: string
  account_id: string | null
  source: string
  content_hash: string
  content_preview: string | null
  metadata: Record<string, unknown>
  similarity: number
  created_at: string
}

export interface GtmContextPack {
  query: string
  account_id: string | null
  lead_id: string | null
  account_state: unknown | null
  semantic_matches: GtmSemanticMatch[]
  drafting_context: string
}

export function stableContentHash(content: string): string {
  return createHash('sha256').update(normalizeEmbeddingContent(content)).digest('hex')
}

export function normalizeEmbeddingContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 6000)
}

export function shouldWriteGtmEmbeddings(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.GTM_EMBEDDINGS_ENABLED !== 'false'
}

export async function upsertGtmEntityEmbedding(
  supabase: SupabaseClient,
  input: UpsertGtmEntityEmbeddingInput,
): Promise<string | null> {
  if (!shouldWriteGtmEmbeddings()) return null

  const entityType = input.entityType.trim().slice(0, 80)
  const source = input.source.trim().slice(0, 120)
  const content = normalizeEmbeddingContent(input.content)
  if (!entityType || !source || !input.entityId || content.length < 12) return null

  const contentHash = stableContentHash(content)
  const { createServiceClient } = await import('../supabase/server.ts')
  const writeClient = await createServiceClient()
  const existing = await findExistingEmbedding(writeClient, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType,
    entityId: input.entityId,
    contentHash,
  })
  if (existing?.id) return existing.id

  try {
    const embedding = await embed(content)
    const { data, error } = await writeClient
      .from('gtm_entity_embeddings')
      .upsert({
        user_id: input.userId,
        client_id: input.clientId ?? null,
        account_id: input.accountId ?? null,
        entity_type: entityType,
        entity_id: input.entityId,
        content_hash: contentHash,
        embedding: toVectorLiteral(embedding),
        model: EMBEDDING_MODEL,
        source,
        content_preview: bodyPreview(content, 900),
        metadata: input.metadata ?? {},
      }, {
        onConflict: 'entity_type,entity_id,content_hash',
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[gtm-semantic-context] embedding upsert failed:', error.message)
      return null
    }
    return (data as { id?: string } | null)?.id ?? null
  } catch (error) {
    console.error('[gtm-semantic-context] embedding write failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function searchGtmSemanticContext(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    query: string
    accountId?: string | null
    entityTypes?: string[]
    limit?: number
  },
): Promise<GtmSemanticMatch[]> {
  if (!shouldWriteGtmEmbeddings()) return []
  const query = normalizeEmbeddingContent(input.query)
  if (query.length < 8) return []

  try {
    const queryEmbedding = await embed(query)
    const { data, error } = await supabase.rpc('match_gtm_entity_embeddings', {
      p_user_id: input.userId,
      p_client_id: input.clientId ?? null,
      p_query_embedding: toVectorLiteral(queryEmbedding),
      p_match_count: Math.max(1, Math.min(50, input.limit ?? MAX_CONTEXT_ITEMS)),
      p_entity_types: input.entityTypes?.length ? input.entityTypes : null,
      p_account_id: input.accountId ?? null,
    })
    if (error) {
      console.error('[gtm-semantic-context] semantic search failed:', error.message)
      return []
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      entity_type: String(row.entity_type ?? ''),
      entity_id: String(row.entity_id ?? ''),
      account_id: typeof row.account_id === 'string' ? row.account_id : null,
      source: String(row.source ?? ''),
      content_hash: String(row.content_hash ?? ''),
      content_preview: typeof row.content_preview === 'string' ? row.content_preview : null,
      metadata: isRecord(row.metadata) ? row.metadata : {},
      similarity: Number(row.similarity ?? 0),
      created_at: String(row.created_at ?? ''),
    })).filter(row => row.id && row.entity_id)
  } catch (error) {
    console.error('[gtm-semantic-context] semantic search error:', error instanceof Error ? error.message : error)
    return []
  }
}

export async function buildGtmContextPack(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    accountId?: string | null
    leadId?: string | null
    query?: string | null
    limit?: number
  },
): Promise<GtmContextPack> {
  const clientId = input.clientId ?? null
  const lead = input.leadId
    ? await loadLeadForContext(supabase, input.userId, clientId, input.leadId)
    : null
  const accountId = input.accountId ?? (lead ? await findAccountIdForLead(supabase, input.userId, clientId, lead) : null)
  const accountState = accountId
    ? await getGtmAccountState(supabase, { userId: input.userId, clientId, accountId })
    : null
  const query = buildContextQuery(input.query, lead, accountState)
  const semanticMatches = await searchGtmSemanticContext(supabase, {
    userId: input.userId,
    clientId,
    accountId,
    query,
    limit: input.limit ?? MAX_CONTEXT_ITEMS,
  })

  return {
    query,
    account_id: accountId,
    lead_id: input.leadId ?? null,
    account_state: accountState,
    semantic_matches: semanticMatches,
    drafting_context: formatDraftingContext(accountState, semanticMatches),
  }
}

export function buildContextQuery(
  explicitQuery: string | null | undefined,
  lead: Record<string, unknown> | null,
  accountState: unknown,
): string {
  if (explicitQuery?.trim()) return normalizeEmbeddingContent(explicitQuery)
  const snapshot = normalizeLeadFeedSnapshot(lead?.feed_snapshot ?? null)
  const account = isRecord(accountState) && isRecord(accountState.account) ? accountState.account : null
  return normalizeEmbeddingContent([
    account?.name,
    account?.domain,
    lead?.target_company,
    lead?.company_domain,
    snapshot?.signal_type,
    snapshot?.headline,
    snapshot?.summary,
    lead?.relevance_reason,
  ].filter(value => typeof value === 'string' && value.trim()).join('\n'))
}

function formatDraftingContext(accountState: unknown, matches: GtmSemanticMatch[]): string {
  const state = isRecord(accountState) ? accountState : {}
  const account = isRecord(state.account) ? state.account : {}
  const signals = Array.isArray(state.signals) ? state.signals.slice(0, 3) : []
  const memories = Array.isArray(state.memories) ? state.memories.slice(0, 3) : []
  const touchpoints = Array.isArray(state.touchpoints) ? state.touchpoints.slice(0, 2) : []

  const lines = [
    typeof account.name === 'string' ? `Account: ${account.name}${typeof account.domain === 'string' ? ` (${account.domain})` : ''}` : '',
    ...signals.map(item => isRecord(item) ? `Recent signal: ${item.headline ?? item.signal_type ?? ''}${item.summary ? ` - ${item.summary}` : ''}` : ''),
    ...memories.map(item => isRecord(item) ? `Memory: ${item.memory_type ?? 'note'} - ${item.content ?? ''}` : ''),
    ...touchpoints.map(item => isRecord(item) ? `Touchpoint: ${item.type ?? 'touchpoint'} ${item.status ?? ''}${item.subject ? ` - ${item.subject}` : ''}` : ''),
    ...matches.slice(0, 5).map(match => `Semantic match (${match.entity_type}, ${(match.similarity * 100).toFixed(0)}%): ${match.content_preview ?? ''}`),
  ].filter(line => line.trim())

  return bodyPreview(lines.join('\n'), 1800)
}

async function loadLeadForContext(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  leadId: string,
): Promise<Record<string, unknown> | null> {
  let query = supabase
    .from('leads')
    .select('id, target_company, company_domain, relevance_reason, feed_snapshot')
    .eq('id', leadId)
    .eq('user_id', userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[gtm-semantic-context] lead context lookup failed:', error.message)
    return null
  }
  return data as Record<string, unknown> | null
}

async function findAccountIdForLead(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  lead: Record<string, unknown>,
): Promise<string | null> {
  const companyName = normalizeEntityName(typeof lead.target_company === 'string' ? lead.target_company : null)
  if (!companyName) return null
  const domain = normalizeDomain(typeof lead.company_domain === 'string' ? lead.company_domain : null)
  const key = accountKey({ name: companyName, domain })
  let query = supabase
    .from('gtm_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('account_key', key)
    .limit(1)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[gtm-semantic-context] account lookup failed:', error.message)
    return null
  }
  return (data as { id?: string } | null)?.id ?? null
}

async function findExistingEmbedding(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    entityType: string
    entityId: string
    contentHash: string
  },
): Promise<{ id?: string } | null> {
  let query = supabase
    .from('gtm_entity_embeddings')
    .select('id')
    .eq('user_id', input.userId)
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .eq('content_hash', input.contentHash)
    .limit(1)
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[gtm-semantic-context] embedding lookup failed:', error.message)
    return null
  }
  return data as { id?: string } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
