import { NextResponse } from 'next/server'
import { handleHeyGenWebhookEvent } from '@/lib/gtm/avatar-video'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    const supabase = await createServiceClient()
    const result = await handleHeyGenWebhookEvent(supabase, payload)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[heygen webhook]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.HEYGEN_WEBHOOK_SECRET?.trim()
  if (!secret) return process.env.NODE_ENV !== 'production'

  const url = new URL(request.url)
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const headerSecret = request.headers.get('x-bombsell-webhook-secret') ?? request.headers.get('x-heygen-webhook-secret')
  return bearer === secret || headerSecret === secret || url.searchParams.get('secret') === secret
}
