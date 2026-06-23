import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import BrandIcon from "@/components/BrandIcon";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  loadWorkspaceLaunchReadiness,
  type LaunchReadinessCheck,
  type WorkspaceLaunchReadiness,
} from "@/core/product/launch-readiness.ts";
import {
  buildOutputDestinations,
  type OutputDestination,
} from "@/core/product/output-destinations.ts";
import {
  loadQualifiedSignalWorkbench,
  type QualifiedSignalContact,
  type QualifiedSignalItem,
  type QualifiedSignalWorkbench,
} from "@/core/product/qualified-signals.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getHeatingUpAccountCount } from "@/core/ingest/account-intent.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import {
  checkAgentSourcesAction,
  decideApprovalWithDraftAction,
  dismissQualifiedSignalAction,
  generateMeetingPrepAction,
  optimizeCampaignStrategyAction,
  optimizePlaySkillsAction,
  prepareQualifiedSignalsAction,
  recordPersonFitFeedbackAction,
  resolveQualifiedSignalContactsAction,
  updateWorkspaceAutonomyAction,
} from "../actions";
import { loadDashboardData } from "../server-data";

export const dynamic = "force-dynamic";

interface RepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: {
    voice?: string;
    story?: string;
  } | null;
  autonomy: {
    channels?: Record<string, RepChannelPolicy>;
  } | null;
  open_conversations: string;
  sent_7d: string;
  outcomes_7d: string;
}

interface RepChannelPolicy {
  daily_cap?: number;
  approval?: string;
}

interface ChannelRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
}

interface ChannelConnection {
  connected: boolean;
  label: string;
  status: string;
  dailyCap: number | null;
  href: string;
}

interface ChannelCoverage {
  email: ChannelConnection;
  linkedIn: ChannelConnection;
}

interface AgentActivity {
  active_workflows: number;
  events_last_hour: number;
  signals_last_hour: number;
  contacts_last_hour: number;
  drafts_last_hour: number;
  outbound_last_hour: number;
  replies_last_hour: number;
  reviews_pending: number;
  event_types: Array<{ event_type: string; count: number }>;
}

interface AgentWorkStageData {
  key: string;
  label: string;
  value: number;
  icon: string;
}

interface AgentOutreachRow {
  id: string;
  conversation_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  channel_account_name: string | null;
  channel_account_kind: string | null;
  channel_account_status: string | null;
  sent_at: Date | null;
  created_at: Date;
  counterparty_name: string | null;
  emails: string[];
  linkedin_url: string | null;
  company_name: string | null;
  signal_title: string | null;
}

interface AgentAcceptedConnectionFollowupRow {
  accepted_event_id: string;
  conversation_id: string | null;
  person_id: string | null;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  signal_title: string | null;
  accepted_at: Date;
}

interface AgentOutreachSummary {
  recent: AgentOutreachRow[];
  accepted_followups: AgentAcceptedConnectionFollowupRow[];
  email_sent_7d: number;
  linkedin_sent_7d: number;
  linkedin_invites_7d: number;
  linkedin_accepts_7d: number;
  linkedin_messages_7d: number;
  email_replies_7d: number;
  linkedin_invite_replies_7d: number;
  linkedin_message_replies_7d: number;
  awaiting_reply: number;
}

interface AgentReplyRow {
  conversation_id: string;
  conversation_status: string;
  inbound_message_id: string;
  inbound_subject: string | null;
  inbound_body: string | null;
  intent_class: string | null;
  received_at: Date;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  reply_draft_message_id: string | null;
  reply_draft_status: string | null;
  reply_approval_id: string | null;
  reply_approval_decision: string | null;
  meeting_prep_generated_at: Date | null;
  meeting_prep_next_action: string | null;
}

interface AgentReplySummary {
  recent: AgentReplyRow[];
  replies_7d: number;
  drafted_replies: number;
  meeting_intent: number;
  prep_ready: number;
}

interface AgentContactRow {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  latest_signal_title: string | null;
  latest_signal_kind: string | null;
  latest_signal_score: string | null;
  last_signal_at: Date | null;
  fresh_signals: string;
  conversations: string;
  email_status: string;
  campaign_status: string;
  latest_outreach_channel: string | null;
  last_outreach_at: Date | null;
  created_at: Date;
  updated_at: Date;
  contact_fit_decision: string | null;
}

interface AgentContactSummary {
  recent: AgentContactRow[];
  reachable: number;
  with_email: number;
  verified_email: number;
  with_linkedin: number;
  linkedin_only: number;
  needs_fit_review: number;
  blocked_by_fit: number;
  draft_ready: number;
  contacted: number;
  replied: number;
  fit_reviewed: number;
  in_outreach: number;
  fresh_signals: number;
}

interface AgentLearningSummary {
  positive_replies_7d: number;
  meetings_7d: number;
  useful_outcomes_30d: number;
  strategy_summary: string | null;
  strategy_updated_at: Date | null;
  skill_summary: string | null;
  skill_updated_at: Date | null;
  recommended_patterns: number;
}

interface AgentSignalMixRow {
  kind: string;
  seen_7d: string;
  qualified_7d: string;
  with_contact_7d: string;
  with_draft_7d: string;
}

interface AgentSignalMix {
  rows: AgentSignalMixRow[];
  seen_7d: number;
  qualified_7d: number;
  with_contact_7d: number;
  with_draft_7d: number;
}

interface SignalReadinessWarning {
  key: string;
  label: string;
  detail: string;
  icon: string;
  tone: "blocked" | "review" | "waiting";
  href: string;
}

interface AgentReviewRow {
  id: string;
  run_id: string;
  kind: string;
  reason: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  expires_at: Date | null;
  conversation_id: string | null;
  message_id: string | null;
  counterparty_person_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  message_subject: string | null;
  channel: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  emails: string[];
  linkedin_url: string | null;
}

// Collapse pending-review rows so a single contact/conversation surfaces once,
// even if multiple pending approval gates exist for them. Rows are assumed to
// arrive newest-first, so the first occurrence wins.
export function dedupeReviewRows(rows: AgentReviewRow[]): AgentReviewRow[] {
  const seen = new Set<string>();
  const deduped: AgentReviewRow[] = [];
  for (const row of rows) {
    const key =
      row.counterparty_person_id ?? row.conversation_id ?? row.message_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

interface AgentReviewSummary {
  pending_count: number;
  recent: AgentReviewRow[];
}

interface RejectedDraftRow {
  id: string;
  subject: string | null;
  body: string | null;
  eval_score: string | null;
  eval_notes: Record<string, unknown> | null;
  created_at: Date;
  conversation_id: string | null;
  counterparty_person_id: string | null;
  origin_signal_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  signal_kind: string | null;
}

interface RejectedDraftSummary {
  recent: RejectedDraftRow[];
}

interface AgentSourceRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  poll_cadence_sec: number;
  last_polled_at: Date | null;
  source_last_polled_at: Date | null;
  next_check_at: Date | null;
  last_error: Record<string, unknown> | null;
  signal_kind: string | null;
  query: string | null;
  source_reason: string | null;
  source_tier: string | null;
  signals_total: string;
  signals_week: string;
  matched_week: string;
}

interface AgentSequenceStep {
  id: string;
  name: string;
  channel: string;
  declaration: string;
  status: string;
  daily_cap: number | null;
  approval: string | null;
  steps: string[];
}

interface AgentSourceStrategy {
  icp: {
    id: string;
    name: string;
    description: string;
    match_threshold: number;
    nice_to_haves: string[];
    must_haves: string[];
  } | null;
  profile: {
    signal_keywords: string[];
    competitor_watchlist: string[];
    target_titles: string[];
    target_markets: string[];
    exclusion_rules: string[];
  };
  sources: AgentSourceRow[];
  sequence: AgentSequenceStep[];
}

interface RepsState {
  reps: RepRow[];
  channels: ChannelRow[];
  readiness: WorkspaceLaunchReadiness;
  activity: AgentActivity;
  strategy: AgentSourceStrategy;
  opportunities: QualifiedSignalWorkbench;
  outreach: AgentOutreachSummary;
  replies: AgentReplySummary;
  reviews: AgentReviewSummary;
  rejectedDrafts: RejectedDraftSummary;
  contacts: AgentContactSummary;
  learning: AgentLearningSummary;
  signalMix: AgentSignalMix;
  outputDestinations: OutputDestination[];
  heatingUpAccounts: number;
}

async function loadRepsState(workspaceId: string): Promise<RepsState> {
  const emptyState = emptyRepsState(workspaceId);
  const [
    reps,
    channels,
    readiness,
    activity,
    strategy,
    opportunities,
    outreach,
    replies,
    reviews,
    rejectedDrafts,
    contacts,
    learning,
    signalMix,
    heatingUpAccounts,
  ] = await Promise.all([
    loadDashboardData(
      "agent",
      "reps",
      emptyState.reps,
      async () => (
        await getPool().query<RepRow>(
          `select r.id,
                  r.name,
                  r.role::text as role,
                  r.status::text as status,
                  r.persona,
                  r.autonomy,
                  (select count(*)::text
                     from conversations c
                    where c.workspace_id = $1
                      and c.rep_id = r.id
                      and c.status in ('open','awaiting_them','awaiting_us')) as open_conversations,
                  (select count(*)::text
                     from messages m
                     join conversations c on c.id = m.conversation_id
                    where m.workspace_id = $1
                      and c.rep_id = r.id
                      and m.direction = 'outbound'
                      and m.created_at >= now() - interval '7 days') as sent_7d,
                  (select count(*)::text
                     from outcomes o
                    where o.workspace_id = $1
                      and o.attributed_rep_id = r.id
                      and o.kind in ('positive_reply','meeting_booked','opportunity_created','deal_won')
                      and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as outcomes_7d
             from reps r
            where r.workspace_id = $1
              and r.status <> 'retired'
            order by r.created_at asc`,
          [workspaceId],
        )
      ).rows,
    ),
    loadDashboardData(
      "agent",
      "channels",
      emptyState.channels,
      async () => (
        await getPool().query<ChannelRow>(
          `with ranked_accounts as (
             select id,
                    display_name,
                    kind::text as kind,
                    status::text as status,
                    daily_cap,
                    last_error,
                    updated_at,
                    created_at,
                    row_number() over (
                      partition by case
                        when kind = 'oauth_outlook' then 'outlook:' || coalesce(
                          nullif(lower(properties ->> 'mailbox_email'), ''),
                          nullif(lower(display_name), ''),
                          id::text
                        )
                        when kind in ('linkedin_session','linkedin_oauth') then 'linkedin:' || coalesce(
                          nullif(lower(display_name), ''),
                          id::text
                        )
                        else id::text
                      end
                      order by case when status = 'connected' then 0 else 1 end,
                               updated_at desc,
                               created_at desc
                    ) as account_rank
               from channel_accounts
              where workspace_id = $1
                and kind in ('oauth_outlook','linkedin_session','linkedin_oauth')
           )
           select id, display_name, kind, status, daily_cap, last_error
             from ranked_accounts
            where account_rank = 1
            order by case
                       when kind = 'oauth_outlook' then 0
                       else 1
                     end,
                     display_name asc`,
          [workspaceId],
        )
      ).rows,
    ),
    loadDashboardData(
      "agent",
      "launch readiness",
      emptyState.readiness,
      () => loadWorkspaceLaunchReadiness(getPool(), workspaceId, { required_channel: "any" }),
    ),
    loadDashboardData(
      "agent",
      "activity",
      emptyState.activity,
      () => loadAgentActivity(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "source strategy",
      emptyState.strategy,
      () => loadAgentSourceStrategy(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "qualified signals",
      emptyState.opportunities,
      () => loadQualifiedSignalWorkbench(getPool(), workspaceId, { limit: 5 }),
    ),
    loadDashboardData(
      "agent",
      "outreach summary",
      emptyState.outreach,
      () => loadAgentOutreachSummary(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "reply summary",
      emptyState.replies,
      () => loadAgentReplySummary(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "review summary",
      emptyState.reviews,
      () => loadAgentReviewSummary(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "rejected drafts",
      emptyState.rejectedDrafts,
      () => loadRejectedDrafts(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "contact summary",
      emptyState.contacts,
      () => loadAgentContactSummary(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "learning summary",
      emptyState.learning,
      () => loadAgentLearningSummary(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "signal mix",
      emptyState.signalMix,
      () => loadAgentSignalMix(workspaceId),
    ),
    loadDashboardData(
      "agent",
      "heating up accounts",
      0,
      () => getHeatingUpAccountCount(getPool(), workspaceId),
    ),
  ]);
  const channelRows = channels;
  const coverage = workspaceChannelCoverage(channelRows);
  return {
    reps,
    channels: channelRows,
    readiness,
    activity,
    strategy,
    opportunities,
    outreach,
    replies,
    reviews,
    rejectedDrafts,
    contacts,
    learning,
    signalMix,
    outputDestinations: buildOutputDestinations({
      email_connected: coverage.email.connected,
      linkedin_connected: coverage.linkedIn.connected,
      crm_connected: channelRows.some(
        (channel) => channel.kind === "crm" && channel.status === "connected",
      ),
      launch_ready: readiness.launch_ready,
    }),
    heatingUpAccounts,
  };
}

async function loadAgentSignalMix(workspaceId: string): Promise<AgentSignalMix> {
  const pool = getPool();
  const rows = await pool.query<AgentSignalMixRow>(
    `select coalesce(s.kind::text, 'other') as kind,
            count(*)::text as seen_7d,
            count(*) filter (
              where s.status in ('matched','in_play')
            )::text as qualified_7d,
            count(*) filter (
              where s.status in ('matched','in_play')
                and exists (
                  select 1
                    from graph_persons p
                   where p.workspace_id = $1
                     and (
                       p.id = s.related_person_id
                       or (
                         s.related_company_id is not null
                         and p.company_id = s.related_company_id
                       )
                     )
                     and (
                       cardinality(coalesce(p.emails, '{}'::text[])) > 0
                       or p.linkedin_url is not null
                     )
                )
            )::text as with_contact_7d,
            count(*) filter (
              where s.status in ('matched','in_play')
                and exists (
                  select 1
                    from conversations c
                    join messages m
                      on m.workspace_id = c.workspace_id
                     and m.conversation_id = c.id
                   where c.workspace_id = $1
                     and c.origin_signal_id = s.id
                     and m.direction = 'outbound'
                     and m.status in ('draft','queued','deferred','sent','delivered','replied')
                )
            )::text as with_draft_7d
       from signals s
      where s.workspace_id = $1
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
      group by coalesce(s.kind::text, 'other')
      order by count(*) filter (where s.status in ('matched','in_play')) desc,
               count(*) desc,
               coalesce(s.kind::text, 'other') asc
      limit 5`,
    [workspaceId],
  );
  return {
    rows: rows.rows,
    seen_7d: rows.rows.reduce((total, row) => total + Number(row.seen_7d), 0),
    qualified_7d: rows.rows.reduce(
      (total, row) => total + Number(row.qualified_7d),
      0,
    ),
    with_contact_7d: rows.rows.reduce(
      (total, row) => total + Number(row.with_contact_7d),
      0,
    ),
    with_draft_7d: rows.rows.reduce(
      (total, row) => total + Number(row.with_draft_7d),
      0,
    ),
  };
}

async function loadAgentSourceStrategy(
  workspaceId: string,
): Promise<AgentSourceStrategy> {
  const pool = getPool();
  const [icp, profile, sources, sequence] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      description: string;
      match_threshold: string;
      nice_to_haves: unknown;
      must_haves: unknown;
    }>(
      `select id,
              name,
              description,
              match_threshold::text as match_threshold,
              nice_to_haves,
              must_haves
         from workspace_icps
        where workspace_id = $1
          and enabled
        order by created_at asc
        limit 1`,
      [workspaceId],
    ),
    pool.query<{
      signal_keywords: string | null;
      competitor_watchlist: string | null;
      target_titles: string | null;
      target_markets: string | null;
      exclusion_rules: string | null;
    }>(
      `select properties->>'signal_keywords' as signal_keywords,
              properties->>'competitor_watchlist' as competitor_watchlist,
              properties->>'target_titles' as target_titles,
              properties->>'target_markets' as target_markets,
              properties->>'exclusion_rules' as exclusion_rules
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc
        limit 1`,
      [workspaceId],
    ),
    pool.query<AgentSourceRow>(
      `select gs.id::text as id,
              gs.name,
              gs.kind::text as kind,
              (wsc.enabled and gs.enabled) as enabled,
              wsc.poll_cadence_sec,
              wsc.last_polled_at,
              gs.last_polled_at as source_last_polled_at,
              case
                when not (wsc.enabled and gs.enabled) then null
                when coalesce(wsc.last_polled_at, gs.last_polled_at) is null then now()
                else coalesce(wsc.last_polled_at, gs.last_polled_at)
                  + (wsc.poll_cadence_sec * interval '1 second')
              end as next_check_at,
              wsc.last_error,
              coalesce(wsc.config_overrides->>'signal_kind', gs.config->>'signal_kind') as signal_kind,
              coalesce(wsc.config_overrides->>'query', gs.config->>'query', gs.config->>'url') as query,
              coalesce(wsc.config_overrides->>'source_reason', gs.config->>'source_reason') as source_reason,
              coalesce(wsc.config_overrides->>'source_tier', gs.config->>'source_tier') as source_tier,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id) as signals_total,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.ingested_at >= now() - interval '7 days') as signals_week,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.status in ('matched','in_play')
                  and s.ingested_at >= now() - interval '7 days') as matched_week
         from workspace_source_configs wsc
         join graph_sources gs
           on gs.workspace_id = wsc.workspace_id
          and gs.id = wsc.source_id
        where wsc.workspace_id = $1
        order by (wsc.enabled and gs.enabled) desc,
                 coalesce(wsc.last_polled_at, gs.last_polled_at, '-infinity'::timestamptz) desc,
                 gs.created_at asc
        limit 6`,
      [workspaceId],
    ),
    pool.query<{
      id: string;
      name: string;
      declaration: string;
      compiled: Record<string, unknown> | null;
      autonomy: Record<string, unknown> | null;
      status: string;
      created_at: Date;
    }>(
      `select id,
              name,
              declaration,
              compiled,
              autonomy,
              status::text as status,
              created_at
         from plays
        where workspace_id = $1
          and status in ('active','draft','paused')
          and coalesce(compiled->>'channel', '') in (
            'email',
            'linkedin_dm',
            'linkedin_inmail',
            'linkedin_connection',
            'linkedin_comment'
          )
        order by case status when 'active' then 0 when 'draft' then 1 else 2 end,
                 created_at asc
        limit 8`,
      [workspaceId],
    ),
  ]);
  const icpRow = icp.rows[0];
  const profileRow = profile.rows[0];
  return {
    icp: icpRow
      ? {
          id: icpRow.id,
          name: icpRow.name,
          description: icpRow.description,
          match_threshold: Number(icpRow.match_threshold),
          nice_to_haves: stringArray(icpRow.nice_to_haves),
          must_haves: stringArray(icpRow.must_haves),
        }
      : null,
    profile: {
      signal_keywords: setupLines(profileRow?.signal_keywords),
      competitor_watchlist: setupLines(profileRow?.competitor_watchlist),
      target_titles: setupLines(profileRow?.target_titles),
      target_markets: setupLines(profileRow?.target_markets),
      exclusion_rules: setupLines(profileRow?.exclusion_rules),
    },
    sources: sources.rows,
    sequence: sequence.rows.map((row) => sequenceStepFromPlay(row)),
  };
}

async function loadAgentActivity(workspaceId: string): Promise<AgentActivity> {
  const pool = getPool();
  const [summary, eventTypes] = await Promise.all([
    pool.query<{
      active_workflows: string;
      events_last_hour: string;
      signals_last_hour: string;
      contacts_last_hour: string;
      drafts_last_hour: string;
      outbound_last_hour: string;
      replies_last_hour: string;
      reviews_pending: string;
    }>(
      `select
         (select count(*)::text from workflow_runs wr
            where wr.workspace_id = $1
              and wr.status in ('pending','running','awaiting_approval','awaiting_event')) as active_workflows,
         (select count(*)::text from events e
            where e.workspace_id = $1
              and e.occurred_at >= now() - interval '1 hour') as events_last_hour,
         (select count(*)::text from signals s
            where s.workspace_id = $1
              and s.status in ('ingested','matched','in_play')
              and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '1 hour') as signals_last_hour,
         (select count(*)::text from graph_persons p
            where p.workspace_id = $1
              and p.updated_at >= now() - interval '1 hour'
              and (
                cardinality(coalesce(p.emails, '{}'::text[])) > 0
                or p.linkedin_url is not null
              )) as contacts_last_hour,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.status not in ('sent','delivered','replied','bounced')
              and m.created_at >= now() - interval '1 hour') as drafts_last_hour,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.status in ('sent','delivered','replied')
              and m.created_at >= now() - interval '1 hour') as outbound_last_hour,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.kind in ('positive_reply','meeting_booked')
              and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '1 hour') as replies_last_hour,
         (select count(*)::text from workflow_approvals a
            where a.workspace_id = $1
              and a.decision = 'pending') as reviews_pending`,
      [workspaceId],
    ),
    pool.query<{ event_type: string; count: string }>(
      `select e.event_type, count(*)::text as count
         from events e
        where e.workspace_id = $1
          and e.occurred_at >= now() - interval '1 hour'
        group by e.event_type
        order by count(*) desc, e.event_type asc
        limit 5`,
      [workspaceId],
    ),
  ]);
  return {
    active_workflows: Number(summary.rows[0]?.active_workflows ?? 0),
    events_last_hour: Number(summary.rows[0]?.events_last_hour ?? 0),
    signals_last_hour: Number(summary.rows[0]?.signals_last_hour ?? 0),
    contacts_last_hour: Number(summary.rows[0]?.contacts_last_hour ?? 0),
    drafts_last_hour: Number(summary.rows[0]?.drafts_last_hour ?? 0),
    outbound_last_hour: Number(summary.rows[0]?.outbound_last_hour ?? 0),
    replies_last_hour: Number(summary.rows[0]?.replies_last_hour ?? 0),
    reviews_pending: Number(summary.rows[0]?.reviews_pending ?? 0),
    event_types: eventTypes.rows.map((row) => ({
      event_type: row.event_type,
      count: Number(row.count),
    })),
  };
}

async function loadAgentContactSummary(
  workspaceId: string,
): Promise<AgentContactSummary> {
  const pool = getPool();
  const [recent, summary] = await Promise.all([
    pool.query<AgentContactRow>(
      `select p.id,
              p.full_name,
              p.title,
              coalesce(p.emails, '{}'::text[]) as emails,
              p.linkedin_url,
              co.name as company_name,
              co.domain::text as company_domain,
              latest_signal.title as latest_signal_title,
              latest_signal.kind as latest_signal_kind,
              latest_signal.match_score::text as latest_signal_score,
              latest_signal.ingested_at as last_signal_at,
              case
                when exists (
                  select 1
                    from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                   where lower(coalesce(ev.meta->>'verified', '')) = 'true'
                      or lower(coalesce(ev.meta->>'status', '')) in ('valid', 'deliverable')
                ) then 'verified'
                when cardinality(coalesce(p.emails, '{}'::text[])) > 0 then 'found'
                else 'missing'
              end as email_status,
              case
                when latest_outreach.campaign_status = 'message_replied'
                  then latest_outreach.campaign_status
                when latest_linkedin_acceptance.last_touch_at is not null
                  then 'connection_accepted'
                else coalesce(latest_outreach.campaign_status, 'not_contacted')
              end as campaign_status,
              case
                when latest_linkedin_acceptance.last_touch_at is not null
                  and coalesce(latest_outreach.campaign_status, '') <> 'message_replied'
                  then latest_linkedin_acceptance.channel
                else latest_outreach.channel
              end as latest_outreach_channel,
              case
                when latest_linkedin_acceptance.last_touch_at is not null
                  and coalesce(latest_outreach.campaign_status, '') <> 'message_replied'
                  then latest_linkedin_acceptance.last_touch_at
                else latest_outreach.last_touch_at
              end as last_outreach_at,
              p.properties #>> '{contact_fit,decision}' as contact_fit_decision,
              p.created_at,
              p.updated_at,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.status in ('ingested','matched','in_play')
                  and (
                    s.related_person_id = p.id
                    or (p.company_id is not null and s.related_company_id = p.company_id)
                  )
                  and s.ingested_at >= now() - interval '14 days') as fresh_signals,
              (select count(*)::text
                 from conversations c
                where c.workspace_id = $1
                  and c.counterparty_person_id = p.id) as conversations
         from graph_persons p
         left join graph_companies co on co.id = p.company_id
         left join lateral (
           select s.title,
                  s.kind::text as kind,
                  s.match_score,
                  coalesce(s.ingested_at, s.freshness_at) as ingested_at
             from signals s
            where s.workspace_id = $1
              and s.status in ('ingested','matched','in_play')
              and (
                s.related_person_id = p.id
                or (p.company_id is not null and s.related_company_id = p.company_id)
              )
            order by coalesce(s.ingested_at, s.freshness_at) desc
            limit 1
         ) latest_signal on true
         left join lateral (
           select 'linkedin_connection'::text as channel,
                  coalesce(nullif(e.payload->>'accepted_at', '')::timestamptz, e.occurred_at) as last_touch_at
             from events e
            where e.workspace_id = $1
              and e.event_type = 'linkedin.connection.accepted'
              and (
                e.payload->>'person_id' = p.id::text
                or (
                  p.linkedin_url is not null
                  and e.payload->>'profile_url' = p.linkedin_url
                )
                or (
                  e.payload->>'conversation_id' is not null
                  and exists (
                    select 1
                      from conversations accepted_conversation
                     where accepted_conversation.workspace_id = $1
                       and accepted_conversation.id::text = e.payload->>'conversation_id'
                       and accepted_conversation.counterparty_person_id = p.id
                  )
                )
              )
            order by coalesce(nullif(e.payload->>'accepted_at', '')::timestamptz, e.occurred_at) desc
            limit 1
         ) latest_linkedin_acceptance on true
         left join lateral (
           select latest_message.channel::text as channel,
                  coalesce(latest_message.sent_at, latest_message.created_at, c.last_activity_at) as last_touch_at,
                  case
                    when exists (
                      select 1
                        from messages inbound
                       where inbound.workspace_id = $1
                         and inbound.conversation_id = c.id
                         and inbound.direction = 'inbound'
                    ) then 'message_replied'
                    when exists (
                      select 1
                        from messages sent
                       where sent.workspace_id = $1
                         and sent.conversation_id = c.id
                         and sent.direction = 'outbound'
                         and sent.status in ('sent','delivered','replied')
                    ) then 'contacted'
                    when exists (
                      select 1
                        from messages draft
                       where draft.workspace_id = $1
                         and draft.conversation_id = c.id
                         and draft.direction = 'outbound'
                         and draft.status in ('draft','queued','deferred')
                    ) then 'draft_ready'
                    else 'not_contacted'
                  end as campaign_status
             from conversations c
             left join lateral (
               select m.channel,
                      m.sent_at,
                      m.created_at
                 from messages m
                where m.workspace_id = $1
                  and m.conversation_id = c.id
                order by coalesce(m.sent_at, m.created_at) desc
                limit 1
             ) latest_message on true
            where c.workspace_id = $1
              and c.counterparty_person_id = p.id
            order by c.last_activity_at desc
            limit 1
         ) latest_outreach on true
        where p.workspace_id = $1
          and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
        order by coalesce(
                   latest_signal.ingested_at,
                   (select max(c.last_activity_at)
                      from conversations c
                     where c.workspace_id = $1
                       and c.counterparty_person_id = p.id),
                   p.updated_at
                 ) desc
        limit 5`,
      [workspaceId],
    ),
    pool.query<{
      reachable: string;
      with_email: string;
      verified_email: string;
      with_linkedin: string;
      linkedin_only: string;
      needs_fit_review: string;
      blocked_by_fit: string;
      draft_ready: string;
      contacted: string;
      replied: string;
      fit_reviewed: string;
      in_outreach: string;
      fresh_signals: string;
    }>(
      `select
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)) as reachable,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and cardinality(coalesce(p.emails, '{}'::text[])) > 0) as with_email,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and exists (
               select 1
                 from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                where lower(coalesce(ev.meta->>'verified', '')) = 'true'
                   or lower(coalesce(ev.meta->>'status', '')) in ('valid', 'deliverable')
             )) as verified_email,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and p.linkedin_url is not null) as with_linkedin,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and p.linkedin_url is not null
             and not exists (
               select 1
                 from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                where lower(coalesce(ev.meta->>'verified', '')) = 'true'
                   or lower(coalesce(ev.meta->>'status', '')) in ('valid', 'deliverable')
             )) as linkedin_only,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
             and p.properties #>> '{contact_fit,decision}' is null) as needs_fit_review,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and p.properties #>> '{contact_fit,decision}' = 'not_fit') as blocked_by_fit,
         (select count(distinct p.id)::text
            from graph_persons p
            join conversations c
              on c.workspace_id = p.workspace_id
             and c.counterparty_person_id = p.id
            join messages m
              on m.workspace_id = c.workspace_id
             and m.conversation_id = c.id
           where p.workspace_id = $1
             and m.direction = 'outbound'
             and m.status in ('draft','queued','deferred')) as draft_ready,
         (select count(distinct p.id)::text
            from graph_persons p
            join conversations c
              on c.workspace_id = p.workspace_id
             and c.counterparty_person_id = p.id
            join messages m
              on m.workspace_id = c.workspace_id
             and m.conversation_id = c.id
           where p.workspace_id = $1
             and m.direction = 'outbound'
             and m.status in ('sent','delivered','replied')) as contacted,
         (select count(distinct p.id)::text
            from graph_persons p
            join conversations c
              on c.workspace_id = p.workspace_id
             and c.counterparty_person_id = p.id
            join messages m
              on m.workspace_id = c.workspace_id
             and m.conversation_id = c.id
           where p.workspace_id = $1
             and m.direction = 'inbound') as replied,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and p.properties #>> '{contact_fit,decision}' is not null) as fit_reviewed,
         (select count(distinct p.id)::text
            from graph_persons p
            left join conversations c
              on c.workspace_id = p.workspace_id
             and c.counterparty_person_id = p.id
            left join messages m
              on m.workspace_id = c.workspace_id
             and m.conversation_id = c.id
           where p.workspace_id = $1
             and (
               (
                 m.direction = 'outbound'
                 and m.status in ('draft','queued','deferred','sent','delivered','replied')
               )
               or exists (
                 select 1
                   from events accepted
                  where accepted.workspace_id = $1
                    and accepted.event_type = 'linkedin.connection.accepted'
                    and (
                      accepted.payload->>'person_id' = p.id::text
                      or (
                        p.linkedin_url is not null
                        and accepted.payload->>'profile_url' = p.linkedin_url
                      )
                    )
               )
             )) as in_outreach,
         (select count(*)::text
            from signals s
           where s.workspace_id = $1
             and s.status in ('ingested','matched','in_play')
             and s.ingested_at >= now() - interval '14 days') as fresh_signals`,
      [workspaceId],
    ),
  ]);
  return {
    recent: recent.rows,
    reachable: Number(summary.rows[0]?.reachable ?? 0),
    with_email: Number(summary.rows[0]?.with_email ?? 0),
    verified_email: Number(summary.rows[0]?.verified_email ?? 0),
    with_linkedin: Number(summary.rows[0]?.with_linkedin ?? 0),
    linkedin_only: Number(summary.rows[0]?.linkedin_only ?? 0),
    needs_fit_review: Number(summary.rows[0]?.needs_fit_review ?? 0),
    blocked_by_fit: Number(summary.rows[0]?.blocked_by_fit ?? 0),
    draft_ready: Number(summary.rows[0]?.draft_ready ?? 0),
    contacted: Number(summary.rows[0]?.contacted ?? 0),
    replied: Number(summary.rows[0]?.replied ?? 0),
    fit_reviewed: Number(summary.rows[0]?.fit_reviewed ?? 0),
    in_outreach: Number(summary.rows[0]?.in_outreach ?? 0),
    fresh_signals: Number(summary.rows[0]?.fresh_signals ?? 0),
  };
}

async function loadAgentLearningSummary(
  workspaceId: string,
): Promise<AgentLearningSummary> {
  const pool = getPool();
  const [outcomes, events] = await Promise.all([
    pool.query<{
      positive_replies_7d: string;
      meetings_7d: string;
      useful_outcomes_30d: string;
    }>(
      `select
         (select count(*)::text from outcomes
            where workspace_id = $1
              and kind = 'positive_reply'
              and coalesce(recorded_at, occurred_at) >= now() - interval '7 days') as positive_replies_7d,
         (select count(*)::text from outcomes
            where workspace_id = $1
              and kind = 'meeting_booked'
              and coalesce(recorded_at, occurred_at) >= now() - interval '7 days') as meetings_7d,
         (select count(*)::text from outcomes
            where workspace_id = $1
              and kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
              and coalesce(recorded_at, occurred_at) >= now() - interval '30 days') as useful_outcomes_30d`,
      [workspaceId],
    ),
    pool.query<{
      event_type: string;
      payload: unknown;
      occurred_at: Date;
    }>(
      `select event_type, payload, occurred_at
         from events
        where workspace_id = $1
          and event_type in (
            'campaign.strategy.recommended',
            'play.skill.optimization.recommended'
          )
        order by occurred_at desc
        limit 6`,
      [workspaceId],
    ),
  ]);
  const latestStrategy = events.rows.find(
    (event) => event.event_type === "campaign.strategy.recommended",
  );
  const latestSkill = events.rows.find(
    (event) => event.event_type === "play.skill.optimization.recommended",
  );
  const strategy = recordPayload(latestStrategy?.payload);
  const skill = recordPayload(latestSkill?.payload);
  return {
    positive_replies_7d: Number(outcomes.rows[0]?.positive_replies_7d ?? 0),
    meetings_7d: Number(outcomes.rows[0]?.meetings_7d ?? 0),
    useful_outcomes_30d: Number(outcomes.rows[0]?.useful_outcomes_30d ?? 0),
    strategy_summary: stringPayload(strategy, "summary"),
    strategy_updated_at: latestStrategy?.occurred_at ?? null,
    skill_summary: stringPayload(skill, "summary"),
    skill_updated_at: latestSkill?.occurred_at ?? null,
    recommended_patterns:
      arrayPayloadLength(skill, "recommendations") ||
      arrayPayloadLength(strategy, "variants"),
  };
}

async function loadAgentOutreachSummary(
  workspaceId: string,
): Promise<AgentOutreachSummary> {
  const pool = getPool();
  const [recent, summary, acceptedFollowups] = await Promise.all([
    pool.query<AgentOutreachRow>(
      `select m.id,
              m.conversation_id,
              m.channel::text as channel,
              m.status::text as status,
              m.subject,
              m.body,
              coalesce(m.eval_score, (judged.payload->>'eval_score')::numeric)::text as eval_score,
              case
                when judged.payload ? 'passed' then (judged.payload->>'passed')::boolean
                else m.eval_passed
              end as eval_passed,
              ca.display_name as channel_account_name,
              ca.kind::text as channel_account_kind,
              ca.status::text as channel_account_status,
              m.sent_at,
              m.created_at,
              p.full_name as counterparty_name,
              coalesce(p.emails, '{}'::text[]) as emails,
              p.linkedin_url,
              co.name as company_name,
              s.title as signal_title
         from messages m
         join conversations c on c.id = m.conversation_id
         left join channel_accounts ca
           on ca.workspace_id = m.workspace_id
          and ca.id = m.channel_account_id
         left join graph_persons p on p.id = c.counterparty_person_id
         left join graph_companies co on co.id = c.counterparty_company_id
         left join signals s on s.id = c.origin_signal_id
         left join lateral (
           select e.payload
             from events e
            where e.workspace_id = m.workspace_id
              and e.event_type = 'draft.judged'
              and e.payload->>'message_id' = m.id::text
            order by e.occurred_at desc
            limit 1
         ) judged on true
        where m.workspace_id = $1
          and m.direction = 'outbound'
          and m.channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
          and m.status in ('sent','delivered','replied')
        order by coalesce(m.sent_at, m.created_at) desc
        limit 30`,
      [workspaceId],
    ),
    pool.query<{
      email_sent_7d: string;
      linkedin_sent_7d: string;
      linkedin_invites_7d: string;
      linkedin_accepts_7d: string;
      linkedin_messages_7d: string;
      email_replies_7d: string;
      linkedin_invite_replies_7d: string;
      linkedin_message_replies_7d: string;
      awaiting_reply: string;
    }>(
      `with recent_replies as (
         select inbound.id,
                latest_outbound.channel::text as latest_outbound_channel
           from messages inbound
           join lateral (
             select outbound.channel
               from messages outbound
              where outbound.workspace_id = $1
                and outbound.conversation_id = inbound.conversation_id
                and outbound.direction = 'outbound'
                and outbound.channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
                and coalesce(outbound.sent_at, outbound.created_at) <= coalesce(inbound.sent_at, inbound.created_at)
              order by coalesce(outbound.sent_at, outbound.created_at) desc
              limit 1
           ) latest_outbound on true
          where inbound.workspace_id = $1
            and inbound.direction = 'inbound'
            and coalesce(inbound.sent_at, inbound.created_at) >= now() - interval '7 days'
       )
       select
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel = 'email'
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as email_sent_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel in ('linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as linkedin_sent_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel = 'linkedin_connection'
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as linkedin_invites_7d,
         (select count(*)::text from events
            where workspace_id = $1
              and event_type = 'linkedin.connection.accepted'
              and occurred_at >= now() - interval '7 days') as linkedin_accepts_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel in ('linkedin_dm','linkedin_inmail')
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as linkedin_messages_7d,
         (select count(*)::text from recent_replies
            where latest_outbound_channel = 'email') as email_replies_7d,
         (select count(*)::text from recent_replies
            where latest_outbound_channel = 'linkedin_connection') as linkedin_invite_replies_7d,
         (select count(*)::text from recent_replies
            where latest_outbound_channel in ('linkedin_dm','linkedin_inmail')) as linkedin_message_replies_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
              and status in ('sent','delivered')
              and coalesce(sent_at, created_at) >= now() - interval '14 days') as awaiting_reply`,
      [workspaceId],
    ),
    pool.query<AgentAcceptedConnectionFollowupRow>(
      `with accepted as (
         select e.id as accepted_event_id,
                e.payload->>'conversation_id' as payload_conversation_id,
                e.payload->>'person_id' as payload_person_id,
                e.payload->>'profile_url' as profile_url,
                coalesce(nullif(e.payload->>'accepted_at', '')::timestamptz, e.occurred_at) as accepted_at
           from events e
          where e.workspace_id = $1
            and e.event_type = 'linkedin.connection.accepted'
            and coalesce(nullif(e.payload->>'accepted_at', '')::timestamptz, e.occurred_at) >= now() - interval '14 days'
       )
       select accepted.accepted_event_id,
              c.id::text as conversation_id,
              p.id::text as person_id,
              coalesce(p.full_name, 'LinkedIn contact') as full_name,
              p.title,
              coalesce(p.linkedin_url, accepted.profile_url) as linkedin_url,
              co.name as company_name,
              s.title as signal_title,
              accepted.accepted_at
         from accepted
         left join graph_persons p
           on p.workspace_id = $1
          and (
            p.id::text = accepted.payload_person_id
            or (
              accepted.profile_url is not null
              and p.linkedin_url = accepted.profile_url
            )
          )
         left join graph_companies co on co.id = p.company_id
         left join lateral (
           select c.id,
                  c.origin_signal_id
             from conversations c
            where c.workspace_id = $1
              and (
                c.id::text = accepted.payload_conversation_id
                or (
                  p.id is not null
                  and c.counterparty_person_id = p.id
                )
              )
            order by case
                       when c.id::text = accepted.payload_conversation_id then 0
                       else 1
                     end,
                     c.last_activity_at desc
            limit 1
         ) c on true
         left join signals s
           on s.workspace_id = $1
          and s.id = c.origin_signal_id
         left join lateral (
           select m.id
             from messages m
            where m.workspace_id = $1
              and c.id is not null
              and m.conversation_id = c.id
              and m.direction = 'outbound'
              and m.channel in ('linkedin_dm','linkedin_inmail','linkedin_comment')
              and coalesce(m.sent_at, m.created_at) >= accepted.accepted_at
            order by coalesce(m.sent_at, m.created_at) desc
            limit 1
         ) followup on true
        where followup.id is null
        order by accepted.accepted_at desc
        limit 5`,
      [workspaceId],
    ),
  ]);
  return {
    recent: recent.rows,
    accepted_followups: acceptedFollowups.rows,
    email_sent_7d: Number(summary.rows[0]?.email_sent_7d ?? 0),
    linkedin_sent_7d: Number(summary.rows[0]?.linkedin_sent_7d ?? 0),
    linkedin_invites_7d: Number(summary.rows[0]?.linkedin_invites_7d ?? 0),
    linkedin_accepts_7d: Number(summary.rows[0]?.linkedin_accepts_7d ?? 0),
    linkedin_messages_7d: Number(summary.rows[0]?.linkedin_messages_7d ?? 0),
    email_replies_7d: Number(summary.rows[0]?.email_replies_7d ?? 0),
    linkedin_invite_replies_7d: Number(
      summary.rows[0]?.linkedin_invite_replies_7d ?? 0,
    ),
    linkedin_message_replies_7d: Number(
      summary.rows[0]?.linkedin_message_replies_7d ?? 0,
    ),
    awaiting_reply: Number(summary.rows[0]?.awaiting_reply ?? 0),
  };
}

async function loadAgentReplySummary(
  workspaceId: string,
): Promise<AgentReplySummary> {
  const pool = getPool();
  const [recent, summary] = await Promise.all([
    pool.query<AgentReplyRow>(
      `select c.id as conversation_id,
              c.status::text as conversation_status,
              inbound.id as inbound_message_id,
              inbound.subject as inbound_subject,
              inbound.body as inbound_body,
              inbound.intent_class,
              coalesce(inbound.sent_at, inbound.created_at) as received_at,
              p.full_name as counterparty_name,
              co.name as company_name,
              s.title as signal_title,
              reply_draft.id as reply_draft_message_id,
              reply_draft.status::text as reply_draft_status,
              approval.id as reply_approval_id,
              approval.decision::text as reply_approval_decision,
              meeting_prep.generated_at as meeting_prep_generated_at,
              meeting_prep.next_action as meeting_prep_next_action
         from conversations c
         join lateral (
           select m.id,
                  m.subject,
                  m.body,
                  m.intent_class,
                  m.sent_at,
                  m.created_at
             from messages m
            where m.workspace_id = $1
              and m.conversation_id = c.id
              and m.direction = 'inbound'
            order by coalesce(m.sent_at, m.created_at) desc
            limit 1
         ) inbound on true
         left join graph_persons p on p.id = c.counterparty_person_id
         left join graph_companies co on co.id = c.counterparty_company_id
         left join signals s on s.id = c.origin_signal_id
         left join lateral (
           select m.id, m.status
             from messages m
            where m.workspace_id = $1
              and m.conversation_id = c.id
              and m.direction = 'outbound'
              and m.properties->>'reply_to_message_id' = inbound.id::text
            order by m.created_at desc
            limit 1
         ) reply_draft on true
         left join lateral (
           select a.id, a.decision
             from workflow_approvals a
            where a.workspace_id = $1
              and a.kind = 'inbound.email.reply'
              and a.payload->>'conversation_id' = c.id::text
              and a.payload->>'inbound_message_id' = inbound.id::text
            order by a.created_at desc
            limit 1
         ) approval on true
         left join lateral (
           select (e.payload->>'generated_at')::timestamptz as generated_at,
                  e.payload->>'next_action' as next_action
             from events e
            where e.workspace_id = $1
              and e.event_type = 'meeting.prep.generated'
              and e.payload->>'conversation_id' = c.id::text
            order by e.occurred_at desc
            limit 1
         ) meeting_prep on true
        where c.workspace_id = $1
          and coalesce(inbound.sent_at, inbound.created_at) >= now() - interval '14 days'
        order by coalesce(inbound.sent_at, inbound.created_at) desc
        limit 8`,
      [workspaceId],
    ),
    pool.query<{
      replies_7d: string;
      drafted_replies: string;
      meeting_intent: string;
      prep_ready: string;
    }>(
      `with recent_replies as (
         select c.id as conversation_id,
                inbound.id as inbound_message_id,
                inbound.intent_class
           from conversations c
           join lateral (
             select m.id,
                    m.intent_class,
                    m.sent_at,
                    m.created_at
               from messages m
              where m.workspace_id = $1
                and m.conversation_id = c.id
                and m.direction = 'inbound'
              order by coalesce(m.sent_at, m.created_at) desc
              limit 1
           ) inbound on true
          where c.workspace_id = $1
            and coalesce(inbound.sent_at, inbound.created_at) >= now() - interval '7 days'
       )
       select
         count(*)::text as replies_7d,
         count(*) filter (
           where exists (
             select 1
               from messages m
              where m.workspace_id = $1
                and m.conversation_id = recent_replies.conversation_id
                and m.direction = 'outbound'
                and m.properties->>'reply_to_message_id' = recent_replies.inbound_message_id::text
           )
         )::text as drafted_replies,
         count(*) filter (
           where recent_replies.intent_class in ('meeting_intent','positive')
         )::text as meeting_intent,
         count(*) filter (
           where exists (
             select 1
               from events e
              where e.workspace_id = $1
                and e.event_type = 'meeting.prep.generated'
                and e.payload->>'conversation_id' = recent_replies.conversation_id::text
           )
         )::text as prep_ready
       from recent_replies`,
      [workspaceId],
    ),
  ]);
  return {
    recent: recent.rows,
    replies_7d: Number(summary.rows[0]?.replies_7d ?? 0),
    drafted_replies: Number(summary.rows[0]?.drafted_replies ?? 0),
    meeting_intent: Number(summary.rows[0]?.meeting_intent ?? 0),
    prep_ready: Number(summary.rows[0]?.prep_ready ?? 0),
  };
}

async function loadAgentReviewSummary(
  workspaceId: string,
): Promise<AgentReviewSummary> {
  const pool = getPool();
  const [recent, summary] = await Promise.all([
    pool.query<AgentReviewRow>(
      `select a.id::text as id,
              a.run_id::text as run_id,
              a.kind,
              a.reason,
              a.payload,
              a.created_at,
              a.expires_at,
              a.payload->>'conversation_id' as conversation_id,
              coalesce(a.payload->>'message_id', a.payload->>'inbound_message_id') as message_id,
              c.counterparty_person_id::text as counterparty_person_id,
              p.full_name as counterparty_name,
              coalesce(p.emails, '{}'::text[]) as emails,
              p.linkedin_url,
              co.name as company_name,
              s.title as signal_title,
              m.subject as message_subject,
              coalesce(m.channel::text, a.payload->>'channel') as channel,
              coalesce(
                m.eval_score,
                case
                  when (a.payload->>'eval_score') ~ '^[0-9]+(\\.[0-9]+)?$'
                  then (a.payload->>'eval_score')::numeric
                  else null
                end
              )::text as eval_score,
              coalesce(m.eval_passed, true) as eval_passed
         from workflow_approvals a
         left join conversations c
           on c.workspace_id = a.workspace_id
          and c.id::text = a.payload->>'conversation_id'
         left join graph_persons p on p.id = c.counterparty_person_id
         left join graph_companies co on co.id = c.counterparty_company_id
         left join signals s on s.id = c.origin_signal_id
         left join messages m
           on m.workspace_id = a.workspace_id
          and m.id::text = coalesce(a.payload->>'message_id', a.payload->>'inbound_message_id')
        where a.workspace_id = $1
          and a.decision = 'pending'
        order by a.created_at desc
        limit 20`,
      [workspaceId],
    ),
    pool.query<{ pending_count: string }>(
      `select count(*)::text as pending_count
         from workflow_approvals a
        where a.workspace_id = $1
          and a.decision = 'pending'`,
      [workspaceId],
    ),
  ]);
  return {
    pending_count: Number(summary.rows[0]?.pending_count ?? 0),
    recent: dedupeReviewRows(recent.rows).slice(0, 6),
  };
}

async function loadRejectedDrafts(
  workspaceId: string,
): Promise<RejectedDraftSummary> {
  const pool = getPool();
  const rows = await pool.query<RejectedDraftRow>(
    `select m.id::text as id,
            m.subject,
            m.body,
            m.eval_score::text as eval_score,
            m.eval_notes,
            m.created_at,
            m.conversation_id::text as conversation_id,
            c.counterparty_person_id::text as counterparty_person_id,
            c.origin_signal_id::text as origin_signal_id,
            p.full_name as counterparty_name,
            co.name as company_name,
            s.title as signal_title,
            s.kind::text as signal_kind
       from messages m
       left join conversations c
         on c.id = m.conversation_id
        and c.workspace_id = m.workspace_id
       left join graph_persons p
         on p.id = c.counterparty_person_id
        and p.workspace_id = m.workspace_id
       left join graph_companies co
         on co.id = p.company_id
        and co.workspace_id = m.workspace_id
       left join signals s
         on s.id = c.origin_signal_id
        and s.workspace_id = m.workspace_id
      where m.workspace_id = $1
        and m.direction = 'outbound'
        and m.status = 'deferred'
        and m.eval_passed = false
        and (m.eval_notes->>'defer_reason') in ('eval_rejected','eval_rejected_after_edit')
      order by m.created_at desc
      limit 25`,
    [workspaceId],
  );
  return { recent: rows.rows };
}

export default async function RepsPage() {
  const active = await getActiveWorkspaceSessionForDashboard("agent");
  if (!active) return <NoWorkspaceReps />;

  const state = await loadSafeRepsState(active.workspace.id);
  const visibleReps = state.reps.filter(isVisibleProductAgent);
  const primaryAgent = visibleReps[0] ?? null;
  const coverage = workspaceChannelCoverage(state.channels);
  const sequence =
    state.strategy.sequence.length > 0
      ? state.strategy.sequence
      : fallbackSequenceFromReps(visibleReps);

  return (
    <div className="space-y-6">
      <AgentTopStrip
        readiness={state.readiness}
        coverage={coverage}
        learning={state.learning}
        primaryAgent={primaryAgent}
        reps={visibleReps}
        outreach={state.outreach}
        heatingUpAccounts={state.heatingUpAccounts}
      />

      <AgentConversationsPanel
        outreach={state.outreach}
        replies={state.replies}
        rejected={state.rejectedDrafts}
      />

      <AgentLeadsPanel
        opportunities={state.opportunities}
        contacts={state.contacts}
      />

      <AgentReviewQueuePanel reviews={state.reviews} />

      <AgentAdvancedDetails
        activity={state.activity}
        coverage={coverage}
        contacts={state.contacts}
        learning={state.learning}
        primaryAgent={primaryAgent}
        readiness={state.readiness}
        reps={visibleReps}
        sequence={sequence}
        signalMix={state.signalMix}
        strategy={state.strategy}
      />
    </div>
  );
}

function AgentTopStrip({
  readiness,
  coverage,
  learning,
  primaryAgent,
  reps,
  outreach,
  heatingUpAccounts,
}: {
  readiness: WorkspaceLaunchReadiness;
  coverage: ChannelCoverage;
  learning: AgentLearningSummary;
  primaryAgent: RepRow | null;
  reps: RepRow[];
  outreach: AgentOutreachSummary;
  heatingUpAccounts: number;
}) {
  const channelConnected = coverage.email.connected || coverage.linkedIn.connected;
  // An account can exist but not be fully "connected" yet (e.g. reauth/sync
  // pending). Only prompt to *connect* when no channel account exists at all;
  // otherwise let readiness guide the next action (review sync, finish setup).
  const hasChannelAccount =
    coverage.email.status !== "needed" || coverage.linkedIn.status !== "needed";
  const next = channelConnected || hasChannelAccount
    ? readinessNextAction(readiness)
    : {
        href: "/dashboard/profile#channels",
        icon: "account_tree",
        label: "Connect Outlook to start outreach",
      };
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const openConversations = sumRepMetric(reps, "open_conversations");
  return (
    <section
      className={
        "rounded-[16px] border p-4 md:p-5 " +
        (channelConnected
          ? "border-[var(--color-line-1)] bg-[var(--color-ink-0)]"
          : "border-[var(--color-warn)] bg-[var(--color-warn-bg)]")
      }
      aria-label="Agent overview"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs font-medium " +
                (channelConnected
                  ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                  : "bg-[var(--color-ink-0)] text-[var(--color-warn)]")
              }
            >
              <Icon name={channelConnected ? "check_circle" : "sync_problem"} size={13} />
              {channelConnected ? "Outreach ready" : "Connect a channel"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-1 text-xs text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)]">
              <Icon name="event_available" size={13} />
              {learning.meetings_7d} meeting
              {learning.meetings_7d === 1 ? "" : "s"} booked this week
            </span>
            {heatingUpAccounts > 0 ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-warn-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-warn)]"
                title="Accounts with multiple recent buying signals"
              >
                <Icon name="radar" size={13} />
                {heatingUpAccounts} account
                {heatingUpAccounts === 1 ? "" : "s"} heating up
              </span>
            ) : null}
          </div>
          <h1
            className="mt-3 text-2xl font-semibold tracking-normal text-[var(--color-text-1)] md:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Agent
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-3)]">
            Finds leads, sends email and LinkedIn, drafts replies for approval,
            and keeps meetings booked as the scoreboard.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <MiniStat label="Open threads" value={openConversations} />
          <MiniStat label="Sent 7d" value={sent7d} />
          {channelConnected && readiness.launch_ready ? (
            <form action={prepareQualifiedSignalsAction}>
              <input type="hidden" name="limit" value="25" />
              <input type="hidden" name="return_to" value="/dashboard/agent#leads" />
              <PendingSubmitButton
                className="btn-solid-sm"
                icon="send"
                iconSize={14}
                pendingLabel="Preparing"
              >
                Prepare outreach
              </PendingSubmitButton>
            </form>
          ) : (
            <Link href={next.href} prefetch className="btn-solid-sm">
              <Icon name={next.icon} size={14} />
              {next.label}
            </Link>
          )}
          {primaryAgent ? (
            <Link href="/dashboard/profile#agent" prefetch className="btn-quiet-sm">
              <Icon name="edit_note" size={14} />
              Edit voice
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AgentStatusHeader({
  readiness,
  coverage,
  primaryAgent,
  reps,
  outreach,
  sequence,
}: {
  readiness: WorkspaceLaunchReadiness;
  coverage: ChannelCoverage;
  primaryAgent: RepRow | null;
  reps: RepRow[];
  outreach: AgentOutreachSummary;
  sequence: AgentSequenceStep[];
}) {
  const next = readinessNextAction(readiness);
  const emailPolicy = primaryAgent?.autonomy?.channels?.email;
  const linkedInPolicy = primaryAgent
    ? firstChannelPolicy(primaryAgent, ["linkedin_dm", "linkedin"])
    : undefined;
  const operatingMode = primaryAgent
    ? agentOperatingMode(emailPolicy, linkedInPolicy)
    : null;
  const openConversations = sumRepMetric(reps, "open_conversations");
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const blocker = commandBlockerCopy(readiness);
  return (
    <section
      className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)] md:p-5"
      aria-label="Agent status"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs font-medium " +
                (readiness.launch_ready
                  ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                  : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]")
              }
            >
              <Icon
                name={readiness.launch_ready ? "check_circle" : "sync_problem"}
                size={13}
              />
              {readiness.launch_ready ? "Ready for outreach" : "Outreach blocked"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              <Icon name="forum" size={13} />
              {openConversations} open conversation
              {openConversations === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              <Icon name="rule" size={13} />
              {sequence.length} outreach rule{sequence.length === 1 ? "" : "s"}
            </span>
          </div>

          <h1
            className="mt-4 text-2xl font-semibold tracking-normal text-[var(--color-text-1)] md:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Agent
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-3)]">
            A conversation-first view of what needs your approval, which threads
            have proof, which signals are ready, and what outcomes changed.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {readiness.launch_ready ? (
              <form action={prepareQualifiedSignalsAction}>
                <input type="hidden" name="limit" value="25" />
                <input
                  type="hidden"
                  name="return_to"
                  value="/dashboard/agent#qualified-signals"
                />
                <PendingSubmitButton
                  className="btn-solid-sm"
                  icon="send"
                  iconSize={14}
                  pendingLabel="Preparing"
                >
                  Prepare outreach
                </PendingSubmitButton>
              </form>
            ) : (
              <Link href={next.href} prefetch className="btn-solid-sm">
                <Icon name={next.icon} size={14} />
                {next.label}
              </Link>
            )}
            <span className="text-xs leading-5 text-[var(--color-text-3)]">
              {readiness.launch_ready
                ? `${sent7d} sent this week through connected channels.`
                : blocker}
            </span>
          </div>
        </div>

        <aside className="grid gap-3 rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <AgentChannelPill
              title="Outlook"
              icon="mail"
              connection={coverage.email}
              policy={emailPolicy}
            />
            <AgentChannelPill
              title="LinkedIn"
              icon="linkedin"
              connection={coverage.linkedIn}
              policy={linkedInPolicy}
              comingSoon
            />
          </div>
          {operatingMode ? (
            <AgentModeControl mode={operatingMode} />
          ) : (
            <Link
              href="/dashboard/profile#agent"
              prefetch
              className="group flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-3 text-sm text-[var(--color-text-2)] transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-1)]"
            >
              <span>Finish Agent voice in Profile.</span>
              <Icon
                name="arrow_forward"
                size={14}
                className="text-[var(--color-text-4)] transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          )}
        </aside>
      </div>
    </section>
  );
}

type AgentConversationItem =
  | { kind: "reply"; key: string; at: Date; reply: AgentReplyRow }
  | { kind: "sent"; key: string; at: Date; message: AgentOutreachRow }
  | {
      kind: "followup";
      key: string;
      at: Date;
      followup: AgentAcceptedConnectionFollowupRow;
    }
  | { kind: "rejected"; key: string; at: Date; rejected: RejectedDraftRow };

function AgentConversationsPanel({
  outreach,
  replies,
  rejected,
}: {
  outreach: AgentOutreachSummary;
  replies: AgentReplySummary;
  rejected: RejectedDraftSummary;
}) {
  const items: AgentConversationItem[] = [
    ...replies.recent.map((reply) => ({
      kind: "reply" as const,
      key: `reply:${reply.inbound_message_id}`,
      at: reply.received_at,
      reply,
    })),
    ...outreach.recent.map((message) => ({
      kind: "sent" as const,
      key: `sent:${message.id}`,
      at: message.sent_at ?? message.created_at,
      message,
    })),
    ...outreach.accepted_followups
      .filter((followup) => Boolean(followup.conversation_id))
      .map((followup) => ({
        kind: "followup" as const,
        key: `followup:${followup.accepted_event_id}`,
        at: followup.accepted_at,
        followup,
      })),
    ...rejected.recent.slice(0, 4).map((row) => ({
      kind: "rejected" as const,
      key: `rejected:${row.id}`,
      at: row.created_at,
      rejected: row,
    })),
  ]
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, 14);
  const replyCount =
    replies.replies_7d +
    outreach.email_replies_7d +
    outreach.linkedin_invite_replies_7d +
    outreach.linkedin_message_replies_7d;

  return (
    <div id="conversations" className="scroll-mt-28">
      <SurfaceSection
        title="Conversations"
        action={
          <Link href="/dashboard/agent#thumb" className="btn-quiet-sm">
            <Icon name="rate_review" size={14} />
            Needs your thumb
          </Link>
        }
      >
        <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Email and LinkedIn threads
              </p>
              <p className="mt-1 max-w-[70ch] text-xs leading-5 text-[var(--color-text-3)]">
                Sent outreach and inbound replies stay visible here once the
                conversation is live. Approval-only drafts move through Needs
                your thumb instead.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConversationProofPill icon="send">
                {outreach.awaiting_reply} awaiting reply
              </ConversationProofPill>
              <ConversationProofPill icon="mail">
                {replyCount} replies this week
              </ConversationProofPill>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No conversations yet"
                hint="When the agent sends email or LinkedIn outreach, threads appear here."
                cta={{
                  href: "/dashboard/profile#channels",
                  label: "Connect accounts",
                  icon: "account_tree",
                }}
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {items.map((item) => (
                <AgentConversationRow key={item.key} item={item} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentConversationRow({ item }: { item: AgentConversationItem }) {
  if (item.kind === "reply") return <AgentReplyLink reply={item.reply} />;
  if (item.kind === "followup") {
    return <AcceptedConnectionFollowupLink row={item.followup} />;
  }
  if (item.kind === "rejected") {
    return <RejectedDraftRowCard row={item.rejected} />;
  }
  return <AgentOutreachLink message={item.message} />;
}

function ConversationProofPill({
  icon,
  children,
}: {
  icon: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

function AgentCommandStrip({
  readiness,
  opportunities,
  outreach,
  coverage,
}: {
  readiness: WorkspaceLaunchReadiness;
  opportunities: QualifiedSignalWorkbench;
  outreach: AgentOutreachSummary;
  coverage: ChannelCoverage;
}) {
  const next = readinessNextAction(readiness);
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const acceptedFollowups = outreach.accepted_followups.length;
  const acceptedFollowupCopy =
    acceptedFollowups === 1
      ? "1 accepted LinkedIn contact needs the next DM."
      : `${acceptedFollowups} accepted LinkedIn contacts need the next DM.`;
  return (
    <section
      className="grid gap-3 rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 md:grid-cols-2 xl:grid-cols-4"
      aria-label="Agent launch commands"
    >
      <AgentCommandLink
        href="/dashboard/agent#qualified-signals"
        icon={<Icon name="sensors" size={17} />}
        title="Qualified signals"
        value={opportunities.stats.qualified}
        detail={`${opportunities.stats.with_verified_contacts} verified contacts, ${opportunities.stats.with_outreach_draft} drafts ready`}
        ready={opportunities.stats.qualified > 0}
      />
      <AgentCommandLink
        href={coverage.email.href}
        icon={<BrandIcon name="microsoft" size={17} />}
        title={coverage.email.connected ? "Email ready" : "Connect Outlook"}
        value={coverage.email.connected ? outreach.email_sent_7d : "Setup"}
        detail={
          coverage.email.connected
            ? `${outreach.email_replies_7d} replies; ${coverage.email.label}; ${coverage.email.dailyCap ?? "uncapped"} daily cap`
            : "Outlook unlocks native email threads and reply sync."
        }
        metricLabel={coverage.email.connected ? "sent 7d" : "needed"}
        ready={coverage.email.connected}
      />
      <AgentCommandLink
        href={coverage.linkedIn.href}
        icon={<BrandIcon name="linkedin" size={17} />}
        title="LinkedIn"
        value="Soon"
        detail="LinkedIn outreach — connection requests, DMs, and reply capture — is coming soon."
        metricLabel=""
        ready={false}
        comingSoon
      />
      <div className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-4">
        <span className="flex items-center justify-between gap-3">
          <span className="grid size-9 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
            <Icon name="send" size={17} />
          </span>
          <span
            className={
              "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
              (readiness.launch_ready
                ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]")
            }
          >
            {readiness.launch_ready ? "Ready" : "Blocked"}
          </span>
        </span>
        <span>
          <span className="block text-sm font-semibold text-[var(--color-text-1)]">
            Prepare outreach
          </span>
          <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
            {readiness.launch_ready
              ? acceptedFollowups > 0
                ? acceptedFollowupCopy
                : `${sent7d} sent this week. Push qualified signals into verified email or LinkedIn drafts.`
              : commandBlockerCopy(readiness)}
          </span>
        </span>
        {readiness.launch_ready ? (
          <form action={prepareQualifiedSignalsAction}>
            <input type="hidden" name="limit" value="25" />
            <input type="hidden" name="return_to" value="/dashboard/agent#qualified-signals" />
            <PendingSubmitButton
              className="btn-solid-sm w-fit"
              icon="send"
              iconSize={14}
              pendingLabel="Preparing"
            >
              Start Agent
            </PendingSubmitButton>
          </form>
        ) : (
          <Link href={next.href} prefetch className="btn-quiet-sm w-fit">
            <Icon name={next.icon} size={14} />
            {next.label}
          </Link>
        )}
      </div>
    </section>
  );
}

function commandBlockerCopy(readiness: WorkspaceLaunchReadiness): string {
  const blocker = readiness.checks.find(
    (check) => check.required && check.status !== "ready",
  );
  if (blocker?.id === "outreach_channel") {
    return "Connect Outlook or LinkedIn before outreach can run.";
  }
  if (blocker?.id === "workspace_profile") {
    return "Complete Profile so the agent knows who you sell to.";
  }
  if (blocker?.id === "icp" || blocker?.id === "rep") {
    return "Finish buyer fit and Agent voice before outreach can run.";
  }
  if (blocker?.id === "signal_sources") {
    return "Check sources so the agent can find qualified signals.";
  }
  if (blocker?.id === "plays") {
    return "Set email or LinkedIn rules before signals can become messages.";
  }
  return "Finish Profile before outreach can run.";
}

function isPostApprovalOutreachStatus(
  status: string | null | undefined,
): boolean {
  return status === "sent" || status === "delivered" || status === "replied";
}

function isSignalPendingApproval(signal: QualifiedSignalItem): boolean {
  return Boolean(signal.outreach_draft?.pending_approval_id);
}

function isSignalInConversationStage(signal: QualifiedSignalItem): boolean {
  return isPostApprovalOutreachStatus(signal.outreach_draft?.status);
}

function isLeadStageSignal(signal: QualifiedSignalItem): boolean {
  return !isSignalPendingApproval(signal) && !isSignalInConversationStage(signal);
}

function AgentModeRail({
  activity,
  opportunities,
  contacts,
  outreach,
  replies,
  learning,
  readiness,
}: {
  activity: AgentActivity;
  opportunities: QualifiedSignalWorkbench;
  contacts: AgentContactSummary;
  outreach: AgentOutreachSummary;
  replies: AgentReplySummary;
  learning: AgentLearningSummary;
  readiness: WorkspaceLaunchReadiness;
}) {
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const learning7d = learning.positive_replies_7d + learning.meetings_7d;
  const modes = [
    {
      href: "#activity",
      icon: "sync",
      label: "Live work",
      value: activity.active_workflows + activity.events_last_hour,
      detail: activity.active_workflows > 0 ? "running now" : "last hour",
      ready: activity.active_workflows > 0 || activity.events_last_hour > 0,
    },
    {
      href: "#review-queue",
      icon: "rate_review",
      label: "Review",
      value: activity.reviews_pending,
      detail: "waiting",
      ready: activity.reviews_pending > 0,
    },
    {
      href: "#outreach",
      icon: "send",
      label: "Outreach",
      value: sent7d,
      detail: "sent 7d",
      ready: sent7d > 0,
    },
    {
      href: "#qualified-signals",
      icon: "sensors",
      label: "Signals",
      value: opportunities.stats.qualified,
      detail: "qualified",
      ready: opportunities.stats.qualified > 0,
    },
    {
      href: "#verified-contacts",
      icon: "person_search",
      label: "Contacts",
      value: contacts.reachable,
      detail: "reachable",
      ready: contacts.reachable > 0,
    },
    {
      href: "#replies",
      icon: "mail",
      label: "Replies",
      value: replies.replies_7d,
      detail: "ready 7d",
      ready: replies.replies_7d > 0,
    },
    {
      href: "#learning",
      icon: "auto_graph",
      label: "Learning",
      value: learning7d,
      detail: "wins 7d",
      ready: learning7d > 0,
    },
    {
      href: "#system",
      icon: "verified",
      label: "System",
      value: readiness.launch_ready ? "Ready" : "Gated",
      detail: readiness.launch_ready ? "launch" : "setup",
      ready: readiness.launch_ready,
    },
  ];

  return (
    <nav
      aria-label="Agent work modes"
      className="sticky top-3 z-20 -mx-1 overflow-x-auto rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]/95 p-1 shadow-[0_18px_38px_-32px_rgba(15,23,42,0.35)] backdrop-blur"
    >
      <div className="flex min-w-max gap-1">
        {modes.map((mode) => (
          <Link
            key={mode.href}
            href={`/dashboard/agent${mode.href}`}
            prefetch
            className="group grid min-w-[126px] grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-[9px] px-2 py-2.5 text-left transition-colors hover:bg-[var(--color-ink-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <span
              className={
                "grid size-8 place-items-center rounded-[8px] " +
                (mode.ready
                  ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
              }
            >
              <Icon name={mode.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5">
                <span className="whitespace-nowrap text-xs font-semibold text-[var(--color-text-1)]">
                  {mode.label}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-4)]">
                  {mode.value}
                </span>
              </span>
              <span className="mt-0.5 block whitespace-nowrap text-[11px] text-[var(--color-text-3)]">
                {mode.detail}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function AgentCommandLink({
  href,
  icon,
  title,
  value,
  detail,
  metricLabel = "now",
  ready,
  comingSoon = false,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  value: number | string;
  detail: string;
  metricLabel?: string;
  ready: boolean;
  comingSoon?: boolean;
}) {
  const inner = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span
          className={
            "grid size-9 place-items-center rounded-[8px] " +
            (ready && !comingSoon
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {icon}
        </span>
        {comingSoon ? (
          <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-4)]">
            Coming soon
          </span>
        ) : (
          <Icon
            name="arrow_forward"
            size={14}
            className="text-[var(--color-text-4)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-accent)]"
          />
        )}
      </span>
      <span>
        <span className="flex items-end gap-2">
          <strong className="text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
            {comingSoon ? "Soon" : value}
          </strong>
          <span className="pb-1 text-[11px] text-[var(--color-text-4)]">
            {comingSoon ? "" : metricLabel}
          </span>
        </span>
        <span className="mt-1 block text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </span>
        <span className="mt-2 line-clamp-2 block text-xs leading-5 text-[var(--color-text-3)]">
          {detail}
        </span>
      </span>
    </>
  );

  if (comingSoon) {
    return (
      <div
        aria-disabled="true"
        className="grid cursor-default gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-4 opacity-60"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={href}
      prefetch
      className="group grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-3)]"
    >
      {inner}
    </Link>
  );
}

function AgentSetupSnapshot({
  strategy,
  signalMix,
  contacts,
  outreach,
  coverage,
  sequence,
  readiness,
}: {
  strategy: AgentSourceStrategy;
  signalMix: AgentSignalMix;
  contacts: AgentContactSummary;
  outreach: AgentOutreachSummary;
  coverage: ChannelCoverage;
  sequence: AgentSequenceStep[];
  readiness: WorkspaceLaunchReadiness;
}) {
  const activeSources = strategy.sources.filter((source) => source.enabled).length;
  const watchedTerms = uniqueStrings([
    ...strategy.profile.signal_keywords,
    ...strategy.profile.competitor_watchlist,
  ]);
  const buyerFilters = uniqueStrings([
    ...strategy.profile.target_titles,
    ...strategy.profile.target_markets,
  ]);
  const readyGates = [
    buyerFilters.length > 0 || Boolean(strategy.icp),
    activeSources > 0,
    signalMix.qualified_7d > 0,
    contacts.verified_email > 0 || contacts.with_linkedin > 0,
    coverage.email.connected || coverage.linkedIn.connected,
    sequence.length > 0,
  ].filter(Boolean).length;
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const nextAction = readinessNextAction(readiness);
  const nextSource = nextSourceCheck(strategy.sources);
  const signalWarnings = signalReadinessWarnings(signalMix);
  return (
    <section className="section-note grid gap-5" aria-label="Agent setup snapshot">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Agent setup
          </p>
          <h2
            className="mt-1 text-[18px] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Signal mix, contact proof, and outreach readiness.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            Buyer fit creates source checks. Qualified signals resolve people.
            Verified handles become judged email or LinkedIn outreach.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1 font-mono text-[12px] text-[var(--color-text-2)]">
            {readyGates}/6 gates ready
          </span>
          <Link
            href={
              readiness.launch_ready
                ? "/dashboard/agent#qualified-signals"
                : nextAction.href
            }
            prefetch
            className={readiness.launch_ready ? "btn-solid-sm" : "btn-quiet-sm"}
          >
            <Icon
              name={readiness.launch_ready ? "send" : nextAction.icon}
              size={14}
            />
            {readiness.launch_ready ? "Prepare outreach" : nextAction.label}
          </Link>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
        <article className="grid content-start gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <span className="flex items-start justify-between gap-3">
            <span className="grid size-9 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Icon name="person_search" size={17} />
            </span>
            <OpportunityPill tone={buyerFilters.length > 0 ? "ready" : "waiting"}>
              {buyerFilters.length > 0 ? "Tuned" : "Needs buyer fit"}
            </OpportunityPill>
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Buyer and sources
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
              {strategy.icp?.name ??
                "Profile defines the buyer filters and signal scanner."}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <MiniStat label="Active sources" value={activeSources} />
            <MiniStat label="Watched terms" value={watchedTerms.length} />
            <MiniStat
              label="Fit gate"
              value={Math.round((strategy.icp?.match_threshold ?? 0.6) * 100)}
            />
            <MiniStat
              label="Next check"
              value={sourceCheckLabel(nextSource?.next_check_at ?? null)}
            />
          </div>
          <StrategyChips
            icon="sensors"
            label="Watched signals"
            values={watchedTerms}
            empty="Add signal keywords"
          />
          {nextSource ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs leading-5 text-[var(--color-text-3)]">
              <Icon name="schedule" size={13} />
              Next source check: {nextSource.name}{" "}
              {sourceCheckLabel(nextSource.next_check_at)}.
            </p>
          ) : null}
        </article>

        <article className="grid content-start gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <span className="flex flex-wrap items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                Signal mix, last 7 days
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
                Shows which timing categories are becoming qualified contacts
                and drafts this week.
              </span>
            </span>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 font-mono text-xs text-[var(--color-text-3)]">
              {signalMix.qualified_7d}/{signalMix.seen_7d} qualified
            </span>
          </span>
          {signalMix.rows.length === 0 ? (
            <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
              No recent signal mix yet. Check sources from Profile or Agent to
              start the first qualified timing run.
            </div>
          ) : (
            <div className="grid gap-2">
              {signalMix.rows.map((row) => (
                <SignalMixRow key={row.kind} row={row} />
              ))}
            </div>
          )}
          <div className="grid gap-2 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">
                <Icon name="warning" size={13} />
                Weak signal warnings
              </span>
              <span className="font-mono text-[11px] text-[var(--color-text-4)]">
                {signalWarnings.length} open
              </span>
            </span>
            {signalWarnings.length === 0 ? (
              <p className="rounded-[8px] bg-[var(--color-pos-bg)] px-3 py-2 text-xs leading-5 text-[var(--color-pos)]">
                Signal flow is clearing the launch gates: qualified timing,
                contact proof, and draft proof are all present this week.
              </p>
            ) : (
              <div className="grid gap-2">
                {signalWarnings.map((warning) => (
                  <Link
                    key={warning.key}
                    href={warning.href}
                    prefetch
                    className="group grid gap-2 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 transition hover:bg-[var(--color-ink-3)]"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
                        <Icon name={warning.icon} size={14} />
                        <span className="truncate">{warning.label}</span>
                      </span>
                      <OpportunityPill tone={warning.tone}>
                        Fix
                      </OpportunityPill>
                    </span>
                    <span className="text-xs leading-5 text-[var(--color-text-3)]">
                      {warning.detail}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </article>

        <article className="grid content-start gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <span className="flex items-start justify-between gap-3">
            <span className="grid size-9 place-items-center rounded-[8px] bg-[var(--color-pos-bg)] text-[var(--color-pos)]">
              <Icon name="verified" size={17} />
            </span>
            <OpportunityPill
              tone={
                coverage.email.connected || coverage.linkedIn.connected
                  ? "ready"
                  : "waiting"
              }
            >
              {coverage.email.connected || coverage.linkedIn.connected
                ? "Output ready"
                : "Connect channel"}
            </OpportunityPill>
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Outreach conversion
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
              Verified contacts, connected channels, and approval rules decide
              whether qualified signals become email sends, LinkedIn DMs, or
              accepted-connection follow-ups.
            </p>
          </div>
          <div className="grid gap-2">
            <SetupGateRow
              icon="mail"
              label="Verified emails"
              value={contacts.verified_email}
              ready={contacts.verified_email > 0}
            />
            <SetupGateRow
              icon="linkedin"
              label="LinkedIn profiles"
              value={contacts.with_linkedin}
              ready={contacts.with_linkedin > 0}
            />
            <SetupGateRow
              icon="rule"
              label="Outreach rules"
              value={sequence.length}
              ready={sequence.length > 0}
            />
            <SetupGateRow
              icon="send"
              label="Sent this week"
              value={sent7d}
              ready={sent7d > 0}
            />
          </div>
        </article>
      </div>
    </section>
  );
}

function signalReadinessWarnings(
  signalMix: AgentSignalMix,
): SignalReadinessWarning[] {
  const warnings: SignalReadinessWarning[] = [];

  if (signalMix.seen_7d === 0) {
    return [
      {
        key: "no-signal-volume",
        label: "No signal volume yet",
        detail:
          "No fresh signals landed this week. Check source cadence and buyer terms before expecting outreach.",
        icon: "sensors",
        tone: "waiting",
        href: "/dashboard/profile#signal-setup",
      },
    ];
  }

  if (signalMix.qualified_7d === 0) {
    warnings.push({
      key: "signals-not-qualifying",
      label: "Signals are not qualifying",
      detail: `${signalMix.seen_7d} seen this week, none qualified. Tighten buyer fit, source terms, or score thresholds.`,
      icon: "rule",
      tone: "review",
      href: "/dashboard/profile#signal-setup",
    });
  }

  if (signalMix.qualified_7d > 0 && signalMix.with_contact_7d === 0) {
    warnings.push({
      key: "qualified-signals-need-contacts",
      label: "Qualified signals need contacts",
      detail: `${signalMix.qualified_7d} qualified signals have no verified email or LinkedIn profile yet.`,
      icon: "person_search",
      tone: "blocked",
      href: "/dashboard/agent#qualified-signals",
    });
  }

  if (signalMix.with_contact_7d > 0 && signalMix.with_draft_7d === 0) {
    warnings.push({
      key: "contacts-need-drafts",
      label: "Contacts need drafts",
      detail: `${signalMix.with_contact_7d} qualified contacts are ready, but none have judged email or LinkedIn drafts.`,
      icon: "rate_review",
      tone: "review",
      href: "/dashboard/agent#qualified-signals",
    });
  }

  const rowWarnings: SignalReadinessWarning[] = [];
  for (const row of signalMix.rows) {
    const qualified = Number(row.qualified_7d);
    const withContact = Number(row.with_contact_7d);
    const withDraft = Number(row.with_draft_7d);
    const label = signalKindLabel(row.kind);
    if (qualified > 0 && withContact === 0) {
      rowWarnings.push({
        key: `${row.kind}-contacts`,
        label: `${label} needs contacts`,
        detail: `${qualified} qualified ${label.toLowerCase()} signals have no verified email or LinkedIn profile.`,
        icon: "person_search",
        tone: "blocked",
        href: "/dashboard/agent#qualified-signals",
      });
      continue;
    }
    if (withContact > 0 && withDraft === 0) {
      rowWarnings.push({
        key: `${row.kind}-drafts`,
        label: `${label} needs drafts`,
        detail: `${withContact} ${label.toLowerCase()} contacts are reachable but waiting on judged outreach.`,
        icon: "rate_review",
        tone: "review",
        href: "/dashboard/agent#qualified-signals",
      });
    }
  }

  return [...warnings, ...rowWarnings].slice(0, 3);
}

function SignalMixRow({ row }: { row: AgentSignalMixRow }) {
  const seen = Number(row.seen_7d);
  const qualified = Number(row.qualified_7d);
  const width = seen > 0 ? Math.max(6, Math.round((qualified / seen) * 100)) : 0;
  return (
    <div className="grid gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.55fr)] md:items-center">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
          {signalKindLabel(row.kind)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-3)]">
          {row.with_contact_7d} with contacts, {row.with_draft_7d} with drafts
        </span>
      </span>
      <span>
        <span className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-3)]">
          <span>{qualified} qualified</span>
          <span>{seen} seen</span>
        </span>
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--color-ink-3)]">
          <span
            className="block h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${width}%` }}
          />
        </span>
      </span>
    </div>
  );
}

function SetupGateRow({
  icon,
  label,
  value,
  ready,
}: {
  icon: string;
  label: string;
  value: number;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--color-text-2)]">
        <Icon name={icon} size={14} />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        <strong className="text-xs tabular-nums text-[var(--color-text-1)]">
          {value}
        </strong>
        <span
          className={
            "size-2 rounded-full " +
            (ready ? "bg-[var(--color-pos)]" : "bg-[var(--color-text-4)]")
          }
        />
      </span>
    </div>
  );
}

async function loadSafeRepsState(workspaceId: string): Promise<RepsState> {
  try {
    return await loadRepsState(workspaceId);
  } catch (err) {
    console.error("[dashboard/agent] failed to load agent state", err);
    return emptyRepsState(workspaceId);
  }
}

function emptyRepsState(workspaceId: string): RepsState {
  return {
    reps: [],
    heatingUpAccounts: 0,
    channels: [],
    readiness: {
      workspace_id: workspaceId,
      checked_at: new Date().toISOString(),
      required_channel: "any",
      status: "blocked",
      launch_ready: false,
      next_action: "configure_profile",
      checks: [],
      blockers: ["Agent state is temporarily unavailable."],
      warnings: [],
    },
    activity: {
      active_workflows: 0,
      events_last_hour: 0,
      signals_last_hour: 0,
      contacts_last_hour: 0,
      drafts_last_hour: 0,
      outbound_last_hour: 0,
      replies_last_hour: 0,
      reviews_pending: 0,
      event_types: [],
    },
    strategy: {
      icp: null,
      profile: {
        signal_keywords: [],
        competitor_watchlist: [],
        target_titles: [],
        target_markets: [],
        exclusion_rules: [],
      },
      sources: [],
      sequence: [],
    },
    outreach: {
      recent: [],
      accepted_followups: [],
      email_sent_7d: 0,
      linkedin_sent_7d: 0,
      linkedin_invites_7d: 0,
      linkedin_accepts_7d: 0,
      linkedin_messages_7d: 0,
      email_replies_7d: 0,
      linkedin_invite_replies_7d: 0,
      linkedin_message_replies_7d: 0,
      awaiting_reply: 0,
    },
    replies: {
      recent: [],
      replies_7d: 0,
      drafted_replies: 0,
      meeting_intent: 0,
      prep_ready: 0,
    },
    reviews: {
      pending_count: 0,
      recent: [],
    },
    rejectedDrafts: {
      recent: [],
    },
    opportunities: {
      signals: [],
      stats: {
        qualified: 0,
        with_verified_contacts: 0,
        with_outreach_draft: 0,
        with_email_draft: 0,
        ready_for_review: 0,
        blocked_by_fit: 0,
      },
    },
    contacts: {
      recent: [],
      reachable: 0,
      with_email: 0,
      verified_email: 0,
      with_linkedin: 0,
      linkedin_only: 0,
      needs_fit_review: 0,
      blocked_by_fit: 0,
      draft_ready: 0,
      contacted: 0,
      replied: 0,
      fit_reviewed: 0,
      in_outreach: 0,
      fresh_signals: 0,
    },
    learning: {
      positive_replies_7d: 0,
      meetings_7d: 0,
      useful_outcomes_30d: 0,
      strategy_summary: null,
      strategy_updated_at: null,
      skill_summary: null,
      skill_updated_at: null,
      recommended_patterns: 0,
    },
    signalMix: {
      rows: [],
      seen_7d: 0,
      qualified_7d: 0,
      with_contact_7d: 0,
      with_draft_7d: 0,
    },
    outputDestinations: buildOutputDestinations({
      email_connected: false,
      linkedin_connected: false,
      crm_connected: false,
      launch_ready: false,
    }),
  };
}

function AgentAdvancedDetails({
  activity,
  contacts,
  coverage,
  learning,
  primaryAgent,
  readiness,
  reps,
  sequence,
  signalMix,
  strategy,
}: {
  activity: AgentActivity;
  contacts: AgentContactSummary;
  coverage: ChannelCoverage;
  learning: AgentLearningSummary;
  primaryAgent: RepRow | null;
  readiness: WorkspaceLaunchReadiness;
  reps: RepRow[];
  sequence: AgentSequenceStep[];
  signalMix: AgentSignalMix;
  strategy: AgentSourceStrategy;
}) {
  const activeSources = strategy.sources.filter((source) => source.enabled).length;
  const readyChecks = readiness.checks.filter(
    (check) => check.status === "ready",
  ).length;
  const emailPolicy = primaryAgent?.autonomy?.channels?.email;
  const linkedInPolicy = primaryAgent
    ? firstChannelPolicy(primaryAgent, ["linkedin_dm", "linkedin"])
    : undefined;
  const operatingMode = primaryAgent
    ? agentOperatingMode(emailPolicy, linkedInPolicy)
    : null;
  return (
    <details
      id="advanced"
      className="group rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 marker:hidden md:px-5">
        <span>
          <span className="block text-sm font-semibold text-[var(--color-text-1)]">
            Advanced / Details
          </span>
          <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
            Source checks, message optimization, channel limits, and setup
            details.
          </span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 text-xs font-medium text-[var(--color-text-2)]">
          <Icon
            name="expand_more"
            size={14}
            className="transition-transform group-open:rotate-180"
          />
          Show details
        </span>
      </summary>

      <div className="grid gap-4 border-t border-[var(--color-line-1)] p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <section className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-1)]">
                  Learning and optimization
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                  Use recent replies and meetings to improve source choice and
                  message patterns.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={optimizeCampaignStrategyAction}>
                  <input type="hidden" name="return_to" value="/dashboard/agent#advanced" />
                  <input type="hidden" name="lookback_days" value="30" />
                  <input type="hidden" name="min_samples" value="3" />
                  <PendingSubmitButton
                    className="btn-quiet-sm"
                    icon="auto_graph"
                    iconSize={14}
                    pendingLabel="Optimizing"
                  >
                    Optimize strategy
                  </PendingSubmitButton>
                </form>
                <form action={optimizePlaySkillsAction}>
                  <input type="hidden" name="return_to" value="/dashboard/agent#advanced" />
                  <input type="hidden" name="lookback_days" value="30" />
                  <input type="hidden" name="min_samples" value="3" />
                  <PendingSubmitButton
                    className="btn-solid-sm"
                    icon="science"
                    iconSize={14}
                    pendingLabel="Optimizing"
                  >
                    Optimize messages
                  </PendingSubmitButton>
                </form>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <MiniStat label="Positive replies" value={learning.positive_replies_7d} />
              <MiniStat label="Meetings" value={learning.meetings_7d} />
              <MiniStat label="Active reps" value={reps.length} />
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              <LearningSummaryCard
                icon="auto_graph"
                title="Strategy note"
                summary={learning.strategy_summary}
                updatedAt={learning.strategy_updated_at}
                empty="No strategy note yet."
              />
              <LearningSummaryCard
                icon="science"
                title="Message note"
                summary={learning.skill_summary}
                updatedAt={learning.skill_updated_at}
                empty="No message note yet."
              />
            </div>
          </section>

          <section className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-1)]">
                  Channels and autonomy
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                  Connected accounts, daily limits, and approval mode.
                </p>
              </div>
              <Link href="/dashboard/profile#channels" prefetch className="btn-quiet-sm">
                <Icon name="account_tree" size={14} />
                Manage channels
              </Link>
            </div>
            <div className="mt-4 grid gap-2">
              <AgentChannelPill
                title="Outlook"
                icon="mail"
                connection={coverage.email}
                policy={emailPolicy}
              />
              <AgentChannelPill
                title="LinkedIn"
                icon="linkedin"
                connection={coverage.linkedIn}
                policy={linkedInPolicy}
              />
            </div>
            <div className="mt-4">
              {operatingMode ? (
                <AgentModeControl mode={operatingMode} />
              ) : (
                <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
                  Add the outbound agent voice before enabling autonomous
                  outreach.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-1)]">
                  Signal mix and sources
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                  See which timing sources became qualified leads this week.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={checkAgentSourcesAction}>
                  <input type="hidden" name="return_to" value="/dashboard/agent#advanced" />
                  <input type="hidden" name="limit" value="25" />
                  <PendingSubmitButton
                    className="btn-quiet-sm"
                    icon="sync_alt"
                    iconSize={14}
                    pendingLabel="Checking"
                  >
                    Check sources
                  </PendingSubmitButton>
                </form>
                <form action={prepareQualifiedSignalsAction}>
                  <input type="hidden" name="limit" value="25" />
                  <input type="hidden" name="return_to" value="/dashboard/agent#leads" />
                  <PendingSubmitButton
                    className="btn-solid-sm"
                    icon="send"
                    iconSize={14}
                    pendingLabel="Preparing"
                  >
                    Prepare outreach
                  </PendingSubmitButton>
                </form>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="grid gap-2">
                {signalMix.rows.length === 0 ? (
                  <p className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
                    No signal mix yet. Check sources to start a fresh run.
                  </p>
                ) : (
                  signalMix.rows.map((row) => (
                    <SignalMixRow key={row.kind} row={row} />
                  ))
                )}
              </div>
              <div className="grid content-start gap-2">
                <MiniStat label="Active sources" value={activeSources} />
                <MiniStat label="Qualified 7d" value={signalMix.qualified_7d} />
                <MiniStat label="Leads found" value={contacts.reachable} />
              </div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {strategy.sources.length === 0 ? (
                <p className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
                  No sources configured yet.
                </p>
              ) : (
                strategy.sources.map((source) => (
                  <SourceHealthRow key={source.id} source={source} />
                ))
              )}
            </div>
          </section>

          <section className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-1)]">
                  Setup details
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                  Profile, sources, channels, and outreach rules.
                </p>
              </div>
              <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
                {readyChecks}/{Math.max(readyChecks, readiness.checks.length)} ready
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              {readiness.checks.length === 0 ? (
                <p className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
                  Setup checks are not available right now.
                </p>
              ) : (
                readiness.checks.map((check) => (
                  <ReadinessCheckRow key={check.id} check={check} />
                ))
              )}
            </div>
            <div className="mt-4 grid gap-2 border-t border-[var(--color-line-1)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)]">
                Plays and limits
              </p>
              {sequence.length === 0 ? (
                <p className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
                  No email or LinkedIn play is active yet.
                </p>
              ) : (
                sequence.map((step) => (
                  <PlayLimitRow key={step.id} step={step} />
                ))
              )}
              <Link href="/dashboard/profile#agent" prefetch className="btn-quiet-sm w-fit">
                <Icon name="rule" size={14} />
                Edit rules
              </Link>
            </div>
          </section>
        </div>

        <section className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Recent activity
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                Last-hour source checks, drafts, sends, and replies.
              </p>
            </div>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
              {activity.active_workflows} active
            </span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {agentLastHourStages(activity).map((stage) => (
              <MiniStat key={stage.key} label={stage.label} value={stage.value} />
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

function SourceHealthRow({ source }: { source: AgentSourceRow }) {
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {source.name}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {source.signal_kind ? signalKindLabel(source.signal_kind) : statusLabel(source.kind)}
          </span>
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (source.enabled
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {source.enabled ? "On" : "Off"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="Seen" value={source.signals_week} />
        <MiniStat label="Qualified" value={source.matched_week} />
        <MiniStat label="Next" value={sourceCheckLabel(source.next_check_at)} />
      </div>
      {source.last_error ? (
        <p className="mt-2 rounded-[8px] bg-[var(--color-warn-bg)] px-3 py-2 text-xs leading-5 text-[var(--color-warn)]">
          Needs attention.
        </p>
      ) : null}
    </div>
  );
}

function ReadinessCheckRow({ check }: { check: LaunchReadinessCheck }) {
  const ready = check.status === "ready";
  return (
    <Link
      href={check.action?.surface ?? readinessFallbackHref(check)}
      prefetch
      className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 transition-colors hover:bg-[var(--color-ink-3)]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={
            "grid size-7 shrink-0 place-items-center rounded-[8px] " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]")
          }
        >
          <Icon name={ready ? "check_circle" : readinessActionIcon(check)} size={14} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[var(--color-text-1)]">
            {check.label}
          </span>
          <span className="block truncate text-[11px] text-[var(--color-text-3)]">
            {check.detail}
          </span>
        </span>
      </span>
      <span
        className={
          "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
          (ready
            ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
            : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
        }
      >
        {ready ? "Ready" : "Needed"}
      </span>
    </Link>
  );
}

function PlayLimitRow({ step }: { step: AgentSequenceStep }) {
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-0)] text-[var(--color-text-2)]">
            <ChannelMark channel={step.channel} size={14} />
          </span>
          <span className="truncate text-xs font-semibold text-[var(--color-text-1)]">
            {step.name}
          </span>
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
          {statusLabel(step.status)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-3)]">
        <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1">
          {channelLabel(step.channel)}
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1">
          {step.daily_cap ?? "No"} daily limit
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1">
          {approvalLabel(step.approval ?? "custom")}
        </span>
      </div>
    </div>
  );
}

function AgentSystemPanel({
  readiness,
  strategy,
  sequence,
  learning,
  primaryAgent,
  coverage,
}: {
  readiness: WorkspaceLaunchReadiness;
  strategy: AgentSourceStrategy;
  sequence: AgentSequenceStep[];
  learning: AgentLearningSummary;
  primaryAgent: RepRow | null;
  coverage: ChannelCoverage;
}) {
  const activeSources = strategy.sources.filter((source) => source.enabled).length;
  const readyChecks = readiness.checks.filter(
    (check) => check.status === "ready",
  ).length;
  const next = readinessNextAction(readiness);
  const emailPolicy = primaryAgent?.autonomy?.channels?.email;
  const linkedInPolicy = primaryAgent
    ? firstChannelPolicy(primaryAgent, ["linkedin_dm", "linkedin"])
    : undefined;
  const operatingMode = primaryAgent
    ? agentOperatingMode(emailPolicy, linkedInPolicy)
    : null;
  const learningCount =
    learning.positive_replies_7d +
    learning.meetings_7d +
    learning.recommended_patterns;
  return (
    <div id="system" className="scroll-mt-28">
      <SurfaceSection
        title="System status"
        action={
          <Link href="/dashboard/profile#agent" className="btn-quiet-sm">
            <Icon name="edit_note" size={14} />
            Tune in Profile
          </Link>
        }
      >
      <div className="grid gap-3 lg:grid-cols-4">
        <SystemStatusCard
          icon={readiness.launch_ready ? "check_circle" : "sync_problem"}
          title={readiness.launch_ready ? "Ready to send" : "Outreach gated"}
          value={`${readyChecks}/${Math.max(readyChecks, readiness.checks.length)} checks`}
          detail={
            readiness.blockers[0] ??
            readiness.warnings[0] ??
            "Profile, sources, channels, and approval gates are healthy."
          }
          href={next.href}
          action={next.label}
          ready={readiness.launch_ready}
        />
        <SystemStatusCard
          icon="sensors"
          title="Signal sources"
          value={`${activeSources} active`}
          detail={
            strategy.sources[0]?.name ??
            "Profile setup creates launch, hiring, funding, and competitor sources."
          }
          href="/dashboard/agent#qualified-signals"
          action="Open signals"
          ready={activeSources > 0}
        />
        <SystemStatusCard
          icon="rule"
          title="Outreach rules"
          value={`${sequence.length} rule set${sequence.length === 1 ? "" : "s"}`}
          detail={
            coverage.email.connected || coverage.linkedIn.connected
              ? "Email sends and LinkedIn actions follow connected-account caps and approval gates."
              : "Connect Outlook or LinkedIn before the agent can send."
          }
          href="/dashboard/profile#channels"
          action="Review channels"
          ready={coverage.email.connected || coverage.linkedIn.connected}
        />
        <SystemStatusCard
          icon="auto_graph"
          title="Learning loop"
          value={`${learningCount} signal${learningCount === 1 ? "" : "s"}`}
          detail={
            learning.strategy_summary ??
            learning.skill_summary ??
            "Replies and meetings teach the agent which signals and messages to scale."
          }
          href="/dashboard/agent#replies"
          action="Review replies"
          ready={learningCount > 0}
        />
      </div>

      <AgentGetStartedChecklist readiness={readiness} coverage={coverage} />

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Agent controls
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                Voice, limits, account connections, and contact-quality rules
                stay in Profile so the Agent page remains an execution surface.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={checkAgentSourcesAction}>
                <input type="hidden" name="return_to" value="/dashboard/agent" />
                <input type="hidden" name="limit" value="25" />
                <PendingSubmitButton
                  className="btn-quiet-sm"
                  icon="sync_alt"
                  iconSize={14}
                  pendingLabel="Checking"
                >
                  Check sources
                </PendingSubmitButton>
              </form>
              <form action={optimizePlaySkillsAction}>
                <input type="hidden" name="return_to" value="/dashboard/agent#replies" />
                <input type="hidden" name="lookback_days" value="30" />
                <input type="hidden" name="min_samples" value="3" />
                <PendingSubmitButton
                  className="btn-quiet-sm"
                  icon="science"
                  iconSize={14}
                  pendingLabel="Optimizing"
                >
                  Optimize messages
                </PendingSubmitButton>
              </form>
            </div>
          </div>
          {operatingMode ? (
            <div className="mt-4">
              <AgentModeControl mode={operatingMode} />
            </div>
          ) : (
            <div className="mt-4 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
              Configure the outbound agent in Profile before enabling
              autonomous outreach.
            </div>
          )}
        </div>

        <div className="section-note">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Channel health
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            Bombsell sends only through connected accounts with explicit caps.
          </p>
          <div className="mt-4 grid gap-2">
            <AgentChannelPill
              title="Email"
              icon="mail"
              connection={coverage.email}
              policy={emailPolicy}
            />
            <AgentChannelPill
              title="LinkedIn"
              icon="linkedin"
              connection={coverage.linkedIn}
              policy={linkedInPolicy}
              comingSoon
            />
          </div>
        </div>
      </div>
      </SurfaceSection>
    </div>
  );
}

function AgentGetStartedChecklist({
  readiness,
  coverage,
}: {
  readiness: WorkspaceLaunchReadiness;
  coverage: ChannelCoverage;
}) {
  const steps = [
    {
      title: "Profile and buyer fit",
      detail: "Company context, buyer profile, and Agent voice are ready.",
      blocked: "Complete Profile so signals can be matched and personalized.",
      href: "/dashboard/profile#profile",
      icon: "badge",
      ready: launchChecksReady(readiness, ["workspace_profile", "icp", "rep"]),
    },
    {
      title: "Email or LinkedIn account",
      detail: channelSetupDetail(coverage),
      blocked: "Connect Outlook or LinkedIn before outreach can leave.",
      href: "/dashboard/profile#channels",
      icon: "account_tree",
      ready: coverage.email.connected || coverage.linkedIn.connected,
    },
    {
      title: "Qualified signal sources",
      detail: "The Agent is watching sources for fresh timing evidence.",
      blocked: "Check sources so the Agent can find qualified signals.",
      href: "/dashboard/agent#qualified-signals",
      icon: "sensors",
      ready: launchChecksReady(readiness, ["signal_sources"]),
    },
    {
      title: "Outreach rules",
      detail: "Judged email or LinkedIn rules can move contacts to outreach.",
      blocked: "Set email or LinkedIn rules before signals can become messages.",
      href: "/dashboard/agent#outreach",
      icon: "send",
      ready: launchChecksReady(readiness, ["plays"]),
    },
  ];
  const readyCount = steps.filter((step) => step.ready).length;
  const next = readinessNextAction(readiness);
  return (
    <div className="mt-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Get started
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            One path from Profile to signals, verified contacts, judged
            outreach, and replies.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 font-mono text-xs text-[var(--color-text-3)]">
            {readyCount}/{steps.length} ready
          </span>
          <Link href={next.href} prefetch className="btn-quiet-sm">
            <Icon name={next.icon} size={14} />
            {next.label}
          </Link>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <Link
            key={step.title}
            href={step.href}
            prefetch
            className="group grid min-h-[126px] gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-3)]"
          >
            <span className="flex items-center justify-between gap-3">
              <span
                className={
                  "grid size-8 place-items-center rounded-[8px] " +
                  (step.ready
                    ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                    : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
                }
              >
                <Icon name={step.ready ? "check_circle" : step.icon} size={15} />
              </span>
              <span
                className={
                  "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
                  (step.ready
                    ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                    : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
                }
              >
                {step.ready ? "Ready" : "Needed"}
              </span>
            </span>
            <span>
              <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                {step.title}
              </span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--color-text-3)]">
                {step.ready ? step.detail : step.blocked}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function launchChecksReady(
  readiness: WorkspaceLaunchReadiness,
  ids: LaunchReadinessCheck["id"][],
): boolean {
  return ids.every((id) =>
    readiness.checks.some((check) => check.id === id && check.status === "ready"),
  );
}

function channelSetupDetail(coverage: ChannelCoverage): string {
  if (coverage.email.connected && coverage.linkedIn.connected) {
    return "Email and LinkedIn are connected for native outreach.";
  }
  if (coverage.email.connected) {
    return "Email is connected; LinkedIn can add DMs when ready.";
  }
  if (coverage.linkedIn.connected) {
    return "LinkedIn is connected; Outlook can add email when ready.";
  }
  return "Connect Outlook or LinkedIn before outreach can leave.";
}

function SystemStatusCard({
  icon,
  title,
  value,
  detail,
  href,
  action,
  ready,
}: {
  icon: string;
  title: string;
  value: string;
  detail: string;
  href: string;
  action: string;
  ready: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      className="group grid gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]"
    >
      <span className="flex items-start justify-between gap-3">
        <span
          className={
            "grid size-9 place-items-center rounded-[8px] " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          <Icon name={icon} size={17} />
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]")
          }
        >
          {ready ? "Ready" : "Needs setup"}
        </span>
      </span>
      <span>
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </span>
        <span className="mt-1 block text-xl font-semibold tabular-nums text-[var(--color-text-1)]">
          {value}
        </span>
        <span className="mt-2 block line-clamp-3 text-xs leading-5 text-[var(--color-text-3)]">
          {detail}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)]">
        {action}
        <Icon
          name="arrow_forward"
          size={13}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}

function StrategyChips({
  icon,
  label,
  values,
  empty,
}: {
  icon: string;
  label: string;
  values: string[];
  empty: string;
}) {
  const visible = values.slice(0, 3);
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-3)]">
        <Icon name={icon} size={13} />
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.length === 0 ? (
          <span className="text-xs text-[var(--color-text-4)]">{empty}</span>
        ) : (
          <>
            {visible.map((value) => (
              <span
                key={value}
                className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-2)]"
              >
                {value}
              </span>
            ))}
            {values.length > visible.length ? (
              <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
                +{values.length - visible.length}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function AgentLeadsPanel({
  opportunities,
  contacts,
}: {
  opportunities: QualifiedSignalWorkbench;
  contacts: AgentContactSummary;
}) {
  const leadSignals = opportunities.signals.filter(isLeadStageSignal);
  return (
    <div id="leads" className="scroll-mt-28">
      <span id="qualified-signals" className="sr-only" aria-hidden="true" />
      <SurfaceSection
        title="Leads the agent is contacting"
        action={
          <form action={prepareQualifiedSignalsAction}>
            <input type="hidden" name="limit" value="25" />
            <input type="hidden" name="return_to" value="/dashboard/agent#leads" />
            <PendingSubmitButton
              className="btn-quiet-sm"
              icon="send"
              iconSize={14}
              pendingLabel="Preparing"
            >
              Prepare outreach
            </PendingSubmitButton>
          </form>
        }
      >
        <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Qualified leads
              </p>
              <p className="mt-1 max-w-[70ch] text-xs leading-5 text-[var(--color-text-3)]">
                A scannable view of who the agent is working, why now matters,
                and whether the next touch is drafted or waiting.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConversationProofPill icon="person_search">
                {contacts.in_outreach} in outreach
              </ConversationProofPill>
              <ConversationProofPill icon="rate_review">
                {opportunities.stats.ready_for_review} drafted
              </ConversationProofPill>
            </div>
          </div>

          {leadSignals.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No leads ready yet"
                hint="When a qualified signal has a reachable person, it appears here as a lead."
                cta={{
                  href: "/dashboard/profile#profile",
                  label: "Tune profile",
                  icon: "person_search",
                }}
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {leadSignals.map((signal) => (
                <AgentLeadRow key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentLeadRow({ signal }: { signal: QualifiedSignalItem }) {
  const contact = signal.contacts[0];
  const draft = signal.outreach_draft;
  const company = signal.company.name ?? signal.company.domain ?? "Unknown company";
  const score =
    signal.match_score == null ? null : Math.round(signal.match_score * 100);
  const href = opportunityHref(signal, contact);
  const deferAction = contactDeferAction(signal.contact_defer_reason);
  const leadStatus = leadStatusLabel(signal);
  return (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]">
      <Link
        href={href}
        prefetch
        className="flex min-w-0 items-start gap-3 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
          <Icon name="person_search" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {contact?.full_name ?? company}
            {contact?.full_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {company}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {contact?.title ?? signalKindLabel(signal.kind)}
          </span>
          <span className="mt-2 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
            <span className="font-medium text-[var(--color-text-2)]">Why now:</span>{" "}
            {signal.title}
          </span>
          {signal.match_reason ? (
            <span className="mt-1 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
              {signal.match_reason}
            </span>
          ) : null}
        </span>
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] pt-3">
        <span
          className={
            "rounded-[8px] px-2.5 py-1 text-xs font-medium " +
            (leadStatus.tone === "ready"
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : leadStatus.tone === "review"
                ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
          }
        >
          {leadStatus.label}
        </span>
        {(signal.account_signal_count ?? 1) >= 2 ? (
          <span
            className="inline-flex items-center gap-1 rounded-[8px] bg-[var(--color-warn-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-warn)]"
            title="This account has multiple recent buying signals"
          >
            <Icon name="radar" size={12} />
            Hot · {signal.account_signal_count} signals
          </span>
        ) : null}
        {score == null ? null : (
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-2.5 py-1 text-xs text-[var(--color-accent)]">
            {score}% fit
          </span>
        )}
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {contact ? contactLabel(contact) : "Finding contact"}
        </span>
        {draft ? (
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            <ChannelMark channel={draft.channel} size={13} />
            {draftOpportunityLabel(draft.status, draft.channel)}
          </span>
        ) : null}
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(signal.freshness_at)}
        </span>
        {contact?.person_id ? (
          <ContactQualificationControls
            personId={contact.person_id}
            currentDecision={contact.contact_fit_decision}
            returnTo="/dashboard/agent#leads"
            compact
          />
        ) : null}
        {deferAction ? (
          <Link href={deferAction.href} className="btn-quiet-sm">
            <Icon name={deferAction.icon} size={14} />
            {deferAction.label}
          </Link>
        ) : null}
        {needsContactResolution(signal) ? (
          <form action={resolveQualifiedSignalContactsAction}>
            <input type="hidden" name="signal_id" value={signal.id} />
            <input type="hidden" name="return_to" value="/dashboard/agent#leads" />
            <PendingSubmitButton
              className="btn-quiet-sm"
              icon="person_search"
              iconSize={14}
              pendingLabel="Finding"
            >
              Find contact
            </PendingSubmitButton>
          </form>
        ) : null}
        <form action={dismissQualifiedSignalAction}>
          <input type="hidden" name="signal_id" value={signal.id} />
          <input type="hidden" name="return_to" value="/dashboard/agent#leads" />
          <input
            type="hidden"
            name="reason"
            value="Skipped from Agent because the lead is not a fit for outreach."
          />
          <PendingSubmitButton
            className="btn-quiet-sm"
            icon="block"
            iconSize={14}
            pendingLabel="Skipping"
            title="Skip lead"
          >
            Skip
          </PendingSubmitButton>
        </form>
      </div>
    </article>
  );
}

function leadStatusLabel(
  signal: QualifiedSignalItem,
): { label: string; tone: "ready" | "review" | "waiting" } {
  const draft = signal.outreach_draft;
  if (isSignalInConversationStage(signal)) {
    return { label: "Contacted", tone: "ready" };
  }
  if (draft) return { label: "Drafted", tone: "review" };
  return { label: "Waiting", tone: "waiting" };
}

function OpportunityPill({
  tone,
  children,
}: {
  tone: "blocked" | "fit" | "ready" | "review" | "waiting";
  children: ReactNode;
}) {
  const toneClass =
    tone === "blocked"
      ? "bg-[var(--color-neg-bg)] text-[var(--color-neg)]"
      : tone === "review"
        ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
        : tone === "fit"
      ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
      : tone === "ready"
        ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
        : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]";
  return (
    <span className={"rounded-[8px] px-2.5 py-1 text-xs " + toneClass}>
      {children}
    </span>
  );
}

function contactLabel(contact: QualifiedSignalContact): string {
  if (contact.verification.email_verified) return "Verified email";
  if (contact.linkedin_url) return "LinkedIn profile";
  if (contact.emails.length > 0) return "Email found";
  return "Contact found";
}

function contactDeferLabel(reason: string): string {
  const known: Record<string, string> = {
    email_auto_enrich_disabled: "Needs contact rules",
    no_email_ready_contact: "No verified email yet",
    no_linkedin_ready_contact: "No LinkedIn profile yet",
  };
  return known[reason] ?? "Needs contacts";
}

function contactDeferAction(
  reason: string | null,
): { href: string; icon: string; label: string } | null {
  if (reason === "email_auto_enrich_disabled") {
    return {
      href: "/dashboard/profile#contact-quality",
      icon: "settings",
      label: "Enable enrichment",
    };
  }
  if (reason === "no_email_ready_contact") {
    return {
      href: "/dashboard/profile#contact-quality",
      icon: "person_search",
      label: "Review contact rules",
    };
  }
  if (reason === "no_linkedin_ready_contact") {
    return {
      href: "/dashboard/profile#linkedin",
      icon: "linkedin",
      label: "Review LinkedIn",
    };
  }
  return null;
}

function needsContactResolution(signal: QualifiedSignalItem): boolean {
  const contact = signal.contacts[0];
  if (!signal.company.id) return false;
  if (signal.outreach_draft) return false;
  if (contact?.verification.email_verified || contact?.linkedin_url) return false;
  return true;
}

function draftOpportunityLabel(status: string, channel: string): string {
  const label = channelLabel(channel);
  if (status === "draft") return `${label} draft`;
  if (status === "deferred") return `${label} waiting`;
  if (status === "sent" || status === "delivered") return "Sent";
  return statusLabel(status);
}

function opportunityHref(
  signal: QualifiedSignalItem,
  contact?: QualifiedSignalContact,
): string {
  if (signal.outreach_draft) {
    return sentDraftHref(
      signal.outreach_draft.conversation_id,
      signal.outreach_draft.message_id,
    );
  }
  if (contact?.person_id) return `/dashboard/agent/contacts/${contact.person_id}`;
  return "/dashboard/agent#qualified-signals";
}

function AgentContactsPanel({
  contacts,
}: {
  contacts: AgentContactSummary;
}) {
  return (
    <div id="verified-contacts" className="scroll-mt-28">
      <SurfaceSection
        title="Verified contacts"
        action={
          <Link href="/dashboard/profile#contact-quality" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Contact quality
          </Link>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid h-fit gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Contact workbench
            </p>
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-1">
              <MiniStat label="Reachable" value={contacts.reachable} />
              <MiniStat label="Email handles" value={contacts.with_email} />
              <MiniStat label="LinkedIn profiles" value={contacts.with_linkedin} />
              <MiniStat label="Signals 14d" value={contacts.fresh_signals} />
            </div>
            <div className="grid gap-2">
              <ContactTrustStep
                icon="verified"
                label="Verified email"
                value={contacts.verified_email}
                total={contacts.reachable}
              />
              <ContactTrustStep
                icon="linkedin"
                label="LinkedIn ready"
                value={contacts.with_linkedin}
                total={contacts.reachable}
              />
              <ContactTrustStep
                icon="fact_check"
                label="Fit reviewed"
                value={contacts.fit_reviewed}
                total={contacts.reachable}
              />
              <ContactTrustStep
                icon="send"
                label="In outreach"
                value={contacts.in_outreach}
                total={contacts.reachable}
              />
            </div>
            <div className="grid gap-2 border-t border-[var(--color-line-1)] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-4)]">
                Contact lanes
              </p>
              <ContactLaneRow
                icon="mail"
                label="Email-ready"
                value={contacts.verified_email}
                tone="ready"
              />
              <ContactLaneRow
                icon="linkedin"
                label="LinkedIn-only"
                value={contacts.linkedin_only}
                tone="fit"
              />
              <ContactLaneRow
                icon="fact_check"
                label="Needs fit review"
                value={contacts.needs_fit_review}
                tone={contacts.needs_fit_review > 0 ? "review" : "quiet"}
              />
              <ContactLaneRow
                icon="block"
                label="Blocked by fit"
                value={contacts.blocked_by_fit}
                tone={contacts.blocked_by_fit > 0 ? "blocked" : "quiet"}
              />
              <ContactLaneRow
                icon="rate_review"
                label="Draft ready"
                value={contacts.draft_ready}
                tone={contacts.draft_ready > 0 ? "ready" : "quiet"}
              />
              <ContactLaneRow
                icon="send"
                label="Contacted"
                value={contacts.contacted}
                tone={contacts.contacted > 0 ? "fit" : "quiet"}
              />
              <ContactLaneRow
                icon="forum"
                label="Replied"
                value={contacts.replied}
                tone={contacts.replied > 0 ? "ready" : "quiet"}
              />
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-3)]">
              Signal-ready contacts show why now, score, email verification,
              LinkedIn profile, fit, and outreach state before the agent sends.
            </p>
          </aside>

          {contacts.recent.length === 0 ? (
            <EmptyState
              title="No verified contacts yet"
              hint="Tune the profile and connect accounts so the agent can resolve emails and LinkedIn profiles from qualified signals."
              cta={{
                href: "/dashboard/profile#profile",
                label: "Update profile",
                icon: "person",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {contacts.recent.map((contact) => (
                <AgentContactLink key={contact.id} contact={contact} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function ContactLaneRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "ready" | "fit" | "review" | "blocked" | "quiet";
}) {
  const color =
    tone === "ready"
      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
      : tone === "fit"
        ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
        : tone === "review"
          ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
          : tone === "blocked"
            ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
            : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]";
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-1)] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--color-text-2)]">
        {icon === "linkedin" ? (
          <BrandIcon name="linkedin" size={13} />
        ) : (
          <Icon name={icon} size={13} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={
          "min-w-7 rounded-[8px] px-2 py-1 text-center font-mono text-[11px] " +
          color
        }
      >
        {value}
      </span>
    </div>
  );
}

function ContactTrustStep({
  icon,
  label,
  value,
  total,
}: {
  icon: string;
  label: string;
  value: number;
  total: number;
}) {
  const ratio = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const ready = value > 0;
  return (
    <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2.5">
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            name={icon}
            size={14}
            className={ready ? "text-[var(--color-accent)]" : "text-[var(--color-text-3)]"}
          />
          <span className="truncate text-xs font-medium text-[var(--color-text-2)]">
            {label}
          </span>
        </span>
        <strong className="text-xs tabular-nums text-[var(--color-text-1)]">
          {value}
        </strong>
      </span>
      <span
        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--color-ink-3)]"
        aria-label={`${label}: ${value} of ${total} reachable contacts`}
      >
        <span
          className={
            "block h-full rounded-full " +
            (ready ? "bg-[var(--color-accent)]" : "bg-[var(--color-line-3)]")
          }
          style={{ width: `${ratio}%` }}
        />
      </span>
    </div>
  );
}

function AgentContactLink({ contact }: { contact: AgentContactRow }) {
  const company = contact.company_name ?? contact.company_domain ?? "Unknown company";
  const signals = Number(contact.fresh_signals);
  const conversations = Number(contact.conversations);
  const latestSignalKind = contact.latest_signal_kind
    ? signalKindLabel(contact.latest_signal_kind)
    : null;
  const latestSignalAt = contact.last_signal_at
    ? freshWhen(contact.last_signal_at)
    : freshWhen(contact.updated_at);
  const signalScore = signalScoreLabel(contact.latest_signal_score);
  const campaignStatus = campaignStatusLabel(contact.campaign_status);
  const nextHandoff = contactNextHandoff(contact);
  const campaignDetail =
    contact.campaign_status === "not_contacted"
      ? "No outreach"
      : `${campaignStatus}${contact.latest_outreach_channel ? ` via ${channelLabel(contact.latest_outreach_channel)}` : ""}`;
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-start">
      <Link
        href={`/dashboard/agent/contacts/${contact.id}`}
        prefetch
        className="flex min-w-0 items-start gap-3 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name="person" size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {contact.full_name}
            <span className="font-normal text-[var(--color-text-3)]">
              {" "}
              at {company}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {contact.title ?? "Role unknown"}
          </span>
          <span className="mt-2 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
            <span className="font-medium text-[var(--color-text-2)]">Why now:</span>{" "}
            {contact.latest_signal_title ??
              "Verified contact ready for the next qualified signal."}
          </span>
          <span className="mt-2 flex w-full max-w-2xl items-start gap-2 rounded-[8px] bg-[var(--color-ink-1)] px-2.5 py-2 text-xs leading-5 text-[var(--color-text-3)]">
            <span
              className={
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] " +
                (nextHandoff.tone === "ready"
                  ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                  : nextHandoff.tone === "review"
                    ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                    : "bg-[var(--color-accent-bg)] text-[var(--color-accent)]")
              }
              aria-hidden="true"
            >
              {nextHandoff.icon === "linkedin" ? (
                <BrandIcon name="linkedin" size={12} />
              ) : (
                <Icon name={nextHandoff.icon} size={12} />
              )}
            </span>
            <span className="min-w-0">
              <span className="font-medium text-[var(--color-text-2)]">
                Next handoff:
              </span>{" "}
              {nextHandoff.detail}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <ContactPill ready={Boolean(signalScore)} icon="auto_graph">
              {signalScore ?? "No signal score"}
            </ContactPill>
            <ContactPill
              ready={contact.email_status !== "missing"}
              icon={contact.email_status === "verified" ? "verified" : "mail"}
            >
              {emailStatusLabel(contact.email_status)}
            </ContactPill>
            <ContactPill ready={Boolean(contact.linkedin_url)} icon="linkedin">
              {contact.linkedin_url ? "LinkedIn profile" : "No LinkedIn"}
            </ContactPill>
            {contact.contact_fit_decision ? (
              <ContactPill ready={contact.contact_fit_decision === "fit"} icon="fact_check">
                {contactFitLabel(contact.contact_fit_decision)}
              </ContactPill>
            ) : null}
          </span>
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {latestSignalKind ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            {latestSignalKind}
          </span>
        ) : null}
        {signals > 0 ? (
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-2.5 py-1 text-xs text-[var(--color-accent)]">
            {signals} signal{signals === 1 ? "" : "s"}
          </span>
        ) : null}
        <span
          className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]"
          title={`Added to the Agent workbench ${new Date(
            contact.created_at,
          ).toLocaleString()}`}
        >
          First seen {freshWhen(contact.created_at)}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          Signal {latestSignalAt}
        </span>
        <span
          className={
            "rounded-[8px] px-2.5 py-1 text-xs " +
            (contact.campaign_status === "message_replied"
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : contact.campaign_status === "connection_accepted"
                ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : contact.campaign_status === "contacted" ||
                  contact.campaign_status === "draft_ready"
                ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
          }
          title={
            contact.last_outreach_at
              ? `${campaignStatus} ${freshWhen(contact.last_outreach_at)}`
              : campaignStatus
          }
        >
          {campaignDetail}
        </span>
        {conversations > 0 ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            {conversations} conversation{conversations === 1 ? "" : "s"}
          </span>
        ) : null}
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
            (nextHandoff.tone === "ready"
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : nextHandoff.tone === "review"
                ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                : "bg-[var(--color-accent-bg)] text-[var(--color-accent)]")
          }
          title={nextHandoff.detail}
        >
          {nextHandoff.icon === "linkedin" ? (
            <BrandIcon name="linkedin" size={13} />
          ) : (
            <Icon name={nextHandoff.icon} size={13} />
          )}
          {nextHandoff.label}
        </span>
        <ContactQualificationControls
          personId={contact.id}
          currentDecision={contact.contact_fit_decision}
          returnTo="/dashboard/agent#verified-contacts"
        />
      </div>
    </article>
  );
}

function contactNextHandoff(contact: AgentContactRow): {
  label: string;
  detail: string;
  icon: string;
  tone: "fit" | "ready" | "review";
} {
  if (contact.campaign_status === "message_replied") {
    return {
      label: "Learn from reply",
      detail:
        "Reply evidence is ready for Agent learning and meeting follow-up.",
      icon: "forum",
      tone: "ready",
    };
  }
  if (contact.campaign_status === "connection_accepted") {
    return {
      label: "Next DM",
      detail:
        "Accepted LinkedIn connection is ready for the next DM or InMail follow-up.",
      icon: "linkedin",
      tone: "ready",
    };
  }
  if (contact.campaign_status === "draft_ready") {
    return {
      label: "Review draft",
      detail:
        "Judged outreach is prepared; review the draft before it leaves the channel.",
      icon: "rate_review",
      tone: "review",
    };
  }
  if (contact.campaign_status === "contacted") {
    return {
      label: "Awaiting reply",
      detail:
        "Sent proof exists; keep this contact in Agent until reply or meeting evidence appears.",
      icon: "schedule",
      tone: "fit",
    };
  }
  if (contact.email_status === "verified") {
    return {
      label: "Email outreach",
      detail:
        "Verified email can move into judged outreach once the channel gate is ready.",
      icon: "mail",
      tone: "ready",
    };
  }
  if (contact.linkedin_url) {
    return {
      label: "LinkedIn outreach",
      detail:
        "LinkedIn profile can move into a connection request, accepted follow-up, or DM path.",
      icon: "linkedin",
      tone: "ready",
    };
  }
  if (contact.email_status === "found") {
    return {
      label: "Verify email",
      detail:
        "Email handle is present but still needs verification before sending.",
      icon: "verified",
      tone: "review",
    };
  }
  return {
    label: "Resolve contact",
    detail:
      "The signal has a person, but Agent still needs a verified email or LinkedIn profile.",
    icon: "person_search",
    tone: "review",
  };
}

function ContactQualificationControls({
  personId,
  currentDecision,
  returnTo,
  compact = false,
}: {
  personId: string;
  currentDecision: string | null;
  returnTo: string;
  compact?: boolean;
}) {
  const options = [
    {
      decision: "fit",
      label: compact ? "Fit" : "Good fit",
      icon: "check",
      note: "Marked as a good-fit contact from Agent.",
    },
    {
      decision: "unsure",
      label: "Review",
      icon: "fact_check",
      note: "Marked for fit review from Agent.",
    },
    {
      decision: "not_fit",
      label: compact ? "No" : "Not fit",
      icon: "close",
      note: "Marked as not a fit from Agent.",
    },
  ];
  return (
    <div
      className={
        "flex flex-wrap items-center gap-1.5 " +
        (compact ? "max-w-[240px]" : "md:justify-end")
      }
      aria-label="Contact qualification"
    >
      {options.map((option) => {
        const active = currentDecision === option.decision;
        return (
          <form key={option.decision} action={recordPersonFitFeedbackAction}>
            <input type="hidden" name="person_id" value={personId} />
            <input type="hidden" name="decision" value={option.decision} />
            <input type="hidden" name="note" value={option.note} />
            <input type="hidden" name="return_to" value={returnTo} />
            <PendingSubmitButton
              aria-label={`${option.label} contact`}
              title={`${option.label} contact`}
              className={
                "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-xs transition-colors " +
                (active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  : "border-[var(--color-line-1)] bg-[var(--color-ink-0)] text-[var(--color-text-2)] hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]")
              }
              icon={option.icon}
              iconSize={13}
              pendingLabel={compact ? "" : "Saving"}
            >
              {compact ? <span className="sr-only">{option.label}</span> : option.label}
            </PendingSubmitButton>
          </form>
        );
      })}
    </div>
  );
}

function ContactPill({
  ready,
  icon,
  children,
}: {
  ready: boolean;
  icon: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex max-w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (ready
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
      }
    >
      {icon === "linkedin" ? (
        <BrandIcon name="linkedin" size={13} />
      ) : (
        <Icon name={icon} size={13} />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

function AgentActivityPanel({ activity }: { activity: AgentActivity }) {
  const workStages = agentLastHourStages(activity);
  const workVolume = workStages.reduce((sum, stage) => sum + stage.value, 0);
  const maxStageValue = Math.max(1, ...workStages.map((stage) => stage.value));
  const focusStage = agentFocusStage(workStages);
  const active =
    activity.active_workflows > 0 ||
    workVolume > 0 ||
    activity.events_last_hour > 0 ||
    activity.reviews_pending > 0;
  const currentWork = agentCurrentWork(activity);
  return (
    <section
      id="activity"
      className="grid scroll-mt-28 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {active ? "Working now" : "Idle right now"}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-3)]">
              {currentWork}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
              {activity.active_workflows} active run
              {activity.active_workflows === 1 ? "" : "s"}
            </span>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-1 text-xs font-medium text-[var(--color-text-2)]">
              Focus: {focusStage.label}
            </span>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <MiniStat label="Events last hour" value={activity.events_last_hour} />
          <MiniStat label="Outreach last hour" value={activity.outbound_last_hour} />
          <MiniStat label="Needs review" value={activity.reviews_pending} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {workStages.map((stage) => (
            <AgentWorkStage key={stage.key} stage={stage} />
          ))}
        </div>
        <div
          className="relative mt-6 overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3"
          aria-label="Last-hour Agent operating loop"
        >
          <span className="agent-work-sweep" aria-hidden="true" />
          <div className="relative z-10 grid h-32 grid-cols-5 items-end gap-2">
            {workStages.map((stage, index) => {
              const focused = stage.key === focusStage.key;
              const height =
                stage.value === 0
                  ? 16
                  : Math.max(
                      26,
                      Math.round((stage.value / maxStageValue) * 100),
                    );
              const delay = `${index * 110}ms`;
              return (
                <span
                  key={stage.key}
                  className="flex h-full min-w-0 flex-col justify-end gap-2"
                  title={`${stage.label}: ${stage.value}`}
                >
                  <span
                    className={
                      "mx-auto w-full max-w-[44px] rounded-t-[6px] transition-[height] duration-500 " +
                      (focused
                        ? "agent-work-focus-bar bg-[var(--color-accent)]"
                        : stage.value > 0
                          ? "animate-pulse bg-[var(--color-accent)]/75"
                        : "bg-[var(--color-line-2)]")
                    }
                    style={{ height: `${height}%`, animationDelay: delay }}
                  />
                  <span
                    className={
                      "flex items-center justify-center " +
                      (focused
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-text-3)]")
                    }
                  >
                    <Icon name={stage.icon} size={13} />
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="section-note h-fit">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          Last-hour activity
        </p>
        <div className="mt-4 grid gap-2">
          {activity.event_types.length === 0 ? (
            <p className="text-sm leading-6 text-[var(--color-text-3)]">
              No event activity in the last hour.
            </p>
          ) : (
            activity.event_types.map((event) => (
              <div
                key={event.event_type}
                className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2"
                title={event.event_type}
              >
                <span className="truncate text-xs text-[var(--color-text-2)]">
                  {agentEventLabel(event.event_type)}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-3)]">
                  {event.count}
                </span>
              </div>
            ))
          )}
        </div>
      </aside>
    </section>
  );
}

function agentFocusStage(stages: AgentWorkStageData[]): AgentWorkStageData {
  return stages.reduce((best, stage) => {
    if (stage.value > best.value) return stage;
    return best;
  }, stages[0] ?? {
    key: "signals",
    label: "Signals checked",
    value: 0,
    icon: "fact_check",
  });
}

function AgentWorkStage({ stage }: { stage: AgentWorkStageData }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-3">
      <span className="flex items-center justify-between gap-2">
        <Icon name={stage.icon} size={14} />
        <strong className="text-base font-semibold tabular-nums text-[var(--color-text-1)]">
          {stage.value}
        </strong>
      </span>
      <span className="mt-2 block truncate text-[11px] text-[var(--color-text-3)]">
        {stage.label}
      </span>
    </div>
  );
}

function contactFitLabel(decision: string): string {
  if (decision === "fit") return "Good fit";
  if (decision === "not_fit") return "Not a fit";
  return "Needs review";
}

function signalScoreLabel(score: string | null): string | null {
  if (score == null) return null;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.round(numeric * 100)}% signal score`;
}

function emailStatusLabel(status: string): string {
  if (status === "verified") return "Verified email";
  if (status === "found") return "Email found";
  return "No email";
}

function campaignStatusLabel(status: string): string {
  if (status === "message_replied") return "Message replied";
  if (status === "connection_accepted") return "Accepted connection";
  if (status === "contacted") return "Contacted";
  if (status === "draft_ready") return "Draft ready";
  return "Not contacted";
}

function AgentOperatingLoopPanel({
  activity,
  opportunities,
  contacts,
  outreach,
  coverage,
}: {
  activity: AgentActivity;
  opportunities: QualifiedSignalWorkbench;
  contacts: AgentContactSummary;
  outreach: AgentOutreachSummary;
  coverage: ChannelCoverage;
}) {
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const loopSteps = [
    {
      icon: "sensors",
      title: "Qualified signals",
      value: opportunities.stats.qualified,
      detail: `${opportunities.stats.with_verified_contacts} with verified contacts`,
      href: "/dashboard/agent#qualified-signals",
      tone: "fit" as const,
    },
    {
      icon: "person_search",
      title: "Verified contacts",
      value: contacts.reachable,
      detail: `${contacts.with_email} email, ${contacts.with_linkedin} LinkedIn`,
      href: "/dashboard/agent#verified-contacts",
      tone: "ready" as const,
    },
    {
      icon: "rate_review",
      title: "Judged drafts",
      value: opportunities.stats.with_outreach_draft,
      detail: `${opportunities.stats.ready_for_review} need review`,
      href: "/dashboard/agent#qualified-signals",
      tone: "waiting" as const,
    },
    {
      icon: "send",
      title: "Sent outreach",
      value: sent7d,
      detail: `${outreach.awaiting_reply} awaiting reply`,
      href: "/dashboard/agent#outreach",
      tone: "ready" as const,
    },
  ];
  return (
    <SurfaceSection
      title="Signal-to-outreach operating loop"
      action={
        <Link href="/dashboard/profile#channels" className="btn-quiet-sm">
          <Icon name="account_tree" size={14} />
          Connect channels
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid auto-rows-max gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            {loopSteps.map((step) => (
              <Link
                key={step.title}
                href={step.href}
                className="group rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]"
              >
                <span className="flex items-center justify-between gap-3">
                  <span
                    className={
                      "grid size-9 place-items-center rounded-[8px] " +
                      (step.tone === "fit"
                        ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                        : step.tone === "ready"
                          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
                    }
                  >
                    <Icon name={step.icon} size={17} />
                  </span>
                  <Icon
                    name="arrow_forward"
                    size={14}
                    className="text-[var(--color-text-4)] transition-colors group-hover:text-[var(--color-accent)]"
                  />
                </span>
                <strong className="mt-4 block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
                  {step.value}
                </strong>
                <span className="mt-1 block text-sm font-medium text-[var(--color-text-1)]">
                  {step.title}
                </span>
                <span className="mt-2 block text-xs leading-5 text-[var(--color-text-3)]">
                  {step.detail}
                </span>
              </Link>
            ))}
          </div>

          <AgentHotSignalPaths signals={opportunities.signals.slice(0, 3)} />
        </div>

        <aside className="section-note h-fit">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Channel readiness
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            The agent can only turn quality signals into email or LinkedIn
            outreach when the destination account is connected and capped.
          </p>
          <div className="mt-4 grid gap-2">
            <OperatingLoopChannel
              title="Email"
              channel="email"
              connection={coverage.email}
              count={outreach.email_sent_7d}
            />
            <OperatingLoopChannel
              title="LinkedIn DMs"
              channel="linkedin_dm"
              connection={coverage.linkedIn}
              count={outreach.linkedin_messages_7d}
            />
          </div>
          <div className="mt-4 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2 text-xs leading-5 text-[var(--color-text-3)]">
            Last hour: {activity.signals_last_hour} signals checked,{" "}
            {activity.contacts_last_hour} contacts resolved,{" "}
            {activity.drafts_last_hour} drafts prepared.
          </div>
        </aside>
      </div>
    </SurfaceSection>
  );
}

function AgentModeCards({
  strategy,
  opportunities,
  contacts,
  outreach,
  coverage,
}: {
  strategy: AgentSourceStrategy;
  opportunities: QualifiedSignalWorkbench;
  contacts: AgentContactSummary;
  outreach: AgentOutreachSummary;
  coverage: ChannelCoverage;
}) {
  const activeSources = strategy.sources.filter((source) => source.enabled).length;
  const sent7d = outreach.email_sent_7d + outreach.linkedin_sent_7d;
  const modes = [
    {
      title: "Signal Agent",
      icon: "sensors",
      detail:
        "Watches launch, hiring, funding, competitor, and LinkedIn intent signals against the buyer profile.",
      statLabel: "Qualified",
      statValue: opportunities.stats.qualified,
      meta: `${activeSources} active source${activeSources === 1 ? "" : "s"}`,
      href: "/dashboard/agent#qualified-signals",
      cta: "Open qualified signals",
      ready: activeSources > 0,
    },
    {
      title: "Outreach Agent",
      icon: "send",
      detail:
        "Turns qualified signals into verified email or LinkedIn contacts, judged drafts, sends, replies, and meetings.",
      statLabel: "Sent 7d",
      statValue: sent7d,
      meta: `${contacts.reachable} reachable contact${contacts.reachable === 1 ? "" : "s"}`,
      href: "/dashboard/agent#outreach",
      cta: "Review outreach",
      ready: coverage.email.connected || coverage.linkedIn.connected,
    },
  ];
  return (
    <SurfaceSection title="Agent launch modes">
      <div className="grid gap-3 lg:grid-cols-2">
        {modes.map((mode) => (
          <Link
            key={mode.title}
            href={mode.href}
            prefetch
            className="group grid gap-5 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]"
          >
            <span className="flex flex-wrap items-start justify-between gap-4">
              <span className="flex min-w-0 items-start gap-3">
                <span
                  className={
                    "grid size-10 shrink-0 place-items-center rounded-[8px] " +
                    (mode.ready
                      ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                      : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
                  }
                >
                  <Icon name={mode.icon} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold text-[var(--color-text-1)]">
                    {mode.title}
                  </span>
                  <span className="mt-2 block max-w-[62ch] text-sm leading-6 text-[var(--color-text-3)]">
                    {mode.detail}
                  </span>
                </span>
              </span>
              <span
                className={
                  "rounded-[8px] px-2.5 py-1 text-xs font-medium " +
                  (mode.ready
                    ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                    : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
                }
              >
                {mode.ready ? "Ready" : "Setup needed"}
              </span>
            </span>
            <span className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-end">
              <MiniStat label={mode.statLabel} value={mode.statValue} />
              <span className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 text-sm text-[var(--color-text-2)]">
                {mode.meta}
              </span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-[8px] text-sm font-medium text-[var(--color-accent)]">
                {mode.cta}
                <Icon
                  name="arrow_forward"
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </SurfaceSection>
  );
}

function AgentHotSignalPaths({
  signals,
}: {
  signals: QualifiedSignalItem[];
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Hot signal traces
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            Signal, verified contact, channel handle, and draft state in one
            trace.
          </p>
        </div>
        <Link href="/dashboard/agent#qualified-signals" className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open queue
        </Link>
      </div>

      {signals.length === 0 ? (
        <p className="mt-4 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 text-sm text-[var(--color-text-3)]">
          No qualified signal traces yet. Profile setup and source checks will
          create the first trace from signal to reachable contact.
        </p>
      ) : (
        <div className="mt-4 grid gap-2">
          {signals.map((signal) => (
            <AgentHotSignalPathRow key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentHotSignalPathRow({ signal }: { signal: QualifiedSignalItem }) {
  const contact = signal.contacts[0];
  const draft = signal.outreach_draft;
  const company = signal.company.name ?? signal.company.domain ?? "Unknown company";
  const status = signalPathStatus(signal);
  return (
    <Link
      href={opportunityHref(signal, contact)}
      prefetch
      className="grid gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 transition-colors hover:bg-[var(--color-ink-3)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
          <Icon name="sensors" size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[var(--color-text-1)]">
            {company}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {signal.title}
          </span>
        </span>
      </span>

      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-[var(--color-text-1)]">
          {contact?.full_name ?? "Resolving contact"}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
          {contact?.title ?? "Waiting for verified email or LinkedIn profile"}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <ContactPill ready={Boolean(contact?.emails.length)} icon="mail">
            {contact?.verification.email_verified
              ? "Verified email"
              : contact?.emails.length
                ? "Email found"
                : "No email"}
          </ContactPill>
          <ContactPill ready={Boolean(contact?.linkedin_url)} icon="linkedin">
            {contact?.linkedin_url ? "LinkedIn profile" : "No LinkedIn"}
          </ContactPill>
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {draft ? (
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            <ChannelMark channel={draft.channel} size={13} />
            {draftOpportunityLabel(draft.status, draft.channel)}
          </span>
        ) : null}
        <OpportunityPill tone={status.tone}>{status.label}</OpportunityPill>
      </span>
    </Link>
  );
}

function signalPathStatus(
  signal: QualifiedSignalItem,
): { label: string; tone: "blocked" | "fit" | "ready" | "review" | "waiting" } {
  const contact = signal.contacts[0];
  const draft = signal.outreach_draft;
  if (contact?.contact_fit_decision === "not_fit") {
    return { label: "Fit blocked", tone: "blocked" };
  }
  if (draft?.status === "sent" || draft?.status === "delivered") {
    return { label: "Outreach sent", tone: "ready" };
  }
  if (draft?.pending_approval_id) {
    return { label: "Needs review", tone: "review" };
  }
  if (draft) {
    return { label: "Draft ready", tone: "ready" };
  }
  if (signal.contact_defer_reason) {
    return {
      label: contactDeferLabel(signal.contact_defer_reason),
      tone: "review",
    };
  }
  if (
    contact?.verification.email_verified ||
    contact?.verification.linkedin_ready ||
    contact?.linkedin_url ||
    contact?.emails.length
  ) {
    return { label: "Contact verified", tone: "fit" };
  }
  return { label: "Resolving", tone: "waiting" };
}

function OperatingLoopChannel({
  title,
  channel,
  connection,
  count,
}: {
  title: string;
  channel: string;
  connection: ChannelConnection;
  count: number;
}) {
  return (
    <Link
      href={connection.href}
      prefetch
      className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2 transition-colors hover:bg-[var(--color-ink-2)]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <ChannelMark channel={channel} size={14} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[var(--color-text-1)]">
            {title}
          </span>
          <span className="block truncate text-[11px] text-[var(--color-text-3)]">
            {connection.connected ? connection.label : connection.status}
          </span>
        </span>
      </span>
      <span className="text-right">
        <span
          className={
            "block rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (connection.connected
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          {connection.connected ? "Ready" : "Needed"}
        </span>
        <span className="mt-1 block text-[11px] tabular-nums text-[var(--color-text-3)]">
          {count} sent 7d
        </span>
      </span>
    </Link>
  );
}

function AgentReviewQueuePanel({
  reviews,
}: {
  reviews: AgentReviewSummary;
}) {
  const visibleCount = reviews.recent.length;
  return (
    <div id="thumb" className="scroll-mt-28">
      <span id="review-queue" className="sr-only" aria-hidden="true" />
      <SurfaceSection
        title="Needs your thumb"
        action={
          reviews.pending_count > 0 ? (
            <Link href="/dashboard/agent#conversations" className="btn-quiet-sm">
              <Icon name="forum" size={14} />
              Open conversations
            </Link>
          ) : undefined
        }
      >
        {reviews.pending_count === 0 ? (
          <EmptyState
            title="Nothing waiting on you"
            hint="When an email or LinkedIn draft needs approval, it appears here before the agent can continue."
            cta={{
              href: "/dashboard/agent#conversations",
              label: "Open conversations",
              icon: "rate_review",
            }}
          />
        ) : (
          <div className="grid gap-2">
            {reviews.recent.map((approval) => (
              <AgentReviewRowCard key={approval.id} approval={approval} />
            ))}
            {reviews.pending_count > visibleCount ? (
              <p className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 text-xs text-[var(--color-text-3)]">
                +{reviews.pending_count - visibleCount} more waiting behind the
                same approval step.
              </p>
            ) : null}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function AgentReviewRowCard({
  approval,
}: {
  approval: AgentReviewRow;
}) {
  const payload = recordPayload(approval.payload) ?? {};
  const subject =
    stringPayload(payload, "subject") ??
    approval.message_subject ??
    reviewKindLabel(approval.kind);
  const body =
    stringPayload(payload, "body") ??
    stringPayload(payload, "draft") ??
    approval.reason;
  const href = reviewProofHref(approval);
  const channel = approval.channel ?? stringPayload(payload, "channel");
  const policy = stringPayload(payload, "policy");
  const dailyCap = numberPayload(payload, "daily_cap");
  const sentToday = numberPayload(payload, "sent_today");
  return (
    <article className="grid gap-3 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
          <Icon name="rate_review" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {approval.counterparty_name ?? "Unknown contact"}
            {approval.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {approval.company_name}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {subject}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {reviewPreview(body)}
          </span>
          {approval.signal_title ? (
            <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
              Why now: {approval.signal_title}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5">
            <ContactHandlePill
              ready={approval.emails.length > 0}
              icon={<Icon name="verified" size={12} />}
            >
              {approval.emails.length > 0 ? "Verified email" : "Email pending"}
            </ContactHandlePill>
            <ContactHandlePill
              ready={Boolean(approval.linkedin_url)}
              icon={<BrandIcon name="linkedin" size={12} />}
            >
              {approval.linkedin_url ? "LinkedIn profile" : "LinkedIn pending"}
            </ContactHandlePill>
            <ReviewQualityPill approval={approval} />
          </span>
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {channel ? channelLabel(channel) : reviewKindLabel(approval.kind)}
        </span>
        {policy ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            {approvalLabel(policy)}
          </span>
        ) : null}
        {dailyCap != null ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs tabular-nums text-[var(--color-text-2)]">
            {sentToday ?? 0}/{dailyCap} today
          </span>
        ) : null}
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {reviewKindLabel(approval.kind)}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(approval.created_at)}
        </span>
        {href ? (
          <Link href={href} prefetch className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Open thread
          </Link>
        ) : null}
        <form action={decideApprovalWithDraftAction}>
          <input type="hidden" name="return_to" value="/dashboard/agent#thumb" />
          <input type="hidden" name="approval_id" value={approval.id} />
          <input type="hidden" name="decision" value="approved" />
          <PendingSubmitButton
            className="btn-solid-sm"
            icon="check"
            iconSize={14}
            pendingLabel="Approving"
          >
            Approve
          </PendingSubmitButton>
        </form>
        <form action={decideApprovalWithDraftAction}>
          <input type="hidden" name="return_to" value="/dashboard/agent#thumb" />
          <input type="hidden" name="approval_id" value={approval.id} />
          <input type="hidden" name="decision" value="rejected" />
          <PendingSubmitButton
            className="btn-quiet-sm"
            icon="close"
            iconSize={14}
            pendingLabel="Rejecting"
          >
            Reject
          </PendingSubmitButton>
        </form>
      </span>
    </article>
  );
}

function AgentRejectedDraftsPanel({
  rejected,
}: {
  rejected: RejectedDraftSummary;
}) {
  const rows = rejected.recent;
  return (
    <div id="rejected-drafts" className="scroll-mt-28">
      <SurfaceSection title="Rejected drafts">
        {rows.length === 0 ? (
          <EmptyState
            title="No rejected drafts"
            hint="No drafts have been blocked this week."
          />
        ) : (
          <div className="grid gap-2">
            {rows.map((row) => (
              <RejectedDraftRowCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function RejectedDraftRowCard({ row }: { row: RejectedDraftRow }) {
  const notes = row.eval_notes ?? {};
  const deferReason =
    typeof notes.defer_reason === "string" ? notes.defer_reason : null;
  const deferDetail =
    typeof notes.defer_detail === "string" ? notes.defer_detail.trim() : "";
  const truncatedDetail =
    deferDetail.length > 240 ? `${deferDetail.slice(0, 240)}…` : deferDetail;
  const scoreNum = row.eval_score != null ? Number(row.eval_score) : null;
  const scoreLabel =
    scoreNum != null && Number.isFinite(scoreNum) ? scoreNum.toFixed(2) : null;
  const subject = row.subject?.trim() || "No subject";
  const bodyPreview = row.body ? row.body.slice(0, 140) : "";
  const contactLine =
    row.counterparty_name
      ? row.company_name
        ? `${row.counterparty_name} at ${row.company_name}`
        : row.counterparty_name
      : "Unknown contact";
  const signalLine = row.signal_title
    ? row.signal_kind
      ? `${row.signal_title} · ${signalKindLabel(row.signal_kind)}`
      : row.signal_title
    : "No signal context";
  return (
    <article className="grid gap-3 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
          <Icon name="block" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {contactLine}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {signalLine}
          </span>
          <span className="mt-2 block truncate text-sm text-[var(--color-text-2)]">
            {subject}
          </span>
          {bodyPreview ? (
            <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
              {bodyPreview}
            </span>
          ) : null}
          {truncatedDetail ? (
            <span className="mt-2 block text-xs leading-5 text-[var(--color-text-3)]">
              Quality note: {truncatedDetail}
            </span>
          ) : null}
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {scoreLabel ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs tabular-nums text-[var(--color-text-2)] mono">
            Quality {scoreLabel}
          </span>
        ) : null}
        <span className="pill pill-warn">{rejectedDraftReasonLabel(deferReason)}</span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(row.created_at)}
        </span>
      </span>
    </article>
  );
}

function rejectedDraftReasonLabel(reason: string | null): string {
  if (reason === "eval_rejected" || reason === "eval_rejected_after_edit") {
    return "Needs rewrite";
  }
  if (!reason) return "Needs review";
  return "Needs review";
}

function ReviewQualityPill({ approval }: { approval: AgentReviewRow }) {
  const score = outreachEvalScore(approval.eval_score);
  const passed = approval.eval_passed;
  const label =
    passed === false
      ? "Needs rewrite"
      : score == null
        ? "Quality checked"
        : `Quality ${score}%`;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11px] " +
        (passed === false
          ? "bg-[var(--color-neg-bg)] text-[var(--color-neg)]"
          : "bg-[var(--color-pos-bg)] text-[var(--color-pos)]")
      }
      title={
        passed === false
          ? "This draft needs a rewrite before sending."
          : "This draft passed the quality check before review."
      }
    >
      <Icon name={passed === false ? "block" : "verified"} size={12} />
      {label}
    </span>
  );
}

function readinessNextAction(readiness: WorkspaceLaunchReadiness): {
  href: string;
  icon: string;
  label: string;
} {
  const actionCheck = readiness.checks.find(
    (check) => check.required && check.status !== "ready" && check.action,
  );
  if (actionCheck?.action) {
    return {
      href: actionCheck.action.surface,
      icon: readinessActionIcon(actionCheck),
      label: actionCheck.action.label,
    };
  }
  if (readiness.launch_ready) {
    return {
      href: "/dashboard/agent#qualified-signals",
      icon: "send",
      label: "Prepare outreach",
    };
  }
  return {
    href: "/dashboard/profile#profile",
    icon: "edit_note",
    label: "Review Profile",
  };
}

function readinessFallbackHref(check: LaunchReadinessCheck): string {
  if (check.id === "workspace_profile") return "/dashboard/profile#profile";
  if (check.id === "icp") return "/dashboard/profile#agent";
  if (check.id === "rep") return "/dashboard/agent";
  if (check.id === "signal_sources") return "/dashboard/profile#signal-setup";
  if (check.id === "plays") return "/dashboard/agent#outreach";
  if (check.id === "linkedin") return "/dashboard/profile#linkedin";
  if (check.id === "outlook") {
    return "/dashboard/profile#email";
  }
  if (check.id === "outreach_channel") return "/dashboard/profile#channels";
  return "/dashboard/profile#channels";
}

function readinessActionIcon(check: LaunchReadinessCheck): string {
  if (check.id === "linkedin") return "linkedin";
  if (check.id === "outlook" || check.id === "outreach_channel") return "mail";
  if (check.id === "signal_sources") return "sensors";
  if (check.id === "plays") return "rule";
  if (check.id === "rep") return "badge";
  return "edit_note";
}

function agentLastHourStages(activity: AgentActivity): AgentWorkStageData[] {
  return [
    {
      key: "signals",
      label: "Signals checked",
      value: activity.signals_last_hour,
      icon: "fact_check",
    },
    {
      key: "contacts",
      label: "Contacts resolved",
      value: activity.contacts_last_hour,
      icon: "person_search",
    },
    {
      key: "drafts",
      label: "Drafts prepared",
      value: activity.drafts_last_hour,
      icon: "rate_review",
    },
    {
      key: "outreach",
      label: "Outreach sent",
      value: activity.outbound_last_hour,
      icon: "send",
    },
    {
      key: "replies",
      label: "Replies / meetings",
      value: activity.replies_last_hour,
      icon: "event_available",
    },
  ];
}

function agentCurrentWork(activity: AgentActivity): string {
  if (activity.active_workflows > 0 && activity.outbound_last_hour > 0) {
    return `Processing ${activity.active_workflows} active Agent run${activity.active_workflows === 1 ? "" : "s"} and moving ${activity.outbound_last_hour} outreach item${activity.outbound_last_hour === 1 ? "" : "s"} from the last hour.`;
  }
  if (activity.active_workflows > 0) {
    return `Processing ${activity.active_workflows} active Agent run${activity.active_workflows === 1 ? "" : "s"} across signal qualification, contact verification, and outreach gates.`;
  }
  if (activity.reviews_pending > 0) {
    return `${activity.reviews_pending} outreach item${activity.reviews_pending === 1 ? " is" : "s are"} waiting for review.`;
  }
  if (activity.events_last_hour > 0) {
    return `${activity.events_last_hour} activity event${activity.events_last_hour === 1 ? "" : "s"} landed in the last hour; no outbound send is currently in motion.`;
  }
  return "No active Agent run right now. The agent will wake when a qualified signal, reply, or channel event arrives.";
}

function agentEventLabel(eventType: string): string {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("signal")) return "Signal checked";
  if (normalized.includes("contact") || normalized.includes("person")) {
    return "Contact resolved";
  }
  if (normalized.includes("draft") || normalized.includes("approval")) {
    return "Draft prepared";
  }
  if (normalized.includes("message") || normalized.includes("outreach")) {
    return "Outreach updated";
  }
  if (normalized.includes("reply") || normalized.includes("outcome")) {
    return "Reply insight captured";
  }
  if (normalized.includes("linkedin")) return "LinkedIn channel updated";
  if (normalized.includes("outlook") || normalized.includes("email")) {
    return "Email channel updated";
  }
  if (normalized.includes("profile") || normalized.includes("workspace")) {
    return "Profile updated";
  }
  if (normalized.includes("source")) return "Source checked";
  if (normalized.includes("workflow")) return "Agent run advanced";
  return "Activity recorded";
}

function AgentOutreachPanel({
  outreach,
}: {
  outreach: AgentOutreachSummary;
}) {
  return (
    <div id="outreach" className="scroll-mt-28">
      <SurfaceSection
        title="Sent outreach"
      >
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Agent outreach, last 7 days
            </p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              <MiniStat label="Emails sent" value={outreach.email_sent_7d} />
              <MiniStat label="DMs sent" value={outreach.linkedin_messages_7d} />
              <MiniStat label="Awaiting reply" value={outreach.awaiting_reply} />
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-3)]">
              Qualified signals become verified contacts, then judged email or
              LinkedIn drafts. Click any contact to inspect the sent draft.
            </p>
          </aside>

          <div className="grid gap-4">
            <ChannelPerformancePanel outreach={outreach} />

            {outreach.accepted_followups.length > 0 ? (
              <AcceptedConnectionFollowups rows={outreach.accepted_followups} />
            ) : null}

            {outreach.recent.length === 0 ? (
              <EmptyState
                title="No sent outreach yet"
                hint="When the agent sends an email or LinkedIn touch, the contact and draft will appear here."
                cta={{
                  href: "/dashboard/profile#channels",
                  label: "Connect accounts",
                  icon: "account_tree",
                }}
              />
            ) : (
              <div className="grid gap-2">
                {outreach.recent.map((message) => (
                  <AgentOutreachLink key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SurfaceSection>
    </div>
  );
}

function AcceptedConnectionFollowups({
  rows,
}: {
  rows: AgentAcceptedConnectionFollowupRow[];
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Accepted connections to follow up
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            LinkedIn accepts without a later DM, InMail, or comment in the same
            person trace.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-pos-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-pos)]">
          {rows.length} ready
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        {rows.map((row) => (
          <AcceptedConnectionFollowupLink
            key={row.accepted_event_id}
            row={row}
          />
        ))}
      </div>
    </div>
  );
}

function AcceptedConnectionFollowupLink({
  row,
}: {
  row: AgentAcceptedConnectionFollowupRow;
}) {
  return (
    <Link
      href={acceptedConnectionHref(row)}
      prefetch
      className="grid gap-3 rounded-[12px] bg-[var(--color-ink-2)] px-3 py-3 transition-colors hover:bg-[var(--color-ink-3)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-0)] text-[var(--color-text-2)]">
          <BrandIcon name="linkedin" size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {row.full_name}
            {row.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {row.company_name}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {row.signal_title ??
              row.title ??
              "Accepted the LinkedIn connection request."}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          DM follow-up due
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(row.accepted_at)}
        </span>
      </span>
    </Link>
  );
}

function acceptedConnectionHref(
  row: AgentAcceptedConnectionFollowupRow,
): string {
  if (row.conversation_id) return `/dashboard/agent/outreach/${row.conversation_id}`;
  if (row.person_id) return `/dashboard/agent/contacts/${row.person_id}`;
  return "/dashboard/agent#outreach";
}

function AgentOutputHandoffPanel({
  destinations,
}: {
  destinations: OutputDestination[];
}) {
  const active = destinations.filter((destination) =>
    ["channel_send", "agent_api", "signal_intake", "qualified_contact_sync"].includes(
      destination.handoff_stage,
    ),
  );
  const planned = destinations.filter(
    (destination) =>
      destination.status === "planned" &&
      [
        "qualified_contact_sync",
        "sent_proof_sync",
        "reply_meeting_alert",
      ].includes(destination.handoff_stage),
  );
  return (
    <div id="output-handoff" className="scroll-mt-28">
      <SurfaceSection title="Output handoff">
        <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Where qualified work can go
              </p>
              <p className="mt-1 max-w-[72ch] text-xs leading-5 text-[var(--color-text-3)]">
                Sent proof, qualified contacts, replies, and meetings stay in
                Agent first. Connected channels and agent APIs can move work
                now; visitor-intent intake and CRM handoff queue typed proof
                packages, while native CRM OAuth, outreach-tool, and team-alert
                sync stay explicit connector work.
              </p>
            </div>
            <Link href="/dashboard/profile#tools" prefetch className="btn-quiet-sm">
              <Icon name="hub" size={14} />
              Manage in Profile
            </Link>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {active.map((destination) => (
              <AgentDestinationCard
                key={destination.key}
                destination={destination}
              />
            ))}
          </div>

          {planned.length > 0 ? (
            <div className="mt-4 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-1)]">
                    Next handoff classes
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
                    These are the output pipes to add after native email,
                    LinkedIn, review, and reply proof are healthy.
                  </p>
                </div>
                <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
                  Planned
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {planned.map((destination) => (
                  <span
                    key={destination.key}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-1 text-xs text-[var(--color-text-2)]"
                  >
                    <AgentDestinationIcon destination={destination} size={13} />
                    {destination.title}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentDestinationCard({
  destination,
}: {
  destination: OutputDestination;
}) {
  const ready =
    destination.status === "connected" || destination.status === "available";
  return (
    <Link
      href={destination.href ?? "/dashboard/profile#tools"}
      prefetch
      className="group grid min-h-[132px] content-between gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3 transition-colors hover:bg-[var(--color-ink-3)]"
    >
      <span className="flex items-start justify-between gap-3">
        <span
          className={
            "grid size-8 shrink-0 place-items-center rounded-[8px] " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          <AgentDestinationIcon destination={destination} size={15} />
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {agentDestinationStatus(destination)}
        </span>
      </span>
      <span>
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">
          {destination.title}
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
          {agentDestinationDetail(destination)}
        </span>
      </span>
    </Link>
  );
}

function AgentDestinationIcon({
  destination,
  size,
}: {
  destination: OutputDestination;
  size: number;
}) {
  if (destination.key === "outlook") {
    return <BrandIcon name="microsoft" size={size} />;
  }
  if (destination.key === "linkedin") {
    return <BrandIcon name="linkedin" size={size} />;
  }
  if (destination.key === "signal-webhook") {
    return <Icon name="webhook" size={size} />;
  }
  if (destination.key === "visitor-deanonymization") {
    return <Icon name="radar" size={size} />;
  }
  if (destination.key === "crm-sync") {
    return <Icon name="person_search" size={size} />;
  }
  if (destination.key === "outreach-tool-sync") {
    return <Icon name="send" size={size} />;
  }
  if (destination.key === "team-alerts") return <Icon name="hub" size={size} />;
  return <Icon name="neurology" size={size} />;
}

function agentDestinationStatus(destination: OutputDestination): string {
  if (destination.status === "connected") return "Connected";
  if (destination.status === "available") return "Available";
  if (destination.status === "planned") return "Planned";
  return "Blocked";
}

function agentDestinationDetail(destination: OutputDestination): string {
  if (destination.handoff_stage === "agent_api") {
    return "Brief, signals, sent proof, approvals, and learning are available to Claude Code.";
  }
  if (destination.handoff_stage === "signal_intake") {
    return "External signal events can enter the same qualified-signal path.";
  }
  if (destination.handoff_stage === "qualified_contact_sync") {
    return destination.status === "connected"
      ? "Qualified contacts can queue to CRM with signal proof, verified contact data, outreach context, and outcomes."
      : "Configure CRM in Profile to queue qualified-contact proof packages for HubSpot, Salesforce, Attio, or a webhook.";
  }
  return destination.detail;
}

function ChannelPerformancePanel({
  outreach,
}: {
  outreach: AgentOutreachSummary;
}) {
  const cards = [
    {
      icon: <Icon name="mail" size={15} />,
      title: "Email",
      sent: outreach.email_sent_7d,
      reply: outreach.email_replies_7d,
      detail: "Native Outlook threads",
    },
    {
      icon: <BrandIcon name="linkedin" size={15} />,
      title: "LinkedIn invites",
      sent: outreach.linkedin_invites_7d,
      accepted: outreach.linkedin_accepts_7d,
      reply: outreach.linkedin_invite_replies_7d,
      detail: "Connection requests",
    },
    {
      icon: <BrandIcon name="linkedin" size={15} />,
      title: "LinkedIn messages",
      sent: outreach.linkedin_messages_7d,
      reply: outreach.linkedin_message_replies_7d,
      detail: "DMs and InMail",
    },
  ];
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Channel performance
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            Outreach is split by email, LinkedIn invites, accepted
            connections, LinkedIn DMs, and channel-attributed replies.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
          7 days
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.title}
            className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-0)] text-[var(--color-text-2)]">
                {card.icon}
              </span>
              <span className="text-[11px] text-[var(--color-text-4)]">
                {card.detail}
              </span>
            </span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-text-1)]">
              {card.title}
            </p>
            <div
              className={
                "mt-3 grid gap-2 " +
                (typeof card.accepted === "number"
                  ? "grid-cols-3"
                  : "grid-cols-2")
              }
            >
              <ChannelPerformanceMetric label="Sent" value={card.sent} />
              {typeof card.accepted === "number" ? (
                <ChannelPerformanceMetric
                  label="Accepted"
                  value={card.accepted}
                />
              ) : null}
              <ChannelPerformanceMetric label="Replies" value={card.reply} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelPerformanceMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2.5 py-2">
      <span className="block text-[11px] text-[var(--color-text-4)]">
        {label}
      </span>
      <strong className="mt-1 block text-lg font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
    </span>
  );
}

function AgentRepliesPanel({
  replies,
}: {
  replies: AgentReplySummary;
}) {
  return (
    <div id="replies" className="scroll-mt-28">
      <SurfaceSection title="Replies ready">
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Reply desk, last 7 days
            </p>
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-1">
              <MiniStat label="Replies" value={replies.replies_7d} />
              <MiniStat label="Drafted" value={replies.drafted_replies} />
              <MiniStat label="Meeting intent" value={replies.meeting_intent} />
              <MiniStat label="Prep ready" value={replies.prep_ready} />
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-3)]">
              Inbound replies are classified, drafted, and tied back to the
              original conversation so the next move is reviewable.
            </p>
          </aside>

          {replies.recent.length === 0 ? (
            <EmptyState
              title="No replies ready yet"
              hint="When contacts reply, the agent will classify intent, prepare a response, and keep the exact conversation trace here."
              cta={{
                href: "/dashboard/agent#outreach",
                label: "Review sent outreach",
                icon: "mail",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {replies.recent.map((reply) => (
                <AgentReplyLink key={reply.inbound_message_id} reply={reply} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentReplyLink({ reply }: { reply: AgentReplyRow }) {
  const href = `/dashboard/agent/outreach/${reply.conversation_id}#message-${reply.inbound_message_id}`;
  const needsPrep = reply.intent_class === "meeting_intent" || reply.intent_class === "positive";
  const needsApproval =
    reply.reply_approval_id != null &&
    (reply.reply_approval_decision == null ||
      reply.reply_approval_decision === "pending");
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center">
      <Link href={href} prefetch className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-pos-bg)] text-[var(--color-pos)]">
          <Icon name="mail" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {reply.counterparty_name ?? "Unknown contact"}
            {reply.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {reply.company_name}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {reply.inbound_subject ?? replyPreview(reply)}
          </span>
          <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
            {replyPreview(reply)}
          </span>
          {reply.signal_title ? (
            <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
              Why now: {reply.signal_title}
            </span>
          ) : null}
        </span>
      </Link>

      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span
          className={
            "rounded-[8px] px-2.5 py-1 text-xs font-medium " +
            (needsApproval
              ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
              : "bg-[var(--color-pos-bg)] text-[var(--color-pos)]")
          }
        >
          {needsApproval
            ? "Reply received - approve draft"
            : "Reply received"}
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {replyIntentLabel(reply.intent_class)}
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {replyDraftLabel(reply)}
        </span>
        {needsApproval && reply.reply_approval_id ? (
          <form action={decideApprovalWithDraftAction}>
            <input
              type="hidden"
              name="return_to"
              value="/dashboard/agent#conversations"
            />
            <input
              type="hidden"
              name="approval_id"
              value={reply.reply_approval_id}
            />
            <input type="hidden" name="decision" value="approved" />
            <PendingSubmitButton
              className="btn-solid-sm"
              icon="check"
              iconSize={14}
              pendingLabel="Sending"
            >
              Approve
            </PendingSubmitButton>
          </form>
        ) : null}
        {reply.meeting_prep_generated_at ? (
          <span className="rounded-[8px] bg-[var(--color-pos-bg)] px-2.5 py-1 text-xs text-[var(--color-pos)]">
            {meetingPrepLabel(reply.meeting_prep_next_action)}
          </span>
        ) : needsPrep ? (
          <form action={generateMeetingPrepAction}>
            <input
              type="hidden"
              name="return_to"
              value="/dashboard/agent#conversations"
            />
            <input
              type="hidden"
              name="conversation_id"
              value={reply.conversation_id}
            />
            <PendingSubmitButton
              className="btn-quiet-sm"
              icon="event_available"
              iconSize={14}
              pendingLabel="Preparing"
            >
              Prepare meeting
            </PendingSubmitButton>
          </form>
        ) : null}
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(reply.received_at)}
        </span>
      </span>
    </article>
  );
}

function AgentLearningPanel({
  learning,
}: {
  learning: AgentLearningSummary;
}) {
  const hasRecommendation = Boolean(
    learning.strategy_summary || learning.skill_summary,
  );
  return (
    <div id="learning" className="scroll-mt-28">
      <SurfaceSection
        title="Learning"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form action={optimizeCampaignStrategyAction}>
              <input type="hidden" name="return_to" value="/dashboard/agent#learning" />
              <input type="hidden" name="lookback_days" value="30" />
              <input type="hidden" name="min_samples" value="3" />
              <PendingSubmitButton
                className="btn-quiet-sm"
                icon="auto_graph"
                iconSize={14}
                pendingLabel="Optimizing"
              >
                Optimize strategy
              </PendingSubmitButton>
            </form>
            <form action={optimizePlaySkillsAction}>
              <input type="hidden" name="return_to" value="/dashboard/agent#learning" />
              <input type="hidden" name="lookback_days" value="30" />
              <input type="hidden" name="min_samples" value="3" />
              <PendingSubmitButton
                className="btn-solid-sm"
                icon="science"
                iconSize={14}
                pendingLabel="Optimizing"
              >
                Optimize messages
              </PendingSubmitButton>
            </form>
          </div>
        }
      >
        <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Outcome notes
              </p>
              <p className="mt-1 max-w-[72ch] text-xs leading-5 text-[var(--color-text-3)]">
                Positive replies and meetings update which signals, channels,
                and message patterns the agent should trust next.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConversationProofPill icon="mail">
                {learning.positive_replies_7d} positive replies
              </ConversationProofPill>
              <ConversationProofPill icon="event_available">
                {learning.meetings_7d} meetings
              </ConversationProofPill>
            </div>
          </div>

          {hasRecommendation ? (
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              <LearningSummaryCard
                icon="auto_graph"
                title="Strategy recommendation"
                summary={learning.strategy_summary}
                updatedAt={learning.strategy_updated_at}
                empty="No strategy recommendation yet."
              />
              <LearningSummaryCard
                icon="science"
                title="Message recommendation"
                summary={learning.skill_summary}
                updatedAt={learning.skill_updated_at}
                empty="No message recommendation yet."
                badge={
                  learning.recommended_patterns > 0
                    ? `${learning.recommended_patterns} patterns`
                    : undefined
                }
              />
            </div>
          ) : (
            <p className="mt-4 rounded-[12px] bg-[var(--color-ink-2)] px-3 py-3 text-sm leading-6 text-[var(--color-text-3)]">
              No recommendation yet. Once replies and meetings are attributed,
              the agent can suggest which sources and messages to scale.
            </p>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function LearningSummaryCard({
  icon,
  title,
  summary,
  updatedAt,
  empty,
  badge,
}: {
  icon: string;
  title: string;
  summary: string | null;
  updatedAt: Date | null;
  empty: string;
  badge?: string;
}) {
  return (
    <article className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={15} />
        </span>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </p>
        {badge ? (
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)]">
            {badge}
          </span>
        ) : null}
        {updatedAt ? (
          <span className="ml-auto text-xs text-[var(--color-text-3)]">
            Updated {freshWhen(updatedAt)}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
        {summary ?? empty}
      </p>
    </article>
  );
}

function AgentOutreachLink({ message }: { message: AgentOutreachRow }) {
  return (
    <Link
      href={sentDraftHref(message.conversation_id, message.id)}
      prefetch
      className="grid gap-3 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <ChannelMark channel={message.channel} size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {message.counterparty_name ?? "Unknown contact"}
            {message.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {message.company_name}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {message.subject ?? messagePreview(message)}
          </span>
          {message.body ? (
            <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
              {messagePreview(message)}
            </span>
          ) : null}
          {message.signal_title ? (
            <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
              Why now: {message.signal_title}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5">
            <ContactHandlePill
              ready={message.emails.length > 0}
              icon={<Icon name="verified" size={12} />}
            >
              {message.emails.length > 0 ? "Verified email" : "Email pending"}
            </ContactHandlePill>
            <ContactHandlePill
              ready={Boolean(message.linkedin_url)}
              icon={<BrandIcon name="linkedin" size={12} />}
            >
              {message.linkedin_url ? "LinkedIn profile" : "LinkedIn pending"}
            </ContactHandlePill>
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-2)]">
          Waiting for reply
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {channelLabel(message.channel)}
        </span>
        <OutreachAccountPill message={message} />
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {statusLabel(message.status)}
        </span>
        <OutreachQualityPill message={message} />
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(message.sent_at ?? message.created_at)}
        </span>
      </span>
    </Link>
  );
}

function ContactHandlePill({
  ready,
  icon,
  children,
}: {
  ready: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11px] " +
        (ready
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
      }
    >
      {icon}
      {children}
    </span>
  );
}

function OutreachAccountPill({ message }: { message: AgentOutreachRow }) {
  const connected = message.channel_account_status === "connected";
  const label = genericMessageChannelAccountLabel(
    message.channel_account_kind,
    message.channel_account_name,
  );
  return (
    <span
      className={
        "inline-flex max-w-[220px] items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (connected
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
      }
      title={
        label
          ? `Sent through ${label}`
          : "No connected account provenance was recorded for this message."
      }
    >
      <Icon name="account_tree" size={13} />
      <span className="truncate">
        {label ? `Via ${label}` : "Account not recorded"}
      </span>
    </span>
  );
}

function genericMessageChannelAccountLabel(
  kind: string | null,
  fallback: string | null,
): string | null {
  if (kind === "oauth_outlook") return "Outlook account";
  if (kind === "linkedin_session" || kind === "linkedin_oauth") {
    return "LinkedIn account";
  }
  return fallback;
}

function OutreachQualityPill({ message }: { message: AgentOutreachRow }) {
  const score = outreachEvalScore(message.eval_score);
  const passed = message.eval_passed;
  const label =
    passed === false
      ? "Needs rewrite"
      : passed !== true
        ? "Quality pending"
        : score == null
          ? "Quality checked"
          : `Quality ${score}%`;
  const icon =
    passed === false ? "block" : passed === true ? "verified" : "sync_problem";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (passed === false
          ? "bg-[var(--color-neg-bg)] text-[var(--color-neg)]"
          : passed === true
            ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
            : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]")
      }
      title={
        passed === false
          ? "The latest quality check rejected this draft."
          : passed === true
            ? "This outreach passed the quality check before sending."
            : "No quality check was found for this sent message."
      }
    >
      <Icon name={icon} size={13} />
      {label}
    </span>
  );
}

function outreachEvalScore(score: string | null): number | null {
  if (score == null) return null;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

function sentDraftHref(conversationId: string, messageId: string): string {
  return `/dashboard/agent/outreach/${conversationId}#message-${messageId}`;
}

function reviewProofHref(approval: AgentReviewRow): string | null {
  if (!approval.conversation_id) return null;
  if (approval.message_id) {
    return sentDraftHref(approval.conversation_id, approval.message_id);
  }
  return `/dashboard/agent/outreach/${approval.conversation_id}`;
}

function reviewKindLabel(kind: string): string {
  const normalized = kind.toLowerCase();
  if (normalized.includes("linkedin")) return "LinkedIn review";
  if (normalized.includes("reply")) return "Reply draft";
  if (normalized.includes("email")) return "Email review";
  if (normalized.includes("channel")) return "Channel review";
  return "Review";
}

function reviewPreview(value: string | null): string {
  if (!value) return "Review the agent's draft before it can continue.";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 150) return normalized;
  return `${normalized.slice(0, 147)}...`;
}

function AgentSetupSummary({
  rep,
  reps,
  coverage,
}: {
  rep: RepRow;
  reps: RepRow[];
  coverage: ChannelCoverage;
}) {
  const emailPolicy = rep.autonomy?.channels?.email;
  const linkedInPolicy = firstChannelPolicy(rep, ["linkedin_dm", "linkedin"]);
  const operatingMode = agentOperatingMode(emailPolicy, linkedInPolicy);
  const openConversations = sumRepMetric(reps, "open_conversations");
  const sent7d = sumRepMetric(reps, "sent_7d");
  const replies7d = sumRepMetric(reps, "outcomes_7d");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <article className="grid gap-5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
            <Icon name="auto_awesome" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[18px] font-semibold text-[var(--color-text-1)]">
                Outbound agent
              </h3>
              <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
                {statusLabel(rep.status)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
              {rep.persona?.story ??
                "Uses your Profile, connected accounts, and approval rules to turn qualified signals into email and LinkedIn outreach."}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Open" value={openConversations} />
          <MiniStat label="Sent 7d" value={sent7d} />
          <MiniStat label="Replies 7d" value={replies7d} />
        </div>
        <AgentModeControl mode={operatingMode} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-1)] pt-3 text-xs text-[var(--color-text-3)]">
          <span>Voice, accounts, and limits stay in Profile.</span>
          <Link href="/dashboard/profile#agent" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Edit voice
          </Link>
        </div>
      </article>

      <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">
            Channels and limits
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            Outreach only moves when the destination channel is connected,
            capped, and allowed by the current approval gate.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <AgentChannelPill
            title="Email"
            icon="mail"
            connection={coverage.email}
            policy={emailPolicy}
          />
          <AgentChannelPill
            title="LinkedIn"
            icon="linkedin"
            connection={coverage.linkedIn}
            policy={linkedInPolicy}
          />
        </div>
      </article>
    </div>
  );
}

type AgentOperatingMode = "autopilot" | "copilot" | "review_first" | "research_only" | "mixed";

function AgentModeControl({ mode }: { mode: AgentOperatingMode }) {
  const detail = agentOperatingModeDetail(mode);
  return (
    <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-4)]">
            Approval mode
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">
            {detail.label}
          </p>
          <p className="mt-1 max-w-[60ch] text-xs leading-5 text-[var(--color-text-3)]">
            {detail.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={updateWorkspaceAutonomyAction}>
            <input type="hidden" name="return_to" value="/dashboard/agent" />
            <input type="hidden" name="autonomy_mode" value="autonomous" />
            <PendingSubmitButton
              className={mode === "autopilot" ? "btn-solid-sm" : "btn-quiet-sm"}
              icon="send"
              iconSize={14}
              pendingLabel="Saving"
            >
              Autopilot
            </PendingSubmitButton>
          </form>
          <form action={updateWorkspaceAutonomyAction}>
            <input type="hidden" name="return_to" value="/dashboard/agent" />
            <input type="hidden" name="autonomy_mode" value="review_only" />
            <PendingSubmitButton
              className={mode === "copilot" ? "btn-solid-sm" : "btn-quiet-sm"}
              icon="rate_review"
              iconSize={14}
              pendingLabel="Saving"
            >
              Copilot
            </PendingSubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}

function agentOperatingMode(
  emailPolicy: RepChannelPolicy | undefined,
  linkedInPolicy: RepChannelPolicy | undefined,
): AgentOperatingMode {
  const approvals = [emailPolicy?.approval, linkedInPolicy?.approval].filter(
    (approval): approval is string => Boolean(approval),
  );
  if (approvals.length === 0) return "autopilot";
  if (approvals.every((approval) => approval === "none")) return "autopilot";
  if (approvals.every((approval) => approval === "always")) return "copilot";
  if (approvals.every((approval) => approval === "approve_first")) {
    return "review_first";
  }
  if (approvals.every((approval) => approval === "research_only")) {
    return "research_only";
  }
  return "mixed";
}

function agentOperatingModeDetail(
  mode: AgentOperatingMode,
): { label: string; description: string } {
  if (mode === "copilot") {
    return {
      label: "Copilot review",
      description:
        "The agent finds contacts and writes outreach, then waits for human approval before sending.",
    };
  }
  if (mode === "review_first") {
    return {
      label: "Review first move",
      description:
        "The first outbound touch waits for approval; follow-up work can move after checks.",
    };
  }
  if (mode === "research_only") {
    return {
      label: "Research only",
      description:
        "The agent can qualify signals and contacts, but outbound stays blocked.",
    };
  }
  if (mode === "mixed") {
    return {
      label: "Mixed policies",
      description:
        "Email and LinkedIn use different approval rules. Choose Autopilot or Copilot to simplify.",
    };
  }
  return {
    label: "Autopilot",
    description:
      "The agent can send after contact verification, quality checks, daily limits, and channel health pass.",
  };
}

function sumRepMetric(
  reps: RepRow[],
  key: "open_conversations" | "sent_7d" | "outcomes_7d",
): number {
  return reps.reduce((sum, rep) => sum + Number(rep[key]), 0);
}

function AgentChannelPill({
  title,
  icon,
  connection,
  policy,
  comingSoon = false,
}: {
  title: string;
  icon: string;
  connection: ChannelConnection;
  policy?: RepChannelPolicy;
  comingSoon?: boolean;
}) {
  const cap = policy?.daily_cap ?? connection.dailyCap ?? 0;
  const approval = policy?.approval ?? "not set";
  const inner = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          {icon === "linkedin" ? (
            <BrandIcon name="linkedin" size={14} />
          ) : (
            <Icon name={icon} size={14} />
          )}
          {title}
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (comingSoon
              ? "bg-[var(--color-ink-0)] text-[var(--color-text-4)]"
              : connection.connected
                ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {comingSoon ? "Coming soon" : connection.connected ? "Ready" : "Connect"}
        </span>
      </span>
      <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
        {comingSoon ? "LinkedIn outreach is coming soon." : connection.label}
      </span>
      <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-3)]">
        {comingSoon
          ? "Not yet available"
          : `${cap > 0 ? `${cap}/day` : "No cap"} - ${approvalLabel(approval)}`}
      </span>
    </>
  );

  if (comingSoon) {
    return (
      <div
        aria-disabled="true"
        className="cursor-default rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 opacity-60"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={connection.href}
      prefetch
      className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 transition-colors hover:border-[var(--color-line-3)]"
    >
      {inner}
    </Link>
  );
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringPayload(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberPayload(
  payload: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = payload?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function arrayPayloadLength(
  payload: Record<string, unknown> | null,
  key: string,
): number {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2">
      <strong className="block text-lg font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-0.5 block text-[11px] text-[var(--color-text-3)]">
        {label}
      </span>
    </span>
  );
}

function nextSourceCheck(sources: AgentSourceRow[]): AgentSourceRow | null {
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) return null;
  return [...enabled].sort(
    (left, right) =>
      sourceCheckTime(left.next_check_at) - sourceCheckTime(right.next_check_at) ||
      left.name.localeCompare(right.name),
  )[0] ?? null;
}

function sourceCheckTime(value: Date | null): number {
  return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
}

function sourceCheckLabel(value: Date | null): string {
  return upcomingWhen(value);
}

function workspaceChannelCoverage(channels: ChannelRow[]): ChannelCoverage {
  const email = firstByReadiness(
    channels.filter((channel) => channel.kind === "oauth_outlook"),
  );
  const linkedIn = firstByReadiness(
    channels.filter(
      (channel) =>
        channel.kind === "linkedin_session" || channel.kind === "linkedin_oauth",
    ),
  );
  return {
    email: channelConnection(email, "Connect Outlook", "/dashboard/profile#email"),
    linkedIn: channelConnection(
      linkedIn,
      "Connect LinkedIn",
      "/dashboard/profile#linkedin",
    ),
  };
}

function firstByReadiness(channels: ChannelRow[]): ChannelRow | undefined {
  return channels.find((channel) => channel.status === "connected") ?? channels[0];
}

function channelConnection(
  channel: ChannelRow | undefined,
  fallback: string,
  href: string,
): ChannelConnection {
  if (!channel) {
    return {
      connected: false,
      label: fallback,
      status: "needed",
      dailyCap: null,
      href,
    };
  }
  return {
    connected: channel.status === "connected",
    label: genericChannelLabel(channel.kind, channel.status === "connected"),
    status: channel.status,
    dailyCap: channel.daily_cap,
    href,
  };
}

function genericChannelLabel(kind: string, connected: boolean): string {
  if (kind === "oauth_outlook") {
    return connected ? "Outlook connected" : "Connect Outlook";
  }
  if (kind === "linkedin_session" || kind === "linkedin_oauth") {
    return connected ? "LinkedIn connected" : "Connect LinkedIn";
  }
  return connected ? "Channel connected" : "Connect channel";
}

function firstChannelPolicy(
  rep: RepRow,
  keys: string[],
): RepChannelPolicy | undefined {
  const channels = rep.autonomy?.channels;
  if (!channels) return undefined;
  for (const key of keys) {
    const policy = channels[key];
    if (policy) return policy;
  }
  return undefined;
}

function isVisibleProductAgent(rep: RepRow): boolean {
  return rep.role === "sdr";
}

function fallbackSequenceFromReps(reps: RepRow[]): AgentSequenceStep[] {
  const rep = reps[0];
  if (!rep) return [];
  const emailPolicy = rep.autonomy?.channels?.email;
  const linkedInPolicy = firstChannelPolicy(rep, ["linkedin_dm", "linkedin"]);
  const sequence: AgentSequenceStep[] = [];
  if (emailPolicy) {
    sequence.push({
      id: `${rep.id}:email`,
      name: "Qualified signal email",
      channel: "email",
      declaration:
        "When a Signal matches the ICP, research the account, draft a judged email, and wait for the configured channel gate.",
      status: rep.status,
      daily_cap: emailPolicy.daily_cap ?? null,
      approval: emailPolicy.approval ?? null,
      steps: [
        "research.signal_context",
        "writer.compose_email",
        "eval.hot_path",
        "approval.channel_gate",
        "sender.email",
      ],
    });
  }
  if (linkedInPolicy) {
    sequence.push({
      id: `${rep.id}:linkedin`,
      name: "Qualified signal LinkedIn touch",
      channel: "linkedin_dm",
      declaration:
        "When email is not the best path or a LinkedIn profile is ready, draft a judged LinkedIn touch and apply channel limits.",
      status: rep.status,
      daily_cap: linkedInPolicy.daily_cap ?? null,
      approval: linkedInPolicy.approval ?? null,
      steps: [
        "research.signal_context",
        "writer.compose_linkedin",
        "eval.hot_path",
        "approval.channel_gate",
        "sender.linkedin",
      ],
    });
  }
  return sequence;
}

function agentDisplayName(role: string): string {
  if (role === "sdr") return "Outbound agent";
  return "Agent";
}

function approvalLabel(value: string): string {
  if (value === "none") return "Autonomous after checks";
  if (value === "always") return "Review every move";
  if (value === "approve_first") return "Review first move";
  if (value === "research_only") return "Research only";
  return "Custom review";
}

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "connected") return "Connected";
  if (status === "needs_reauth") return "Needs reauth";
  if (status === "draft") return "Draft";
  if (status === "queued") return "Queued";
  if (status === "deferred") return "Waiting";
  if (status === "sent") return "Sent";
  if (status === "delivered") return "Delivered";
  if (status === "replied") return "Replied";
  if (status === "matched") return "Ready";
  if (status === "in_play") return "In play";
  return "In progress";
}

function signalKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "hn") return "HN";
  if (normalized === "rss") return "RSS";
  if (normalized === "gdelt") return "GDELT";
  return statusLabel(normalized);
}

function messagePreview(message: AgentOutreachRow): string {
  const text = message.body;
  if (!text) return "Sent draft";
  return text.length > 96 ? text.slice(0, 96) + "..." : text;
}

function replyPreview(reply: AgentReplyRow): string {
  const text = reply.inbound_body;
  if (!text) return "Inbound reply";
  return text.length > 96 ? text.slice(0, 96) + "..." : text;
}

function replyIntentLabel(intent: string | null): string {
  if (intent === "meeting_intent") return "Meeting intent";
  if (intent === "positive") return "Positive reply";
  if (intent === "neutral") return "Neutral reply";
  if (intent === "negative") return "Negative reply";
  if (intent === "unsubscribe") return "Unsubscribe";
  if (intent === "do_not_contact") return "Do not contact";
  return "Classifying";
}

function replyDraftLabel(reply: AgentReplyRow): string {
  if (reply.reply_approval_decision === "pending") return "Draft ready";
  if (reply.reply_approval_decision === "approved") return "Approved";
  if (reply.reply_approval_decision === "rejected") return "Rejected";
  if (reply.reply_draft_status) return statusLabel(reply.reply_draft_status);
  return "Draft pending";
}

function meetingPrepLabel(action: string | null): string {
  if (action === "prepare_meeting") return "Meeting prep ready";
  if (action === "ask_for_times") return "Ask for times";
  if (action === "wait_for_reply") return "Wait for reply";
  if (action === "do_not_follow_up") return "Do not follow up";
  return "Prep ready";
}

function freshWhen(value: Date): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function upcomingWhen(value: Date | null): string {
  if (!value) return "Not scheduled";
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function channelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  if (channel === "linkedin_connection") return "LinkedIn connect";
  if (channel === "linkedin_comment") return "LinkedIn comment";
  return "Other channel";
}

function ChannelMark({ channel, size }: { channel: string; size: number }) {
  if (channel.startsWith("linkedin")) {
    return <BrandIcon name="linkedin" size={size} />;
  }
  return <Icon name="mail" size={size} />;
}

function sequenceStepFromPlay(row: {
  id: string;
  name: string;
  declaration: string;
  compiled: Record<string, unknown> | null;
  autonomy: Record<string, unknown> | null;
  status: string;
}): AgentSequenceStep {
  const compiled = recordValue(row.compiled) ?? {};
  const autonomy = recordValue(row.autonomy);
  const channel = stringValue(compiled.channel) ?? "email";
  const channelPolicy = policyFromAutonomy(autonomy, channel);
  return {
    id: row.id,
    name: row.name,
    channel,
    declaration: row.declaration,
    status: row.status,
    daily_cap: numberValue(channelPolicy?.daily_cap),
    approval: stringValue(channelPolicy?.approval),
    steps: stepsFromCompiled(compiled),
  };
}

function policyFromAutonomy(
  autonomy: Record<string, unknown> | null,
  channel: string,
): Record<string, unknown> | null {
  const channels = recordValue(autonomy?.channels);
  if (!channels) return null;
  return recordValue(channels[channel]);
}

function stepsFromCompiled(compiled: Record<string, unknown>): string[] {
  const steps = Array.isArray(compiled.steps) ? compiled.steps : [];
  return steps
    .map((step) => recordValue(step))
    .filter((step): step is Record<string, unknown> => Boolean(step))
    .map((step) => stringValue(step.op) ?? stringValue(step.id))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setupLines(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const record = recordValue(item);
      return (
        stringValue(record?.label) ??
        stringValue(record?.title) ??
        stringValue(record?.value) ??
        stringValue(record?.text)
      );
    })
    .filter((item): item is string => Boolean(item));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function NoWorkspaceReps() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Agent"
        title="Create a workspace."
        description="The agent needs a workspace profile, channels, and launch guardrails before it can act."
      />
      <EmptyState
        title="No workspace selected."
        hint="Create or select a workspace before configuring the agent."
        cta={{
          href: "/dashboard/profile#profile",
          label: "Start setup",
          icon: "add_business",
        }}
      />
    </div>
  );
}
