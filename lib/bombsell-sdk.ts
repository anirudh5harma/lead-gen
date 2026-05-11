/**
 * Bombsell Agent SDK — TypeScript client for AI agents to consume
 * Bombsell GTM infrastructure. Works in Node.js, Deno, and edge runtimes.
 *
 * @example
 * ```ts
 * import { Bombsell } from './bombsell-sdk'
 *
 * const bombsell = new Bombsell({ apiKey: 'bsk_agt_...' })
 *
 * // Consume individual agents
 * const signals = await bombsell.signal.poll()
 * const enriched = await bombsell.enrich.contacts({ targetCompany: 'Acme Corp' })
 *
 * // Run multi-agent workflows
 * const result = await bombsell.workflows.run('full-funnel')
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BombsellConfig {
  baseUrl?: string       // default: 'https://bombsell.com'
  apiKey?: string        // Agent API key (bsk_agt_...)
  sessionToken?: string  // Supabase session token (browser-only)
  timeout?: number       // request timeout in ms, default: 30000
}

export interface AgentProfile {
  id: string; name: string; role: string; description: string
  version: { semver: string; commit: string; deployedAt: string }
  health: { status: string; lastHeartbeat: string | null; consecutiveFailures: number; avgLatencyMs: number | null }
  capabilities: string[]
  configSchema: Record<string, unknown> | null
}

export interface ToolDef {
  tool: string; description: string; cost: number
}

export interface TaskResult {
  taskId: string; traceId: string; status: string
  result?: Record<string, unknown>; error?: string
  creditsConsumed: number; latencyMs: number
}

export interface WorkflowDef {
  name: string; displayName: string; description: string
  steps: Array<{ order: number; role: string; tool: string; description: string }>
  estimatedCredits: number; estimatedLatencyMs: number
}

export interface EnrichedContacts {
  contactCount: number
  contacts: Array<{ name?: string; title?: string; email?: string; verified?: boolean }>
}

export interface ScoredCandidate {
  company_name: string; signal_type: string; source_name: string
  score: number; summary?: string
}

export interface ReplyIntent {
  intent: 'positive' | 'negative' | 'neutral' | 'booking' | 'unsubscribe' | 'out_of_office'
  summary: string
}

export interface DraftEval {
  score: number; checks: unknown[]; failed: unknown[]; version: string
}

export interface SafetyDecision {
  decision: string; reasons: string[]
}

export interface AgentQualityScore {
  agentId: string; role: string; tasksCompleted: number; tasksFailed: number
  avgQualityScore: number; avgLatencyMs: number; improvementVelocity: number
  lastEvalAt: string | null
}

// ─── Client ────────────────────────────────────────────────────────────────────

export class Bombsell {
  private baseUrl: string
  private headers: Record<string, string>
  private timeout: number

  constructor(config: BombsellConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://bombsell.com'
    this.timeout = config.timeout ?? 30000
    this.headers = { 'Content-Type': 'application/json' }

    if (config.apiKey) {
      this.headers['Authorization'] = `Bearer ${config.apiKey}`
    } else if (config.sessionToken) {
      this.headers['Authorization'] = `Bearer ${config.sessionToken}`
    }
  }

  // ── Low-level dispatch ───────────────────────────────────────────────────

  /** Dispatch a raw tool to any agent by role. Returns full TaskResult. */
  async dispatch(role: string, tool: string, args: Record<string, unknown> = {}): Promise<TaskResult> {
    const res = await this.fetch('/api/agents/' + role + '/dispatch', {
      method: 'POST',
      body: JSON.stringify({ tool, arguments: args }),
    })
    return res.json() as Promise<TaskResult>
  }

  /** List all registered agents with health status */
  async listAgents(): Promise<AgentProfile[]> {
    const res = await this.fetch('/api/a2a/agents')
    const data = await res.json() as { agents: AgentProfile[] }
    return data.agents ?? []
  }

  /** Get a specific agent's profile and tools */
  async getAgent(role: string): Promise<{ agent: AgentProfile; tools: ToolDef[] }> {
    const res = await this.fetch('/api/agents/' + role)
    if (!res.ok) throw new Error(`Agent not found: ${role}`)
    return res.json() as Promise<{ agent: AgentProfile; tools: ToolDef[] }>
  }

  /** Get per-agent quality scores from self-improvement engine */
  async agentQuality(): Promise<AgentQualityScore[]> {
    try {
      // Try via operator agent first
      const res = await this.dispatch('operator', 'bombsell.operator.status', {})
      return (res.result?.agents as AgentQualityScore[]) ?? []
    } catch {
      return []
    }
  }

  // ── Agent-specific methods ───────────────────────────────────────────────

  signal = {
    poll: () => this.dispatch('signal', 'bombsell.signal.poll'),
    ingest: (source: string, opts?: { sourceType?: string; url?: string; category?: string }) =>
      this.dispatch('signal', 'bombsell.signal.ingest', { source, ...opts }),
  }

  match = {
    candidates: () => this.dispatch('match', 'bombsell.match.candidates'),
    rank: (candidates: Array<{ company_name: string; signal_type: string; source_name: string; summary?: string }>) =>
      this.dispatch('match', 'bombsell.match.rank', { candidates }) as Promise<TaskResult>,
  }

  enrich = {
    contacts: (targetCompany: string, companyDomain?: string) =>
      this.dispatch('enrich', 'bombsell.enrich.contacts', { targetCompany, companyDomain }) as Promise<TaskResult>,
    verify: (emails: string[]) =>
      this.dispatch('enrich', 'bombsell.enrich.verify', { emails }),
  }

  outreach = {
    draft: (leadId: string) => this.dispatch('outreach', 'bombsell.outreach.draft', { leadId }),
    send: (leadId: string) => this.dispatch('outreach', 'bombsell.outreach.send', { leadId }),
    evaluate: (opts: { subject: string; body: string; greeting: string; targetCompany: string; signalType?: string; signalSummary?: string }) =>
      this.dispatch('outreach', 'bombsell.outreach.eval_draft', opts) as Promise<TaskResult>,
  }

  safety = {
    check: (leadId: string) =>
      this.dispatch('safety', 'bombsell.safety.check', { leadId }) as Promise<TaskResult>,
    simulate: (leadId: string, message: string) =>
      this.dispatch('safety', 'bombsell.safety.simulate', { leadId, message }),
  }

  reply = {
    classify: (subject: string, text: string) =>
      this.dispatch('reply', 'bombsell.reply.classify', { subject, text }) as Promise<TaskResult>,
  }

  followup = {
    schedule: (leadId: string, spacingDays?: number[]) =>
      this.dispatch('followup', 'bombsell.followup.schedule', { leadId, spacingDays }),
  }

  insight = {
    list: (limit?: number) => this.dispatch('insight', 'bombsell.insight.list', { limit }),
  }

  crm = {
    sync: (leadId: string, status: string) =>
      this.dispatch('crm', 'bombsell.crm.sync', { leadId, status }),
  }

  // ── Content engine (LinkedIn / X) ────────────────────────────────────────

  ideas = {
    generate: (opts?: { count?: number; platform?: 'linkedin' | 'x' | 'both'; topic?: string }) =>
      this.dispatch('idea', 'bombsell.idea.generate', opts ?? {}) as Promise<TaskResult>,
    list: (opts?: { limit?: number; status?: string }) =>
      this.dispatch('idea', 'bombsell.idea.list', opts ?? {}) as Promise<TaskResult>,
  }

  content = {
    write: (ideaId: string, platform?: 'linkedin' | 'x') =>
      this.dispatch('writer', 'bombsell.content.write', { ideaId, platform }) as Promise<TaskResult>,
    thread: (postId: string) =>
      this.dispatch('writer', 'bombsell.content.thread', { postId }) as Promise<TaskResult>,
    edit: (postId: string) =>
      this.dispatch('editor', 'bombsell.content.edit', { postId }) as Promise<TaskResult>,
    schedule: (postId: string, scheduledAt: string) =>
      this.dispatch('publisher', 'bombsell.content.schedule', { postId, scheduledAt }) as Promise<TaskResult>,
    publish: (postId: string) =>
      this.dispatch('publisher', 'bombsell.content.publish', { postId }) as Promise<TaskResult>,
    metrics: (opts?: { postId?: string; limit?: number }) =>
      this.dispatch('engagement', 'bombsell.content.metrics', opts ?? {}) as Promise<TaskResult>,
    repurpose: (postId?: string) =>
      this.dispatch('repurpose', 'bombsell.content.repurpose', { postId }) as Promise<TaskResult>,
  }

  // ── Workflows ────────────────────────────────────────────────────────────

  workflows = {
    /** List all available multi-agent workflows */
    list: async (): Promise<WorkflowDef[]> => {
      const res = await this.fetch('/api/a2a/workflows')
      const data = await res.json() as { workflows: WorkflowDef[] }
      return data.workflows ?? []
    },

    /** Run a multi-agent workflow (full-funnel, signal-to-insight, etc.) */
    run: (workflow: string, context?: { leadId?: string; companyName?: string; companyDomain?: string }): Promise<TaskResult> =>
      this.dispatch('operator', 'bombsell.operator.orchestrate', { workflow, context }),
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(this.baseUrl + path, {
        ...init,
        headers: { ...this.headers, ...(init?.headers as Record<string, string> ?? {}) },
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
        throw new Error(err.error ?? `Bombsell API error: ${res.status}`)
      }

      return res
    } finally {
      clearTimeout(timer)
    }
  }
}

export default Bombsell
