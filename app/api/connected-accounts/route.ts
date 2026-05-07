import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stopGmailWatch } from '@/lib/oauth/gmail-watch'
import { deleteOutlookSubscription } from '@/lib/oauth/outlook-watch'
import { getValidAccessToken, type ConnectedAccount } from '@/lib/oauth/sender'
import { getMaxInboxesForTier, getUserTier } from '@/lib/oauth/connected-accounts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [tier, { data }] = await Promise.all([
    getUserTier(supabase, user.id),
    supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, is_active, last_used_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
  ])

  return NextResponse.json({
    accounts: data ?? [],
    max_accounts: getMaxInboxesForTier(tier),
  })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: account } = await supabase
    .from('connected_accounts')
    .select('id, provider, email, display_name, access_token, refresh_token, token_expires_at, outlook_subscription_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  await revokeProviderAutomation(account as ConnectedAccount & { outlook_subscription_id?: string | null }, supabase)

  const { error } = await supabase
    .from('connected_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

async function revokeProviderAutomation(
  account: ConnectedAccount & { outlook_subscription_id?: string | null },
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  try {
    const accessToken = await getValidAccessToken(account, supabase)
    if (account.provider === 'gmail') {
      await stopGmailWatch(accessToken)
    } else if (account.outlook_subscription_id) {
      await deleteOutlookSubscription({
        accessToken,
        subscriptionId: account.outlook_subscription_id,
      })
    }
  } catch (error) {
    console.error('[connected-accounts] provider automation revoke failed:', {
      accountId: account.id,
      provider: account.provider,
      error,
    })
  }
}
