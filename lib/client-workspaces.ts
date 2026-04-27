import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanTier } from '@/lib/plan'

export interface ClientWorkspaceRow {
  id: string
  is_archived?: boolean | null
  created_at?: string | null
}

export interface WorkspaceAccessInput {
  plan: PlanTier
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
  const preferredClient = activeClientId
    ? activeClients.find(client => client.id === activeClientId) ?? null
    : null
  const keepClient = preferredClient ?? activeClients[0] ?? orderedClients[0] ?? null

  if (!keepClient) {
    return {
      visibleClientIds: [],
      keepClientId: null,
      archiveClientIds: [],
      unarchiveClientIds: [],
    }
  }

  if (plan === 'pro') {
    return {
      visibleClientIds: activeClients.length > 0
        ? activeClients.map(client => client.id)
        : [keepClient.id],
      keepClientId: keepClient.id,
      archiveClientIds: [],
      unarchiveClientIds: keepClient.is_archived ? [keepClient.id] : [],
    }
  }

  return {
    visibleClientIds: [keepClient.id],
    keepClientId: keepClient.id,
    archiveClientIds: activeClients
      .filter(client => client.id !== keepClient.id)
      .map(client => client.id),
    unarchiveClientIds: keepClient.is_archived ? [keepClient.id] : [],
  }
}

export async function syncWorkspaceAccessForPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: PlanTier,
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
