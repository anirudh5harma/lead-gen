/**
 * Workflow Types — workflow definitions, step results, and run tracking
 * for the Bombsell operator agent orchestration system.
 */
import type { AgentRole, AgentTaskOutput } from '../protocol/types'
import { OUTBOUND_PIPELINE, CONTENT_PIPELINE, type Engine } from './engines'

export type WorkflowName =
  // v2 canonical engine pipelines
  | 'outbound'
  | 'content'
  // legacy presets (still exposed via A2A)
  | 'full-funnel'
  | 'signal-to-insight'
  | 'enrich-and-outreach'
  | 'reply-handling'

export interface WorkflowStep {
  order: number
  role: AgentRole
  tool: string
  description: string
  required?: boolean // if true, workflow fails if this step fails
  acting?: boolean   // step acts on the outside world → autonomy mode gates it
}

export interface WorkflowDefinition {
  name: WorkflowName
  displayName: string
  description: string
  engine: Engine
  steps: WorkflowStep[]
  estimatedCredits: number
  estimatedLatencyMs: number
}

export interface WorkflowRun {
  id: string
  workflowName: WorkflowName
  userId: string
  clientId: string | null
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  steps: WorkflowStepResult[]
  totalCreditsConsumed: number
  totalLatencyMs: number
}

export interface WorkflowStepResult {
  step: number
  role: AgentRole
  tool: string
  status: 'completed' | 'failed' | 'skipped'
  taskOutput?: AgentTaskOutput
  error?: string
  latencyMs: number
  creditsConsumed: number
}

// ─── Workflow Definitions ──────────────────────────────────────────────────────────

const OUTBOUND: WorkflowDefinition = {
  name: 'outbound',
  displayName: 'Outbound Engine',
  description: 'Signal → account match → enrich → safety → draft → send → reply → book / follow-up. Steps run only for agents the workspace has enabled.',
  engine: 'outbound',
  steps: OUTBOUND_PIPELINE,
  estimatedCredits: 3.5,
  estimatedLatencyMs: 60000,
}

const CONTENT: WorkflowDefinition = {
  name: 'content',
  displayName: 'Content Engine',
  description: 'Idea → write → edit → schedule → publish → learn (LinkedIn / X). Steps run only for agents the workspace has enabled.',
  engine: 'content',
  steps: CONTENT_PIPELINE,
  estimatedCredits: 1.5,
  estimatedLatencyMs: 30000,
}

const FULL_FUNNEL: WorkflowDefinition = {
  name: 'full-funnel',
  displayName: 'Full Funnel',
  description: 'End-to-end lead generation: poll signals → match → enrich → safety check → send outreach',
  engine: 'outbound',
  steps: [
    { order: 1, role: 'signal', tool: 'bombsell.signal.poll', description: 'Poll for new buying signals', required: true },
    { order: 2, role: 'match', tool: 'bombsell.match.rank', description: 'Rank candidates against ICP', required: true },
    { order: 3, role: 'enrich', tool: 'bombsell.enrich.contacts', description: 'Enrich with verified contacts', required: true },
    { order: 4, role: 'safety', tool: 'bombsell.safety.check', description: 'Compliance and safety check', required: true },
    { order: 5, role: 'outreach', tool: 'bombsell.outreach.send', description: 'Send personalized outreach', required: false, acting: true },
  ],
  estimatedCredits: 3.0,
  estimatedLatencyMs: 45000,
}

const SIGNAL_TO_INSIGHT: WorkflowDefinition = {
  name: 'signal-to-insight',
  displayName: 'Signal to Insight',
  description: 'Poll signals, rank matches, and generate actionable insights',
  engine: 'outbound',
  steps: [
    { order: 1, role: 'signal', tool: 'bombsell.signal.poll', description: 'Poll for new buying signals', required: true },
    { order: 2, role: 'match', tool: 'bombsell.match.rank', description: 'Rank candidates against ICP', required: true },
    { order: 3, role: 'insight', tool: 'bombsell.insight.list', description: 'List GTM insights and recommendations', required: false },
  ],
  estimatedCredits: 1.5,
  estimatedLatencyMs: 25000,
}

const ENRICH_AND_OUTREACH: WorkflowDefinition = {
  name: 'enrich-and-outreach',
  displayName: 'Enrich & Outreach',
  description: 'Enrich contacts, run safety check, and draft outreach messages',
  engine: 'outbound',
  steps: [
    { order: 1, role: 'enrich', tool: 'bombsell.enrich.contacts', description: 'Enrich with verified contacts', required: true },
    { order: 2, role: 'safety', tool: 'bombsell.safety.check', description: 'Compliance and safety check', required: true },
    { order: 3, role: 'outreach', tool: 'bombsell.outreach.draft', description: 'Draft personalized outreach', required: false },
  ],
  estimatedCredits: 2.0,
  estimatedLatencyMs: 30000,
}

const REPLY_HANDLING: WorkflowDefinition = {
  name: 'reply-handling',
  displayName: 'Reply Handling',
  description: 'Classify inbound reply intent and schedule appropriate follow-ups',
  engine: 'outbound',
  steps: [
    { order: 1, role: 'reply', tool: 'bombsell.reply.classify', description: 'Classify reply intent (positive/negative/question/ooo)', required: true },
    { order: 2, role: 'followup', tool: 'bombsell.followup.schedule', description: 'Schedule follow-up actions', required: false, acting: true },
  ],
  estimatedCredits: 0.5,
  estimatedLatencyMs: 8000,
}

export const WORKFLOW_DEFINITIONS: Record<WorkflowName, WorkflowDefinition> = {
  outbound: OUTBOUND,
  content: CONTENT,
  'full-funnel': FULL_FUNNEL,
  'signal-to-insight': SIGNAL_TO_INSIGHT,
  'enrich-and-outreach': ENRICH_AND_OUTREACH,
  'reply-handling': REPLY_HANDLING,
}

/** The two user-facing engine pipelines. */
export const ENGINE_WORKFLOWS: WorkflowDefinition[] = [OUTBOUND, CONTENT]
