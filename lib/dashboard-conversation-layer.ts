import type { DashboardView, LeadStatusCommand } from './dashboard-command-layer'

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
  activeView: DashboardView
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

export function interpretDashboardConversation(
  transcript: string,
  context: DashboardConversationContext,
): DashboardConversationInterpretation {
  const phrase = normalizeConversationPhrase(transcript)
  if (!phrase) return { kind: 'unsupported', reason: 'No command was heard.' }

  const collection = parseCollectionRequest(phrase, context.lastCollection)
  if (collection) {
    return {
      kind: 'action',
      action: {
        type: 'show_collection',
        collection,
        summary: collection === 'contentIdeas' ? 'Show content ideas' : 'Show pipeline',
      },
    }
  }

  const itemAction = parseItemAction(phrase, context)
  if (itemAction) return itemAction

  return {
    kind: 'unsupported',
    reason: 'Try "show content ideas", "approve idea 1", "show pipeline", or "draft lead 1".',
  }
}

export function rankConversationPipelineLeads<T extends DashboardConversationLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    const priority = statusPriority(a.status, a.sent_at, a.replied_at, a.booked_at) - statusPriority(b.status, b.sent_at, b.replied_at, b.booked_at)
    if (priority !== 0) return priority
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })
}

export function normalizeConversationPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCollectionRequest(
  phrase: string,
  lastCollection: DashboardConversationCollection | null,
): DashboardConversationCollection | null {
  if (/^list (them|those|these|it)( here)?$/.test(phrase)) return lastCollection
  if (/\b(content ideas?|post ideas?|ideas?)\b/.test(phrase) && /\b(what|show|list|give|send|open|today|current|queued|queue|backlog)\b/.test(phrase)) return 'contentIdeas'
  if (/\b(pipeline|leads|accounts|opportunities|lead queue|account queue)\b/.test(phrase) && /\b(show|list|what|give|send|current|open)\b/.test(phrase)) return 'pipeline'
  return null
}

function parseItemAction(
  phrase: string,
  context: DashboardConversationContext,
): DashboardConversationInterpretation | null {
  const index = extractIndex(phrase)
  if (!index) return null

  const explicitCollection = /\b(idea|ideas|content idea|post idea)\b/.test(phrase)
    ? 'contentIdeas'
    : /\b(lead|account|pipeline item|opportunity)\b/.test(phrase)
      ? 'pipeline'
      : null
  const collection = explicitCollection ?? context.lastCollection
  if (!collection) {
    return {
      kind: 'clarify',
      reason: 'I need a visible list first. Say "show content ideas" or "show pipeline", then refer to an item number.',
    }
  }

  if (collection === 'contentIdeas') return parseContentIdeaItemAction(phrase, context.contentIdeas, index)
  return parsePipelineItemAction(phrase, context.pipelineLeads, index)
}

function parseContentIdeaItemAction(
  phrase: string,
  ideas: DashboardConversationIdea[],
  index: number,
): DashboardConversationInterpretation {
  const idea = ideas[index - 1]
  if (!idea) {
    return {
      kind: 'clarify',
      reason: `I only see ${ideas.length} content idea${ideas.length === 1 ? '' : 's'} right now. Say "show content ideas" to refresh the list.`,
    }
  }

  const action = contentActionFromPhrase(phrase)
  if (!action) {
    return {
      kind: 'clarify',
      reason: `What should I do with idea ${index}? Say "approve idea ${index}", "reject idea ${index}", or "draft idea ${index}".`,
    }
  }

  const verb = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Draft'
  return {
    kind: 'action',
    action: {
      type: 'content_idea',
      action,
      ideaId: idea.id,
      ideaLabel: idea.angle,
      index,
      summary: `${verb} idea ${index}`,
    },
  }
}

function parsePipelineItemAction(
  phrase: string,
  leads: DashboardConversationLead[],
  index: number,
): DashboardConversationInterpretation {
  const ranked = rankConversationPipelineLeads(leads)
  const lead = ranked[index - 1]
  if (!lead) {
    return {
      kind: 'clarify',
      reason: `I only see ${ranked.length} pipeline item${ranked.length === 1 ? '' : 's'} right now. Say "show pipeline" to refresh the list.`,
    }
  }

  const status = statusFromPhrase(phrase)
  if (status) {
    return {
      kind: 'action',
      action: {
        type: 'pipeline_item',
        action: 'status',
        status,
        leadId: lead.id,
        leadLabel: lead.target_company,
        index,
        summary: `Mark ${lead.target_company} ${status}`,
        requiresConfirmation: status === 'dismissed',
      },
    }
  }

  const action = pipelineActionFromPhrase(phrase)
  if (!action) {
    return {
      kind: 'clarify',
      reason: `What should I do with pipeline item ${index}? Say "show lead ${index}", "draft lead ${index}", "unlock lead ${index}", or "send lead ${index}".`,
    }
  }

  return {
    kind: 'action',
    action: {
      type: 'pipeline_item',
      action,
      leadId: lead.id,
      leadLabel: lead.target_company,
      index,
      summary: action === 'details'
        ? `Open ${lead.target_company}`
        : action === 'draft'
          ? `Prepare outreach draft for ${lead.target_company}`
          : action === 'unlock'
            ? `Unlock contact for ${lead.target_company}`
            : `Send outreach for ${lead.target_company}`,
      requiresConfirmation: action === 'send',
    },
  }
}

function contentActionFromPhrase(phrase: string): ContentIdeaAction | null {
  if (/\b(approve|accept|use|greenlight|green light)\b/.test(phrase)) return 'approve'
  if (/\b(reject|dismiss|remove|skip)\b/.test(phrase)) return 'reject'
  if (/\b(draft|write|compose|turn into|create post)\b/.test(phrase)) return 'draft'
  return null
}

function pipelineActionFromPhrase(phrase: string): Exclude<PipelineItemAction, 'status'> | null {
  if (/\b(send|dispatch|approve)\b/.test(phrase) && /\b(outreach|email|message|lead|account|one|item)\b/.test(phrase)) return 'send'
  if (/\b(draft|prepare|write|generate)\b/.test(phrase)) return 'draft'
  if (/\b(unlock|resolve|find contact|find email)\b/.test(phrase)) return 'unlock'
  if (/\b(show|open|view|details|review)\b/.test(phrase)) return 'details'
  return null
}

function statusFromPhrase(phrase: string): LeadStatusCommand | null {
  if (!/\b(mark|set)\b/.test(phrase)) return null
  if (/\b(dismissed|dismiss|archive|archived|reject|rejected)\b/.test(phrase)) return 'dismissed'
  if (/\b(booked|meeting)\b/.test(phrase)) return 'booked'
  if (/\b(replied|reply)\b/.test(phrase)) return 'replied'
  if (/\b(sent)\b/.test(phrase)) return 'sent'
  if (/\b(viewed|seen)\b/.test(phrase)) return 'viewed'
  return null
}

function extractIndex(phrase: string): number | null {
  const numeric = phrase.match(/(?:#|number\s+)?(\d{1,2})\b/)
  if (numeric?.[1]) return Number(numeric[1])
  if (/\b(first|top)\b/.test(phrase)) return 1
  if (/\b(second)\b/.test(phrase)) return 2
  if (/\b(third)\b/.test(phrase)) return 3
  if (/\b(fourth)\b/.test(phrase)) return 4
  if (/\b(fifth)\b/.test(phrase)) return 5
  return null
}

function statusPriority(status: string | null | undefined, sentAt?: string | null, repliedAt?: string | null, bookedAt?: string | null): number {
  if (bookedAt || status === 'booked') return 5
  if (repliedAt || status === 'replied') return 4
  if (sentAt || status === 'sent') return 3
  if (status === 'drafted' || status === 'unlocked' || status === 'delivered') return 1
  return 0
}
