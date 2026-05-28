import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RemoteControlProvider } from './auth'

export interface RemoteControlConnection {
  provider: RemoteControlProvider
  providerUserId: string
  providerChatId: string | null
  username: string | null
  enabled: boolean
  createdAt: string
}

export function hashRemoteLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createRemoteLinkToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function createRemoteControlLink(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    provider: RemoteControlProvider
    ttlMinutes?: number
  },
): Promise<{ token: string; expiresAt: string }> {
  const token = createRemoteLinkToken()
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 15) * 60_000).toISOString()
  const { error } = await supabase.from('remote_control_link_tokens').insert({
    user_id: input.userId,
    client_id: input.clientId ?? null,
    provider: input.provider,
    token_hash: hashRemoteLinkToken(token),
    expires_at: expiresAt,
  })
  if (error) throw new Error(error.message)
  return { token, expiresAt }
}

export async function consumeRemoteControlLink(
  supabase: SupabaseClient,
  input: {
    provider: RemoteControlProvider
    token: string
    providerUserId: string
    providerChatId?: string | null
    username?: string | null
  },
): Promise<{ userId: string; clientId: string | null } | null> {
  const tokenHash = hashRemoteLinkToken(input.token)
  const { data: link, error } = await supabase
    .from('remote_control_link_tokens')
    .select('id, user_id, client_id, expires_at, consumed_at')
    .eq('provider', input.provider)
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!link || link.consumed_at || new Date(link.expires_at).getTime() < Date.now()) return null

  const { error: identityError } = await supabase.from('remote_control_identities').upsert({
    user_id: link.user_id,
    client_id: link.client_id ?? null,
    provider: input.provider,
    provider_user_id: input.providerUserId,
    provider_chat_id: input.providerChatId ?? null,
    username: input.username ?? null,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,provider_user_id' })
  if (identityError) throw new Error(identityError.message)

  await supabase
    .from('remote_control_link_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', link.id)

  return { userId: link.user_id, clientId: link.client_id ?? null }
}

export async function listRemoteControlConnections(
  supabase: SupabaseClient,
  userId: string,
): Promise<RemoteControlConnection[]> {
  const { data, error } = await supabase
    .from('remote_control_identities')
    .select('provider, provider_user_id, provider_chat_id, username, enabled, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingRemoteControlTableError(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []).map(row => ({
    provider: row.provider as RemoteControlProvider,
    providerUserId: row.provider_user_id,
    providerChatId: row.provider_chat_id ?? null,
    username: row.username ?? null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  }))
}

function isMissingRemoteControlTableError(message: string): boolean {
  return /remote_control_identities/i.test(message)
    && /(schema cache|does not exist|not find|not found|unknown table)/i.test(message)
}
