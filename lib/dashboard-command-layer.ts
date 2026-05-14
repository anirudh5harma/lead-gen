export type DashboardView =
  | 'home'
  | 'accounts'
  | 'outreach'
  | 'content'
  | 'agents'
  | 'integrations'
  | 'settings'

export type LeadStatusCommand = 'viewed' | 'dismissed' | 'booked' | 'sent' | 'replied'
export type LeadCommandAction = 'open' | 'review' | 'draft' | 'unlock' | 'send' | 'status'

export interface DashboardCommandLead {
  id: string
  target_company: string
  company_domain?: string | null
  contact_name?: string | null
  contact_title?: string | null
  relevance_score?: number | null
  status?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
}

export type DashboardCommand =
  | { type: 'navigate'; view: DashboardView; summary: string; sectionId?: string; sectionLabel?: string }
  | { type: 'refresh'; summary: string }
  | { type: 'search'; query: string; summary: string }
  | { type: 'lead'; action: Exclude<LeadCommandAction, 'status'>; leadId: string; leadLabel: string; summary: string; requiresConfirmation?: boolean }
  | { type: 'lead'; action: 'status'; status: LeadStatusCommand; leadId: string; leadLabel: string; summary: string; requiresConfirmation?: boolean }

export type DashboardCommandInterpretation =
  | { kind: 'command'; command: DashboardCommand }
  | { kind: 'clarify'; reason: string; options: Array<{ label: string; command: DashboardCommand }> }
  | { kind: 'unsupported'; reason: string }

export interface InterpretDashboardCommandInput {
  transcript: string
  activeView: DashboardView
  leads: DashboardCommandLead[]
}

interface LeadMatch {
  lead: DashboardCommandLead
  score: number
}

interface DestinationTarget {
  label: string
  view: DashboardView
  sectionId?: string
  sectionLabel?: string
  aliases: string[]
}

const VIEW_ALIASES: Array<{ view: DashboardView; aliases: string[] }> = [
  { view: 'home', aliases: ['home', 'dashboard', 'today', 'queue', 'command bar', 'start'] },
  { view: 'outreach', aliases: ['pipeline', 'outreach', 'drafts', 'sent outreach', 'review queue', 'replies', 'sent emails'] },
  { view: 'accounts', aliases: ['accounts', 'signals', 'signal', 'account list', 'hot fits', 'hot accounts', 'watchlist'] },
  { view: 'content', aliases: ['content', 'content engine', 'ideas', 'composer', 'calendar', 'performance', 'posts'] },
  { view: 'agents', aliases: ['agents', 'fleet', 'agent fleet', 'agent status', 'system'] },
  { view: 'integrations', aliases: ['integrations', 'connections', 'connectors', 'inbox connection', 'crm'] },
  { view: 'settings', aliases: ['settings', 'billing', 'profile', 'team', 'preferences', 'workspace'] },
]

const DESTINATION_TARGETS: DestinationTarget[] = [
  {
    label: 'social accounts',
    view: 'integrations',
    sectionId: 'integrations-social',
    sectionLabel: 'Content publishing',
    aliases: ['social account', 'social accounts', 'linkedin', 'linked in', 'x account', 'twitter', 'post to social', 'publish content', 'content publishing', 'social publishing'],
  },
  {
    label: 'Telegram and Discord remote control',
    view: 'integrations',
    sectionId: 'integrations-remote',
    sectionLabel: 'Remote control',
    aliases: ['remote control', 'telegram', 'discord', 'chat command', 'chat commands', 'voice note', 'voice notes', 'operate from chat', 'command from telegram', 'command from discord'],
  },
  {
    label: 'outreach inboxes',
    view: 'integrations',
    sectionId: 'integrations-sending',
    sectionLabel: 'Outreach inboxes',
    aliases: ['gmail', 'outlook', 'email account', 'email accounts', 'mailbox', 'mailboxes', 'inbox', 'inboxes', 'sending account', 'outreach inbox', 'send from my inbox'],
  },
  {
    label: 'CRM sync',
    view: 'integrations',
    sectionId: 'integrations-crm',
    sectionLabel: 'CRM sync',
    aliases: ['crm', 'hubspot', 'salesforce', 'pipedrive', 'zoho', 'crm sync', 'import crm', 'export crm'],
  },
  {
    label: 'notifications and booking',
    view: 'integrations',
    sectionId: 'integrations-ops',
    sectionLabel: 'Notifications and booking',
    aliases: ['slack', 'calendly', 'cal.com', 'booking link', 'bookings', 'notification', 'notifications', 'webhook', 'webhooks'],
  },
  {
    label: 'AI models',
    view: 'integrations',
    sectionId: 'integrations-ai',
    sectionLabel: 'AI models',
    aliases: ['ai model', 'ai models', 'llm', 'openai', 'chatgpt', 'claude', 'anthropic', 'api key', 'model key'],
  },
  {
    label: 'Agents API',
    view: 'integrations',
    sectionId: 'integrations-agents-api',
    sectionLabel: 'Agents API',
    aliases: ['agents api', 'agent api', 'a2a', 'agent key', 'developer api', 'api docs', 'rest api'],
  },
  {
    label: 'billing',
    view: 'settings',
    sectionId: 'settings-billing',
    sectionLabel: 'Billing',
    aliases: ['billing', 'plan', 'plans', 'subscription', 'upgrade', 'credits', 'invoice', 'payment'],
  },
  {
    label: 'profile and ICP',
    view: 'settings',
    sectionId: 'settings-profile',
    sectionLabel: 'Profile',
    aliases: ['profile', 'workspace profile', 'company profile', 'icp', 'ideal customer', 'target industries', 'keywords'],
  },
  {
    label: 'automation settings',
    view: 'settings',
    sectionId: 'settings-automation',
    sectionLabel: 'Automation',
    aliases: ['automation', 'autopilot', 'approve first', 'research only', 'approval mode', 'safety mode'],
  },
  {
    label: 'outreach pipeline',
    view: 'outreach',
    aliases: ['reply', 'replies', 'draft', 'drafts', 'sent email', 'sent emails', 'send outreach', 'pipeline', 'outreach queue', 'review queue', 'email status'],
  },
  {
    label: 'account signals',
    view: 'accounts',
    aliases: ['account signal', 'account signals', 'hot account', 'hot accounts', 'watchlist', 'fit score', 'lead score', 'signals'],
  },
  {
    label: 'content workspace',
    view: 'content',
    aliases: ['content idea', 'content ideas', 'post idea', 'post ideas', 'composer', 'calendar', 'content calendar', 'performance', 'published posts'],
  },
  {
    label: 'agent fleet',
    view: 'agents',
    aliases: ['agent', 'agents', 'fleet', 'agent status', 'agent activity', 'workflow', 'workflows'],
  },
]

const FILLER_WORDS = new Set([
  'a',
  'an',
  'as',
  'at',
  'for',
  'in',
  'lead',
  'account',
  'company',
  'please',
  'the',
  'to',
])

export function interpretDashboardCommand(input: InterpretDashboardCommandInput): DashboardCommandInterpretation {
  const phrase = normalizePhrase(input.transcript)
  if (!phrase) return { kind: 'unsupported', reason: 'No command was heard.' }

  const destination = parseDestinationIntent(phrase)
  if (destination) return destination

  const navigation = parseNavigation(phrase)
  if (navigation) return { kind: 'command', command: navigation }

  if (/\b(refresh|reload|sync|update)\b/.test(phrase)) {
    return { kind: 'command', command: { type: 'refresh', summary: 'Refresh dashboard data' } }
  }

  const search = parseSearch(phrase)
  if (search) return { kind: 'command', command: search }

  const leadIntent = parseLeadIntent(phrase, input.leads)
  if (leadIntent) return leadIntent

  return {
    kind: 'unsupported',
    reason: 'Try commands like "open Acme", "prepare draft for Acme", "show pipeline", or "refresh".',
  }
}

export function isVoiceConfirmation(transcript: string): boolean {
  const phrase = normalizePhrase(transcript)
  return /^(confirm|yes|approve|do it|send it|go ahead|proceed)$/.test(phrase)
}

export function isVoiceCancellation(transcript: string): boolean {
  const phrase = normalizePhrase(transcript)
  return /^(cancel|stop|never mind|nevermind|no|abort)$/.test(phrase)
}

function parseDestinationIntent(phrase: string): DashboardCommandInterpretation | null {
  if (!hasDestinationIntent(phrase)) return null

  const matches = DESTINATION_TARGETS
    .map(target => ({ target, score: scoreDestinationTarget(phrase, target) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)

  if (matches.length === 0) return null

  const [best, second] = matches
  if (second && best.score - second.score < 8) {
    return {
      kind: 'clarify',
      reason: 'I found a few places that could match. Which one should I open?',
      options: matches.slice(0, 3).map(match => ({
        label: match.target.label,
        command: destinationCommand(match.target),
      })),
    }
  }

  return { kind: 'command', command: destinationCommand(best.target) }
}

function hasDestinationIntent(phrase: string): boolean {
  return /\b(where|how|what|which)\b/.test(phrase)
    || /\b(take me|go to|navigate|open|show me|view|find|look at)\b/.test(phrase)
    || /\b(connect|configure|setup|set up|add|manage|change|edit|update|see|check)\b/.test(phrase)
    || /\b(i need|i want|help me)\b/.test(phrase)
}

function scoreDestinationTarget(phrase: string, target: DestinationTarget): number {
  let score = 0
  for (const alias of target.aliases) {
    const normalizedAlias = normalizePhrase(alias)
    if (phrase.includes(normalizedAlias)) {
      score += 28 + normalizedAlias.split(' ').length * 4
      continue
    }

    const tokens = normalizedAlias.split(' ').filter(token => token.length > 2)
    const matchedTokens = tokens.filter(token => phrase.includes(token)).length
    if (tokens.length > 1 && matchedTokens === tokens.length) score += 18
    else if (matchedTokens > 0) score += matchedTokens * 4
  }

  if (target.sectionId && /\b(connect|configure|setup|set up|add|manage|change|edit|update)\b/.test(phrase)) score += 6
  if (/\b(where|how|help)\b/.test(phrase)) score += 4
  return score
}

function destinationCommand(target: DestinationTarget): DashboardCommand {
  const destination = target.sectionLabel ? `${viewLabel(target.view)}: ${target.sectionLabel}` : viewLabel(target.view)
  return {
    type: 'navigate',
    view: target.view,
    sectionId: target.sectionId,
    sectionLabel: target.sectionLabel,
    summary: `Open ${destination}`,
  }
}

function parseNavigation(phrase: string): DashboardCommand | null {
  if (!/\b(open|go|show|switch|take|navigate|view)\b/.test(phrase)) return null
  for (const entry of VIEW_ALIASES) {
    if (entry.aliases.some(alias => phrase.includes(alias))) {
      return {
        type: 'navigate',
        view: entry.view,
        summary: `Open ${viewLabel(entry.view)}`,
      }
    }
  }
  return null
}

function parseSearch(phrase: string): DashboardCommand | null {
  const match = phrase.match(/^(?:search|filter|look up|find)\s+(?:for\s+)?(.+)$/)
  const query = cleanupLeadTarget(match?.[1] ?? '')
  if (!query) return null
  return { type: 'search', query, summary: `Search for "${query}"` }
}

function parseLeadIntent(phrase: string, leads: DashboardCommandLead[]): DashboardCommandInterpretation | null {
  if (isQuestionPhrase(phrase)) return null

  const status = parseStatusIntent(phrase)
  if (status) return withResolvedLead(phrase, leads, status.action, status.status)

  if (/\b(approve|dispatch|send)\b/.test(phrase) && /\b(outreach|email|draft|message)\b/.test(phrase)) {
    return withResolvedLead(phrase, leads, 'send')
  }

  if (/\b(prepare|draft|write|generate|regenerate)\b/.test(phrase) && /\b(draft|email|outreach|message)\b/.test(phrase)) {
    return withResolvedLead(phrase, leads, 'draft')
  }

  if (/\b(unlock|resolve contact|find contact|find email|resolve email)\b/.test(phrase)) {
    return withResolvedLead(phrase, leads, 'unlock')
  }

  if (/\b(review)\b/.test(phrase)) {
    return withResolvedLead(phrase, leads, 'review')
  }

  if (/\b(open|show|view)\b/.test(phrase)) {
    return withResolvedLead(phrase, leads, 'open')
  }

  return null
}

function isQuestionPhrase(phrase: string): boolean {
  return /\b(where|how|what|which)\b/.test(phrase)
}

function parseStatusIntent(phrase: string): { action: 'status'; status: LeadStatusCommand } | null {
  if (!/\b(mark|set|dismiss|archive)\b/.test(phrase)) return null
  if (/\b(dismiss|dismissed|archive|archived|reject|rejected)\b/.test(phrase)) return { action: 'status', status: 'dismissed' }
  if (/\b(booked|meeting booked|meeting)\b/.test(phrase)) return { action: 'status', status: 'booked' }
  if (/\b(replied|reply)\b/.test(phrase)) return { action: 'status', status: 'replied' }
  if (/\b(sent)\b/.test(phrase)) return { action: 'status', status: 'sent' }
  if (/\b(viewed|seen)\b/.test(phrase)) return { action: 'status', status: 'viewed' }
  return null
}

function withResolvedLead(
  phrase: string,
  leads: DashboardCommandLead[],
  action: Exclude<LeadCommandAction, 'status'>,
): DashboardCommandInterpretation
function withResolvedLead(
  phrase: string,
  leads: DashboardCommandLead[],
  action: 'status',
  status: LeadStatusCommand,
): DashboardCommandInterpretation
function withResolvedLead(
  phrase: string,
  leads: DashboardCommandLead[],
  action: LeadCommandAction,
  status?: LeadStatusCommand,
): DashboardCommandInterpretation {
  const target = extractLeadTarget(phrase, action, status)
  const resolved = resolveLeadTarget(target, leads)
  if (resolved.kind !== 'match') return resolved

  const leadLabel = resolved.lead.target_company
  const requiresConfirmation = action === 'send' || status === 'dismissed'
  if (action === 'status') {
    const nextStatus = status ?? 'viewed'
    return {
      kind: 'command',
      command: {
        type: 'lead',
        action,
        status: nextStatus,
        leadId: resolved.lead.id,
        leadLabel,
        summary: `Mark ${leadLabel} ${nextStatus}`,
        requiresConfirmation,
      },
    }
  }

  return {
    kind: 'command',
    command: {
      type: 'lead',
      action,
      leadId: resolved.lead.id,
      leadLabel,
      summary: leadActionSummary(action, leadLabel),
      requiresConfirmation,
    },
  }
}

function resolveLeadTarget(
  target: string,
  leads: DashboardCommandLead[],
): { kind: 'match'; lead: DashboardCommandLead } | DashboardCommandInterpretation {
  if (leads.length === 0) {
    return { kind: 'unsupported', reason: 'There are no leads loaded on the dashboard yet.' }
  }

  if (isTopLeadTarget(target)) {
    return { kind: 'match', lead: [...leads].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))[0] }
  }

  if (!target) {
    return { kind: 'unsupported', reason: 'Which account should I use?' }
  }

  const matches = rankLeadMatches(target, leads).filter(match => match.score > 0)
  if (matches.length === 0) {
    return { kind: 'unsupported', reason: `No loaded account matches "${target}".` }
  }

  const [best, second] = matches
  if (second && best.score < 100 && best.score - second.score < 18) {
    return {
      kind: 'clarify',
      reason: `I found multiple accounts for "${target}".`,
      options: matches.slice(0, 3).map(match => ({
        label: match.lead.target_company,
        command: {
          type: 'lead',
          action: 'open',
          leadId: match.lead.id,
          leadLabel: match.lead.target_company,
          summary: `Open ${match.lead.target_company}`,
        },
      })),
    }
  }

  return { kind: 'match', lead: best.lead }
}

function rankLeadMatches(target: string, leads: DashboardCommandLead[]): LeadMatch[] {
  const normalizedTarget = normalizePhrase(target)
  const tokens = normalizedTarget.split(' ').filter(Boolean)

  return leads.map(lead => {
    const company = normalizePhrase(lead.target_company)
    const domain = normalizePhrase(lead.company_domain ?? '')
    const contact = normalizePhrase(lead.contact_name ?? '')
    const title = normalizePhrase(lead.contact_title ?? '')
    const haystack = [company, domain, contact, title].filter(Boolean).join(' ')

    let score = 0
    if (company === normalizedTarget) score = 120
    else if (domain === normalizedTarget) score = 110
    else if (company.startsWith(normalizedTarget)) score = 95
    else if (domain.startsWith(normalizedTarget)) score = 90
    else if (haystack.includes(normalizedTarget)) score = 78
    else if (tokens.length > 0 && tokens.every(token => haystack.includes(token))) score = 62
    else score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 12 : 0), 0)

    return { lead, score }
  }).sort((a, b) => b.score - a.score)
}

function extractLeadTarget(phrase: string, action: LeadCommandAction, status?: LeadStatusCommand): string {
  let value = phrase
    .replace(/\b(please|can you|could you)\b/g, ' ')
    .replace(/\b(lead|account|company)\b/g, ' ')

  if (action === 'send') value = value.replace(/\b(approve|dispatch|send|outreach|email|draft|message)\b/g, ' ')
  if (action === 'draft') value = value.replace(/\b(prepare|draft|write|generate|regenerate|outreach|email|message)\b/g, ' ')
  if (action === 'unlock') value = value.replace(/\b(unlock|resolve contact|find contact|find email|resolve email|contact|email)\b/g, ' ')
  if (action === 'review') value = value.replace(/\b(review)\b/g, ' ')
  if (action === 'open') value = value.replace(/\b(open|show|view)\b/g, ' ')
  if (action === 'status') {
    value = value
      .replace(/\b(mark|set|as|status|dismiss|dismissed|archive|archived|reject|rejected|booked|meeting|replied|reply|sent|viewed|seen)\b/g, ' ')
      .replace(new RegExp(`\\b${status ?? ''}\\b`, 'g'), ' ')
  }

  return cleanupLeadTarget(value)
}

function cleanupLeadTarget(value: string): string {
  return normalizePhrase(value)
    .split(' ')
    .filter(word => !FILLER_WORDS.has(word))
    .join(' ')
    .trim()
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTopLeadTarget(target: string): boolean {
  return !target || /\b(top|first|best|highest|priority|next)\b/.test(target)
}

function viewLabel(view: DashboardView): string {
  return VIEW_ALIASES.find(entry => entry.view === view)?.aliases[0] ?? view
}

function leadActionSummary(action: Exclude<LeadCommandAction, 'status'>, leadLabel: string): string {
  switch (action) {
    case 'open':
      return `Open ${leadLabel}`
    case 'review':
      return `Review ${leadLabel}`
    case 'draft':
      return `Prepare outreach draft for ${leadLabel}`
    case 'unlock':
      return `Unlock contact for ${leadLabel}`
    case 'send':
      return `Send outreach for ${leadLabel}`
  }
}
