import type { SupabaseClient } from '@supabase/supabase-js'
import { getTierConfig, type SubscriptionTier } from './lead-credits.ts'

export interface ClientWorkspaceRow {
  id: string
  is_archived?: boolean | null
  created_at?: string | null
}

export interface WorkspaceAccessInput {
  plan: SubscriptionTier
  activeClientId: string | null
  clients: ClientWorkspaceRow[]
}

export interface WorkspaceAccessPlan {
  visibleClientIds: string[]
  keepClientId: string | null
  archiveClientIds: string[]
  unarchiveClientIds: string[]
}

function sortClientsByCreatedAt(clients: ClientWorkspaceRow[]): ClientWorkspaceRow[] {
  return [...clients].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
    return aTime - bTime
  })
}

export function buildWorkspaceAccessPlan({
  plan,
  activeClientId,
  clients,
}: WorkspaceAccessInput): WorkspaceAccessPlan {
  const orderedClients = sortClientsByCreatedAt(clients)
  const activeClients = orderedClients.filter(client => !client.is_archived)
  const maxVisible = Math.max(1, getTierConfig(plan).maxInboxes)

  const preferredClient = activeClientId
    ? orderedClients.find(client => client.id === activeClientId) ?? null
    : null

  const visibleActiveClients = selectVisibleClients({
    activeClients,
    preferredClientId: preferredClient?.id ?? null,
    maxVisible,
  })

  const keepClient = preferredClient ?? visibleActiveClients[0] ?? orderedClients[0] ?? null

  if (!keepClient) {
    return {
      visibleClientIds: [],
      keepClientId: null,
      archiveClientIds: [],
      unarchiveClientIds: [],
    }
  }

  const visibleClientIds = visibleActiveClients.length > 0
    ? visibleActiveClients.map(client => client.id)
    : [keepClient.id]
  const visibleSet = new Set(visibleClientIds)

  return {
    visibleClientIds,
    keepClientId: keepClient.id,
    archiveClientIds: activeClients
      .filter(client => !visibleSet.has(client.id))
      .map(client => client.id),
    unarchiveClientIds: keepClient.is_archived && visibleSet.has(keepClient.id)
      ? [keepClient.id]
      : [],
  }
}

function selectVisibleClients(input: {
  activeClients: ClientWorkspaceRow[]
  preferredClientId: string | null
  maxVisible: number
}): ClientWorkspaceRow[] {
  const { activeClients, preferredClientId, maxVisible } = input
  if (activeClients.length <= maxVisible) return activeClients

  const visible: ClientWorkspaceRow[] = []
  if (preferredClientId) {
    const preferred = activeClients.find(client => client.id === preferredClientId)
    if (preferred) visible.push(preferred)
  }

  for (const client of activeClients) {
    if (visible.length >= maxVisible) break
    if (visible.some(existing => existing.id === client.id)) continue
    visible.push(client)
  }
  return visible
}

export async function syncWorkspaceAccessForPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: SubscriptionTier,
): Promise<WorkspaceAccessPlan> {
  const [{ data: clients }, { data: profile }] = await Promise.all([
    supabase
      .from('client_accounts')
      .select('id, is_archived, created_at')
      .eq('user_id', userId),
    supabase
      .from('user_profiles')
      .select('active_client_id')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const accessPlan = buildWorkspaceAccessPlan({
    plan,
    activeClientId: (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null,
    clients: (clients ?? []) as ClientWorkspaceRow[],
  })

  if (accessPlan.keepClientId) {
    await supabase
      .from('user_profiles')
      .update({ active_client_id: accessPlan.keepClientId })
      .eq('user_id', userId)
  }

  if (accessPlan.unarchiveClientIds.length > 0) {
    await supabase
      .from('client_accounts')
      .update({ is_archived: false })
      .eq('user_id', userId)
      .in('id', accessPlan.unarchiveClientIds)
  }

  if (accessPlan.archiveClientIds.length > 0) {
    await supabase
      .from('client_accounts')
      .update({ is_archived: true })
      .eq('user_id', userId)
      .in('id', accessPlan.archiveClientIds)

    await supabase
      .from('crm_sync_settings')
      .update({ enabled: false })
      .eq('user_id', userId)
      .in('client_id', accessPlan.archiveClientIds)
  }

  return accessPlan
}
