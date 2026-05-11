/**
 * Agent Protocol — Core type definitions for all Bombsell agents.
 * Every agent implements this protocol and can be independently consumed.
 */
// ─── Agent Identity ────────────────────────────────────────────────────────────

export type AgentRole =
  // ── Outbound engine ──
  | 'signal'       // Signal ingestion and intelligence
  | 'match'        // ICP matching and candidate ranking
  | 'enrich'       // Contact enrichment and verification
  | 'outreach'     // Draft generation and send execution
  | 'safety'       // Policy and compliance guard
  | 'reply'        // Reply detection and intent classification
  | 'booking'      // Meeting booking and calendar management
  | 'followup'     // Scheduled follow-up orchestration
  // ── Content engine ──
  | 'idea'         // Content idea generation from signals/trends
  | 'writer'       // Post drafting per platform (LinkedIn/X)
  | 'editor'       // Brand-voice editing, format/length rules
  | 'publisher'    // Scheduling and publishing via posting partner
  | 'engagement'   // Engagement tracking and attribution
  | 'repurpose'    // Repurpose winning content into variants
  // ── Shared / add-ons ──
  | 'insight'      // Analytics, insights, and recommendations
  | 'crm'          // CRM sync and memory management (Team plan)
  | 'operator'     // Orchestration supervisor and workflow control

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'degraded' | 'offline'

export interface AgentVersion {
  semver: string   // e.g. "1.2.3"
  commit: string   // git SHA
  deployedAt: string // ISO timestamp
}

export interface AgentHealth {
  status: AgentStatus
  lastHeartbeat: string | null
  consecutiveFailures: number
  avgLatencyMs: number | null
  version: AgentVersion | null
}

export interface AgentProfile {
  id: string
  name: string
  role: AgentRole
  description: string
  version: AgentVersion
  health: AgentHealth
  capabilities: Array<string | AgentCapability>
  apiEndpoint: string | null   // null = internal only
  scopes: string[]             // OAuth scopes this agent requires
  configSchema: Record<string, unknown> | null  // JSON schema for config
}

// ─── Capability Negotiation ─────────────────────────────────────────────────────

/** What an agent can do — advertised via MCP/tools and used for capability routing */
export interface AgentCapability {
  tool: string           // e.g. "bombsell.signal.ingest"
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  creditCost: number
  avgLatencyMs?: number
  rateLimited?: boolean
}

/** Handshake between orchestrator and worker agent */
export interface AgentHandshakeRequest {
  agentId: string
  role: AgentRole
  capabilities: AgentCapability[]
  authToken: string
  workspaceContext: {
    userId: string
    clientId: string | null
    icpKeywords: string[]
    targetIndustries: string[]
    activePlan: string
  }
}

export interface AgentHandshakeResponse {
  accepted: boolean
  agentProfile: AgentProfile
  assignedCapabilities: string[]   // subset of requested that were accepted
  rateLimit: {
    requestsPerMinute: number
    burstSize: number
  }
  creditBalance: number
  sessionId: string   // opaque; used in all subsequent calls
}

// ─── Task Dispatch ──────────────────────────────────────────────────────────────

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type TaskStatus = 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskCallbackMode = 'none' | 'webhook' | 'stream' | 'poll'

export interface AgentTaskInput {
  tool: string
  arguments: Record<string, unknown>
  priority?: TaskPriority
  maxCredits?: number       // hard cap; reject if exceeded
  timeoutMs?: number        // soft timeout; task may self-extend
  callback?: {
    mode: TaskCallbackMode
    url?: string          // for webhook
    pollUrl?: string      // for poll mode
  }
}

export interface AgentTaskOutput {
  taskId: string
  status: TaskStatus
  result?: Record<string, unknown>
  error?: string
  creditsConsumed: number
  latencyMs: number
  traceId: string   // for eval tracing
}

// ─── Self-Improvement Primitives ───────────────────────────────────────────────

export interface AgentMetricSnapshot {
  agentId: string
  role: AgentRole
  timestamp: string
  tasksCompleted: number
  tasksFailed: number
  avgLatencyMs: number
  p95LatencyMs: number | null
  creditCostPerTask: number
  qualityScore: number | null   // from eval traces
  feedbackScore: number | null // from outcomes (replied/booked)
}

export interface AgentFeedback {
  agentId: string
  taskId: string
  traceId: string
  outcome: 'success' | 'partial' | 'failure'
  qualityScore: number       // 0-100
  signalType?: string       // for match agent ranking tuning
  sourceName?: string
  personaType?: string
  errorReason?: string
  metadata?: Record<string, unknown>
}

export interface AgentTuningHint {
  agentId: string
  agentName?: string       // resolved agent name (for DB ops)
  role: AgentRole
  type?: 'signal_weight' | 'source_boost' | 'persona_boost' | 'param_adjust'
  userId?: string
  clientId?: string | null
  signalType?: string       // which signal type to boost/demote
  source?: string           // which source to boost/demote
  sourceBoost?: Record<string, number>  // source → multiplier
  personaBoost?: Record<string, number> // contact title → multiplier
  parameterAdjustment?: Record<string, number | string>
  confidenceThreshold?: number
  newWeight?: number        // computed ICP signal weight
  newPriority?: number      // computed lead priority delta
}

// ─── Internal Agent Communication ─────────────────────────────────────────────

/** Cross-agent message envelope */
export interface AgentMessage {
  id: string
  from: string       // agent role
  to: string         // agent role, or '*' for broadcast
  sessionId: string
  messageType: 'task' | 'result' | 'error' | 'heartbeat' | 'shutdown' | 'config_update'
  payload: Record<string, unknown>
  timestamp: string
  ttlMs: number      // 0 = no expiry
}

/** Supervisor → worker: dispatch task */
export interface WorkerTaskDispatch {
  taskId: string
  sessionId: string
  tool: string
  args: Record<string, unknown>
  priority: TaskPriority
  tracingContext: {
    traceId: string
    parentSpanId?: string
    workflowRunId?: string
  }
}

/** Worker → supervisor: task result */
export interface WorkerTaskResult {
  taskId: string
  traceId: string
  status: 'completed' | 'failed'
  result?: Record<string, unknown>
  error?: string
  creditsConsumed: number
  latencyMs: number
  evalTrace?: {
    status: 'passed' | 'blocked' | 'failed' | 'warning'
    score: number
    reasons?: string[]
  }
}

// ─── Config & Lifecycle ────────────────────────────────────────────────────────

export interface AgentConfigUpdate {
  agentId: string
  role: AgentRole
  patch: Partial<{
    rateLimit: number
    creditBudget: number
    enabledTools: string[]
    customParams: Record<string, unknown>
  }>
}

export interface AgentLifecycleEvent {
  event: 'start' | 'heartbeat' | 'config_changed' | 'health_degraded' | 'health_restored' | 'shutdown'
  agentId: string
  role: AgentRole
  timestamp: string
  payload?: Record<string, unknown>
}
