export type RemoteConversationIntent =
  | { type: 'list_content_ideas' }
  | { type: 'content_idea_action'; action: 'approve' | 'reject' | 'draft'; index: number }
  | { type: 'list_pipeline' }
  | { type: 'lead_index_action'; action: 'details' | 'draft' | 'unlock' | 'send' | 'status'; index: number; status?: 'viewed' | 'dismissed' | 'booked' | 'sent' | 'replied' }

export interface RemoteContentIdea {
  id: string
  platform?: string | null
  angle: string
  hook?: string | null
  rationale?: string | null
  score?: number | null
  status?: string | null
  created_at?: string | null
}

export interface RemotePipelineLead {
  id: string
  target_company: string
  company_domain?: string | null
  relevance_score?: number | null
  relevance_reason?: string | null
  status?: string | null
  contact_name?: string | null
  contact_title?: string | null
  contact_email?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
}

export function parseRemoteConversationIntent(transcript: string): RemoteConversationIntent | null {
  const phrase = normalizeRemotePhrase(transcript)
  if (!phrase) return null

  const contentAction = parseContentIdeaAction(phrase)
  if (contentAction) return contentAction

  const leadAction = parseLeadIndexAction(phrase)
  if (leadAction) return leadAction

  if (isContentIdeaListRequest(phrase)) return { type: 'list_content_ideas' }
  if (isPipelineListRequest(phrase)) return { type: 'list_pipeline' }
  return null
}

export function formatContentIdeasForChat(ideas: RemoteContentIdea[], limit = 8): string {
  const visible = ideas.slice(0, limit)
  if (visible.length === 0) {
    return 'No active content ideas are queued right now. Reply "generate content ideas" from the dashboard until remote generation is enabled.'
  }

  const lines = visible.flatMap((idea, index) => {
    const meta = [
      idea.platform ?? 'linkedin',
      typeof idea.score === 'number' ? `score ${Math.round(idea.score)}` : null,
      idea.status && idea.status !== 'proposed' ? idea.status : null,
    ].filter(Boolean).join(' · ')
    const row = `${index + 1}. ${truncate(idea.angle, 150)}${meta ? ` (${meta})` : ''}`
    return idea.hook ? [row, `   Hook: ${truncate(idea.hook, 120)}`] : [row]
  })

  return [
    `Content ideas (${visible.length}${ideas.length > visible.length ? ` of ${ideas.length}` : ''}):`,
    ...lines,
    'Reply "approve idea 1", "reject idea 1", or "draft idea 1".',
  ].join('\n')
}

export function formatPipelineForChat(leads: RemotePipelineLead[], limit = 8): string {
  const visible = rankRemotePipelineLeads(leads).slice(0, limit)
  if (visible.length === 0) {
    return 'No active pipeline items are loaded right now.'
  }

  const lines = visible.flatMap((lead, index) => {
    const meta = [
      typeof lead.relevance_score === 'number' ? `score ${Math.round(lead.relevance_score)}` : null,
      lead.status ?? 'new',
    ].filter(Boolean).join(' · ')
    const contact = [lead.contact_name, lead.contact_title].filter(Boolean).join(', ')
    const row = `${index + 1}. ${lead.target_company}${meta ? ` (${meta})` : ''}`
    const detail = contact || lead.relevance_reason
    return detail ? [row, `   ${truncate(detail, 140)}`] : [row]
  })

  return [
    `Pipeline (${visible.length}${leads.length > visible.length ? ` of ${leads.length}` : ''}):`,
    ...lines,
    'Reply "show lead 1", "draft lead 1", "unlock lead 1", or "send lead 1". Sends still require confirmation.',
  ].join('\n')
}

export function formatLeadDetailsForChat(lead: RemotePipelineLead, index?: number): string {
  const heading = `${index ? `Lead ${index}: ` : ''}${lead.target_company}`
  const lines = [
    `${heading}${typeof lead.relevance_score === 'number' ? ` (score ${Math.round(lead.relevance_score)})` : ''}`,
    `Status: ${lead.status ?? 'new'}`,
  ]
  const contact = [lead.contact_name, lead.contact_title, lead.contact_email].filter(Boolean).join(' · ')
  if (contact) lines.push(`Contact: ${contact}`)
  if (lead.company_domain) lines.push(`Domain: ${lead.company_domain}`)
  if (lead.relevance_reason) lines.push(`Why it fits: ${truncate(lead.relevance_reason, 420)}`)
  lines.push(`Actions: "draft lead ${index ?? 1}", "unlock lead ${index ?? 1}", "send lead ${index ?? 1}".`)
  return lines.join('\n')
}

export function rankRemotePipelineLeads<T extends RemotePipelineLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    const priority = statusPriority(a.status) - statusPriority(b.status)
    if (priority !== 0) return priority
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  })
}

export function numberedItem<T>(items: T[], index: number): T | null {
  if (!Number.isInteger(index) || index < 1 || index > items.length) return null
  return items[index - 1] ?? null
}

export function normalizeRemotePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseContentIdeaAction(phrase: string): RemoteConversationIntent | null {
  if (!/\b(idea|ideas|content idea|post idea)\b/.test(phrase)) return null
  const index = extractNumber(phrase)
  if (!index) return null

  if (/\b(approve|accept|use|greenlight|green light)\b/.test(phrase)) return { type: 'content_idea_action', action: 'approve', index }
  if (/\b(reject|dismiss|remove|skip)\b/.test(phrase)) return { type: 'content_idea_action', action: 'reject', index }
  if (/\b(draft|write|compose|turn into|create post)\b/.test(phrase)) return { type: 'content_idea_action', action: 'draft', index }
  return null
}

function parseLeadIndexAction(phrase: string): RemoteConversationIntent | null {
  if (!/\b(lead|account|pipeline item|opportunity)\b/.test(phrase)) return null
  const index = extractNumber(phrase)
  if (!index) return null

  if (/\b(mark|set)\b/.test(phrase)) {
    if (/\b(booked|meeting)\b/.test(phrase)) return { type: 'lead_index_action', action: 'status', index, status: 'booked' }
    if (/\b(replied|reply)\b/.test(phrase)) return { type: 'lead_index_action', action: 'status', index, status: 'replied' }
    if (/\b(sent)\b/.test(phrase)) return { type: 'lead_index_action', action: 'status', index, status: 'sent' }
    if (/\b(dismissed|dismiss|archive|archived|reject|rejected)\b/.test(phrase)) return { type: 'lead_index_action', action: 'status', index, status: 'dismissed' }
    if (/\b(viewed|seen)\b/.test(phrase)) return { type: 'lead_index_action', action: 'status', index, status: 'viewed' }
  }

  if (/\b(send|dispatch|approve)\b/.test(phrase) && /\b(outreach|email|message|lead|account)\b/.test(phrase)) return { type: 'lead_index_action', action: 'send', index }
  if (/\b(draft|prepare|write|generate)\b/.test(phrase)) return { type: 'lead_index_action', action: 'draft', index }
  if (/\b(unlock|resolve|find contact|find email)\b/.test(phrase)) return { type: 'lead_index_action', action: 'unlock', index }
  if (/\b(show|open|view|details|review)\b/.test(phrase)) return { type: 'lead_index_action', action: 'details', index }
  return null
}

function isContentIdeaListRequest(phrase: string): boolean {
  if (/^list (them|those|these|it)( here)?$/.test(phrase)) return true
  if (/\b(content ideas?|post ideas?|ideas?)\b/.test(phrase) && /\b(what|show|list|give|send|today|current|queued|queue|backlog)\b/.test(phrase)) return true
  return false
}

function isPipelineListRequest(phrase: string): boolean {
  return /\b(pipeline|leads|accounts|opportunities|lead queue|account queue)\b/.test(phrase)
    && /\b(show|list|what|give|send|current|open)\b/.test(phrase)
}

function extractNumber(phrase: string): number | null {
  const numeric = phrase.match(/(?:#|number\s+)?(\d{1,2})\b/)
  if (numeric?.[1]) return Number(numeric[1])
  if (/\b(first|top)\b/.test(phrase)) return 1
  if (/\b(second)\b/.test(phrase)) return 2
  if (/\b(third)\b/.test(phrase)) return 3
  return null
}

function statusPriority(status: string | null | undefined): number {
  if (status === 'replied' || status === 'booked') return 4
  if (status === 'sent') return 3
  if (status === 'drafted') return 1
  return 0
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1)}...` : normalized
}
