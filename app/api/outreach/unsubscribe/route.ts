import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return new NextResponse('Invalid unsubscribe link.', { status: 400 })
  }

  const email = await verifyUnsubscribeToken(token)
  if (!email) {
    return new NextResponse('Invalid or tampered unsubscribe link.', { status: 400 })
  }

  const supabase = await createServiceClient()
  await supabase
    .from('unsubscribed_emails')
    .upsert({ email: email.toLowerCase() }, { onConflict: 'email' })

  return new NextResponse(
    `<!DOCTYPE html><html><head><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;">
      <h2>You've been unsubscribed</h2>
      <p style="color:#666;">${email} will no longer receive outreach from Bombsell users.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
