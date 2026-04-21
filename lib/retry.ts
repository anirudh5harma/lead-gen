const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504])

/**
 * Fetch with exponential backoff on transient HTTP errors (4xx rate-limit, 5xx).
 * Definitive errors (400, 401, 403, 404) are returned immediately.
 */
export async function retryFetch(
  url: string | URL,
  options?: RequestInit,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<Response> {
  let last!: Response
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(url, options)
    if (!TRANSIENT_STATUS.has(res.status)) return res
    last = res
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, baseDelayMs * 2 ** i))
    }
  }
  return last
}
