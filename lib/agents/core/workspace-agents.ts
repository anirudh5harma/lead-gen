/**
 * Workspace agent config — per-workspace enable/autonomy/config for every agent.
 * The registry (registry.ts) is the capability *catalog*; this is the *instance*
 * layer. If a workspace has no rows yet, sensible defaults are returned so the
 * system behaves exactly as before the v2 migration.
 *
 * See PLAN.md §3.1 / §3.3.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentRole } from '../protocol/types'
import {
  AGENT_ENGINE, ADDON_ROLES, type Engine, type Autonomy,
  ENGINE_PIPELINES,
} from './engines'
import { SYSTEM_AGENTS } from './registry'

export interface WorkspaceAgentConfig {
  role: AgentRole
  engine: Engine
  enabled: boolean
  autonomy: Autonomy
  config: Record<string, unknown>
}

export type WorkspaceAgentMap = Map<AgentRole, WorkspaceAgentConfig>

/** Workspace key — a team workspace (client_accounts.id) when present, else the user id. */
export function resolveWorkspaceId(userId: string, clientId: string | null): string {
  return clientId ?? userId
}

/** Default config for a role when no DB row exists. */
function defaultConfigFor(role: AgentRole): WorkspaceAgentConfig {
  return {
    role,
    engine: AGENT_ENGINE[role],
    // add-ons (insight/crm/repurpose/engagement) are off until explicitly enabled
    enabled: !ADDON_ROLES.has(role),
    autonomy: 'approve_first',
    config: {},
  }
}

/** Full default map across every known system agent role. */
export function defaultWorkspaceAgentMap(): WorkspaceAgentMap {
  const m: WorkspaceAgentMap = new Map()
  for (const def of SYSTEM_AGENTS) {
    m.set(def.role, defaultConfigFor(def.role))
  }
  return m
}

/** Load a workspace's agent config, falling back to defaults for any missing role. */
export async function loadWorkspaceAgents(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceAgentMap> {
  const map = defaultWorkspaceAgentMap()
  const { data, error } = await supabase
    .from('workspace_agents')
    .select('agent_role, engine, enabled, autonomy, config')
    .eq('workspace_id', workspaceId)
  if (error || !data) return map
  for (const row of data) {
    const role = row.agent_role as AgentRole
    map.set(role, {
      role,
      engine: (row.engine as Engine) ?? AGENT_ENGINE[role] ?? 'shared',
      enabled: row.enabled !== false,
      autonomy: (row.autonomy as Autonomy) ?? 'approve_first',
      config: (row.config as Record<string, unknown>) ?? {},
    })
  }
  return map
}

export function isAgentEnabled(map: WorkspaceAgentMap, role: AgentRole): boolean {
  return map.get(role)?.enabled ?? !ADDON_ROLES.has(role)
}

export function getAutonomy(map: WorkspaceAgentMap, role: AgentRole): Autonomy {
  return map.get(role)?.autonomy ?? 'approve_first'
}

export function getAgentConfig(map: WorkspaceAgentMap, role: AgentRole): Record<string, unknown> {
  return map.get(role)?.config ?? {}
}

/**
 * Seed `workspace_agents` rows for the given engines. Idempotent — uses upsert
 * on (workspace_id, agent_role) and never downgrades an existing row.
 */
export async function seedWorkspaceAgents(
  supabase: SupabaseClient,
  opts: { workspaceId: string; userId: string; engines: Array<Exclude<Engine, 'shared'>> },
): Promise<void> {
  const roles = new Set<AgentRole>()
  for (const engine of opts.engines) {
    for (const step of ENGINE_PIPELINES[engine]) roles.add(step.role)
  }
  // always include the operator (pipeline runner)
  roles.add('operator')

  const { data: existing } = await supabase
    .from('workspace_agents')
    .select('agent_role')
    .eq('workspace_id', opts.workspaceId)
  const have = new Set((existing ?? []).map((r) => r.agent_role as string))

  const rows = [...roles]
    .filter((role) => !have.has(role))
    .map((role) => ({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      agent_role: role,
      engine: AGENT_ENGINE[role],
      enabled: !ADDON_ROLES.has(role),
      autonomy: 'approve_first' as Autonomy,
      config: {},
    }))
  if (rows.length === 0) return
  await supabase.from('workspace_agents').upsert(rows, { onConflict: 'workspace_id,agent_role' })
}

/** Update one workspace agent (enable/disable, autonomy, or config merge). */
export async function updateWorkspaceAgent(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string
    userId: string
    role: AgentRole
    patch: Partial<Pick<WorkspaceAgentConfig, 'enabled' | 'autonomy'>> & { config?: Record<string, unknown> }
  },
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof opts.patch.enabled === 'boolean') update.enabled = opts.patch.enabled
  if (opts.patch.autonomy) update.autonomy = opts.patch.autonomy
  if (opts.patch.config) update.config = opts.patch.config

  // upsert so a row is created on first edit even if the workspace was never seeded
  await supabase.from('workspace_agents').upsert(
    {
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      agent_role: opts.role,
      engine: AGENT_ENGINE[opts.role],
      ...update,
    },
    { onConflict: 'workspace_id,agent_role' },
  )
}
