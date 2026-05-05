import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { DISTRIBUTION_PROVIDERS, providerConnectStatus } from '@/lib/distribution'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let query = supabase
    .from('connected_distribution_accounts')
    .select('id, provider, provider_account_id, display_name, handle, scopes, status, publish_mode, metadata, last_publish_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    providers: DISTRIBUTION_PROVIDERS.map(provider => ({
      ...provider,
      connect: providerConnectStatus(provider.id),
    })),
    accounts: data ?? [],
  })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('connected_distribution_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
