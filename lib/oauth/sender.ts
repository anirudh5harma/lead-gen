import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshGoogleToken, sendViaGmail } from './google'
import { refreshMicrosoftToken, sendViaOutlook } from './microsoft'
import { signUnsubscribeToken } from '@/lib/unsubscribe'
import { normalizeEmailAddress, sanitizeHeaderValue } from '@/lib/email-safety'

const UNSUBSCRIBE_BASE = `${process.env.NEXT_PUBLIC_APP_URL}/api/outreach/unsubscribe`

async function unsubscribeUrl(email: string): Promise<string> {
  const token = await signUnsubscribeToken(email)
  return `${UNSUBSCRIBE_BASE}?token=${token}`
}

export interface ConnectedAccount {
  id:               string
  provider:         'gmail' | 'outlook'
  email:            string
  display_name:     string | null
  access_token:     string
  refresh_token:    string
  token_expires_at: string
}

export interface SendResult {
  messageId: string
  threadId:  string | null
  fromEmail: string
  provider:  'gmail' | 'outlook'
}

export async function getValidAccessToken(account: ConnectedAccount, supabase: SupabaseClient): Promise<string> {
  const expiresAt = new Date(account.token_expires_at).getTime()

  // Refresh if expiring within 5 minutes
  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    const refreshed = account.provider === 'gmail'
      ? await refreshGoogleToken(account.refresh_token)
      : await refreshMicrosoftToken(account.refresh_token)

    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    await supabase
      .from('connected_accounts')
      .update({ access_token: refreshed.access_token, token_expires_at: newExpiry })
      .eq('id', account.id)

    return refreshed.access_token
  }

  return account.access_token
}

/**
 * Picks the least-recently-used active connected account for a user.
 * If preferEmail is provided, picks that specific account (for follow-up continuity).
 * Returns null if the user has no connected accounts.
 */
export async function pickSenderAccount(
  userId:       string,
  supabase:     SupabaseClient,
  preferEmail?: string | null,
  preferAccountId?: string | null,
  notUsedSince?: string | null,
): Promise<ConnectedAccount | null> {
  if (preferEmail) {
    let query = supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('email', preferEmail)
      .eq('is_active', true)
    if (notUsedSince) query = query.or(`last_used_at.is.null,last_used_at.lte.${notUsedSince}`)
    const { data } = await query.maybeSingle()
    if (data) return data as ConnectedAccount
  }

  if (preferAccountId) {
    let query = supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('id', preferAccountId)
      .eq('is_active', true)
    if (notUsedSince) query = query.or(`last_used_at.is.null,last_used_at.lte.${notUsedSince}`)
    const { data } = await query.maybeSingle()
    if (data) return data as ConnectedAccount
  }

  let query = supabase
    .from('connected_accounts')
    .select('id, provider, email, display_name, access_token, refresh_token, token_expires_at, created_at')
    .eq('user_id', userId)
    .eq('is_active', true)
  if (notUsedSince) query = query.or(`last_used_at.is.null,last_used_at.lte.${notUsedSince}`)
  const { data } = await query
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data as ConnectedAccount | null
}

/**
 * Sends an email using the user's connected sending account.
 * Handles token refresh automatically.
 * Returns null if no connected account is available — caller falls back to Resend.
 */
export async function sendWithConnectedAccount(params: {
  userId:        string
  supabase:      SupabaseClient
  to:            string
  cc?:           string[]
  subject:       string
  body:          string
  fromName:      string
  inReplyTo?:    string | null
  gmailThreadId?: string | null
  preferEmail?:  string | null
  preferAccountId?: string | null
  notUsedSince?: string | null
}): Promise<SendResult | null> {
  const { userId, supabase, to, cc = [], subject, body, fromName, inReplyTo, gmailThreadId, preferEmail, preferAccountId, notUsedSince } = params
  const recipient = normalizeEmailAddress(to)
  const ccRecipients = [...new Set(cc.map(email => normalizeEmailAddress(email)).filter(email => email.toLowerCase() !== recipient.toLowerCase()))]
  const safeSubject = sanitizeHeaderValue(subject)
  const safeFromName = sanitizeHeaderValue(fromName)

  const account = await pickSenderAccount(userId, supabase, preferEmail, preferAccountId, notUsedSince)
  if (!account) return null

  const accessToken  = await getValidAccessToken(account, supabase)
  const unsubLink    = await unsubscribeUrl(recipient)
  const bodyWithFooter = `${body}\n\n---\nTo unsubscribe, visit: ${unsubLink}`
  const displayName  = safeFromName || account.display_name || account.email

  let result: SendResult

  if (account.provider === 'gmail') {
    const gmailResult = await sendViaGmail({
      accessToken,
      fromEmail:  account.email,
      fromName:   displayName,
      to:         recipient,
      cc:         ccRecipients,
      subject:    safeSubject,
      body:       bodyWithFooter,
      inReplyTo:  inReplyTo ?? null,
      threadId:   gmailThreadId ?? null,
      unsubLink,
    })
    result = { ...gmailResult, fromEmail: account.email, provider: 'gmail' }
  } else {
    const outlookResult = await sendViaOutlook({
      accessToken,
      fromEmail:  account.email,
      fromName:   displayName,
      to:         recipient,
      cc:         ccRecipients,
      subject:    safeSubject,
      body:       bodyWithFooter,
      inReplyTo:  inReplyTo ?? null,
      unsubLink,
    })
    result = { ...outlookResult, fromEmail: account.email, provider: 'outlook' }
  }

  // Round-robin: mark this account as just used
  await supabase
    .from('connected_accounts')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', account.id)

  return result
}
