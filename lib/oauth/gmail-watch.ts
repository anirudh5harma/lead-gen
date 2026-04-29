const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'

/**
 * Registers (or re-registers) a Gmail push notification watch on the user's inbox.
 * Returns the initial historyId — store this so processNewMessages knows where to diff from.
 * Watch expires after 7 days; renew every 6 days via cron.
 */
export async function startGmailWatch(
  accessToken: string,
  pubsubTopic: string,
): Promise<{ historyId: string; expiration: string }> {
  const res = await fetch(`${GMAIL_API}/users/me/watch`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ topicName: pubsubTopic, labelIds: ['INBOX'] }),
  })
  const data = await res.json() as { historyId?: number; expiration?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(data.error?.message || 'Gmail watch failed')
  return { historyId: String(data.historyId!), expiration: data.expiration! }
}

export async function stopGmailWatch(accessToken: string): Promise<void> {
  await fetch(`${GMAIL_API}/users/me/stop`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export interface GmailInboxMessage {
  id:        string
  threadId:  string
  from:      string
  subject:   string | null
  snippet:   string
  messageId: string | null
  inReplyTo: string | null
}

/**
 * Returns messages added to INBOX since startHistoryId.
 * Fetches only metadata headers needed for reply detection.
 */
export async function getNewInboxMessages(
  accessToken:    string,
  startHistoryId: string,
): Promise<{ messages: GmailInboxMessage[]; latestHistoryId: string | null }> {
  const res = await fetch(
    `${GMAIL_API}/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return { messages: [], latestHistoryId: null }

  const data = await res.json() as {
    history?: Array<{ messagesAdded?: Array<{ message: { id: string; threadId: string } }> }>
    historyId?: string
  }

  const added: Array<{ id: string; threadId: string }> = []
  for (const record of (data.history ?? [])) {
    for (const m of (record.messagesAdded ?? [])) {
      added.push({ id: m.message.id, threadId: m.message.threadId })
    }
  }

  if (!added.length) return { messages: [], latestHistoryId: data.historyId ?? null }

  const results = await Promise.allSettled(
    added.map(async ({ id, threadId }) => {
      const msgRes = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=metadata` +
        `&metadataHeaders=In-Reply-To&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!msgRes.ok) return null
      const msg = await msgRes.json() as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } }
      const hdrs = msg.payload?.headers ?? []
      const get  = (name: string) => hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
      return {
        id,
        threadId,
        from: get('From') ?? '',
        subject: get('Subject'),
        snippet: msg.snippet ?? '',
        messageId: get('Message-ID'),
        inReplyTo: get('In-Reply-To'),
      } as GmailInboxMessage
    }),
  )

  const messages = results
    .filter((r): r is PromiseFulfilledResult<GmailInboxMessage | null> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value!)

  return { messages, latestHistoryId: data.historyId ?? null }
}
