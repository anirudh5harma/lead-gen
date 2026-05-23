/**
 * Agent Registry — in-memory agent identity store with DB persistence.
 * Tracks all Bombsell agents (both system-internal and external A2A agents).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AgentProfile, AgentHealth, AgentRole, AgentStatus,
  AgentCapability, AgentLifecycleEvent,
} from '../protocol/types'

// In-memory state for fast access; syncs to DB on config changes
const registry = new Map<string, AgentProfile>()
const healthStore = new Map<string, AgentHealth>()

// ─── System agent definitions ─────────────────────────────────────────────────

export const SYSTEM_AGENTS: Array<Omit<AgentProfile, 'id' | 'version' | 'health'>> = [
  {
    name: 'signal-agent',
    role: 'signal',
    description: 'Ingests public buying signals, clusters duplicates, computes novelty.',
    capabilities: [
      { tool: 'bombsell.signal.poll', description: 'Poll all configured signal sources', creditCost: 0.1 },
      { tool: 'bombsell.signal.ingest', description: 'Ingest a raw signal into the pipeline', creditCost: 0.05 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        sources: { type: 'array', items: { type: 'string' } },
        freshnessHours: { type: 'number', default: 48 },
        clusterSimilarityThreshold: { type: 'number', default: 0.85 },
      },
    },
  },
  {
    name: 'match-agent',
    role: 'match',
    description: 'Matches signal candidates against ICP, ranks by adaptive score.',
    capabilities: [
      { tool: 'bombsell.match.candidates', description: 'List top signal candidates', creditCost: 0.1 },
      { tool: 'bombsell.match.rank', description: 'Rank candidates by ICP fit', creditCost: 0.2 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        maxCandidates: { type: 'number', default: 200 },
        recallDepth: { type: 'number', default: 50 },
        scoreThreshold: { type: 'number', default: 0.5 },
      },
    },
  },
  {
    name: 'enrich-agent',
    role: 'enrich',
    description: 'Enriches contacts via multi-provider waterfall, validates emails.',
    capabilities: [
      { tool: 'bombsell.enrich.contacts', description: 'Find contacts for a company', creditCost: 0.5 },
      { tool: 'bombsell.enrich.verify', description: 'Verify email deliverability', creditCost: 0.2 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        providers: { type: 'array', items: { type: 'string' } },
        maxContactsPerCompany: { type: 'number', default: 3 },
        validationStrictness: { type: 'string', enum: ['strict', 'normal', 'relaxed'], default: 'normal' },
      },
    },
  },
  {
    name: 'outreach-agent',
    role: 'outreach',
    description: 'Drafts personalized outreach using signal context, evaluates quality.',
    capabilities: [
      { tool: 'bombsell.outreach.draft', description: 'Draft personalized outreach', creditCost: 0.3 },
      { tool: 'bombsell.outreach.send', description: 'Send approved outreach', creditCost: 0.1 },
      { tool: 'bombsell.outreach.evaluate', description: 'Evaluate draft quality', creditCost: 0.1 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'deepseek' },
        maxDraftsPerLead: { type: 'number', default: 3 },
        qualityThreshold: { type: 'number', default: 70 },
      },
    },
  },
  {
    name: 'safety-agent',
    role: 'safety',
    description: 'Policy guard: validates sends against unsubscribe, blocked companies, rate limits.',
    capabilities: [
      { tool: 'bombsell.safety.check', description: 'Check outbound against policy', creditCost: 0.05 },
      { tool: 'bombsell.safety.simulate', description: 'Simulate policy outcome', creditCost: 0.02 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },
  {
    name: 'reply-agent',
    role: 'reply',
    description: 'Detects inbound replies, classifies intent, routes to booking or followup stop.',
    capabilities: [
      { tool: 'bombsell.reply.classify', description: 'Classify reply intent', creditCost: 0.1 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },
  {
    name: 'booking-agent',
    role: 'booking',
    description: 'Sends calendly/booking links on positive intent, records meeting outcomes.',
    capabilities: [
      { tool: 'bombsell.booking.send_link', description: 'Send booking link', creditCost: 0.05 },
      { tool: 'bombsell.booking.status', description: 'Check booking status', creditCost: 0.02 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        autoSendOnPositive: { type: 'boolean', default: true },
        calendlyUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'followup-agent',
    role: 'followup',
    description: 'Schedules and dispatches follow-up sequences based on reply status.',
    capabilities: [
      { tool: 'bombsell.followup.schedule', description: 'Schedule follow-up sequence', creditCost: 0.1 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        maxFollowups: { type: 'number', default: 4 },
        spacingDays: { type: 'array', items: { type: 'number' } },
      },
    },
  },
  {
    name: 'insight-agent',
    role: 'insight',
    description: 'Generates GTM insights, pipeline analytics, and recommendations.',
    capabilities: [
      { tool: 'bombsell.insight.list', description: 'List recent insights', creditCost: 0.1 },
      { tool: 'bombsell.insight.generate', description: 'Generate new insight', creditCost: 0.3 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },
  {
    name: 'crm-agent',
    role: 'crm',
    description: 'Syncs lead outcomes to external CRM systems, maintains CRM memory.',
    capabilities: [
      { tool: 'bombsell.crm.sync', description: 'Sync lead to CRM', creditCost: 0.1 },
      { tool: 'bombsell.crm.export', description: 'Export pipeline data', creditCost: 0.2 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['hubspot', 'salesforce', 'pipedrive', 'custom'] },
        apiKey: { type: 'string' },
        syncOnStatus: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'operator-agent',
    role: 'operator',
    description: 'Orchestrates all other agents, manages pipeline runs, routes tasks.',
    capabilities: [
      { tool: 'bombsell.operator.orchestrate', description: 'Run a multi-agent pipeline', creditCost: 0.2 },
      { tool: 'bombsell.operator.status', description: 'Check pipeline status', creditCost: 0.02 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },

  // ─── Content engine (LinkedIn / X) ────────────────────────────────────────────
  {
    name: 'idea-agent',
    role: 'idea',
    description: 'Generates content angles from buying signals, trends, and inspiration sources.',
    capabilities: [
      { tool: 'bombsell.idea.generate', description: 'Generate scored content ideas', creditCost: 0.2 },
      { tool: 'bombsell.idea.list', description: 'List pending content ideas', creditCost: 0.05 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        platforms: { type: 'array', items: { type: 'string', enum: ['linkedin', 'x'] } },
        ideasPerCycle: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'writer-agent',
    role: 'writer',
    description: 'Drafts posts per platform — hook, body, CTA — and expands threads.',
    capabilities: [
      { tool: 'bombsell.content.write', description: 'Draft a post from an idea', creditCost: 0.3 },
      { tool: 'bombsell.content.thread', description: 'Expand a post into a thread', creditCost: 0.3 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'deepseek' },
        voice: { type: 'string' },
      },
    },
  },
  {
    name: 'editor-agent',
    role: 'editor',
    description: 'Brand-voice and format pass: tone, length, hashtags, mentions, platform limits.',
    capabilities: [
      { tool: 'bombsell.content.edit', description: 'Edit a draft for brand voice & format', creditCost: 0.1 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        maxHashtags: { type: 'number', default: 3 },
        bannedPhrases: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'publisher-agent',
    role: 'publisher',
    description: 'Schedules and publishes posts via the connected posting partner.',
    capabilities: [
      { tool: 'bombsell.content.schedule', description: 'Schedule a post', creditCost: 0.05 },
      { tool: 'bombsell.content.publish', description: 'Publish a post now', creditCost: 0.05 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: {
      type: 'object',
      properties: {
        partner: { type: 'string', enum: ['typefully', 'buffer', 'ayrshare'] },
        slotsPerWeek: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'engagement-agent',
    role: 'engagement',
    description: 'Pulls impressions/likes/replies/follower delta and attributes outcomes for the reward loop.',
    capabilities: [
      { tool: 'bombsell.content.metrics', description: 'Collect engagement metrics for posts', creditCost: 0.05 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },
  {
    name: 'repurpose-agent',
    role: 'repurpose',
    description: 'Turns top-performing posts into new variants and cross-platform versions.',
    capabilities: [
      { tool: 'bombsell.content.repurpose', description: 'Repurpose a winning post', creditCost: 0.2 },
    ],
    apiEndpoint: null,
    scopes: [],
    configSchema: null,
  },
]

// ─── Registry Operations ───────────────────────────────────────────────────────

export function registerSystemAgent(def: typeof SYSTEM_AGENTS[number]): AgentProfile {
  const health: AgentHealth = {
    status: 'idle',
    lastHeartbeat: new Date().toISOString(),
    consecutiveFailures: 0,
    avgLatencyMs: null,
    version: { semver: '1.0.0', commit: 'init', deployedAt: new Date().toISOString() },
  }
  const profile: AgentProfile = {
    id: def.name,
    name: def.name,
    role: def.role,
    description: def.description,
    version: health.version!,
    health,
    capabilities: def.capabilities,
    apiEndpoint: def.apiEndpoint,
    scopes: def.scopes,
    configSchema: def.configSchema,
  }
  registry.set(def.name, profile)
  healthStore.set(def.name, health)
  return profile
}

export function getAgent(idOrRole: string): AgentProfile | null {
  // Registry is keyed by agent *name* (e.g. "signal-agent"); callers routinely
  // pass a *role* ("signal"). Resolve either form so dispatch/health lookups work.
  return registry.get(idOrRole) ?? getAgentByRole(idOrRole as AgentRole) ?? null
}

export function getAgentByRole(role: AgentRole): AgentProfile | null {
  const agents = Array.from(registry.values())
  for (const p of agents) {
    if (p.role === role) return p
  }
  return null
}

/** Resolve a name-or-role to the registry key (agent name). */
function resolveAgentId(idOrRole: string): string | null {
  if (registry.has(idOrRole)) return idOrRole
  return getAgentByRole(idOrRole as AgentRole)?.id ?? null
}

export function listAgents(): AgentProfile[] {
  return Array.from(registry.values())
}

export function listAgentsByRole(role: AgentRole): AgentProfile[] {
  return Array.from(registry.values()).filter(p => p.role === role)
}

export function updateAgentHealth(agentIdOrRole: string, patch: Partial<AgentHealth>): void {
  const agentId = resolveAgentId(agentIdOrRole)
  if (!agentId) return
  const current = healthStore.get(agentId)
  if (current) {
    healthStore.set(agentId, { ...current, ...patch })
    const profile = registry.get(agentId)
    if (profile) registry.set(agentId, { ...profile, health: healthStore.get(agentId)! })
  }
}

export function updateAgentStatus(agentIdOrRole: string, status: AgentStatus): void {
  updateAgentHealth(agentIdOrRole, { status, lastHeartbeat: new Date().toISOString() })
}

export function updateAgentLatency(agentIdOrRole: string, latencyMs: number): void {
  const agentId = resolveAgentId(agentIdOrRole)
  if (!agentId) return
  const h = healthStore.get(agentId)
  if (h) {
    const prev = h.avgLatencyMs ?? latencyMs
    const n = h.consecutiveFailures > 0 ? 2 : 5  // weight recent history
    updateAgentHealth(agentId, { avgLatencyMs: (prev * (n - 1) + latencyMs) / n })
  }
}

// ─── DB Sync ───────────────────────────────────────────────────────────────────

export async function syncAgentIdentitiesToDb(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
): Promise<void> {
  const agents = Array.from(registry.values())
  for (const agent of agents) {
    const { error } = await supabase.from('agent_identities').upsert({
      user_id: userId,
      client_id: clientId,
      name: agent.name,
      description: agent.description,
      provider: 'bombsell-system',
      principal_email: userId, // placeholder
      metadata: {
        role: agent.role,
        version: agent.version,
        capabilities: (agent.capabilities as Array<AgentCapability | string>).map(c =>
          typeof c === 'string' ? c : c.tool
        ),
      },
      is_active: agent.health.status !== 'offline',
    }, { onConflict: 'user_id,name' })
    if (error && error.code !== '23505') {
      console.error(`[agent-registry] sync failed for ${agent.name}:`, error.message)
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function emitAgentLifecycle(
  supabase: SupabaseClient,
  event: AgentLifecycleEvent,
): Promise<void> {
  const { error } = await supabase.from('agent_events').insert({
    agent_name: event.role,
    event_type: `lifecycle.${event.event}`,
    status: 'completed',
    title: `Agent ${event.event}: ${event.agentId}`,
    metadata: event.payload ?? {},
  })
  if (error) console.error('[agent-registry] lifecycle event failed:', error.message)
}

// Boot all system agents in-memory
export function bootstrapAgents(): void {
  for (const def of SYSTEM_AGENTS) {
    registerSystemAgent(def)
  }
}

// Auto-bootstrap on first import
let bootstrapped = false
export function ensureBootstrapped(): void {
  if (!bootstrapped) {
    bootstrapAgents()
    bootstrapped = true
  }
}
