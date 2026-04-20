export type ZBStatus =
  | 'valid'
  | 'invalid'
  | 'catch-all'
  | 'spamtrap'
  | 'abuse'
  | 'do_not_mail'
  | 'unknown'

export interface ZBResult {
  email: string
  status: ZBStatus
  sub_status: string
  free_email: boolean
  did_you_mean: string | null
  mx_found: boolean
}

export interface ZBBatchItem {
  email: string
  status: ZBStatus
  sub_status: string
}

export function isSafeToSend(status: ZBStatus): boolean {
  return status === 'valid' || status === 'catch-all'
}

export async function verifyEmail(email: string): Promise<ZBResult | null> {
  if (!process.env.ZEROBOUNCE_API_KEY) return null

  try {
    const url = new URL('https://api.zerobounce.net/v2/validate')
    url.searchParams.set('api_key', process.env.ZEROBOUNCE_API_KEY)
    url.searchParams.set('email', email)

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null

    const json = await res.json() as Partial<ZBResult> & { error?: string }
    if (json.error) return null

    return {
      email: json.email ?? email,
      status: (json.status ?? 'unknown') as ZBStatus,
      sub_status: json.sub_status ?? '',
      free_email: json.free_email ?? false,
      did_you_mean: json.did_you_mean ?? null,
      mx_found: json.mx_found ?? false,
    }
  } catch (e) {
    console.error('ZeroBounce verify error:', e)
    return null
  }
}

// Batch endpoint: cheaper per-credit and faster than sequential single calls.
// Use when validating multiple candidates at once (Hunter results).
export async function verifyEmailsBatch(emails: string[]): Promise<ZBBatchItem[]> {
  if (!process.env.ZEROBOUNCE_API_KEY || !emails.length) return []

  try {
    const res = await fetch('https://bulkapi.zerobounce.net/v2/validatebatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.ZEROBOUNCE_API_KEY,
        email_batch: emails.map(e => ({ email_address: e, ip_address: '' })),
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) return []
    const json = await res.json() as { email_batch?: Record<string, unknown>[] }

    return (json.email_batch ?? []).map(r => ({
      email: String(r.address ?? ''),
      status: (r.status ?? 'unknown') as ZBStatus,
      sub_status: String(r.sub_status ?? ''),
    }))
  } catch (e) {
    console.error('ZeroBounce batch error:', e)
    return []
  }
}
