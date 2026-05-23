const SECRET = process.env.CRON_SECRET ?? 'dev-secret'

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signUnsubscribeToken(email: string): Promise<string> {
  const lower = email.toLowerCase()
  const key   = await getKey()
  const sig   = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(lower))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${Buffer.from(lower).toString('base64url')}.${sigB64}`
}

export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  // New format: base64url(email).hmac-sig
  const dot = token.lastIndexOf('.')
  if (dot > 0) {
    try {
      const emailB64 = token.slice(0, dot)
      const sigB64   = token.slice(dot + 1)
      const email    = Buffer.from(emailB64, 'base64url').toString('utf-8')
      if (email.includes('@')) {
        const key      = await getKey()
        const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
        const valid    = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(email))
        if (valid) return email
      }
    } catch { /* fall through */ }
  }
  // Legacy format: plain base64url(email) — keeps old links working
  try {
    const email = Buffer.from(token, 'base64url').toString('utf-8')
    if (email.includes('@')) return email
  } catch { /* ignore */ }
  return null
}
