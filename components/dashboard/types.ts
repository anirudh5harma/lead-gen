export type View =
  | 'home'
  | 'sales/inbox' | 'sales/outreach' | 'sales/explore'
  | 'marketing/content' | 'marketing/content/posts' | 'marketing/content/blogs' | 'marketing/content/videos'
  | 'marketing/campaigns' | 'marketing/audience'
  | 'revenue/pipeline' | 'revenue/analytics'
  | 'accounts'
  | 'engine/autopilot' | 'engine/sequences'
  | 'settings'

export interface NavSection {
  id: string
  label: string
  items: Array<{
    id: View
    label: string
    children?: Array<{
      id: View
      label: string
    }>
  }>
}

export interface WorkspaceMembership {
  client_id: string
  role: string
  name: string
}

export interface UserProfile {
  company_name: string
  client_name?: string
  services_description: string
  website_url?: string | null
  icp_keywords: string[] | null
  target_industries?: string[] | null
  email?: string
  plan?: string
  leads_used_this_month?: number
  leads_reset_at?: string | null
  lead_credit_balance?: number
  subscription_status?: 'none' | 'active' | 'canceled' | 'past_due'
  subscription_period?: 'monthly' | 'annual' | null
  subscription_renews_at?: string | null
  slack_webhook_url?: string | null
  slack_min_score?: number | null
  active_client_id?: string | null
  automation_mode?: 'research_only' | 'approve_first' | 'autopilot'
  workspaces?: WorkspaceMembership[]
}

export interface GtmWorkItem {
  id: string
  type: string
  status: 'open' | 'blocked' | 'waiting' | 'completed'
  priority: number
  title: string
  body: string
  account_name: string
  account_domain: string | null
  lead_id: string | null
  account_id: string | null
  workflow_run_id: string | null
  policy_decision_id: string | null
  action_label: string
  source: string
  created_at: string
  account_state_url: string | null
  metadata?: Record<string, unknown>
}

export interface GtmContentIdea {
  id: string
  lead_id: string | null
  account_id: string | null
  content_type: 'x_post' | 'linkedin_post' | 'blog_article' | 'video_script' | 'newsletter_blurb' | 'campaign_brief' | 'sales_enablement_note'
  channel?: 'social' | 'written' | 'video' | 'campaign' | string
  target_platform?: string | null
  origin?: 'suggested' | 'custom' | string
  tab?: 'posts' | 'blogs' | 'videos' | null
  batch_date?: string | null
  suggestion_rank?: number | null
  audience: string
  angle: string
  pillar?: string | null
  idea_format?: string | null
  why_now?: string | null
  proof_points: Array<{ label: string; value: string }>
  source_insights?: Array<{ label: string; value: string }>
  pain_category: string
  score?: number
  scoring_debug?: Record<string, unknown>
  status: 'new' | 'drafted' | 'approved' | 'dismissed'
  draft: Record<string, unknown>
  draft_settings?: Record<string, unknown>
  final_body?: string | null
  custom_prompt?: string | null
  source_assets?: Array<{ label: string; value: string }>
  media_assets?: Array<{ label: string; value: string }>
  latest_avatar_video_job?: {
    id: string
    status: 'manual_ready' | 'queued' | 'rendering' | 'ready' | 'failed'
    provider: string
    video_url: string | null
    thumbnail_url: string | null
    error_message: string | null
    created_at: string
    updated_at: string | null
  } | null
  compliance_flags?: Record<string, unknown>
  scheduled_for?: string | null
  published_at?: string | null
  created_at: string
}

export interface GtmInsight {
  id: string
  insight_type: string
  title: string
  summary: string
  evidence: Array<{ label: string; value: string }>
  confidence: number
  impact_score: number
  recommended_action_type: string
  recommended_action_payload: Record<string, unknown>
  status: 'open' | 'actioned' | 'dismissed' | 'archived'
  created_at: string
}

export interface CoverageRecommendation {
  id: string
  recommendation_type: string
  source_name: string | null
  source_type: string | null
  title: string
  summary: string
  suggested_config: Record<string, unknown>
  evidence: Array<{ label: string; value: string }>
  expected_impact: number
  estimated_cost_usd: number
  status: 'open' | 'applied' | 'dismissed'
  created_at: string
}

export interface LaunchReadinessSnapshot {
  score: number
  status: 'blocked' | 'needs_work' | 'ready' | 'running'
  headline: string
  first_value: {
    signal_clusters: number
    high_quality_clusters: number
    ready_work_items: number
    verified_contacts: number
    sent: number
    replies: number
    booked: number
  }
  segments: Array<{ key: string; label: string; score: number; done: boolean; reason: string; action: string }>
  recommendations: string[]
  source_learning: Array<{ source_name: string; signal_type: string | null; reliability_score: number; sent_count: number; replied_count: number; booked_count: number }>
}

export interface AccountMemoryListItem {
  id: string
  name: string
  domain: string | null
  lifecycle_stage: string
  source_kind: string | null
  first_seen_at: string
  last_seen_at: string
  counts: { signals: number; memories: number; touchpoints: number; leads: number }
  outcomes: { sent: number; replied: number; booked: number }
  checkpoints?: Record<string, unknown>
  source_learning?: Array<Record<string, unknown>>
}

export interface AccountStateSnapshot {
  account: {
    id: string
    name: string
    domain: string | null
    website_url?: string | null
    lifecycle_stage: string
    source_kind?: string | null
    first_seen_at: string
    last_seen_at: string
  }
  people: Array<{ id: string; email: string | null; name: string | null; title: string | null; verified: boolean | null; last_seen_at: string }>
  signals: Array<{ id: string; signal_type: string; headline: string; summary: string | null; source_name: string | null; source_url: string | null; observed_at: string; confidence: number }>
  touchpoints: Array<{ id: string; type: string; status: string; subject: string | null; body_preview: string | null; occurred_at: string }>
  memories: Array<{ id: string; memory_type: string; content: string; source: string; confidence: number; observed_at: string }>
  leads: Array<{ id: string; target_company: string; relevance_score: number; relevance_reason: string | null; status: string; created_at: string; sent_at: string | null; replied_at: string | null; booked_at: string | null }>
  workflow_runs: Array<{ id: string; workflow_type: string; status: string; current_step: string | null; started_at: string; error_message: string | null }>
  policy_decisions: Array<{ id: string; policy_name: string; action_type: string; decision: string; reasons: string[]; decided_at: string }>
  outreach_plans?: Array<{ id: string; status: string; confidence: number; trigger: string; persona: string; angle: string; proof: string; risk_flags: string[]; created_at: string }>
  checkpoints?: Record<string, unknown>
  next_actions: Array<{ type: string; label: string; reason: string; priority: number; lead_id?: string }>
  state_health: { memory_count: number; signal_count: number; person_count: number; touchpoint_count: number; last_seen_at: string }
}

export interface AutoSendAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email: string
  display_name?: string | null
}

export interface PendingFollowup {
  id: string
  scheduled_for: string
  lead_id: string
  leads: { id: string; target_company: string; status: string } | null
}

export interface ConnectedAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email: string
  display_name: string | null
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

export interface SequenceTemplateRow {
  id: string
  name: string
  custom_instructions: string | null
  followup_custom_instructions: string | null
  is_default: boolean
}

export interface ClientAccountSummary {
  id: string
  name: string
}

export interface BlockedCompany {
  id: string
  company_name: string
  company_domain: string | null
}
