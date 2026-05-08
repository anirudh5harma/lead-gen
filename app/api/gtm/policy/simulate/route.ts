import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buildRecipientGroup } from '@/lib/outreach-recipients'
import { validateOutboundRecipients } from '@/lib/outbound-recipient-validation'
import { simulateOutboundPolicy } from '@/lib/policies/outbound'
import { upsertGtmEvalTrace } from '@/lib/gtm/eval-traces'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const userSupabase = await createClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = body as {
    lead_id?: string
    recipient_emails?: string[]
    require_verified_contact?: boolean
  } | null
  const leadId = payload?.lead_id?.trim()
  if (!leadId) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })

  const supabase = await createServiceClient()
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, user_id, client_id, target_company, company_domain, status, is_unlocked, contact_email, contact_verified')
    .eq('id', leadId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const requestedRecipients = Array.isArray(payload?.recipient_emails)
    ? payload!.recipient_emails
    : [lead.contact_email].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const recipientGroup = buildRecipientGroup(requestedRecipients.map(email => ({ email })))
  if (!recipientGroup) return NextResponse.json({ error: 'At least one valid recipient is required' }, { status: 400 })
  const recipientEmails = recipientGroup.all.map(recipient => recipient.email.toLowerCase())

  const recipientValidation = await validateOutboundRecipients(recipientEmails)
  const requireVerified = payload?.require_verified_contact !== false

  const decision = await simulateOutboundPolicy(supabase, {
    userId: user.id,
    clientId: lead.client_id,
    leadId,
    targetCompany: lead.target_company,
    companyDomain: lead.company_domain,
    status: lead.status,
    isUnlocked: lead.is_unlocked,
    contactVerified: lead.contact_verified,
    recipientValidationSafe: recipientValidation.safe,
    recipientEmails,
    requireVerifiedContact: requireVerified,
    metadata: {
      simulation: true,
      recipient_validation_safe: recipientValidation.safe,
    },
  })

  await upsertGtmEvalTrace(supabase, {
    userId: user.id,
    clientId: lead.client_id,
    leadId,
    traceType: 'policy_simulation',
    status: decision.decision === 'allowed' ? 'passed' : 'blocked',
    reasons: decision.reasons,
    metadata: {
      simulation: true,
      recipient_emails: recipientEmails,
      recipient_validation_safe: recipientValidation.safe,
      require_verified_contact: requireVerified,
    },
  })

  return NextResponse.json({
    decision,
    recipient_validation: {
      safe: recipientValidation.safe,
      reasons: recipientValidation.reasons,
      unsafe_emails: recipientValidation.unsafeEmails,
    },
  })
}
