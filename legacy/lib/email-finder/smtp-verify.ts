import dns from 'dns/promises'

export type EmailConfidence = 'high' | 'medium' | 'low'

export interface VerifiedEmail {
  email: string
  confidence: EmailConfidence
  hasMX: boolean
}

/**
 * Verifies whether an email address is likely deliverable by:
 * 1. Checking that the domain has valid MX records (DNS lookup)
 * 2. Optionally doing an SMTP RCPT TO check (more accurate but slower)
 *
 * Note: Many mail servers reject SMTP probing — MX check alone is reliable
 * enough for MVP and won't get you blocklisted.
 */
export async function verifyEmail(email: string): Promise<VerifiedEmail> {
  const domain = email.split('@')[1]
  if (!domain) return { email, confidence: 'low', hasMX: false }

  try {
    const mxRecords = await dns.resolveMx(domain)
    const hasMX = mxRecords.length > 0

    if (!hasMX) return { email, confidence: 'low', hasMX: false }

    // If domain has MX, mark as medium confidence (we know mail is accepted)
    return { email, confidence: 'medium', hasMX: true }
  } catch {
    return { email, confidence: 'low', hasMX: false }
  }
}

/**
 * Verifies a list of email candidates in parallel and returns
 * only those with MX records, sorted by confidence.
 */
export async function verifyEmailCandidates(
  candidates: string[]
): Promise<VerifiedEmail[]> {
  const results = await Promise.allSettled(candidates.map(verifyEmail))
  return results
    .filter(r => r.status === 'fulfilled' && r.value.hasMX)
    .map(r => (r as PromiseFulfilledResult<VerifiedEmail>).value)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.confidence] - order[b.confidence]
    })
}
