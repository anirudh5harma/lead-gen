import type { LeadFeedSnapshot, LeadOrigin, LeadSourceKind } from '@/lib/lead-sources'

export type SignalRow = LeadFeedSnapshot

export interface Lead {
  id: string
  client_id?: string | null
  origin?: LeadOrigin
  source_kind?: LeadSourceKind | null
  source_record_id?: string | null
  feed_session_id?: string | null
  feed_session_label?: string | null
  feed_session_started_at?: string | null
  target_company: string
  company_domain?: string | null
  relevance_score: number
  relevance_reason: string | null
  status: string
  is_unlocked?: boolean
  unlocked_at?: string | null
  created_at: string
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  reply_intent?: 'not_interested' | 'out_of_office' | 'neutral' | 'interested' | 'meeting_requested' | 'meeting_booked' | null
  reply_summary?: string | null
  reply_body_snippet?: string | null
  reply_received_at?: string | null
  meeting_detected_at?: string | null
  booking_reply_sent_at?: string | null
  contact_email?: string | null
  contact_name?: string | null
  contact_title?: string | null
  feed_snapshot?: LeadFeedSnapshot | null
  signals?: SignalRow | SignalRow[] | null
}
