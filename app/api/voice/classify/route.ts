import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { classifyVoiceIntent } from '@/lib/voice-intent-layer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Auth: require a valid session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { transcript?: string }
  const transcript = body.transcript?.trim()
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  try {
    const classification = await classifyVoiceIntent(transcript)
    return NextResponse.json(classification)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Classification failed' },
      { status: 500 },
    )
  }
}
