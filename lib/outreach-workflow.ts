import type { SupabaseClient } from '@supabase/supabase-js'
import { enrichCompany, type EnrichedContact } from './email-finder/enrich.ts'
import { consumeLeadCredit, refundLeadCredit } from './lead-credits.ts'
import { buildRecipientGroup, ensureBodyGreetsRecipients, type OutreachRecipientGroup } from './outreach-recipients.ts'

export interface LeadContactLike {
  id?: unknown
  user_id?: unknown
  client_id?: unknown
  target_company?: unknown
  company_domain?: unknown
  is_unlocked?: unknown
  contact_email?: unknown
  contact_name?: unknown
  contact_title?: unknown
  contact_verified?: unknown
  feed_snapshot?: unknown
}

export interface OutreachStakeholder {
  name: string
  title: string
  email: string
  confidence: string
  source: string
}

export interface LeadRecipientResolution {
  recipientGroup: OutreachRecipientGroup | null
  stakeholders: OutreachStakeholder[]
  status: number
  error: string | null
  contact: { email: string; name: string | null; title: string | null; verified: boolean } | null
  debug: Record<string, unknown>
}

export async function resolveLeadRecipients(
  supabase: SupabaseClient,
  input: {
    lead: LeadContactLike
    userId: string
    servicesDescription?: string | null
    signalType?: string | null
    signalDomain?: string | null
    consumeCreditIfLocked?: boolean
    creditSource?: string
    refundCreditWhenNoContact?: boolean
    forceRefresh?: boolean
    requireVerified?: boolean
    maxContacts?: number
  },
): Promise<LeadRecipientResolution> {
  const leadId = String(input.lead.id ?? '')
  const targetCompany = typeof input.lead.target_company === 'string' ? input.lead.target_company : ''
  const existingGroup = input.forceRefresh || (input.requireVerified && input.lead.contact_verified !== true)
    ? null
    : buildRecipientGroup([primaryLeadContact(input.lead)])

  if (existingGroup) {
    return {
      recipientGroup: existingGroup,
      stakeholders: groupToStakeholders(existingGroup, input.lead.contact_verified === true ? 'high' : 'medium', 'lead_contact'),
      status: 200,
      error: null,
      contact: {
        email: existingGroup.to.email.toLowerCase(),
        name: existingGroup.to.name || null,
        title: existingGroup.to.title || null,
        verified: input.lead.contact_verified === true,
      },
      debug: {
        source: 'lead_contact',
        status: input.lead.contact_verified === true ? 'ready' : 'ready_unverified',
        message: input.lead.contact_verified === true
          ? 'Verified contact is available for this lead.'
          : 'Contact is available, but will be reverified before any send.',
        used_credit: false,
        contact_email: existingGroup.to.email,
        contact_name: existingGroup.to.name,
        contact_verified: input.lead.contact_verified === true,
      },
    }
  }

  if (!leadId || !targetCompany) {
    return emptyResolution(422, 'This lead is missing company context for contact discovery.', {
      source: 'invalid_lead',
      status: 'missing_company',
      message: 'This lead is missing company context for contact discovery.',
    })
  }

  const wasUnlocked = input.lead.is_unlocked === true
  let usedCredit = false
  if (!wasUnlocked && input.consumeCreditIfLocked) {
    try {
      usedCredit = await consumeLeadCredit(supabase, {
        userId: input.userId,
        leadId,
        metadata: { source: input.creditSource ?? 'contact_resolution_unlock' },
      })
    } catch (error) {
      return emptyResolution(500, error instanceof Error ? error.message : 'Unable to use lead credit for contact discovery.', {
        source: 'credit_error',
        status: 'blocked',
        message: error instanceof Error ? error.message : 'Unable to use lead credit for contact discovery.',
      })
    }

    if (!usedCredit) {
      return emptyResolution(403, 'You need lead credits to unlock this lead before contact discovery.', {
        source: 'no_credits',
        status: 'blocked',
        message: 'No lead credits are available for contact discovery.',
      })
    }

    const { error: unlockError } = await supabase
      .from('leads')
      .update({ is_unlocked: true, unlocked_at: new Date().toISOString() })
      .eq('id', leadId)
      .eq('user_id', input.userId)

    if (unlockError) {
      await refundLeadCredit(supabase, {
        userId: input.userId,
        leadId,
        metadata: { source: `${input.creditSource ?? 'contact_resolution'}_unlock_update_failed` },
      }).catch(() => {})
      return emptyResolution(500, unlockError.message, {
        source: 'unlock_update_failed',
        status: 'blocked',
        message: unlockError.message,
      })
    }
  } else if (!wasUnlocked && !input.consumeCreditIfLocked) {
    return emptyResolution(403, 'Unlock this lead before contact discovery.', {
      source: 'lead_locked',
      status: 'blocked',
      message: 'Lead is locked and contact discovery was not allowed to spend a credit.',
    })
  }

  const result = await enrichCompany(
    targetCompany,
    input.signalDomain || (typeof input.lead.company_domain === 'string' ? input.lead.company_domain : null),
    supabase,
    {
      servicesDescription: input.servicesDescription ?? null,
      signalType: input.signalType ?? null,
      maxContacts: input.maxContacts ?? 4,
      forceRefresh: input.forceRefresh === true,
      requireVerified: input.requireVerified === true,
    },
  )
  const contacts = result.contacts.filter(contact => contact.email && (!input.requireVerified || contact.verified))
  const topContact = contacts[0] ?? null
  const now = new Date().toISOString()
  const baseUpdate: Record<string, unknown> = { contact_enriched_at: now }
  if (result.resolvedDomain) baseUpdate.company_domain = result.resolvedDomain

  if (!topContact) {
    await supabase.from('leads').update({
      ...baseUpdate,
      last_contact_verification_error: input.requireVerified ? 'verified_contact_not_found' : 'contact_not_found',
    }).eq('id', leadId).eq('user_id', input.userId)

    if (usedCredit && input.refundCreditWhenNoContact !== false) {
      await refundLeadCredit(supabase, {
        userId: input.userId,
        leadId,
        metadata: { source: `${input.creditSource ?? 'contact_resolution'}_no_contact_refund` },
      }).catch(() => {})
      await supabase
        .from('leads')
        .update({ is_unlocked: false, unlocked_at: null })
        .eq('id', leadId)
        .eq('user_id', input.userId)
        .is('contact_email', null)
        .then(({ error }) => {
          if (error) console.error('[outreach-workflow] failed to relock lead after no-contact refund:', error.message)
        })
    }

    return emptyResolution(422, input.requireVerified
      ? 'Bombsell could not find a verified contact email for this company yet.'
      : 'Bombsell could not find a usable contact email for this company yet.', {
      source: 'enrichment',
      status: 'not_found',
      message: input.requireVerified
        ? 'Contact discovery did not find a verified recipient yet.'
        : 'Contact discovery did not find a usable recipient yet.',
      used_credit: usedCredit,
      from_cache: result.fromCache,
      resolved_domain: result.resolvedDomain,
      contact_count: contacts.length,
      require_verified: input.requireVerified === true,
    })
  }

  await persistLeadTopContact(supabase, {
    leadId,
    userId: input.userId,
    contact: topContact,
    baseUpdate,
    now,
  })

  const stakeholders = contactsToStakeholders(contacts)
  const recipientGroup = buildRecipientGroup(stakeholders)
  return {
    recipientGroup,
    stakeholders,
    status: recipientGroup ? 200 : 422,
    error: recipientGroup ? null : 'Bombsell found contacts, but none were usable as recipients.',
    contact: recipientGroup ? {
      email: recipientGroup.to.email.toLowerCase(),
      name: recipientGroup.to.name || null,
      title: recipientGroup.to.title || null,
      verified: topContact.verified,
    } : null,
    debug: {
      source: 'enrichment',
      status: recipientGroup ? 'ready' : 'not_usable',
      message: recipientGroup
        ? 'Contact discovery found a recipient for this lead.'
        : 'Contact discovery found contacts, but none were usable as recipients.',
      used_credit: usedCredit,
      from_cache: result.fromCache,
      resolved_domain: result.resolvedDomain,
      contact_count: contacts.length,
      top_contact_verified: topContact.verified,
      contact_email: recipientGroup?.to.email ?? null,
      contact_name: recipientGroup?.to.name ?? null,
      require_verified: input.requireVerified === true,
    },
  }
}

export async function persistLeadTopContact(
  supabase: SupabaseClient,
  input: {
    leadId: string
    userId: string
    contact: EnrichedContact
    baseUpdate?: Record<string, unknown>
    now?: string
  },
): Promise<void> {
  const now = input.now ?? new Date().toISOString()
  await supabase.from('leads').update({
    ...(input.baseUpdate ?? {}),
    contact_email: input.contact.email.toLowerCase(),
    contact_name: input.contact.name || null,
    contact_title: input.contact.title || null,
    contact_source: input.contact.source,
    contact_verified: input.contact.verified,
    contact_verified_at: input.contact.verified ? now : null,
    contact_verification_status: input.contact.zb_status ?? null,
    last_contact_verification_error: input.contact.verified ? null : 'contact_not_verified',
  }).eq('id', input.leadId).eq('user_id', input.userId)
}

export async function upsertOutreachDraft(
  supabase: SupabaseClient,
  input: {
    leadId: string
    userId: string
    clientId?: string | null
    subject: string
    body: string
    stakeholders: OutreachStakeholder[]
    greeting?: string | null
  },
): Promise<{ subject: string; body: string; stakeholders: OutreachStakeholder[] }> {
  const normalizedBody = input.greeting
    ? ensureBodyGreetsRecipients(input.body, input.greeting)
    : input.body
  const { data, error } = await supabase
    .from('outreach_drafts')
    .upsert({
      lead_id: input.leadId,
      user_id: input.userId,
      client_id: input.clientId ?? null,
      subject: input.subject,
      body: normalizedBody,
      stakeholders: input.stakeholders,
    }, { onConflict: 'lead_id' })
    .select('subject, body, stakeholders')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return {
    subject: typeof data?.subject === 'string' ? data.subject : input.subject,
    body: typeof data?.body === 'string' ? data.body : normalizedBody,
    stakeholders: Array.isArray(data?.stakeholders) ? data.stakeholders as OutreachStakeholder[] : input.stakeholders,
  }
}

export function primaryLeadContact(lead: LeadContactLike): OutreachStakeholder {
  return {
    name: typeof lead.contact_name === 'string' ? lead.contact_name : '',
    title: typeof lead.contact_title === 'string' ? lead.contact_title : 'Decision Maker',
    email: typeof lead.contact_email === 'string' ? lead.contact_email : '',
    confidence: lead.contact_verified === true ? 'high' : 'medium',
    source: 'lead_contact',
  }
}

export function contactsToStakeholders(contacts: EnrichedContact[]): OutreachStakeholder[] {
  return contacts.map(contact => ({
    name: contact.name || '',
    title: contact.title || 'Decision Maker',
    email: contact.email.toLowerCase(),
    confidence: contact.verified ? 'high' : 'medium',
    source: contact.source || 'enrichment',
  }))
}

export function firstUsableStakeholder(value: unknown): { name: string; email: string } | null {
  if (!Array.isArray(value)) return null
  const group = buildRecipientGroup(value as Array<Partial<OutreachStakeholder> | null>)
  if (!group) return null
  return {
    name: group.to.name,
    email: group.to.email,
  }
}

function groupToStakeholders(group: OutreachRecipientGroup, confidence: string, source: string): OutreachStakeholder[] {
  return group.all.map(recipient => ({
    name: recipient.name,
    title: recipient.title,
    email: recipient.email,
    confidence,
    source,
  }))
}

function emptyResolution(status: number, error: string, debug: Record<string, unknown>): LeadRecipientResolution {
  return {
    recipientGroup: null,
    stakeholders: [],
    status,
    error,
    contact: null,
    debug,
  }
}
