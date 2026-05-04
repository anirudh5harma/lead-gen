import { enrichSingleEmail } from './email-finder/enrich'
import { isSafeToSend, type ZBStatus } from './email-finder/zeroBounce'
import { normalizeEmailAddress } from './email-safety'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecipientValidationRow {
  email: string
  status: ZBStatus | null
  verifiedAt: string | null
  safe: boolean
  reason: string | null
}

export interface RecipientValidationResult {
  safe: boolean
  rows: RecipientValidationRow[]
  unsafeEmails: string[]
  reasons: string[]
}

export async function validateOutboundRecipients(
  emails: string[],
  options?: { maxCacheAgeDays?: number },
): Promise<RecipientValidationResult> {
  const normalized = normalizeUniqueEmails(emails)
  const rows = await Promise.all(normalized.map(async email => {
    const verification = await enrichSingleEmail(email, {
      maxCacheAgeDays: options?.maxCacheAgeDays ?? outboundVerificationMaxAgeDays(),
    })
    const status = verification?.status ?? null
    const safe = status ? isSafeToSend(status) : false
    return {
      email,
      status,
      verifiedAt: verification?.verifiedAt ?? null,
      safe,
      reason: safe ? null : status ? `email_${status}` : 'email_validation_unavailable',
    }
  }))

  const unsafeRows = rows.filter(row => !row.safe)
  return {
    safe: unsafeRows.length === 0,
    rows,
    unsafeEmails: unsafeRows.map(row => row.email),
    reasons: [...new Set(unsafeRows.map(row => row.reason).filter((reason): reason is string => Boolean(reason)))],
  }
}

export function outboundVerificationMaxAgeDays(): number {
  const configured = Number(process.env.OUTBOUND_VERIFICATION_MAX_AGE_DAYS)
  if (!Number.isFinite(configured) || configured <= 0) return 30
  return Math.max(1, Math.min(90, Math.round(configured)))
}

export async function persistLeadRecipientVerification(
  supabase: SupabaseClient,
  input: {
    leadId: string
    userId: string
    primaryEmail?: string | null
    validation: RecipientValidationResult
  },
): Promise<boolean> {
  const primaryEmail = input.primaryEmail ? normalizeMaybeEmail(input.primaryEmail) : input.validation.rows[0]?.email ?? null
  const primaryRow = primaryEmail
    ? input.validation.rows.find(row => row.email.toLowerCase() === primaryEmail.toLowerCase()) ?? null
    : input.validation.rows[0] ?? null

  const verified = input.validation.safe && Boolean(primaryRow?.safe)
  const { error } = await supabase
    .from('leads')
    .update({
      contact_email: primaryEmail ?? null,
      contact_verified: verified,
      contact_verified_at: primaryRow?.verifiedAt ?? new Date().toISOString(),
      contact_verification_status: primaryRow?.status ?? null,
      last_contact_verification_error: input.validation.safe ? null : input.validation.reasons.join(', ') || 'recipient_not_verified',
    })
    .eq('id', input.leadId)
    .eq('user_id', input.userId)

  if (error) console.error('[outbound-recipient-validation] lead verification update failed:', error.message)
  return verified
}

function normalizeMaybeEmail(value: string): string | null {
  try {
    return normalizeEmailAddress(value).toLowerCase()
  } catch {
    return null
  }
}

function normalizeUniqueEmails(emails: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const rawEmail of emails) {
    try {
      const email = normalizeEmailAddress(rawEmail).toLowerCase()
      if (seen.has(email)) continue
      seen.add(email)
      normalized.push(email)
    } catch {
      // Invalid addresses are filtered by recipient group construction.
    }
  }
  return normalized
}
