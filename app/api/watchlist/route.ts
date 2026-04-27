import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { syncMonitoredAccountsFromWorkspaceSources, upsertMonitoredAccountSeeds } from '@/lib/monitored-accounts'

interface WatchlistInput {
  company_name?: string
  company_domain?: string | null
  notes?: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let query = supabase
    .from('watchlist_companies')
    .select('id, company_name, company_domain, notes, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ companies: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = await createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const body = await request.json().catch(() => null) as (WatchlistInput & { companies?: WatchlistInput[] }) | null
  const batch = Array.isArray(body?.companies) ? normalizeWatchlistInputs(body.companies) : []

  if (batch.length > 0) {
    let existingQuery = supabase
      .from('watchlist_companies')
      .select('company_name, company_domain')
      .eq('user_id', user.id)

    existingQuery = activeClientId ? existingQuery.eq('client_id', activeClientId) : existingQuery.is('client_id', null)
    const { data: existing, error: existingError } = await existingQuery

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

    const existingKeys = new Set((existing ?? []).map(row => watchlistKey(row.company_name, row.company_domain)))
    const rows = batch.filter(item => !existingKeys.has(watchlistKey(item.company_name, item.company_domain)))

    if (rows.length === 0) {
      return NextResponse.json({ companies: [], inserted: 0, skipped: batch.length })
    }

    const { data, error } = await supabase
      .from('watchlist_companies')
      .insert(rows.map(item => ({
        user_id: user.id,
        client_id: activeClientId,
        company_name: item.company_name,
        company_domain: item.company_domain || null,
        notes: item.notes || null,
      })))
      .select('id, company_name, company_domain, notes, created_at')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (activeClientId && data?.length) {
      upsertMonitoredAccountSeeds(service, data.map(company => ({
        userId: user.id,
        clientId: activeClientId,
        companyName: company.company_name,
        companyDomain: company.company_domain,
        source: 'watchlist',
        sourceTimestamp: company.created_at,
        priorityBoost: 20,
      }))).catch(err => {
        console.error('[watchlist] batch monitored account upsert failed:', err)
      })
    }

    return NextResponse.json({
      companies: data ?? [],
      inserted: data?.length ?? 0,
      skipped: batch.length - (data?.length ?? 0),
    })
  }

  const { company_name, company_domain, notes } = body ?? {}

  if (!company_name?.trim()) {
    return NextResponse.json({ error: 'company_name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('watchlist_companies')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      company_name: company_name.trim(),
      company_domain: company_domain?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select('id, company_name, company_domain, notes, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already watching this company' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (activeClientId) {
    upsertMonitoredAccountSeeds(service, [{
      userId: user.id,
      clientId: activeClientId,
      companyName: company_name.trim(),
      companyDomain: company_domain?.trim() || null,
      source: 'watchlist',
      sourceTimestamp: new Date().toISOString(),
      priorityBoost: 20,
    }]).catch(err => {
      console.error('[watchlist] monitored account upsert failed:', err)
    })
  }

  return NextResponse.json({ company: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const service = await createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const { id } = await request.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let query = supabase
    .from('watchlist_companies')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  syncMonitoredAccountsFromWorkspaceSources(service).catch(err => {
    console.error('[watchlist] monitored account sync failed:', err)
  })
  return NextResponse.json({ ok: true })
}

function normalizeWatchlistInputs(inputs: WatchlistInput[]): Array<{ company_name: string; company_domain: string | null; notes: string | null }> {
  const seen = new Set<string>()
  const rows: Array<{ company_name: string; company_domain: string | null; notes: string | null }> = []

  for (const input of inputs.slice(0, 500)) {
    const companyName = input.company_name?.trim()
    if (!companyName) continue
    const companyDomain = normalizeDomain(input.company_domain ?? '')
    const key = watchlistKey(companyName, companyDomain)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      company_name: companyName,
      company_domain: companyDomain || null,
      notes: input.notes?.trim() || null,
    })
  }

  return rows
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/[,\s]+$/, '')
}

function watchlistKey(companyName: string, companyDomain?: string | null): string {
  return `${companyName.trim().toLowerCase()}|${normalizeDomain(companyDomain ?? '')}`
}
