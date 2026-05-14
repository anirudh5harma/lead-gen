/**
 * Bombsell Dashboard Conversation Layer
 *
 * In-dashboard voice/text conversation interpretation.
 * Intent classification is handled by the LLM-based voice-intent-layer;
 * this file handles item resolution (mapping indices/pipeline items)
 * and constructing conversation actions.
 */
import { classifyVoiceIntent, classifyVoiceIntentClient } from '@/lib/voice-intent-layer'
import type { LeadStatusCommand } from './dashboard-command-layer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardConversationCollection = 'contentIdeas' | 'pipeline'
export type ContentIdeaAction = 'approve' | 'reject' | 'draft'
export type PipelineItemAction = 'details' | 'draft' | 'unlock' | 'send' | 'status'

export interface DashboardConversationIdea {
  id: string
  angle: string
  platform?: string | null
  score?: number | null
  status?: string | null
}

export interface DashboardConversationLead {
  id: string
  target_company: string
  relevance_score?: number | null
  status?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
}

export interface DashboardConversationContext {
  activeView: string
  lastCollection: DashboardConversationCollection | null
  contentIdeas: DashboardConversationIdea[]
  pipelineLeads: DashboardConversationLead[]
}

export type DashboardConversationAction =
  | { type: 'show_collection'; collection: DashboardConversationCollection; summary: string }
  | { type: 'content_idea'; action: ContentIdeaAction; ideaId: string; ideaLabel: string; index: number; summary: string }
  | { type: 'pipeline_item'; action: Exclude<PipelineItemAction, 'status'>; leadId: string; leadLabel: string; index: number; summary: string; requiresConfirmation?: boolean }
  | { type: 'pipeline_item'; action: 'status'; status: LeadStatusCommand; leadId: string; leadLabel: string; index: number; summary: string; requiresConfirmation?: boolean }

export type DashboardConversationInterpretation =
  | { kind: 'action'; action: DashboardConversationAction }
  | { kind: 'clarify'; reason: string }
  | { kind: 'unsupported'; reason: string }

// ─── Utilities ────────────────────────────────────────────────────────────────

export function rankConversationPipelineLeads<T extends DashboardConversationLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    const priority = statusPriority(a.status, a.sent_at, a.replied_at, a.booked_at) - statusPriority(b.status, b.sent_at, b.replied_at, b.booked_at)
    if (priority !== 0) return priority
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })
}

function statusPriority(status: string | null | undefined, sentAt?: string | null, repliedAt?: string | null, bookedAt?: string | null): number {
  if (bookedAt || status === 'booked') return 5
  if (repliedAt || status === 'replied') return 4
  if (sentAt || status === 'sent') return 3
  if (status === 'drafted' || status === 'unlocked' || status === 'delivered') return 1
  return 0
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a voice/text transcript into a structured conversation action.
 * Uses LLM-based intent classification with the dashboard conversation context.
 */
export async function classifyDashboardConversation(
  transcript: string,
  context: DashboardConversationContext,
): Promise<DashboardConversationInterpretation> {
  const classification = await classifyVoiceIntent(transcript)
  const vi = classification.intent

  switch (vi.intent) {
    case 'list_pipeline':
      return {
        kind: 'action',
        action: { type: 'show_collection', collection: 'pipeline', summary: 'Show pipeline' },
      }

    case 'list_content_ideas':
      return {
        kind: 'action',
        action: { type: 'show_collection', collection: 'contentIdeas', summary: 'Show content ideas' },
      }

    case 'content_idea_approve':
    case 'content_idea_reject':
    case 'content_idea_draft': {
      const ideaAction = vi.intent === 'content_idea_approve' ? 'approve'
        : vi.intent === 'content_idea_reject' ? 'reject' : 'draft'

      // Resolve by index
      const index = vi.index
      if (!index) {
        return { kind: 'clarify', reason: 'Which idea number? Say "approve idea 2" for example.' }
      }
      const ideas = context.contentIdeas
      const idea = ideas[index - 1]
      if (!idea) {
        return {
          kind: 'clarify',
          reason: `I only see ${ideas.length} content idea${ideas.length === 1 ? '' : 's'} right now. Say "show content ideas" to refresh the list.`,
        }
      }

      const verb = ideaAction === 'approve' ? 'Approve' : ideaAction === 'reject' ? 'Reject' : 'Draft'
      return {
        kind: 'action',
        action: {
          type: 'content_idea',
          action: ideaAction,
          ideaId: idea.id,
          ideaLabel: idea.angle,
          index,
          summary: `${verb} idea ${index}`,
        },
      }
    }

    case 'lead_details':
    case 'lead_draft':
    case 'lead_unlock':
    case 'lead_send':
    case 'lead_status': {
      const action = leadIntentToPipelineAction(vi.intent)
      if (!action) return { kind: 'unsupported', reason: 'Could not determine what to do with this lead.' }

      const ranked = rankConversationPipelineLeads(context.pipelineLeads)

      // Resolve by index first, then by name (not supported in conversation context — needs pipeline list visible)
      let targetIndex = vi.index
      if (!targetIndex) {
        return {
          kind: 'clarify',
          reason: 'I need a visible list first. Say "show pipeline", then refer to a lead number like "draft lead 1".',
        }
      }

      const lead = ranked[targetIndex - 1]
      if (!lead) {
        return {
          kind: 'clarify',
          reason: `I only see ${ranked.length} pipeline item${ranked.length === 1 ? '' : 's'} right now. Say "show pipeline" to refresh the list.`,
        }
      }

      if (vi.intent === 'lead_status') {
        const status = vi.status ?? 'viewed'
        return {
          kind: 'action',
          action: {
            type: 'pipeline_item',
            action: 'status',
            status,
            leadId: lead.id,
            leadLabel: lead.target_company,
            index: targetIndex,
            summary: `Mark ${lead.target_company} ${status}`,
            requiresConfirmation: status === 'dismissed',
          },
        }
      }

      const summaries: Record<string, string> = {
        details: `Open ${lead.target_company}`,
        draft: `Prepare outreach draft for ${lead.target_company}`,
        unlock: `Unlock contact for ${lead.target_company}`,
        send: `Send outreach for ${lead.target_company}`,
      }

      return {
        kind: 'action',
        action: {
          type: 'pipeline_item',
          action,
          leadId: lead.id,
          leadLabel: lead.target_company,
          index: targetIndex,
          summary: summaries[action] || `${action} ${lead.target_company}`,
          requiresConfirmation: action === 'send',
        },
      }
    }

    case 'confirm':
    case 'cancel':
      return { kind: 'unsupported', reason: 'Nothing to confirm or cancel right now.' }

    case 'help':
      return {
        kind: 'unsupported',
        reason: 'Try saying "show pipeline", "show content ideas", "approve idea 1", or "draft lead 1".',
      }

    default:
      return {
        kind: 'unsupported',
        reason: vi.note || 'Try saying "show pipeline", "draft lead 1", or "approve idea 2".',
      }
  }
}

function leadIntentToPipelineAction(intent: string): Exclude<PipelineItemAction, 'status'> | null {
  switch (intent) {
    case 'lead_details': return 'details'
    case 'lead_draft': return 'draft'
    case 'lead_unlock': return 'unlock'
    case 'lead_send': return 'send'
    default: return null
  }
}

/**
 * Browser-safe variant: calls /api/voice/classify instead of the LLM directly.
 * Use this in client components (DashboardShell).
 */
export async function classifyDashboardConversationClient(
  transcript: string,
  context: DashboardConversationContext,
): Promise<DashboardConversationInterpretation> {
  const classification = await classifyVoiceIntentClient(transcript)
  const vi = classification.intent

  // Identical intent-to-action mapping as classifyDashboardConversation
  switch (vi.intent) {
    case 'list_pipeline':
      return { kind: 'action', action: { type: 'show_collection', collection: 'pipeline', summary: 'Show pipeline' } }
    case 'list_content_ideas':
      return { kind: 'action', action: { type: 'show_collection', collection: 'contentIdeas', summary: 'Show content ideas' } }
    case 'content_idea_approve':
    case 'content_idea_reject':
    case 'content_idea_draft': {
      const ideaAction = vi.intent === 'content_idea_approve' ? 'approve'
        : vi.intent === 'content_idea_reject' ? 'reject' : 'draft'
      const index = vi.index
      if (!index) return { kind: 'clarify', reason: 'Which idea number? Say "approve idea 2" for example.' }
      const ideas = context.contentIdeas
      const idea = ideas[index - 1]
      if (!idea) return { kind: 'clarify', reason: `I only see ${ideas.length} content idea${ideas.length === 1 ? '' : 's'} right now.` }
      const verb = ideaAction === 'approve' ? 'Approve' : ideaAction === 'reject' ? 'Reject' : 'Draft'
      return { kind: 'action', action: { type: 'content_idea', action: ideaAction, ideaId: idea.id, ideaLabel: idea.angle, index, summary: `${verb} idea ${index}` } }
    }
    case 'lead_details':
    case 'lead_draft':
    case 'lead_unlock':
    case 'lead_send':
    case 'lead_status': {
      const action = leadIntentToPipelineAction(vi.intent)
      if (!action) return { kind: 'unsupported', reason: 'Could not determine what to do with this lead.' }
      const ranked = rankConversationPipelineLeads(context.pipelineLeads)
      const targetIndex = vi.index
      if (!targetIndex) return { kind: 'clarify', reason: 'I need a visible list first. Say "show pipeline", then refer to a lead number like "draft lead 1".' }
      const lead = ranked[targetIndex - 1]
      if (!lead) return { kind: 'clarify', reason: `I only see ${ranked.length} pipeline item${ranked.length === 1 ? '' : 's'} right now.` }
      if (vi.intent === 'lead_status') {
        const status = vi.status ?? 'viewed'
        return {
          kind: 'action',
          action: { type: 'pipeline_item', action: 'status', status, leadId: lead.id, leadLabel: lead.target_company, index: targetIndex, summary: `Mark ${lead.target_company} ${status}`, requiresConfirmation: status === 'dismissed' },
        }
      }
      const summaries: Record<string, string> = {
        details: `Open ${lead.target_company}`, draft: `Prepare outreach draft for ${lead.target_company}`,
        unlock: `Unlock contact for ${lead.target_company}`, send: `Send outreach for ${lead.target_company}`,
      }
      return {
        kind: 'action',
        action: { type: 'pipeline_item', action, leadId: lead.id, leadLabel: lead.target_company, index: targetIndex, summary: summaries[action], requiresConfirmation: action === 'send' },
      }
    }
    case 'confirm':
    case 'cancel':
      return { kind: 'unsupported', reason: 'Nothing to confirm or cancel right now.' }
    case 'help':
      return { kind: 'unsupported', reason: 'Try saying "show pipeline", "show content ideas", "approve idea 1", or "draft lead 1".' }
    default:
      return { kind: 'unsupported', reason: vi.note || 'Try saying "show pipeline", "draft lead 1", or "approve idea 2".' }
  }
}
