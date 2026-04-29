import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { microsoftAuthUrl } from '@/lib/oauth/microsoft'
import { createOAuthState } from '@/lib/oauth/state'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`)

  const state = createOAuthState(user.id)
  return NextResponse.redirect(microsoftAuthUrl(state))
}
