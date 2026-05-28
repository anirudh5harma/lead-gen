import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export interface WorkspaceMember {
  id: string
  client_id: string
  user_id: string | null
  role: 'owner' | 'admin' | 'member'
  invited_email: string
  invited_at: string
  accepted_at: string | null
  name?: string | null
}

export interface TeamInvite {
  id: string
  token: string
  client_id: string
  invited_email: string
  role: 'admin' | 'member'
  expires_at: string
  used_at: string | null
}

export interface WorkspaceActivity {
  id: string
  client_id: string
  user_id: string | null
  action_type: string
  entity_type: string | null
  entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  user_name?: string | null
}

const INVITE_EXPIRY_HOURS = 72
const MAX_TEAM_MEMBERS: Record<string, number> = {
  free: 1,
  launch: 1,
  growth: 1,
  scale: 5,
  team: 10,
  enterprise: 20,
}

export function getMaxTeamMembers(plan: string): number {
  return MAX_TEAM_MEMBERS[plan] ?? 1
}

export async function getWorkspaceMembers(
  supabase: SupabaseClient,
  clientId: string,
): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('id, client_id, user_id, role, invited_email, invited_at, accepted_at')
    .eq('client_id', clientId)
    .order('accepted_at', { ascending: false })
    .order('invited_at', { ascending: false })

  if (error) {
    console.error('[team] getWorkspaceMembers error:', error.message)
    return []
  }

  const members = (data ?? []) as WorkspaceMember[]

  // Fetch names for accepted members
  const userIds = members.filter(m => m.user_id).map(m => m.user_id!)
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, company_name')
      .in('user_id', userIds)

    const nameById = new Map((profiles ?? []).map((p: { user_id: string; company_name: string }) => [p.user_id, p.company_name]))
    for (const member of members) {
      if (member.user_id) {
        member.name = nameById.get(member.user_id) || member.invited_email
      }
    }
  }

  return members
}

export async function getUserWorkspaceMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ client_id: string; role: string; name: string }>> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('client_id, role, client_accounts(name)')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)

  if (error) {
    console.error('[team] getUserWorkspaceMemberships error:', error.message)
    return []
  }

  return (data ?? []).map((row: { client_id: string; role: string; client_accounts: { name: string } | { name: string }[] | null }) => ({
    client_id: row.client_id,
    role: row.role,
    name: Array.isArray(row.client_accounts)
      ? row.client_accounts[0]?.name ?? 'Workspace'
      : row.client_accounts?.name ?? 'Workspace',
  }))
}

export async function canManageTeam(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<boolean> {
  // Owner of the workspace can always manage
  const { data: client } = await supabase
    .from('client_accounts')
    .select('user_id')
    .eq('id', clientId)
    .maybeSingle()

  if (client?.user_id === userId) return true

  // Admins can manage too
  const { data: member } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .maybeSingle()

  return member?.role === 'admin' || member?.role === 'owner'
}

export async function createTeamInvite(
  supabase: SupabaseClient,
  params: {
    clientId: string
    invitedBy: string
    invitedEmail: string
    role: 'admin' | 'member'
  },
): Promise<{ invite: TeamInvite | null; error: string | null }> {
  const { clientId, invitedBy, invitedEmail, role } = params

  // Check if inviter can manage team
  const canManage = await canManageTeam(supabase, invitedBy, clientId)
  if (!canManage) {
    return { invite: null, error: 'You do not have permission to invite team members.' }
  }

  // Check workspace plan limits
  const { data: client } = await supabase
    .from('client_accounts')
    .select('user_id, is_team_workspace')
    .eq('id', clientId)
    .maybeSingle()

  if (!client) return { invite: null, error: 'Workspace not found.' }

  // Get owner's plan
  const { data: ownerProfile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', client.user_id)
    .maybeSingle()

  const plan = (ownerProfile?.plan as string) || 'free'
  const maxMembers = getMaxTeamMembers(plan)

  // Count current members + pending invites
  const { count: memberCount } = await supabase
    .from('workspace_members')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if ((memberCount ?? 0) >= maxMembers) {
    return { invite: null, error: `Team limit reached. Upgrade to add more members.` }
  }

  // Check if already invited or member
  const { data: existing } = await supabase
    .from('workspace_members')
    .select('id, accepted_at')
    .eq('client_id', clientId)
    .eq('invited_email', invitedEmail.toLowerCase())
    .maybeSingle()

  if (existing) {
    if (existing.accepted_at) {
      return { invite: null, error: 'This person is already a team member.' }
    }
    return { invite: null, error: 'An invite is already pending for this email.' }
  }

  // Create workspace member record (pending)
  const { data: member, error: memberError } = await supabase
    .from('workspace_members')
    .insert({
      client_id: clientId,
      invited_by: invitedBy,
      invited_email: invitedEmail.toLowerCase(),
      role,
    })
    .select('id')
    .single()

  if (memberError || !member) {
    return { invite: null, error: memberError?.message ?? 'Failed to create invite.' }
  }

  // Create invite token
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()

  const { data: invite, error: inviteError } = await supabase
    .from('workspace_invite_tokens')
    .insert({
      token,
      client_id: clientId,
      invited_email: invitedEmail.toLowerCase(),
      invited_by: invitedBy,
      role,
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (inviteError || !invite) {
    return { invite: null, error: inviteError?.message ?? 'Failed to create invite token.' }
  }

  return { invite: invite as TeamInvite, error: null }
}

export async function acceptTeamInvite(
  supabase: SupabaseClient,
  params: {
    userId: string
    userEmail: string
    token: string
  },
): Promise<{ success: boolean; error: string | null; clientId?: string }> {
  const { userId, userEmail, token } = params

  // Find valid invite token
  const { data: invite, error: inviteError } = await supabase
    .from('workspace_invite_tokens')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle()

  if (inviteError || !invite) {
    return { success: false, error: 'Invalid or expired invite link.' }
  }

  // Verify email matches (case insensitive)
  if (invite.invited_email.toLowerCase() !== userEmail.toLowerCase()) {
    return { success: false, error: 'This invite was sent to a different email address.' }
  }

  // Mark invite as used
  await supabase
    .from('workspace_invite_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Update workspace member record
  const { error: updateError } = await supabase
    .from('workspace_members')
    .update({
      user_id: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq('client_id', invite.client_id)
    .eq('invited_email', invite.invited_email.toLowerCase())
    .is('accepted_at', null)

  if (updateError) {
    return { success: false, error: updateError.message }
  }

  // Set user's active workspace to the invited one
  await supabase
    .from('user_profiles')
    .update({ active_client_id: invite.client_id })
    .eq('user_id', userId)

  // Log activity
  await logWorkspaceActivity(supabase, {
    clientId: invite.client_id,
    userId,
    actionType: 'member_joined',
    metadata: { invited_email: invite.invited_email, role: invite.role },
  })

  return { success: true, error: null, clientId: invite.client_id }
}

export async function removeTeamMember(
  supabase: SupabaseClient,
  params: {
    requestedBy: string
    clientId: string
    memberId: string
  },
): Promise<{ success: boolean; error: string | null }> {
  const { requestedBy, clientId, memberId } = params

  const canManage = await canManageTeam(supabase, requestedBy, clientId)
  if (!canManage) {
    return { success: false, error: 'You do not have permission to remove team members.' }
  }

  // Cannot remove the workspace owner
  const { data: member } = await supabase
    .from('workspace_members')
    .select('user_id, role, invited_email')
    .eq('id', memberId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!member) return { success: false, error: 'Member not found.' }

  const { data: client } = await supabase
    .from('client_accounts')
    .select('user_id')
    .eq('id', clientId)
    .maybeSingle()

  if (member.user_id === client?.user_id) {
    return { success: false, error: 'Cannot remove the workspace owner.' }
  }

  // Delete member
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('id', memberId)
    .eq('client_id', clientId)

  if (error) {
    return { success: false, error: error.message }
  }

  await logWorkspaceActivity(supabase, {
    clientId,
    userId: requestedBy,
    actionType: 'member_removed',
    metadata: { removed_email: member.invited_email, removed_by: requestedBy },
  })

  return { success: true, error: null }
}

export async function logWorkspaceActivity(
  supabase: SupabaseClient,
  params: {
    clientId: string
    userId: string | null
    actionType: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await supabase.from('workspace_activity').insert({
      client_id: params.clientId,
      user_id: params.userId,
      action_type: params.actionType,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? {},
    })
  } catch (error) {
    console.error('[team] logWorkspaceActivity error:', error)
  }
}

export async function getWorkspaceActivity(
  supabase: SupabaseClient,
  clientId: string,
  limit = 50,
): Promise<WorkspaceActivity[]> {
  const { data, error } = await supabase
    .from('workspace_activity')
    .select('id, client_id, user_id, action_type, entity_type, entity_id, metadata, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[team] getWorkspaceActivity error:', error.message)
    return []
  }

  const activities = (data ?? []) as WorkspaceActivity[]

  // Fetch user names
  const userIds = [...new Set(activities.filter(a => a.user_id).map(a => a.user_id!))]
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, company_name')
      .in('user_id', userIds)

    const nameById = new Map((profiles ?? []).map((p: { user_id: string; company_name: string }) => [p.user_id, p.company_name]))
    for (const activity of activities) {
      if (activity.user_id) {
        activity.user_name = nameById.get(activity.user_id) || 'Team member'
      }
    }
  }

  return activities
}

export async function assignLead(
  supabase: SupabaseClient,
  params: {
    leadId: string
    assignedUserId: string | null
    assignedBy: string
  },
): Promise<{ success: boolean; error: string | null }> {
  const { leadId, assignedUserId, assignedBy } = params

  // Verify the assigner has access to this lead
  const { data: lead } = await supabase
    .from('leads')
    .select('client_id, user_id')
    .eq('id', leadId)
    .maybeSingle()

  if (!lead) return { success: false, error: 'Lead not found.' }

  const canManage = await canManageTeam(supabase, assignedBy, lead.client_id as string)
  if (!canManage && lead.user_id !== assignedBy) {
    return { success: false, error: 'You do not have permission to assign this lead.' }
  }

  const { error } = await supabase
    .from('leads')
    .update({
      assigned_user_id: assignedUserId,
      assigned_at: assignedUserId ? new Date().toISOString() : null,
    })
    .eq('id', leadId)

  if (error) {
    return { success: false, error: error.message }
  }

  await logWorkspaceActivity(supabase, {
    clientId: lead.client_id as string,
    userId: assignedBy,
    actionType: 'lead_assigned',
    entityType: 'lead',
    entityId: leadId,
    metadata: { assigned_user_id: assignedUserId },
  })

  return { success: true, error: null }
}
