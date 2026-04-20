import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { microsoftAuthUrl } from '@/lib/oauth/microsoft'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`)

  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now() })).toString('base64url')
  return NextResponse.redirect(microsoftAuthUrl(state))
}
