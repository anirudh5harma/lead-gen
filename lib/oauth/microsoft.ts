const MICROSOFT_AUTH_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_API           = 'https://graph.microsoft.com/v1.0'

const SCOPES = 'openid offline_access User.Read Mail.Send Mail.Read'

export function microsoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft-mail/callback`,
    response_type: 'code',
    scope:         SCOPES,
    state,
  })
  return `${MICROSOFT_AUTH_URL}?${params}`
}

export async function exchangeMicrosoftCode(code: string): Promise<{
  access_token: string; refresh_token: string; expires_in: number
  email: string; name: string
}> {
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft-mail/callback`,
      grant_type:    'authorization_code',
      scope:         SCOPES,
    }),
  })
  const data = await res.json() as Record<string, string>
  if (!res.ok) throw new Error(data.error_description || 'Microsoft token exchange failed')

  const userRes = await fetch(`${GRAPH_API}/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const user = await userRes.json() as { mail?: string; userPrincipalName?: string; displayName?: string }

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_in:    Number(data.expires_in),
    email:         (user.mail || user.userPrincipalName)!,
    name:          user.displayName || user.mail || user.userPrincipalName!,
  }
}

export async function refreshMicrosoftToken(refreshToken: string): Promise<{
  access_token: string; expires_in: number
}> {
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token:  refreshToken,
      client_id:     process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      grant_type:    'refresh_token',
      scope:         SCOPES,
    }),
  })
  const data = await res.json() as Record<string, string>
  if (!res.ok) throw new Error(data.error_description || 'Microsoft token refresh failed')
  return { access_token: data.access_token, expires_in: Number(data.expires_in) }
}

export async function sendViaOutlook(params: {
  accessToken: string
  fromEmail:   string
  fromName:    string
  to:          string
  subject:     string
  body:        string
  inReplyTo?:  string | null
  unsubLink:   string
}): Promise<{ messageId: string; threadId: string | null }> {
  const { accessToken, fromEmail, fromName, to, subject, body, inReplyTo, unsubLink } = params

  const internetMessageHeaders = [
    { name: 'List-Unsubscribe',      value: `<${unsubLink}>` },
    { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ...(inReplyTo ? [
      { name: 'In-Reply-To', value: inReplyTo },
      { name: 'References',  value: inReplyTo },
    ] : []),
  ]

  const res = await fetch(`${GRAPH_API}/me/sendMail`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body:           { contentType: 'Text', content: body },
        toRecipients:   [{ emailAddress: { address: to } }],
        from:           { emailAddress: { name: fromName, address: fromEmail } },
        internetMessageHeaders,
      },
      saveToSentItems: true,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || 'Outlook send failed')
  }

  // sendMail returns 202 with no body; fetch the real sent-item IDs for reply detection.
  // Brief pause lets the item appear in SentItems before we query.
  await new Promise(r => setTimeout(r, 800))
  try {
    const sentRes = await fetch(
      `${GRAPH_API}/me/mailFolders/SentItems/messages` +
      `?$orderby=sentDateTime desc&$top=1&$select=internetMessageId,conversationId`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (sentRes.ok) {
      const sentData = await sentRes.json() as {
        value?: Array<{ internetMessageId?: string; conversationId?: string }>
      }
      const item = sentData.value?.[0]
      if (item?.internetMessageId && item?.conversationId) {
        return { messageId: item.internetMessageId, threadId: item.conversationId }
      }
    }
  } catch { /* fall through */ }

  return { messageId: `outlook_${fromEmail}_${Date.now()}`, threadId: null }
}
