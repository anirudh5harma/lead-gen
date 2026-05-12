/**
 * Engines — the two end-to-end products users can set up, expressed as
 * ordered chains of agent roles. Every agent is still independently runnable;
 * an "engine" is just a default pipeline + the set of agents it draws from.
 *
 * See PLAN.md §1–§3.
 */
import type { AgentRole } from '../protocol/types'

export type Engine = 'outbound' | 'content' | 'shared'

/** How much agency the workspace gives an agent. */
export type Autonomy = 'research_only' | 'approve_first' | 'autopilot'

export const AUTONOMY_VALUES: readonly Autonomy[] = ['research_only', 'approve_first', 'autopilot'] as const

/** Which engine each agent role belongs to. `shared`/add-on agents work in both. */
export const AGENT_ENGINE: Record<AgentRole, Engine> = {
  // outbound
  signal: 'outbound',
  match: 'outbound',
  enrich: 'outbound',
  outreach: 'outbound',
  safety: 'outbound',
  reply: 'outbound',
  booking: 'outbound',
  followup: 'outbound',
  // content
  idea: 'content',
  writer: 'content',
  editor: 'content',
  publisher: 'content',
  engagement: 'content',
  repurpose: 'content',
  // shared / add-ons / control
  insight: 'shared',
  crm: 'shared',
  operator: 'shared',
}

/** Roles that *act on the outside world* — if an agent is `approve_first`,
 *  the pipeline stops before this step and waits for human approval; if
 *  `research_only`, the step is skipped entirely. */
export const ACTING_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>([
  'outreach',   // send
  'booking',    // sends a link
  'followup',   // schedules real sends
  'publisher',  // publishes a post
  'crm',        // writes to an external system
])

/** Add-on roles that are off by default and gated (e.g. CRM = Team plan). */
export const ADDON_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>(['insight', 'crm', 'repurpose', 'engagement'])

export interface PipelineStep {
  order: number
  role: AgentRole
  tool: string
  description: string
  required?: boolean   // if true and the agent is disabled → block the run with an explanation
  acting?: boolean     // step touches the outside world (send / publish / book) → autonomy mode applies to *this step*
}

/** Canonical Outbound pipeline. */
export const OUTBOUND_PIPELINE: PipelineStep[] = [
  { order: 1, role: 'signal',   tool: 'bombsell.signal.poll',         description: 'Ingest new buying signals', required: true },
  { order: 2, role: 'match',    tool: 'bombsell.match.rank',          description: 'Rank accounts against ICP', required: true },
  { order: 3, role: 'enrich',   tool: 'bombsell.enrich.contacts',     description: 'Find & verify contacts', required: true },
  { order: 4, role: 'safety',   tool: 'bombsell.safety.check',        description: 'Deliverability & compliance check', required: true },
  { order: 5, role: 'outreach', tool: 'bombsell.outreach.draft',      description: 'Draft personalized outreach' },
  { order: 6, role: 'outreach', tool: 'bombsell.outreach.send',       description: 'Send approved outreach', acting: true },
  { order: 7, role: 'reply',    tool: 'bombsell.reply.classify',      description: 'Classify inbound reply intent' },
  { order: 8, role: 'booking',  tool: 'bombsell.booking.send_link',   description: 'Send booking link on positive intent', acting: true },
  { order: 9, role: 'followup', tool: 'bombsell.followup.schedule',   description: 'Schedule follow-up sequence', acting: true },
]

/** Canonical Content pipeline (LinkedIn / X). */
export const CONTENT_PIPELINE: PipelineStep[] = [
  { order: 1, role: 'idea',       tool: 'bombsell.idea.generate',       description: 'Generate content angles from signals & trends', required: true },
  { order: 2, role: 'writer',     tool: 'bombsell.content.write',       description: 'Draft a post per platform', required: true },
  { order: 3, role: 'editor',     tool: 'bombsell.content.edit',        description: 'Brand-voice & format pass' },
  { order: 4, role: 'publisher',  tool: 'bombsell.content.schedule',    description: 'Schedule / publish via posting partner', acting: true },
  { order: 5, role: 'engagement', tool: 'bombsell.content.metrics',     description: 'Collect engagement & attribute outcomes' },
  { order: 6, role: 'repurpose',  tool: 'bombsell.content.repurpose',   description: 'Repurpose top posts into variants' },
]

export const ENGINE_PIPELINES: Record<Exclude<Engine, 'shared'>, PipelineStep[]> = {
  outbound: OUTBOUND_PIPELINE,
  content: CONTENT_PIPELINE,
}

/** Roles seeded for a workspace when an engine is enabled (excludes add-ons). */
export function defaultRolesForEngine(engine: Exclude<Engine, 'shared'>): AgentRole[] {
  const roles = new Set<AgentRole>()
  for (const step of ENGINE_PIPELINES[engine]) {
    if (!ADDON_ROLES.has(step.role)) roles.add(step.role)
  }
  return [...roles]
}
