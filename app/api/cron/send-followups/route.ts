import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import { getPlanLimits, PLAN_LIMITS, type PlanTier } from '@/lib/plan'

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const UNSUBSCRIBE_BASE = `${process.env.NEXT_PUBLIC_APP_URL}/api/outreach/unsubscribe`

function unsubscribeUrl(email: string): string {
  return `${UNSUBSCRIBE_BASE}?token=${Buffer.from(email).toString('base64url')}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 503 })
  }

  const supabase = await createServiceClient()
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data: pending } = await supabase
    .from('scheduled_followups')
    .select(`
      id, user_id, lead_id, scheduled_for,
      leads(target_company, contact_email),
      outreach_sequences(followup_subject, followup_body)
    `)
    .lte('scheduled_for', new Date().toISOString())
    .is('sent_at', null)
    .limit(50)

  if (!pending?.length) return NextResponse.json({ sent: 0 })

  const userIds = [...new Set(pending.map(p => p.user_id))]
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, plan, auto_send_enabled, leads_used_this_month, leads_reset_at')
    .in('user_id', userIds)

  const now = new Date()
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Build per-user quota state; reset counter if 30-day window elapsed
  const quotaMap: Record<string, { plan: PlanTier; used: number; limit: number; autoSend: boolean }> = {}
  for (const p of (profiles ?? [])) {
    const plan = (p.plan ?? 'free') as PlanTier
    let used = p.leads_used_this_month ?? 0

    if (p.leads_reset_at && new Date(p.leads_reset_at) < windowStart) {
      used = 0
      await supabase
        .from('user_profiles')
        .update({ leads_used_this_month: 0, leads_reset_at: now.toISOString() })
        .eq('user_id', p.user_id)
    }

    quotaMap[p.user_id] = {
      plan,
      used,
      limit: PLAN_LIMITS[plan].sends_per_month,
      autoSend: p.auto_send_enabled ?? true,
    }
  }

  let sent = 0
  for (const item of pending) {
    const quota = quotaMap[item.user_id]
    if (!quota) continue
    if (!getPlanLimits(quota.plan).followups) continue
    if (!quota.autoSend) continue
    if (quota.used >= quota.limit) continue  // quota exhausted — follow-ups count against limit

    const lead = item.leads as unknown as { contact_email?: string; target_company: string } | null
    const seq  = item.outreach_sequences as unknown as { followup_subject: string; followup_body: string } | null
    if (!lead?.contact_email || !seq) continue

    const email = lead.contact_email.toLowerCase()

    const { data: unsub } = await supabase
      .from('unsubscribed_emails').select('id').eq('email', email).maybeSingle()
    if (unsub) {
      await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
      continue
    }

    const { data: bounced } = await supabase
      .from('bounced_emails').select('id').eq('email', email).maybeSingle()
    if (bounced) {
      await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
      continue
    }

    const fromAddress = process.env.RESEND_FROM ?? 'outreach@bombsell.com'
    const { data: emailData, error } = await resend.emails.send({
      from: fromAddress,
      to: lead.contact_email,
      subject: seq.followup_subject,
      text: `${seq.followup_body}\n\n---\nTo unsubscribe: ${unsubscribeUrl(lead.contact_email)}`,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(lead.contact_email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })

    if (!error) {
      await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
      if (emailData?.id) {
        await supabase.from('leads').update({ message_id: emailData.id }).eq('id', item.lead_id)
      }
      // Increment quota — follow-ups count against the monthly send limit
      await supabase.rpc('increment_leads_used', { p_user_id: item.user_id })
      quota.used++  // update in-memory so subsequent items in this run see the updated count
      sent++
    }
  }

  return NextResponse.json({ sent })
}
