import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  buildCrmImportLeadReason,
  buildCrmImportSignal,
  mapCrmImportRecord,
  normalizeCrmProvider,
} from '@/lib/crm-sync'

const MAX_IMPORT_RECORDS = 250

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('key')?.trim()
  if (!secret) return NextResponse.json({ error: 'Import key required' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: settings, error: settingsError } = await supabase
    .from('crm_sync_settings')
    .select('user_id, client_id, provider, import_enabled, import_secret')
    .eq('import_secret', secret)
    .eq('import_enabled', true)
    .maybeSingle()

  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 })
  if (!settings) return NextResponse.json({ error: 'CRM import is not enabled for this workspace.' }, { status: 403 })

  const payload = await request.json().catch(() => null)
  const records = normalizePayloadRecords(payload)
  if (records.length === 0) return NextResponse.json({ error: 'No CRM records found.' }, { status: 400 })

  const provider = normalizeCrmProvider((settings as { provider?: string | null }).provider)
  const mapped = records
    .slice(0, MAX_IMPORT_RECORDS)
    .map(record => mapCrmImportRecord(provider, record))
    .filter(record => record !== null)

  const now = new Date().toISOString()
  const batchId = crypto.randomUUID()
  const userId = (settings as { user_id: string }).user_id
  const clientId = (settings as { client_id?: string | null }).client_id ?? null

  const { error: batchError } = await supabase.from('crm_import_batches').insert({
    id: batchId,
    user_id: userId,
    client_id: clientId,
    provider,
    import_secret: secret,
    record_count: records.length,
    imported_count: mapped.length,
    skipped_count: records.length - mapped.length,
  })
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 })

  let imported = 0
  let skipped = records.length - mapped.length

  for (const record of mapped) {
    const recordKey = `${userId}:${clientId ?? 'personal'}:${record.externalId}`
    const { data: existingRecord } = await supabase
      .from('crm_import_records')
      .select('id')
      .eq('record_key', recordKey)
      .maybeSingle()

    if (existingRecord?.id) {
      skipped += 1
      continue
    }

    const { data: insertedRecord, error: recordError } = await supabase
      .from('crm_import_records')
      .insert({
        batch_id: batchId,
        user_id: userId,
        client_id: clientId,
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
      })
      .select('id')
      .single()

    if (recordError || !insertedRecord) {
      skipped += 1
      continue
    }

    const signal = buildCrmImportSignal({ provider, record })
    const leadReason = buildCrmImportLeadReason({ provider, record })
    const { error: leadError } = await supabase.from('leads').insert({
      user_id: userId,
      client_id: clientId,
      signal_id: null,
      origin: 'crm_import',
      source_kind: 'crm_record',
      source_record_id: insertedRecord.id,
      feed_session_id: batchId,
      feed_session_label: `CRM import · ${provider}`,
      feed_session_started_at: now,
      target_company: record.companyName,
      company_domain: record.companyDomain,
      relevance_score: leadReason.score,
      relevance_reason: leadReason.reason,
      status: 'new',
      is_unlocked: Boolean(record.contactEmail),
      contact_email: record.contactEmail,
      contact_name: record.contactName,
      contact_title: record.contactTitle,
      contact_verified: record.contactEmail ? true : null,
      feed_snapshot: {
        signal_type: signal.signalType,
        headline: signal.headline,
        summary: signal.summary,
        source_url: signal.sourceUrl,
        source_name: provider,
        company_domain: record.companyDomain,
        published_at: now,
      },
    })

    if (leadError) skipped += 1
    else imported += 1
  }

  await supabase
    .from('crm_import_batches')
    .update({ imported_count: imported, skipped_count: skipped })
    .eq('id', batchId)

  return NextResponse.json({ ok: true, imported, skipped, batch_id: batchId })
}

function normalizePayloadRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const object = payload as Record<string, unknown>
  if (Array.isArray(object.records)) return object.records
  if (Array.isArray(object.data)) return object.data
  if (Array.isArray(object.items)) return object.items
  return [object]
}
