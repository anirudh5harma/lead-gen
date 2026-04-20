const GRAPH_API = 'https://graph.microsoft.com/v1.0'

// Outlook inbox subscriptions expire after max 4230 minutes (~3 days)
const LIFETIME_MINUTES = 4200

export async function createOutlookSubscription(params: {
  accessToken:  string
  clientState:  string
  webhookUrl:   string
}): Promise<{ subscriptionId: string; expiration: string }> {
  const { accessToken, clientState, webhookUrl } = params
  const expiration = new Date(Date.now() + LIFETIME_MINUTES * 60 * 1000).toISOString()

  const res = await fetch(`${GRAPH_API}/subscriptions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType:         'created',
      notificationUrl:    webhookUrl,
      resource:           'me/mailFolders/Inbox/messages',
      expirationDateTime: expiration,
      clientState,
    }),
  })
  const data = await res.json() as { id?: string; expirationDateTime?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(data.error?.message || 'Outlook subscription failed')
  return { subscriptionId: data.id!, expiration: data.expirationDateTime! }
}

export async function renewOutlookSubscription(params: {
  accessToken:    string
  subscriptionId: string
}): Promise<string> {
  const { accessToken, subscriptionId } = params
  const expiration = new Date(Date.now() + LIFETIME_MINUTES * 60 * 1000).toISOString()

  const res = await fetch(`${GRAPH_API}/subscriptions/${subscriptionId}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ expirationDateTime: expiration }),
  })
  const data = await res.json() as { expirationDateTime?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(data.error?.message || 'Outlook renewal failed')
  return data.expirationDateTime!
}

export async function deleteOutlookSubscription(params: {
  accessToken:    string
  subscriptionId: string
}): Promise<void> {
  await fetch(`${GRAPH_API}/subscriptions/${params.subscriptionId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })
}

export interface OutlookMessageMeta {
  conversationId: string
  inReplyTo:      string | null
}

export async function fetchOutlookMessageMeta(
  accessToken: string,
  messageId:   string,
): Promise<OutlookMessageMeta | null> {
  const res = await fetch(
    `${GRAPH_API}/me/messages/${messageId}?$select=conversationId,internetMessageHeaders`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return null
  const data = await res.json() as {
    conversationId?: string
    internetMessageHeaders?: Array<{ name: string; value: string }>
  }

  const hdrs    = data.internetMessageHeaders ?? []
  const inReplyTo = hdrs.find(h => h.name.toLowerCase() === 'in-reply-to')?.value ?? null
  return { conversationId: data.conversationId ?? '', inReplyTo }
}

/** Fetch the most recently sent item to get its real RFC 2822 message-id and conversationId. */
export async function fetchLatestSentItem(
  accessToken: string,
): Promise<{ internetMessageId: string; conversationId: string } | null> {
  const res = await fetch(
    `${GRAPH_API}/me/mailFolders/SentItems/messages` +
    `?$orderby=sentDateTime desc&$top=1&$select=internetMessageId,conversationId`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return null
  const data = await res.json() as { value?: Array<{ internetMessageId?: string; conversationId?: string }> }
  const item = data.value?.[0]
  if (!item?.internetMessageId || !item?.conversationId) return null
  return { internetMessageId: item.internetMessageId, conversationId: item.conversationId }
}
