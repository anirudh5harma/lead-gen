import { formatMailboxHeader, normalizeEmailAddress, sanitizeHeaderValue } from '@/lib/email-safety'

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API        = 'https://gmail.googleapis.com/gmail/v1'

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',  // read message headers for reply detection
].join(' ')

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-mail/callback`,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export async function exchangeGoogleCode(code: string): Promise<{
  access_token: string; refresh_token: string; expires_in: number
  email: string; name: string
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-mail/callback`,
      grant_type:    'authorization_code',
    }),
  })
  const data = await res.json() as Record<string, string>
  if (!res.ok) throw new Error(data.error_description || 'Google token exchange failed')

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const user = await userRes.json() as { email: string; name?: string }

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_in:    Number(data.expires_in),
    email:         user.email,
    name:          user.name || user.email,
  }
}

export async function refreshGoogleToken(refreshToken: string): Promise<{
  access_token: string; expires_in: number
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token:  refreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json() as Record<string, string>
  if (!res.ok) throw new Error(data.error_description || 'Google token refresh failed')
  return { access_token: data.access_token, expires_in: Number(data.expires_in) }
}

export interface GmailSendResult {
  messageId: string
  threadId: string
}

export async function sendViaGmail(params: {
  accessToken: string
  fromEmail:   string
  fromName:    string
  to:          string
  cc?:         string[]
  subject:     string
  body:        string
  inReplyTo?:  string | null
  threadId?:   string | null
  unsubLink:   string
}): Promise<GmailSendResult> {
  const { accessToken, fromEmail, fromName, to, cc = [], subject, body, inReplyTo, threadId, unsubLink } = params
  const safeFrom = formatMailboxHeader(fromName, fromEmail)
  const safeTo = normalizeEmailAddress(to)
  const safeCc = cc.map(email => normalizeEmailAddress(email)).filter(email => email.toLowerCase() !== safeTo.toLowerCase())
  const safeSubject = sanitizeHeaderValue(subject)
  const safeInReplyTo = inReplyTo ? sanitizeHeaderValue(inReplyTo) : null

  const headerLines = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    ...(safeCc.length > 0 ? [`Cc: ${safeCc.join(', ')}`] : []),
    `Subject: ${safeSubject}`,
    'Content-Type: text/plain; charset=utf-8',
    `List-Unsubscribe: <${unsubLink}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    ...(safeInReplyTo ? [`In-Reply-To: ${safeInReplyTo}`, `References: ${safeInReplyTo}`] : []),
  ]

  const raw = Buffer.from(`${headerLines.join('\r\n')}\r\n\r\n${body}`).toString('base64url')
  const payload: Record<string, string> = { raw }
  if (threadId) payload.threadId = threadId

  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  const data = await res.json() as { id?: string; threadId?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(data.error?.message || 'Gmail send failed')
  return { messageId: data.id!, threadId: data.threadId! }
}
