import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  buildCrmImportLeadReason,
  buildCrmImportSignal,
  mapCrmImportRecord,
  normalizeCrmProvider,
} from '@/lib/crm-sync'

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null)
  const records = normalizeRecords(body).slice(0, 50)
  if (records.length === 0) {
    return NextResponse.json({ error: 'No CRM records found in payload' }, { status: 400 })
  }

  const provider = normalizeCrmProvider(setting.provider)
  const now = new Date().toISOString()
  let imported = 0
  let skipped = 0

  for (const rawRecord of records) {
    const record = mapCrmImportRecord(provider, rawRecord)
    if (!record) {
      skipped++
      continue
    }

    const signal = buildCrmImportSignal({ provider, record })
    const { data: savedSignal, error: signalError } = await supabase
      .from('signals')
      .upsert({
        company_name: record.companyName,
        company_domain: record.companyDomain,
        signal_type: signal.signalType,
        headline: signal.headline,
        summary: signal.summary,
        source_url: signal.sourceUrl,
        source_name: 'crm_import',
        published_at: now,
      }, { onConflict: 'source_url' })
      .select('id')
      .single()

    if (signalError || !savedSignal) {
      skipped++
      continue
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', setting.user_id)
      .eq('signal_id', savedSignal.id)
      .eq('origin', 'crm_import')
      .maybeSingle()

    if (existingLead) {
      skipped++
      continue
    }

    const leadMatch = buildCrmImportLeadReason({ provider, record })
    const { error: leadError } = await supabase
      .from('leads')
      .insert({
        user_id: setting.user_id,
        client_id: setting.client_id,
        signal_id: savedSignal.id,
        origin: 'crm_import',
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
        match_debug: {
          matched_via: 'crm_import',
          provider,
          external_id: record.externalId,
          crm_status: record.crmStatus,
          owner_name: record.ownerName,
          lead_source: record.leadSource,
          import_key: key,
          raw: record.raw,
        },
      })

    if (leadError) {
      skipped++
      continue
    }

    imported++
  }

  return NextResponse.json({
    ok: true,
    provider,
    imported,
    skipped,
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
