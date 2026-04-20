import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPortalUrl } from '@/lib/dodo'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Dodo uses a static customer portal — customers log in with their email
  const url = getPortalUrl()
  return NextResponse.json({ url })
}
