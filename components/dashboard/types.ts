/**
 * Dashboard view types — collapsed surface area.
 *
 * Bombsell dashboard has 6 first-class views. Legacy view ids
 * (sales/inbox, marketing/*, revenue/*, engine/*) are mapped onto
 * the new ids in DashboardShell so old links keep working.
 */
export type View =
  | 'home'         // command bar + queue (the primary workspace)
  | 'accounts'     // account-centric pipeline (Outbound · Signals)
  | 'outreach'     // drafts, sent, replies (Outbound · Pipeline)
  | 'content'      // Content engine — ideas, composer, calendar, performance
  | 'agents'       // agent stacks + fleet + pipelines + activity
  | 'integrations' // every connection (sending, CRM, signals, social, ops, agents-API) in one place
  | 'settings'     // profile, billing, team, plans

export interface NavSection {
  id: string
  label: string
  items: Array<{
    id: View
    label: string
    children?: Array<{ id: View; label: string }>
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
  calendly_url?: string | null
  workspaces?: WorkspaceMembership[]
}

/* Legacy types preserved (used by lib/* code paths) — keep as-is. */

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
