import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'
import { recordOutcomeLearning } from '@/lib/gtm/outcome-learning'

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

  const { data: leads } = await supabase
    .from('leads')
    .select('id, user_id, client_id')
    .eq('contact_email', email.toLowerCase())
    .limit(50)
  await Promise.all((leads ?? []).map(lead => recordOutcomeLearning(supabase, {
    userId: lead.user_id as string,
    clientId: (lead as { client_id?: string | null }).client_id ?? null,
    leadId: lead.id as string,
    outcome: 'unsubscribed',
    metadata: { source: 'unsubscribe_link' },
  }).catch(() => {})))

  return new NextResponse(
    `<!DOCTYPE html><html><head><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;">
      <h2>You've been unsubscribed</h2>
      <p style="color:#666;">${email} will no longer receive outreach from Bombsell users.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
