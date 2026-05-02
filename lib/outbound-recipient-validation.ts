import { enrichSingleEmail } from './email-finder/enrich'
import { isSafeToSend, type ZBStatus } from './email-finder/zeroBounce'
import { normalizeEmailAddress } from './email-safety'

export interface RecipientValidationRow {
  email: string
  status: ZBStatus | null
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
): Promise<RecipientValidationResult> {
  const normalized = normalizeUniqueEmails(emails)
  const rows = await Promise.all(normalized.map(async email => {
    const status = await enrichSingleEmail(email)
    const safe = status ? isSafeToSend(status) : false
    return {
      email,
      status,
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
