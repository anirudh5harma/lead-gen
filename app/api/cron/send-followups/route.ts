import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getPlanLimits, type PlanTier } from '@/lib/plan'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { resolveOutreachContext } from '@/lib/outreach-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'send_followups')
  try {
    const { data: pending } = await supabase
      .from('scheduled_followups')
      .select(`
        id, user_id, lead_id, scheduled_for,
        leads(target_company, contact_email, status, message_id, from_email, gmail_thread_id, client_id),
        outreach_sequences(followup_subject, followup_body)
      `)
      .lte('scheduled_for', new Date().toISOString())
      .is('sent_at', null)
      .limit(50)

    if (!pending?.length) {
      const payload = { sent: 0, pending: 0 }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(pending.map(p => p.user_id))]
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, plan, auto_send_enabled, company_name, services_description, calendly_url')
      .in('user_id', userIds)

    const clientIds = pending
      .map(item => ((item.leads as { client_id?: string | null } | null)?.client_id ?? null))
      .filter((id): id is string => Boolean(id))
    const { data: clientProfiles } = clientIds.length > 0
      ? await supabase
          .from('client_accounts')
          .select('id, name, services_description, calendly_url')
          .in('id', clientIds)
      : { data: [] }

    const now = new Date()
    const quotaMap: Record<string, {
      plan: PlanTier
      autoSend: boolean
      profile: { company_name?: string | null; services_description?: string | null; calendly_url?: string | null }
    }> = {}
    for (const p of (profiles ?? [])) {
      const plan = (p.plan ?? 'free') as PlanTier
      quotaMap[p.user_id] = {
        plan,
        autoSend: p.auto_send_enabled ?? false,
        profile: {
          company_name: (p as { company_name?: string | null }).company_name ?? null,
          services_description: (p as { services_description?: string | null }).services_description ?? null,
          calendly_url: (p as { calendly_url?: string | null }).calendly_url ?? null,
        },
      }
    }
    const clientProfileMap = new Map(
      (clientProfiles ?? []).map(profile => [
        profile.id,
        {
          name: profile.name,
          services_description: profile.services_description,
          calendly_url: (profile as { calendly_url?: string | null }).calendly_url ?? null,
        },
      ]),
    )

    let sent = 0
    for (const item of pending) {
      const quota = quotaMap[item.user_id]
      if (!quota) continue
      if (!getPlanLimits(quota.plan).followups) continue
      if (!quota.autoSend) continue

      const lead = item.leads as unknown as {
        contact_email?: string; target_company: string; status?: string
        message_id?: string | null; from_email?: string | null; gmail_thread_id?: string | null
        client_id?: string | null
      } | null
      const seq = item.outreach_sequences as unknown as {
        followup_subject: string; followup_body: string
      } | null

      if (!lead?.contact_email) continue

    // Fall back to a generic follow-up template when pre-generation didn't complete
      const fuSubject = seq?.followup_subject ?? `Following up`
      const fuBody    = seq?.followup_body    ??
        `Probably caught you at a bad time — figured I'd check back in case it's still relevant.\n\nWorth a quick 15-min call this week?`

      if (lead.status === 'replied' || lead.status === 'booked') {
        await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
        continue
      }

      const email = lead.contact_email.toLowerCase()
      const [unsubRes, bounceRes] = await Promise.all([
        supabase.from('unsubscribed_emails').select('id').eq('email', email).maybeSingle(),
        supabase.from('bounced_emails').select('id').eq('email', email).maybeSingle(),
      ])
      if (unsubRes.data || bounceRes.data) {
        await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
        continue
      }

    // For Gmail threads, pass threadId for proper threading.
    // For Outlook, gmail_thread_id stores the conversationId — not directly usable as inReplyTo,
    // but the outlook webhook will handle reply detection via conversationId.
      const gmailThreadId = lead.gmail_thread_id ?? null
      const inReplyTo     = lead.message_id ? `<${lead.message_id}>` : null
      const clientProfile = lead.client_id ? clientProfileMap.get(lead.client_id) ?? null : null
      const outreachContext = resolveOutreachContext({
        userProfile: quota.profile,
        clientProfile,
      })

      try {
        const result = await sendWithConnectedAccount({
          userId:        item.user_id,
          supabase,
          to:            lead.contact_email,
          subject:       fuSubject,
          body:          fuBody,
          fromName:      outreachContext.fromName,
          inReplyTo,
          gmailThreadId,
          preferEmail:   lead.from_email ?? null,
        })

        if (!result) continue  // no connected account — skip this follow-up

        await supabase.from('scheduled_followups').update({ sent_at: now.toISOString() }).eq('id', item.id)
        if (result.messageId) {
          await supabase.from('leads').update({
            message_id:      result.messageId,
            gmail_thread_id: result.threadId ?? lead.gmail_thread_id,
          }).eq('id', item.lead_id)
        }
        sent++
      } catch (err) {
        console.error(`[send-followups] failed for lead ${item.lead_id}:`, err)
      }
    }

    const payload = { sent, pending: pending.length }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
