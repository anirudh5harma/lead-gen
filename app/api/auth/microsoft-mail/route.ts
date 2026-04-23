import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { microsoftAuthUrl } from '@/lib/oauth/microsoft'
import { canUseConnectedSending } from '@/lib/plan'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`)

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!canUseConnectedSending(profile?.plan)) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?view=settings&ca_error=plan_required`)
  }

  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now() })).toString('base64url')
  return NextResponse.redirect(microsoftAuthUrl(state))
}
