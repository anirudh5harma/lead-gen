import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { googleAuthUrl } from '@/lib/oauth/google'
import { createOAuthState } from '@/lib/oauth/state'

export async function GET() {
  if (process.env.NEXT_PUBLIC_ENABLE_GMAIL_CONNECT !== 'true') {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?view=settings&ca_error=gmail_disabled`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`)

  const state = createOAuthState(user.id)
  return NextResponse.redirect(googleAuthUrl(state))
}
