import { NextResponse } from 'next/server'
import { buildFeedSessionLabel } from '@/lib/feed-sessions'
import { createAdminClient } from '@/lib/supabase/server'
import { buildCrmLeadFeedSnapshot } from '@/lib/lead-sources'
import {
  buildCrmImportLeadReason,
  buildCrmImportSignal,
  mapCrmImportRecord,
  normalizeCrmProvider,
} from '@/lib/crm-sync'
import { checkRateLimit } from '@/lib/rate-limit'

const MAX_CRM_IMPORT_RECORDS = 50
const MAX_CRM_IMPORT_BODY_BYTES = 1_000_000

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_CRM_IMPORT_BODY_BYTES) {
    return NextResponse.json({ error: 'CRM import payload is too large.' }, { status: 413 })
  }

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  if (!key) {
    return NextResponse.json({ error: 'Missing import key' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: setting, error: settingError } = await supabase
    .from('crm_sync_settings')
    .select('user_id, client_id, provider, import_enabled')
    .eq('import_secret', key)
    .maybeSingle()

  if (settingError || !setting || !setting.import_enabled) {
    return NextResponse.json({ error: 'CRM import is not enabled for this key' }, { status: 401 })
  }

  const rl = await checkRateLimit(`crm-import:${key}`, 60, 3600, { failClosed: true, supabase })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many CRM import requests for this workspace. Limit is 60 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null)
  const records = normalizeRecords(body).slice(0, MAX_CRM_IMPORT_RECORDS)
  if (records.length === 0) {
    return NextResponse.json({ error: 'No CRM records found in payload' }, { status: 400 })
  }

  const provider = normalizeCrmProvider(setting.provider)
  const now = new Date().toISOString()
  const { data: batch } = await supabase
    .from('crm_import_batches')
    .insert({
      user_id: setting.user_id,
      client_id: setting.client_id,
      provider,
      import_secret: key,
      record_count: records.length,
    })
    .select('id')
    .single()

  const batchId = batch?.id ?? null
  const sessionLabel = buildFeedSessionLabel({
    origin: 'crm_import',
    startedAt: now,
    provider,
    recordCount: records.length,
  })
  let imported = 0
  let skipped = 0
  let duplicates = 0
  let sourceErrors = 0
  let leadErrors = 0

  for (const rawRecord of records) {
    const record = mapCrmImportRecord(provider, rawRecord)
    if (!record) {
      skipped++
      continue
    }

    const recordKey = buildCrmRecordKey({
      userId: setting.user_id,
      clientId: setting.client_id,
      provider,
      externalId: record.externalId,
      companyName: record.companyName,
      contactEmail: record.contactEmail,
    })

    const { data: savedRecord, error: recordError } = await saveCrmImportRecord(supabase, {
      batch_id: batchId,
      user_id: setting.user_id,
      client_id: setting.client_id,
      provider,
      record_key: recordKey,
      external_id: record.externalId,
      company_name: record.companyName,
      company_domain: record.companyDomain,
      contact_email: record.contactEmail,
      contact_name: record.contactName,
      contact_title: record.contactTitle,
      crm_status: record.crmStatus,
      owner_name: record.ownerName,
      lead_source: record.leadSource,
      notes: record.notes,
      raw_payload: record.raw,
      updated_at: now,
    })

    if (recordError || !savedRecord) {
      sourceErrors++
      if (recordError) console.error('[crm-import] source record save error:', recordError.message)
      skipped++
      continue
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', setting.user_id)
      .eq('source_kind', 'crm_record')
      .eq('source_record_id', savedRecord.id)
      .maybeSingle()

    if (existingLead) {
      duplicates++
      skipped++
      continue
    }

    const signal = buildCrmImportSignal({ provider, record })
    const leadMatch = buildCrmImportLeadReason({ provider, record })
    const snapshot = buildCrmLeadFeedSnapshot({
      headline: signal.headline,
      summary: signal.summary,
      companyDomain: record.companyDomain,
      provider,
      crmStatus: record.crmStatus,
      ownerName: record.ownerName,
      leadSource: record.leadSource,
      publishedAt: now,
    })

    const { error: leadError } = await supabase
      .from('leads')
      .insert({
        user_id: setting.user_id,
        client_id: setting.client_id,
        signal_id: null,
        origin: 'crm_import',
        feed_session_id: batchId,
        feed_session_label: sessionLabel,
        feed_session_started_at: now,
        source_kind: 'crm_record',
        source_record_id: savedRecord.id,
        target_company: record.companyName,
        company_domain: record.companyDomain,
        relevance_score: leadMatch.score,
        relevance_reason: leadMatch.reason,
        status: 'new',
        is_unlocked: true,
        unlocked_at: now,
        contact_email: record.contactEmail,
        contact_name: record.contactName,
        contact_title: record.contactTitle,
        feed_snapshot: snapshot,
        match_debug: {
          matched_via: 'crm_import',
          provider,
          external_id: record.externalId,
          crm_status: record.crmStatus,
          owner_name: record.ownerName,
          lead_source: record.leadSource,
          import_key: key,
          batch_id: batchId,
          source_kind: 'crm_record',
          raw: record.raw,
        },
      })

    if (leadError) {
      leadErrors++
      console.error('[crm-import] lead insert error:', leadError.message)
      skipped++
      continue
    }

    imported++
  }

  if (batchId) {
    await supabase
      .from('crm_import_batches')
      .update({
        imported_count: imported,
        skipped_count: skipped,
      })
      .eq('id', batchId)
  }

  return NextResponse.json({
    ok: true,
    provider,
    imported,
    skipped,
    duplicates,
    source_errors: sourceErrors,
    lead_errors: leadErrors,
  })
}

function normalizeRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (typeof body !== 'object' || body === null) return []

  const payload = body as Record<string, unknown>
  if (Array.isArray(payload.records)) return payload.records
  if (Array.isArray(payload.items)) return payload.items
  if (payload.record) return [payload.record]
  return [payload]
}

function buildCrmRecordKey(params: {
  userId: string
  clientId: string | null
  provider: string
  externalId?: string | null
  companyName: string
  contactEmail?: string | null
}) {
  return [
    'crm-import',
    params.userId,
    params.clientId ?? 'workspace-none',
    params.provider,
    params.externalId || params.contactEmail || params.companyName,
  ]
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9:._@-]+/g, '-')
}

async function saveCrmImportRecord(
  supabase: ReturnType<typeof createAdminClient>,
  payload: {
    batch_id: string | null
    user_id: string
    client_id: string | null
    provider: string
    record_key: string
    external_id?: string | null
    company_name: string
    company_domain?: string | null
    contact_email?: string | null
    contact_name?: string | null
    contact_title?: string | null
    crm_status?: string | null
    owner_name?: string | null
    lead_source?: string | null
    notes?: string | null
    raw_payload: unknown
    updated_at: string
  },
) {
  const { data: existing, error: existingError } = await supabase
    .from('crm_import_records')
    .select('id')
    .eq('record_key', payload.record_key)
    .maybeSingle()

  if (existingError) return { data: null, error: existingError }

  if (existing) {
    const { data, error } = await supabase
      .from('crm_import_records')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single()
    return { data, error }
  }

  const inserted = await supabase
    .from('crm_import_records')
    .insert(payload)
    .select('id')
    .single()

  if (!inserted.error) return inserted

  if (inserted.error.code === '23505') {
    return await supabase
      .from('crm_import_records')
      .select('id')
      .eq('record_key', payload.record_key)
      .single()
  }

  return inserted
}
