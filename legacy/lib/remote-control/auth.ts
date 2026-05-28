import type { SupabaseClient } from '@supabase/supabase-js'

export type RemoteControlProvider = 'telegram' | 'discord'

export interface RemoteControlPrincipal {
  userId: string
  clientId: string | null
  provider: RemoteControlProvider
  providerUserId: string
  providerChatId?: string | null
}

interface EnvPrincipal {
  user_id?: string
  userId?: string
  client_id?: string | null
  clientId?: string | null
}

export async function resolveRemoteControlPrincipal(
  supabase: SupabaseClient,
  input: {
    provider: RemoteControlProvider
    providerUserId: string
    providerChatId?: string | null
  },
): Promise<RemoteControlPrincipal | null> {
  const { data } = await supabase
    .from('remote_control_identities')
    .select('user_id, client_id, enabled')
    .eq('provider', input.provider)
    .eq('provider_user_id', input.providerUserId)
    .eq('enabled', true)
    .maybeSingle()

  if (data?.user_id) {
    return {
      userId: data.user_id,
      clientId: data.client_id ?? null,
      provider: input.provider,
      providerUserId: input.providerUserId,
      providerChatId: input.providerChatId ?? null,
    }
  }

  const envPrincipal = resolveEnvPrincipal(input.provider, input.providerUserId)
  if (!envPrincipal) return null
  return {
    ...envPrincipal,
    provider: input.provider,
    providerUserId: input.providerUserId,
    providerChatId: input.providerChatId ?? null,
  }
}

export function resolveEnvPrincipal(
  provider: RemoteControlProvider,
  providerUserId: string,
): { userId: string; clientId: string | null } | null {
  const structured = parseStructuredEnv(process.env.REMOTE_CONTROL_USERS, provider, providerUserId)
  if (structured) return structured

  const providerEnv = provider === 'telegram'
    ? process.env.REMOTE_CONTROL_TELEGRAM_USERS
    : process.env.REMOTE_CONTROL_DISCORD_USERS
  return parseProviderEnv(providerEnv, providerUserId)
}

function parseStructuredEnv(
  raw: string | undefined,
  provider: RemoteControlProvider,
  providerUserId: string,
): { userId: string; clientId: string | null } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const providerBlock = parsed[provider]
    if (!providerBlock || typeof providerBlock !== 'object') return null
    const value = (providerBlock as Record<string, unknown>)[providerUserId]
    if (!value) return null
    if (typeof value === 'string') return { userId: value, clientId: null }
    if (typeof value !== 'object') return null
    const principal = value as EnvPrincipal
    const userId = principal.user_id ?? principal.userId
    if (!userId) return null
    return { userId, clientId: principal.client_id ?? principal.clientId ?? null }
  } catch {
    return null
  }
}

function parseProviderEnv(
  raw: string | undefined,
  providerUserId: string,
): { userId: string; clientId: string | null } | null {
  if (!raw) return null
  for (const entry of raw.split(',')) {
    const [externalId, userId, clientId] = entry.split(':').map(part => part?.trim())
    if (externalId === providerUserId && userId) {
      return { userId, clientId: clientId || null }
    }
  }
  return null
}
