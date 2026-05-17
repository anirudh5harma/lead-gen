import type { DashboardView, LeadStatusCommand } from './dashboard-command-layer'

export type VoiceIntentType =
  | 'list_pipeline'
  | 'list_content_ideas'
  | 'lead_details'
  | 'lead_draft'
  | 'lead_unlock'
  | 'lead_send'
  | 'lead_status'
  | 'content_idea_approve'
  | 'content_idea_reject'
  | 'content_idea_draft'
  | 'navigate'
  | 'search'
  | 'refresh'
  | 'help'
  | 'confirm'
  | 'cancel'
  | 'unknown'

export type VoiceSentiment = 'neutral' | 'urgent' | 'confused' | 'frustrated' | 'curious'

export interface VoiceIntent {
  intent: VoiceIntentType
  sentiment: VoiceSentiment
  target?: string
  index?: number
  status?: LeadStatusCommand
  view?: DashboardView
  sectionId?: string
  tab?: string
  query?: string
  note?: string
}

export interface VoiceClassification {
  intent: VoiceIntent
  latencyMs: number
  llmUsed: boolean
}

export const CONFIRM_PATTERN = /^(confirm|yes|approve|do it|send it|go ahead|proceed|yep|yeah|sure|ok|okay|go for it)$/i
export const CANCEL_PATTERN = /^(cancel|stop|never mind|nevermind|no|abort|nope|don't|don't send)$/i

export function tryVoiceFastPath(transcript: string): VoiceIntent | null {
  const trimmed = transcript.trim().toLowerCase()
  if (CONFIRM_PATTERN.test(trimmed)) return { intent: 'confirm', sentiment: 'neutral' }
  if (CANCEL_PATTERN.test(trimmed)) return { intent: 'cancel', sentiment: 'neutral' }
  return null
}

export function isVoiceConfirmation(transcript: string): boolean {
  return CONFIRM_PATTERN.test(transcript.trim().toLowerCase())
}

export function isVoiceCancellation(transcript: string): boolean {
  return CANCEL_PATTERN.test(transcript.trim().toLowerCase())
}
