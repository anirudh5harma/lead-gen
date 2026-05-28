/**
 * Per-agent profile and catalog endpoint.
 *
 * GET  /api/agents/:role  — Returns agent profile, capabilities, version, health,
 *                           config schema, and available tools with costs.
 * Unknown roles return 404 with a list of valid roles.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureBootstrapped, getAgentByRole } from '@/lib/agents/core/registry'
import type { AgentRole } from '@/lib/agents/protocol/types'
import { authenticateAgent } from '@/lib/a2a/agent-auth'

// ─── Tool catalog ─────────────────────────────────────────────────────────

const ROLE_TOOLS: Record<AgentRole, Array<{ tool: string; description: string }>> = {
  signal: [
    { tool: 'bombsell.signal.poll', description: 'Poll for new buying signals from configured sources' },
    { tool: 'bombsell.signal.ingest', description: 'Ingest a single signal from a specific GTM source' },
  ],
  match: [
    { tool: 'bombsell.match.candidates', description: 'Run candidate matching against recent signals' },
    { tool: 'bombsell.match.rank', description: 'Rank candidates against ICP scoring and adaptive weights' },
  ],
  enrich: [
    { tool: 'bombsell.enrich.contacts', description: 'Enrich a target company with verified contact emails' },
    { tool: 'bombsell.enrich.verify', description: 'Verify a batch of email addresses via SMTP' },
  ],
  outreach: [
    { tool: 'bombsell.outreach.draft', description: 'Draft a personalized outreach message for a lead' },
    { tool: 'bombsell.outreach.send', description: 'Send outreach email via a connected sending account' },
    { tool: 'bombsell.outreach.eval_draft', description: 'Evaluate outreach draft quality and return scores' },
  ],
  safety: [
    { tool: 'bombsell.safety.check', description: 'Run full outbound policy check on a lead' },
    { tool: 'bombsell.safety.simulate', description: 'Simulate policy check with a draft message' },
  ],
  reply: [
    { tool: 'bombsell.reply.classify', description: 'Classify inbound reply intent (positive/negative/question/ooo)' },
  ],
  booking: [
    { tool: 'bombsell.booking.send_link', description: 'Send a Calendly / booking link to a positive-intent lead' },
    { tool: 'bombsell.booking.track_outcome', description: 'Record a meeting outcome (booked / rescheduled / no-show)' },
  ],
  followup: [
    { tool: 'bombsell.followup.schedule', description: 'Schedule a follow-up sequence for a lead' },
  ],
  insight: [
    { tool: 'bombsell.insight.list', description: 'List generated GTM insights and recommendations' },
    { tool: 'bombsell.insight.generate', description: 'Trigger insight generation for the current workspace' },
  ],
  crm: [
    { tool: 'bombsell.crm.sync', description: 'Sync a lead status change to the connected CRM' },
  ],
  operator: [
    { tool: 'bombsell.operator.orchestrate', description: 'Execute a named pipeline across multiple agents' },
  ],
  // ── Content engine ──
  idea: [
    { tool: 'bombsell.idea.generate', description: 'Generate scored content ideas from signals & trends' },
    { tool: 'bombsell.idea.list', description: 'List pending content ideas' },
  ],
  writer: [
    { tool: 'bombsell.content.write', description: 'Draft a post per platform from an idea' },
    { tool: 'bombsell.content.thread', description: 'Expand a post into a thread' },
  ],
  editor: [
    { tool: 'bombsell.content.edit', description: 'Brand-voice & format pass on a draft' },
  ],
  publisher: [
    { tool: 'bombsell.content.schedule', description: 'Schedule a post via the connected posting partner' },
    { tool: 'bombsell.content.publish', description: 'Publish a post now' },
  ],
  engagement: [
    { tool: 'bombsell.content.metrics', description: 'Collect engagement metrics and attribute outcomes' },
  ],
  repurpose: [
    { tool: 'bombsell.content.repurpose', description: 'Repurpose a winning post into variants' },
  ],
}

const VALID_ROLES: AgentRole[] = [
  'signal', 'match', 'enrich', 'outreach', 'safety',
  'reply', 'booking', 'followup', 'insight', 'crm', 'operator',
  'idea', 'writer', 'editor', 'publisher', 'engagement', 'repurpose',
]

// ─── Auth helpers ─────────────────────────────────────────────────────────

function agentKey(request: Request): string | null {
  return request.headers.get('x-agent-key') ?? null
}

async function authenticate(request: Request) {
  const key = agentKey(request)
  if (key === process.env.AGENT_API_SECRET) {
    return { type: 'agent' as const, userId: 'agent-system' }
  }
  if (request.headers.get('authorization')?.startsWith('Bearer bsk_agt_')) {
    const agent = await authenticateAgent(request)
    if (agent instanceof NextResponse) return agent
    return { type: 'agent' as const, userId: agent.userId }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { type: 'user' as const, userId: user.id }
}

// ─── GET /api/agents/:role ────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ role: string }> },
) {
  const role = (await params).role as AgentRole

  // Unknown role → 404 with available roles
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Unknown agent role: "${role}"`, availableRoles: VALID_ROLES },
      { status: 404 },
    )
  }

  const auth = await authenticate(request)
  if (auth instanceof NextResponse) return auth
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  ensureBootstrapped()

  const agent = getAgentByRole(role)
  if (!agent) {
    return NextResponse.json(
      { error: `Agent "${role}" not found in registry`, availableRoles: VALID_ROLES },
      { status: 404 },
    )
  }

  // Resolve tool costs from the DB cost catalog (best-effort)
  const supabase = await createClient()
  const toolsWithCosts = await resolveToolCosts(supabase, role)

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      version: agent.version,
      health: agent.health,
      capabilities: agent.capabilities,
      configSchema: agent.configSchema,
    },
    tools: toolsWithCosts,
    timestamp: new Date().toISOString(),
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function resolveToolCosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: AgentRole,
): Promise<Array<{ tool: string; description: string; cost: number }>> {
  const defs = ROLE_TOOLS[role] ?? []
  if (defs.length === 0) return []

  const toolNames = defs.map(d => d.tool)
  const costMap = new Map<string, number>()

  // Try to load costs from agent_cost_catalog
  try {
    const { data } = await supabase
      .from('agent_cost_catalog')
      .select('action, credit_cost')
      .in('action', toolNames)

    if (data) {
      for (const row of data) {
        costMap.set(row.action, Number(row.credit_cost))
      }
    }
  } catch {
    // Fall through — use defaults
  }

  return defs.map(d => ({
    tool: d.tool,
    description: d.description,
    cost: costMap.get(d.tool) ?? 0,
  }))
}
