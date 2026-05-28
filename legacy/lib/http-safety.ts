const MAX_WEBHOOK_URL_LENGTH = 2048

export function normalizeOutboundWebhookUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (isBlockedHostname(url.hostname)) return null

  url.hash = ''
  return url.toString()
}

export async function postJsonWebhook(
  webhookUrl: string,
  payload: unknown,
  timeoutMs = 8000,
): Promise<Response> {
  const normalized = normalizeOutboundWebhookUrl(webhookUrl)
  if (!normalized) {
    throw new Error('Invalid outbound webhook URL')
  }

  return fetch(normalized, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal'
  ) {
    return true
  }

  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false

  const octets = ipv4.slice(1).map(Number)
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true
  const [a, b] = octets

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}
