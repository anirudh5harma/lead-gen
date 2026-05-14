/**
 * Bombsell Dashboard Command Layer
 *
 * Maps voice/text utterances to structured dashboard commands.
 * Intent classification is handled by the LLM-based voice-intent-layer;
 * this file handles lead resolution (fuzzy matching company names)
 * and command construction.
 */
import { classifyVoiceIntent, classifyVoiceIntentClient, isVoiceConfirmation, isVoiceCancellation } from '@/lib/voice-intent-layer'
import type { VoiceIntent } from '@/lib/voice-intent-layer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardView =
  | 'home'
  | 'outreach'
  | 'accounts'
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

// ─── Lead resolution ─────────────────────────────────────────────────────────

interface LeadMatch {
  lead: DashboardCommandLead
  score: number
}

const FILLER_WORDS = new Set([
  'a', 'an', 'as', 'at', 'for', 'in', 'lead', 'account', 'company',
  'please', 'the', 'to',
])

export function resolveLeadTarget(
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

export function rankLeadMatches(target: string, leads: DashboardCommandLead[]): LeadMatch[] {
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

function isTopLeadTarget(target: string): boolean {
  return !target || /\b(top|first|best|highest|priority|next)\b/.test(target)
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupLeadTarget(value: string): string {
  return normalizePhrase(value)
    .split(' ')
    .filter(word => !FILLER_WORDS.has(word))
    .join(' ')
    .trim()
}

// ─── Intent → Command mapping ──────────────────────────────────────────────

/**
 * Classify a voice/text transcript into a structured dashboard command.
 * Uses LLM-based intent classification (with fast-path confirm/cancel bypass).
 */
export async function classifyDashboardCommand(
  input: InterpretDashboardCommandInput,
): Promise<DashboardCommandInterpretation> {
  const classification = await classifyVoiceIntent(input.transcript, {
    activeView: input.activeView,
  })
  const vi = classification.intent

  switch (vi.intent) {
    case 'confirm':
      return { kind: 'unsupported', reason: 'Nothing to confirm right now.' }

    case 'cancel':
      return { kind: 'unsupported', reason: 'Nothing to cancel right now.' }

    case 'refresh':
      return {
        kind: 'command',
        command: { type: 'refresh', summary: 'Refresh dashboard data' },
      }

    case 'search': {
      const query = vi.query || ''
      if (!query) return { kind: 'unsupported', reason: 'What would you like to search for?' }
      return {
        kind: 'command',
        command: { type: 'search', query, summary: `Search for "${query}"` },
      }
    }

    case 'navigate': {
      const view = vi.view || 'home'
      const viewLabels: Record<DashboardView, string> = {
        home: 'Home', outreach: 'Outreach', accounts: 'Accounts',
        content: 'Content', agents: 'Agents', integrations: 'Integrations',
        settings: 'Settings',
      }
      return {
        kind: 'command',
        command: {
          type: 'navigate',
          view,
          sectionId: vi.sectionId,
          sectionLabel: vi.sectionId ? vi.target : undefined,
          summary: `Open ${viewLabels[view]}`,
        },
      }
    }

    case 'help':
      return {
        kind: 'unsupported',
        reason: 'Try commands like "show pipeline", "draft outreach for Acme", "approve idea 1", "go to settings", or "search for fintech companies".',
      }

    case 'lead_details':
    case 'lead_draft':
    case 'lead_unlock':
    case 'lead_send':
    case 'lead_status': {
      const action = leadIntentToAction(vi.intent)
      if (!action) return { kind: 'unsupported', reason: vi.note || 'Could not determine what to do with this lead.' }

      // Resolve by index first, then by name
      const leads = input.leads
      let targetLead: DashboardCommandLead | null = null
      let resolvedBy = ''

      if (vi.index && vi.index > 0) {
        targetLead = leads[vi.index - 1] ?? null
        resolvedBy = `index ${vi.index}`
      }

      if (!targetLead && vi.target) {
        const cleaned = cleanupLeadTarget(vi.target)
        const resolved = resolveLeadTarget(cleaned, leads)
        if (resolved.kind === 'match') {
          targetLead = resolved.lead
          resolvedBy = `"${cleaned}"`
        } else {
          return resolved // clarify or unsupported
        }
      }

      if (!targetLead) {
        return {
          kind: 'unsupported',
          reason: vi.target
            ? `Could not find "${vi.target}" in the current pipeline.`
            : 'Which lead should I use? Say the company name or number.',
        }
      }

      const leadLabel = targetLead.target_company
      const requiresConfirmation = action === 'send'

      if (vi.intent === 'lead_status') {
        const status = vi.status || 'viewed'
        return {
          kind: 'command',
          command: {
            type: 'lead',
            action: 'status',
            status,
            leadId: targetLead.id,
            leadLabel,
            summary: `Mark ${leadLabel} ${status}`,
            requiresConfirmation: status === 'dismissed',
          },
        }
      }

      const summaries: Record<string, string> = {
        details: `Open ${leadLabel}`,
        draft: `Prepare outreach draft for ${leadLabel}`,
        unlock: `Unlock contact for ${leadLabel}`,
        send: `Send outreach for ${leadLabel}`,
      }

      return {
        kind: 'command',
        command: {
          type: 'lead',
          action,
          leadId: targetLead.id,
          leadLabel,
          summary: summaries[action] || `${action} ${leadLabel}`,
          requiresConfirmation,
        },
      }
    }

    default:
      return {
        kind: 'unsupported',
        reason: vi.note || 'Try commands like "show pipeline", "draft outreach for Acme", or "go to settings".',
      }
  }
}

function leadIntentToAction(intent: VoiceIntent['intent']): Exclude<LeadCommandAction, 'status'> | null {
  switch (intent) {
    case 'lead_details': return 'open'
    case 'lead_draft': return 'draft'
    case 'lead_unlock': return 'unlock'
    case 'lead_send': return 'send'
    default: return null
  }
}

// ─── Re-exports from voice-intent-layer ────────────────────────────────────

export { isVoiceConfirmation, isVoiceCancellation }

/**
 * Browser-safe variant: calls /api/voice/classify instead of calling
 * the LLM directly. Use this in client components (DashboardShell).
 */
export async function classifyDashboardCommandClient(
  input: InterpretDashboardCommandInput,
): Promise<DashboardCommandInterpretation> {
  const classification = await classifyVoiceIntentClient(input.transcript)
  const vi = classification.intent

  // Identical intent-to-command mapping as classifyDashboardCommand
  switch (vi.intent) {
    case 'confirm':
      return { kind: 'unsupported', reason: 'Nothing to confirm right now.' }
    case 'cancel':
      return { kind: 'unsupported', reason: 'Nothing to cancel right now.' }
    case 'refresh':
      return { kind: 'command', command: { type: 'refresh', summary: 'Refresh dashboard data' } }
    case 'search': {
      const query = vi.query || ''
      if (!query) return { kind: 'unsupported', reason: 'What would you like to search for?' }
      return { kind: 'command', command: { type: 'search', query, summary: `Search for "${query}"` } }
    }
    case 'navigate': {
      const view = vi.view || 'home'
      const viewLabels: Record<DashboardView, string> = {
        home: 'Home', outreach: 'Outreach', accounts: 'Accounts',
        content: 'Content', agents: 'Agents', integrations: 'Integrations',
        settings: 'Settings',
      }
      return {
        kind: 'command',
        command: {
          type: 'navigate', view,
          sectionId: vi.sectionId,
          sectionLabel: vi.sectionId ? vi.target : undefined,
          summary: `Open ${viewLabels[view]}`,
        },
      }
    }
    case 'help':
      return {
        kind: 'unsupported',
        reason: 'Try commands like "show pipeline", "draft outreach for Acme", "approve idea 1", "go to settings", or "search for fintech companies".',
      }
    case 'lead_details':
    case 'lead_draft':
    case 'lead_unlock':
    case 'lead_send':
    case 'lead_status': {
      const action = leadIntentToAction(vi.intent)
      if (!action) return { kind: 'unsupported', reason: vi.note || 'Could not determine what to do with this lead.' }
      const leads = input.leads
      let targetLead: DashboardCommandLead | null = null
      if (vi.index && vi.index > 0) targetLead = leads[vi.index - 1] ?? null
      if (!targetLead && vi.target) {
        const cleaned = cleanupLeadTarget(vi.target)
        const resolved = resolveLeadTarget(cleaned, leads)
        if (resolved.kind === 'match') targetLead = resolved.lead
        else return resolved
      }
      if (!targetLead) {
        return {
          kind: 'unsupported',
          reason: vi.target
            ? `Could not find "${vi.target}" in the current pipeline.`
            : 'Which lead should I use? Say the company name or number.',
        }
      }
      const leadLabel = targetLead.target_company
      const requiresConfirmation = action === 'send'
      if (vi.intent === 'lead_status') {
        const status = vi.status || 'viewed'
        return {
          kind: 'command',
          command: {
            type: 'lead', action: 'status', status,
            leadId: targetLead.id, leadLabel,
            summary: `Mark ${leadLabel} ${status}`,
            requiresConfirmation: status === 'dismissed',
          },
        }
      }
      const summaries: Record<string, string> = {
        details: `Open ${leadLabel}`, draft: `Prepare outreach draft for ${leadLabel}`,
        unlock: `Unlock contact for ${leadLabel}`, send: `Send outreach for ${leadLabel}`,
      }
      return {
        kind: 'command',
        command: {
          type: 'lead', action, leadId: targetLead.id, leadLabel,
          summary: summaries[action] || `${action} ${leadLabel}`,
          requiresConfirmation,
        },
      }
    }
    default:
      return {
        kind: 'unsupported',
        reason: vi.note || 'Try commands like "show pipeline", "draft outreach for Acme", or "go to settings".',
      }
  }
}
