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
} from './engines'
import { SYSTEM_AGENTS } from './registry'

export interface WorkspaceAgentConfig {
  role: AgentRole
  engine: Engine
  enabled: boolean
  autonomy: Autonomy
  config: Record<string, unknown>
  health: string | null
  lastRunAt: string | null
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
    enabled: !ADDON_ROLES.has(role),
    autonomy: 'approve_first',
    config: {},
    health: null,
    lastRunAt: null,
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
    .select('agent_role, engine, enabled, autonomy, config, health, last_run_at')
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
      health: (row.health as string) ?? null,
      lastRunAt: (row.last_run_at as string) ?? null,
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
 * Seed `workspace_agents` rows for every known system agent role. Roles that
 * belong to one of the workspace's selected engines (plus all `shared` roles)
 * are enabled by default; everything else is seeded disabled so the row exists
 * but stays dormant until the user opts in via Agents → Stacks. Add-on roles
 * (CRM, insight, repurpose, engagement) remain off until the user enables them
 * explicitly, regardless of engine selection.
 *
 * Idempotent on `(workspace_id, agent_role)` — never downgrades an existing
 * row. Pass `reconcileEnabled: true` to re-align the `enabled` flag of
 * existing rows after a workspace switches engines.
 */
export async function seedWorkspaceAgents(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string
    userId: string
    engines: Array<Exclude<Engine, 'shared'>>
    /**
     * When true, also updates the `enabled` flag of existing rows to match the
     * engine selection. Use this when a workspace changes engines post-seed.
     * Add-on roles are never auto-enabled, and rows the user has explicitly
     * toggled stay untouched as long as they already match what we'd set.
     */
    reconcileEnabled?: boolean
  },
): Promise<void> {
  const selectedEngines = new Set<Engine>(opts.engines)
  selectedEngines.add('shared')

  const desiredEnabled = (role: AgentRole) =>
    !ADDON_ROLES.has(role) && selectedEngines.has(AGENT_ENGINE[role])

  const { data: existing } = await supabase
    .from('workspace_agents')
    .select('agent_role, enabled')
    .eq('workspace_id', opts.workspaceId)
  const existingByRole = new Map(
    (existing ?? []).map((r) => [r.agent_role as AgentRole, { enabled: r.enabled as boolean }]),
  )

  const allRoles: AgentRole[] = (Object.keys(AGENT_ENGINE) as AgentRole[])
  // Touch the operator first so the pipeline runner is always present.
  allRoles.sort((a, b) => (a === 'operator' ? -1 : b === 'operator' ? 1 : 0))

  const inserts: Array<{
    workspace_id: string
    user_id: string
    agent_role: AgentRole
    engine: Engine
    enabled: boolean
    autonomy: Autonomy
    config: Record<string, unknown>
  }> = []

  for (const role of allRoles) {
    if (existingByRole.has(role)) continue
    inserts.push({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      agent_role: role,
      engine: AGENT_ENGINE[role],
      enabled: desiredEnabled(role),
      autonomy: 'approve_first',
      config: {},
    })
  }
  if (inserts.length > 0) {
    await supabase.from('workspace_agents').upsert(inserts, { onConflict: 'workspace_id,agent_role' })
  }

  if (opts.reconcileEnabled) {
    // Flip `enabled` for non-addon roles whose engine selection changed. We
    // intentionally leave add-on roles alone (they require explicit opt-in)
    // and never downgrade a role the user manually disabled when engine is
    // still selected — that lives in the per-row UI.
    for (const role of allRoles) {
      if (ADDON_ROLES.has(role)) continue
      const want = desiredEnabled(role)
      const have = existingByRole.get(role)
      if (have && have.enabled !== want && !want) {
        // engine deselected → turn role off
        await supabase
          .from('workspace_agents')
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq('workspace_id', opts.workspaceId)
          .eq('agent_role', role)
      } else if (have && have.enabled !== want && want) {
        // engine newly selected → turn role on
        await supabase
          .from('workspace_agents')
          .update({ enabled: true, updated_at: new Date().toISOString() })
          .eq('workspace_id', opts.workspaceId)
          .eq('agent_role', role)
      }
    }
  }
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
