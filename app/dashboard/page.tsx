import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import { SurfaceSection } from "@/components/dashboard/SurfaceHero";
import FirstSignalsLoading from "@/components/dashboard/FirstSignalsLoading";
import {
  generateMeetingPrepAction,
  prepareQualifiedSignalsAction,
} from "./actions";
import { loadDashboardData } from "./server-data";

export const metadata: Metadata = {
  title: "Brief | Bombsell",
};

export const dynamic = "force-dynamic";

interface BriefActionState {
  pending_reviews: number;
  unhealthy_channels: number;
  bounced_24h: number;
  useful_outcomes_7d: number;
  meetings_7d: number;
  qualified_signals_24h: number;
  qualified_signals_7d: number;
  emails_sent_24h: number;
  emails_sent_7d: number;
  dms_sent_24h: number;
  dms_sent_7d: number;
  replies_24h: number;
  replies_7d: number;
  meetings_24h: number;
}

interface SignalKindMetric {
  kind: string;
  count_24h: number;
  count_7d: number;
  with_contacts_7d: number;
  with_drafts_7d: number;
}

interface BriefSignalHealth {
  active_sources: number;
  watched_sources: number;
  productive_sources_7d: number;
  quiet_sources: number;
  due_sources: number;
  next_check_at: Date | null;
  next_check_source_name: string | null;
  attention_source_name: string | null;
  attention_reason: string | null;
}

interface BriefOutcomeInsight {
  id: string;
  kind: string;
  occurred_at: Date;
  conversation_id: string | null;
  attributed_message_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  message_subject: string | null;
  reply_intent: string | null;
  meeting_prep_generated_at: Date | null;
  meeting_prep_next_action: string | null;
}

interface BriefLearningInsight {
  strategy_summary: string | null;
  strategy_updated_at: Date | null;
  skill_summary: string | null;
  skill_updated_at: Date | null;
  recommended_patterns: number;
  useful_outcomes_30d: number;
  top_signal_kind_7d: string | null;
  top_signal_kind_wins_7d: number;
  top_channel_7d: string | null;
  top_channel_wins_7d: number;
}

interface BriefHotContact {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  linkedin_url: string | null;
  email_status: string;
  company_name: string | null;
  company_domain: string | null;
  latest_signal_title: string;
  latest_signal_kind: string;
  last_signal_at: Date;
  contact_fit_decision: string | null;
}

interface BriefContactReadiness {
  signal_backed: number;
  verified_email: number;
  linkedin_profiles: number;
  needs_email_verification: number;
  fit_reviewed: number;
}

interface BriefChannelReadiness {
  email_connected: boolean;
  linkedin_connected: boolean;
  connected_count: number;
}

interface BriefCapabilityReadiness {
  push_signal_sources: number;
  visitor_signals_7d: number;
  visitor_qualified_7d: number;
  visitor_contacts_7d: number;
  visitor_outreach_7d: number;
  crm_destinations: number;
}

interface BriefPriority {
  action?: "prepare_outreach";
  detail: string;
  href: string;
  icon: string;
  label: string;
  title: string;
  tone: "pink" | "yellow" | "green" | "blue";
}

type BriefTone = "pink" | "yellow" | "green" | "blue";

const TONE_BG: Record<BriefTone, string> = {
  pink: "bg-[var(--color-brand-pink)] text-[#9a0103]",
  yellow: "bg-[var(--color-brand-yellow)] text-[#441f16]",
  green: "bg-[var(--color-brand-green)] text-[#273416]",
  blue: "bg-[var(--color-brand-blue)] text-[#0a0d27]",
};

async function loadBriefActionState(workspaceId: string): Promise<BriefActionState> {
  const pool = getPool();
  const { rows } = await pool.query<{
    pending_reviews: string;
    unhealthy_channels: string;
    bounced_24h: string;
    useful_outcomes_7d: string;
    meetings_7d: string;
    qualified_signals_24h: string;
    qualified_signals_7d: string;
    emails_sent_24h: string;
    emails_sent_7d: string;
    dms_sent_24h: string;
    dms_sent_7d: string;
    replies_24h: string;
    replies_7d: string;
    meetings_24h: string;
  }>(
    `with outlook_accounts as (
       select coalesce(
                nullif(lower(ca.properties ->> 'mailbox_email'), ''),
                nullif(lower(ca.display_name), ''),
                ca.id::text
              ) as outlook_mailbox_key,
              ca.status,
              ca.last_error
         from channel_accounts ca
        where ca.workspace_id = $1
          and ca.kind = 'oauth_outlook'
     ),
     outlook_mailboxes as (
       select outlook_mailbox_key,
              bool_or(status = 'connected') as has_connected,
              bool_or(status = 'connected' and last_error is not null) as has_connected_error,
              bool_or(status::text in (
                'needs_reauth',
                'errored',
                'error',
                'rate_limited',
                'suspended',
                'disconnected'
              )) as has_blocked_status
         from outlook_accounts
        group by outlook_mailbox_key
     )
     select
       (select count(*)::text from workflow_approvals a
          where a.workspace_id = $1
            and a.decision = 'pending') as pending_reviews,
       ((select count(*) from outlook_mailboxes
          where has_connected_error
             or (has_blocked_status and not has_connected))
        + (select count(*) from channel_accounts ca
             where ca.workspace_id = $1
               and ca.kind in ('email_domain','linkedin_oauth','linkedin_session')
               and (
                 ca.status::text in ('needs_reauth','errored','error','rate_limited','suspended','disconnected')
                 or ca.last_error is not null
               )))::text as unhealthy_channels,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.status = 'bounced'
            and m.sent_at >= now() - interval '24 hours') as bounced_24h,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as useful_outcomes_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'meeting_booked'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as meetings_7d,
       (select count(*)::text from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours') as qualified_signals_24h,
       (select count(*)::text from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as qualified_signals_7d,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel = 'email'
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as emails_sent_24h,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel = 'email'
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as emails_sent_7d,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel in ('linkedin_dm','linkedin_inmail')
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as dms_sent_24h,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel in ('linkedin_dm','linkedin_inmail')
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as dms_sent_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'positive_reply'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as replies_24h,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'positive_reply'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as replies_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'meeting_booked'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as meetings_24h`,
    [workspaceId],
  );
  return {
    pending_reviews: Number(rows[0]?.pending_reviews ?? 0),
    unhealthy_channels: Number(rows[0]?.unhealthy_channels ?? 0),
    bounced_24h: Number(rows[0]?.bounced_24h ?? 0),
    useful_outcomes_7d: Number(rows[0]?.useful_outcomes_7d ?? 0),
    meetings_7d: Number(rows[0]?.meetings_7d ?? 0),
    qualified_signals_24h: Number(rows[0]?.qualified_signals_24h ?? 0),
    qualified_signals_7d: Number(rows[0]?.qualified_signals_7d ?? 0),
    emails_sent_24h: Number(rows[0]?.emails_sent_24h ?? 0),
    emails_sent_7d: Number(rows[0]?.emails_sent_7d ?? 0),
    dms_sent_24h: Number(rows[0]?.dms_sent_24h ?? 0),
    dms_sent_7d: Number(rows[0]?.dms_sent_7d ?? 0),
    replies_24h: Number(rows[0]?.replies_24h ?? 0),
    replies_7d: Number(rows[0]?.replies_7d ?? 0),
    meetings_24h: Number(rows[0]?.meetings_24h ?? 0),
  };
}

async function loadSignalKindMetrics(workspaceId: string): Promise<SignalKindMetric[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    kind: string;
    count_24h: string;
    count_7d: string;
    with_contacts_7d: string;
    with_drafts_7d: string;
  }>(
    `select coalesce(s.kind::text, 'other') as kind,
            count(*) filter (
              where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours'
            )::text as count_24h,
            count(*) filter (
              where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
            )::text as count_7d,
            count(*) filter (
              where exists (
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
            )::text as with_contacts_7d,
            count(*) filter (
              where exists (
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
            )::text as with_drafts_7d
       from signals s
      where s.workspace_id = $1
        and s.status in ('matched','in_play')
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
      group by coalesce(s.kind::text, 'other')
      order by count(*) desc, coalesce(s.kind::text, 'other') asc
      limit 6`,
    [workspaceId],
  );
  return rows.map((row) => ({
    kind: row.kind,
    count_24h: Number(row.count_24h),
    count_7d: Number(row.count_7d),
    with_contacts_7d: Number(row.with_contacts_7d),
    with_drafts_7d: Number(row.with_drafts_7d),
  }));
}

async function loadBriefSignalHealth(
  workspaceId: string,
): Promise<BriefSignalHealth> {
  const pool = getPool();
  const { rows } = await pool.query<{
    active_sources: string;
    watched_sources: string;
    productive_sources_7d: string;
    quiet_sources: string;
    due_sources: string;
    next_check_at: Date | null;
    next_check_source_name: string | null;
    attention_source_name: string | null;
    attention_reason: string | null;
  }>(
    `with source_rows as (
       select gs.id,
              gs.name,
              (wsc.enabled and gs.enabled) as enabled,
              coalesce(wsc.last_polled_at, gs.last_polled_at) as last_polled_at,
              case
                when not (wsc.enabled and gs.enabled) then null
                when coalesce(wsc.last_polled_at, gs.last_polled_at) is null then now()
                else coalesce(wsc.last_polled_at, gs.last_polled_at)
                  + (wsc.poll_cadence_sec * interval '1 second')
              end as next_check_at,
              wsc.last_error,
              (select count(*)::int
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.status in ('matched','in_play')
                  and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as matched_week
         from workspace_source_configs wsc
         join graph_sources gs
           on gs.workspace_id = wsc.workspace_id
          and gs.id = wsc.source_id
        where wsc.workspace_id = $1
     ),
     attention as (
       select name,
              case
                when last_error is not null then 'source error'
                when enabled and matched_week = 0 then 'no qualified signals this week'
                else null
              end as reason
         from source_rows
        where last_error is not null
           or (enabled and matched_week = 0)
        order by case when last_error is not null then 0 else 1 end,
                 coalesce(last_polled_at, '-infinity'::timestamptz) desc,
                 name asc
        limit 1
     )
     select count(*) filter (where enabled)::text as active_sources,
            count(*)::text as watched_sources,
            count(*) filter (where enabled and matched_week > 0)::text as productive_sources_7d,
            count(*) filter (where enabled and matched_week = 0)::text as quiet_sources,
            count(*) filter (where enabled and next_check_at <= now())::text as due_sources,
            (select next_check_at
               from source_rows
              where enabled
              order by next_check_at asc nulls first, name asc
              limit 1) as next_check_at,
            (select name
               from source_rows
              where enabled
              order by next_check_at asc nulls first, name asc
              limit 1) as next_check_source_name,
            (select name from attention) as attention_source_name,
            (select reason from attention) as attention_reason
       from source_rows`,
    [workspaceId],
  );
  const row = rows[0];
  return {
    active_sources: Number(row?.active_sources ?? 0),
    watched_sources: Number(row?.watched_sources ?? 0),
    productive_sources_7d: Number(row?.productive_sources_7d ?? 0),
    quiet_sources: Number(row?.quiet_sources ?? 0),
    due_sources: Number(row?.due_sources ?? 0),
    next_check_at: row?.next_check_at ?? null,
    next_check_source_name: row?.next_check_source_name ?? null,
    attention_source_name: row?.attention_source_name ?? null,
    attention_reason: row?.attention_reason ?? null,
  };
}

async function loadBriefHotContacts(workspaceId: string): Promise<BriefHotContact[]> {
  const pool = getPool();
  const { rows } = await pool.query<BriefHotContact>(
    `select p.id,
            p.full_name,
            p.title,
            coalesce(p.emails, '{}'::text[]) as emails,
            p.linkedin_url,
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
            co.name as company_name,
            co.domain::text as company_domain,
            latest_signal.title as latest_signal_title,
            latest_signal.kind as latest_signal_kind,
            latest_signal.signal_at as last_signal_at,
            p.properties #>> '{contact_fit,decision}' as contact_fit_decision
       from graph_persons p
       left join graph_companies co on co.id = p.company_id
       join lateral (
         select s.title,
                s.kind::text as kind,
                coalesce(s.ingested_at, s.freshness_at) as signal_at
           from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '14 days'
            and (
              s.related_person_id = p.id
              or (p.company_id is not null and s.related_company_id = p.company_id)
            )
          order by coalesce(s.ingested_at, s.freshness_at) desc
          limit 1
       ) latest_signal on true
      where p.workspace_id = $1
        and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
      order by latest_signal.signal_at desc
      limit 40`,
    [workspaceId],
  );
  return dedupeHotContacts(rows).slice(0, 5);
}

function dedupeHotContacts(contacts: BriefHotContact[]): BriefHotContact[] {
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const seenCompanies = new Set<string>();
  const deduped: BriefHotContact[] = [];

  for (const contact of contacts) {
    const emails = contact.emails
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    // One contact per company so the brief surfaces unique companies rather
    // than several people from the same account. Contacts with no company
    // are never collapsed together.
    const companyKey = (contact.company_domain ?? contact.company_name ?? "")
      .trim()
      .toLowerCase();
    const duplicateId = seenIds.has(contact.id);
    const duplicateEmail = emails.some((email) => seenEmails.has(email));
    const duplicateCompany = companyKey.length > 0 && seenCompanies.has(companyKey);
    if (duplicateId || duplicateEmail || duplicateCompany) continue;

    seenIds.add(contact.id);
    for (const email of emails) seenEmails.add(email);
    if (companyKey.length > 0) seenCompanies.add(companyKey);
    deduped.push(contact);
  }

  return deduped;
}

async function loadBriefContactReadiness(
  workspaceId: string,
): Promise<BriefContactReadiness> {
  const pool = getPool();
  const { rows } = await pool.query<{
    signal_backed: string;
    verified_email: string;
    linkedin_profiles: string;
    needs_email_verification: string;
    fit_reviewed: string;
  }>(
    `with signal_backed_contacts as (
       select p.id,
              p.emails,
              p.linkedin_url,
              p.properties,
              exists (
                select 1
                  from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                 where lower(coalesce(ev.meta->>'verified', '')) = 'true'
                    or lower(coalesce(ev.meta->>'status', '')) in ('valid', 'deliverable')
              ) as has_verified_email
         from graph_persons p
        where p.workspace_id = $1
          and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
          and exists (
            select 1
              from signals s
             where s.workspace_id = $1
               and s.status in ('matched','in_play')
               and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '14 days'
               and (
                 s.related_person_id = p.id
                 or (p.company_id is not null and s.related_company_id = p.company_id)
               )
          )
     )
     select count(*)::text as signal_backed,
            count(*) filter (where has_verified_email)::text as verified_email,
            count(*) filter (where linkedin_url is not null)::text as linkedin_profiles,
            count(*) filter (
              where cardinality(coalesce(emails, '{}'::text[])) > 0
                and not has_verified_email
            )::text as needs_email_verification,
            count(*) filter (
              where properties #>> '{contact_fit,decision}' is not null
            )::text as fit_reviewed
       from signal_backed_contacts`,
    [workspaceId],
  );
  const row = rows[0];
  return {
    signal_backed: Number(row?.signal_backed ?? 0),
    verified_email: Number(row?.verified_email ?? 0),
    linkedin_profiles: Number(row?.linkedin_profiles ?? 0),
    needs_email_verification: Number(row?.needs_email_verification ?? 0),
    fit_reviewed: Number(row?.fit_reviewed ?? 0),
  };
}

async function loadBriefChannelReadiness(
  workspaceId: string,
): Promise<BriefChannelReadiness> {
  const pool = getPool();
  const { rows } = await pool.query<{
    email_connected: string;
    linkedin_connected: string;
  }>(
    `select
       exists (
         select 1
           from channel_accounts ca
          where ca.workspace_id = $1
            and ca.kind = 'oauth_outlook'
            and ca.status = 'connected'
       )::text as email_connected,
       exists (
         select 1
           from channel_accounts ca
          where ca.workspace_id = $1
            and ca.kind in ('linkedin_oauth','linkedin_session')
            and ca.status = 'connected'
       )::text as linkedin_connected`,
    [workspaceId],
  );
  const emailConnected = rows[0]?.email_connected === "true";
  const linkedInConnected = rows[0]?.linkedin_connected === "true";
  return {
    email_connected: emailConnected,
    linkedin_connected: linkedInConnected,
    connected_count: Number(emailConnected) + Number(linkedInConnected),
  };
}

async function loadBriefCapabilityReadiness(
  workspaceId: string,
): Promise<BriefCapabilityReadiness> {
  const pool = getPool();
  const { rows } = await pool.query<{
    push_signal_sources: string;
    visitor_signals_7d: string;
    visitor_qualified_7d: string;
    visitor_contacts_7d: string;
    visitor_outreach_7d: string;
    crm_destinations: string;
  }>(
    `with visitor_signals as (
       select s.id,
              s.status,
              s.related_person_id,
              s.related_company_id
         from signals s
        where s.workspace_id = $1
          and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
          and (
            s.properties #>> '{structured,visitor_deanonymization}' = 'true'
            or s.provenance->>'source' = 'visitor_deanonymization'
            or s.provenance->>'provider' in ('rb2b','clearbit','factors','warmly')
          )
     )
     select
       (select count(*)::text
          from graph_sources gs
         where gs.workspace_id = $1
           and (
             gs.config->>'adapter' = 'webhook'
             or gs.properties->>'adapter' = 'webhook'
           )) as push_signal_sources,
       (select count(*)::text from visitor_signals) as visitor_signals_7d,
       (select count(*)::text
          from visitor_signals vs
         where vs.status in ('matched','in_play')) as visitor_qualified_7d,
       (select count(distinct p.id)::text
          from visitor_signals vs
          join graph_persons p
            on p.workspace_id = $1
           and (
             p.id = vs.related_person_id
             or (
               vs.related_company_id is not null
               and p.company_id = vs.related_company_id
             )
           )
           and (
             cardinality(coalesce(p.emails, '{}'::text[])) > 0
             or p.linkedin_url is not null
           )) as visitor_contacts_7d,
       (select count(distinct c.id)::text
          from visitor_signals vs
          join conversations c
            on c.workspace_id = $1
           and c.origin_signal_id = vs.id
          join messages m
            on m.workspace_id = c.workspace_id
           and m.conversation_id = c.id
           and m.direction = 'outbound'
           and m.status in ('draft','queued','deferred','sent','delivered','replied')) as visitor_outreach_7d,
       (select count(*)::text
          from channel_accounts ca
         where ca.workspace_id = $1
           and ca.kind = 'crm'
           and ca.status = 'connected') as crm_destinations`,
    [workspaceId],
  );
  return {
    push_signal_sources: Number(rows[0]?.push_signal_sources ?? 0),
    visitor_signals_7d: Number(rows[0]?.visitor_signals_7d ?? 0),
    visitor_qualified_7d: Number(rows[0]?.visitor_qualified_7d ?? 0),
    visitor_contacts_7d: Number(rows[0]?.visitor_contacts_7d ?? 0),
    visitor_outreach_7d: Number(rows[0]?.visitor_outreach_7d ?? 0),
    crm_destinations: Number(rows[0]?.crm_destinations ?? 0),
  };
}

async function loadBriefOutcomeInsights(
  workspaceId: string,
): Promise<BriefOutcomeInsight[]> {
  const pool = getPool();
  const { rows } = await pool.query<BriefOutcomeInsight>(
    `select o.id,
            o.kind::text as kind,
            coalesce(o.recorded_at, o.occurred_at) as occurred_at,
            o.conversation_id,
            o.attributed_message_id,
            p.full_name as counterparty_name,
            co.name as company_name,
            s.title as signal_title,
            m.subject as message_subject,
            o.properties->>'reply_intent' as reply_intent,
            meeting_prep.generated_at as meeting_prep_generated_at,
            meeting_prep.next_action as meeting_prep_next_action
       from outcomes o
       left join conversations c on c.id = o.conversation_id
       left join graph_persons p on p.id = coalesce(o.subject_person_id, c.counterparty_person_id)
       left join graph_companies co on co.id = coalesce(o.subject_company_id, c.counterparty_company_id)
       left join signals s on s.id = coalesce(o.attributed_signal_id, c.origin_signal_id)
       left join messages m on m.id = o.attributed_message_id
       left join lateral (
         select (e.payload->>'generated_at')::timestamptz as generated_at,
                e.payload->>'next_action' as next_action
           from events e
          where e.workspace_id = $1
            and e.event_type = 'meeting.prep.generated'
            and c.id is not null
            and e.payload->>'conversation_id' = c.id::text
          order by e.occurred_at desc
          limit 1
       ) meeting_prep on true
      where o.workspace_id = $1
        and o.kind in ('positive_reply','meeting_booked')
        and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days'
      order by coalesce(o.recorded_at, o.occurred_at) desc
      limit 5`,
    [workspaceId],
  );
  return rows;
}

async function loadBriefLearningInsight(
  workspaceId: string,
): Promise<BriefLearningInsight> {
  const pool = getPool();
  const [outcomes, events, winners] = await Promise.all([
    pool.query<{ useful_outcomes_30d: string }>(
      `select count(*)::text as useful_outcomes_30d
         from outcomes o
        where o.workspace_id = $1
          and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
          and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '30 days'`,
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
    pool.query<{
      top_signal_kind_7d: string | null;
      top_signal_kind_wins_7d: string;
      top_channel_7d: string | null;
      top_channel_wins_7d: string;
    }>(
      `with useful as (
         select o.id,
                o.conversation_id,
                o.attributed_message_id,
                coalesce(o.attributed_signal_id, c.origin_signal_id) as signal_id,
                coalesce(o.recorded_at, o.occurred_at) as outcome_at
           from outcomes o
           left join conversations c on c.id = o.conversation_id
          where o.workspace_id = $1
            and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days'
       ),
       signal_counts as (
         select s.kind::text as signal_kind,
                count(*)::int as wins
           from useful u
           join signals s
             on s.workspace_id = $1
            and s.id = u.signal_id
          group by s.kind
       ),
       channel_counts as (
         select attributed_channel.channel,
                count(*)::int as wins
           from useful u
           join lateral (
             select m.channel::text as channel
               from messages m
              where m.workspace_id = $1
                and m.direction = 'outbound'
                and (
                  m.id = u.attributed_message_id
                  or (
                    u.attributed_message_id is null
                    and u.conversation_id is not null
                    and m.conversation_id = u.conversation_id
                    and coalesce(m.sent_at, m.created_at) <= u.outcome_at
                  )
                )
              order by case when m.id = u.attributed_message_id then 0 else 1 end,
                       coalesce(m.sent_at, m.created_at) desc
              limit 1
           ) attributed_channel on true
          group by attributed_channel.channel
       )
       select
         (select signal_kind from signal_counts order by wins desc, signal_kind asc limit 1) as top_signal_kind_7d,
         coalesce((select wins::text from signal_counts order by wins desc, signal_kind asc limit 1), '0') as top_signal_kind_wins_7d,
         (select channel from channel_counts order by wins desc, channel asc limit 1) as top_channel_7d,
         coalesce((select wins::text from channel_counts order by wins desc, channel asc limit 1), '0') as top_channel_wins_7d`,
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
    strategy_summary: stringPayload(strategy, "summary"),
    strategy_updated_at: latestStrategy?.occurred_at ?? null,
    skill_summary: stringPayload(skill, "summary"),
    skill_updated_at: latestSkill?.occurred_at ?? null,
    recommended_patterns:
      arrayPayloadLength(skill, "recommendations") ||
      arrayPayloadLength(strategy, "variants"),
    useful_outcomes_30d: Number(outcomes.rows[0]?.useful_outcomes_30d ?? 0),
    top_signal_kind_7d: winners.rows[0]?.top_signal_kind_7d ?? null,
    top_signal_kind_wins_7d: Number(
      winners.rows[0]?.top_signal_kind_wins_7d ?? 0,
    ),
    top_channel_7d: winners.rows[0]?.top_channel_7d ?? null,
    top_channel_wins_7d: Number(winners.rows[0]?.top_channel_wins_7d ?? 0),
  };
}

const EMPTY_ACTION_STATE: BriefActionState = {
  pending_reviews: 0,
  unhealthy_channels: 0,
  bounced_24h: 0,
  useful_outcomes_7d: 0,
  meetings_7d: 0,
  qualified_signals_24h: 0,
  qualified_signals_7d: 0,
  emails_sent_24h: 0,
  emails_sent_7d: 0,
  dms_sent_24h: 0,
  dms_sent_7d: 0,
  replies_24h: 0,
  replies_7d: 0,
  meetings_24h: 0,
};

const EMPTY_LEARNING_INSIGHT: BriefLearningInsight = {
  strategy_summary: null,
  strategy_updated_at: null,
  skill_summary: null,
  skill_updated_at: null,
  recommended_patterns: 0,
  useful_outcomes_30d: 0,
  top_signal_kind_7d: null,
  top_signal_kind_wins_7d: 0,
  top_channel_7d: null,
  top_channel_wins_7d: 0,
};

const EMPTY_SIGNAL_HEALTH: BriefSignalHealth = {
  active_sources: 0,
  watched_sources: 0,
  productive_sources_7d: 0,
  quiet_sources: 0,
  due_sources: 0,
  next_check_at: null,
  next_check_source_name: null,
  attention_source_name: null,
  attention_reason: null,
};

const EMPTY_CONTACT_READINESS: BriefContactReadiness = {
  signal_backed: 0,
  verified_email: 0,
  linkedin_profiles: 0,
  needs_email_verification: 0,
  fit_reviewed: 0,
};

const EMPTY_CHANNEL_READINESS: BriefChannelReadiness = {
  email_connected: false,
  linkedin_connected: false,
  connected_count: 0,
};

const EMPTY_CAPABILITY_READINESS: BriefCapabilityReadiness = {
  push_signal_sources: 0,
  visitor_signals_7d: 0,
  visitor_qualified_7d: 0,
  visitor_contacts_7d: 0,
  visitor_outreach_7d: 0,
  crm_destinations: 0,
};

export default async function BriefPage() {
  const session = await getActiveWorkspaceSessionForDashboard("brief");
  if (!session) {
    return (
      <BriefView
        actions={EMPTY_ACTION_STATE}
        signalKinds={[]}
        signalHealth={EMPTY_SIGNAL_HEALTH}
        contactReadiness={EMPTY_CONTACT_READINESS}
        channelReadiness={EMPTY_CHANNEL_READINESS}
        capabilityReadiness={EMPTY_CAPABILITY_READINESS}
        hotContacts={[]}
        outcomeInsights={[]}
        learning={EMPTY_LEARNING_INSIGHT}
        workspaceName="there"
        workspaceSlug={null}
      />
    );
  }
  const [
    {
      actions,
      signalKinds,
      signalHealth,
      contactReadiness,
      channelReadiness,
      capabilityReadiness,
      hotContacts,
      outcomeInsights,
      learning,
    },
    workspaceAgeSeconds,
  ] = await Promise.all([
    loadBriefState(session.workspace.id),
    loadDashboardData(
      "brief",
      "workspace age",
      null,
      () => loadWorkspaceAgeSeconds(session.workspace.id),
    ),
  ]);

  const isFreshWorkspace =
    workspaceAgeSeconds !== null &&
    workspaceAgeSeconds < 5 * 60 &&
    actions.qualified_signals_7d === 0 &&
    actions.qualified_signals_24h === 0 &&
    signalHealth.watched_sources === 0;

  if (isFreshWorkspace) {
    return <FirstSignalsLoading workspaceName={session.workspace.name} />;
  }

  return (
    <BriefView
      actions={actions}
      signalKinds={signalKinds}
      signalHealth={signalHealth}
      contactReadiness={contactReadiness}
      channelReadiness={channelReadiness}
      capabilityReadiness={capabilityReadiness}
      hotContacts={hotContacts}
      outcomeInsights={outcomeInsights}
      learning={learning}
      workspaceName={session.workspace.name}
      workspaceSlug={session.workspace.slug}
    />
  );
}

async function loadWorkspaceAgeSeconds(
  workspaceId: string,
): Promise<number | null> {
  const { rows } = await getPool().query<{ age_seconds: string }>(
    `select extract(epoch from (now() - created_at))::text as age_seconds
       from workspaces
      where id = $1`,
    [workspaceId],
  );
  if (!rows[0]) return null;
  const value = Number(rows[0].age_seconds);
  return Number.isFinite(value) ? value : null;
}

async function loadBriefState(
  workspaceId: string,
): Promise<{
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
  signalHealth: BriefSignalHealth;
  contactReadiness: BriefContactReadiness;
  channelReadiness: BriefChannelReadiness;
  capabilityReadiness: BriefCapabilityReadiness;
  hotContacts: BriefHotContact[];
  outcomeInsights: BriefOutcomeInsight[];
  learning: BriefLearningInsight;
}> {
  const [
    actions,
    signalKinds,
    signalHealth,
    contactReadiness,
    channelReadiness,
    capabilityReadiness,
    hotContacts,
    outcomeInsights,
    learning,
  ] = await Promise.all([
    loadDashboardData(
      "brief",
      "action state",
      EMPTY_ACTION_STATE,
      () => loadBriefActionState(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "signal kind metrics",
      [],
      () => loadSignalKindMetrics(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "signal health",
      EMPTY_SIGNAL_HEALTH,
      () => loadBriefSignalHealth(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "contact readiness",
      EMPTY_CONTACT_READINESS,
      () => loadBriefContactReadiness(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "channel readiness",
      EMPTY_CHANNEL_READINESS,
      () => loadBriefChannelReadiness(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "capability readiness",
      EMPTY_CAPABILITY_READINESS,
      () => loadBriefCapabilityReadiness(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "hot contacts",
      [],
      () => loadBriefHotContacts(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "outcome insights",
      [],
      () => loadBriefOutcomeInsights(workspaceId),
    ),
    loadDashboardData(
      "brief",
      "learning insight",
      EMPTY_LEARNING_INSIGHT,
      () => loadBriefLearningInsight(workspaceId),
    ),
  ]);
  return {
    actions,
    signalKinds,
    signalHealth,
    contactReadiness,
    channelReadiness,
    capabilityReadiness,
    hotContacts,
    outcomeInsights,
    learning,
  };
}

function BriefView({
  actions,
  signalKinds,
  signalHealth,
  contactReadiness,
  channelReadiness,
  capabilityReadiness,
  hotContacts,
  outcomeInsights,
  learning,
  workspaceName,
  workspaceSlug,
}: {
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
  signalHealth: BriefSignalHealth;
  contactReadiness: BriefContactReadiness;
  channelReadiness: BriefChannelReadiness;
  capabilityReadiness: BriefCapabilityReadiness;
  hotContacts: BriefHotContact[];
  outcomeInsights: BriefOutcomeInsight[];
  learning: BriefLearningInsight;
  workspaceName: string;
  workspaceSlug: string | null;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const totalSent24h = actions.emails_sent_24h + actions.dms_sent_24h;
  const totalSent7d = actions.emails_sent_7d + actions.dms_sent_7d;
  const draftedSignals7d = signalKinds.reduce(
    (total, signal) => total + signal.with_drafts_7d,
    0,
  );
  const priority = briefPriority(
    actions,
    channelReadiness,
    totalSent7d,
    signalHealth,
  );
  const workspaceLabel = workspaceDisplayName(workspaceName, workspaceSlug);
  const landedCount = outcomeInsights.length;
  const briefLine = briefStatusLine(actions, priority, totalSent24h, landedCount);
  const hasMomentum =
    actions.qualified_signals_7d +
      contactReadiness.signal_backed +
      draftedSignals7d +
      totalSent7d +
      actions.replies_7d +
      actions.meetings_7d >
    0;

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 sm:p-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          {today}
        </p>
        <h1
          className="mt-4 max-w-full break-words text-[clamp(2rem,5vw,4.25rem)] font-bold leading-[0.98] text-[var(--color-text-1)] [overflow-wrap:anywhere]"
          style={{ fontFamily: "var(--font-display)", letterSpacing: 0 }}
        >
          Morning brief for {workspaceLabel}.
        </h1>
        <p className="mt-5 max-w-[72ch] text-[15.5px] leading-7 tracking-[-0.01em] text-[var(--color-text-2)]">
          {briefLine}
        </p>
      </section>

      <BriefPrimaryAction priority={priority} />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <BriefApprovalsCard pendingReviews={actions.pending_reviews} />
        <BriefLandedCard outcomeInsights={outcomeInsights} />
      </section>

      <SurfaceSection
        title="Fresh qualified contacts"
        action={
          <Link href="/dashboard/agent#verified-contacts" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            View contacts
          </Link>
        }
      >
        {hotContacts.length === 0 ? (
          <BriefEmptyCard
            icon="person_search"
            title="No fresh qualified contacts yet"
            hint="Connect a channel or review qualified signals; the first reachable people will appear here with proof."
            href="/dashboard/agent#qualified-signals"
            label="Review signals"
            tone="yellow"
          />
        ) : (
          <div className="grid gap-3">
            {hotContacts.map((contact) => (
              <BriefHotContactRow key={contact.id} contact={contact} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <div id="weekly-learning" className="scroll-mt-28">
        <SurfaceSection
          title="This week the agent learned..."
          action={
            <Link href="/dashboard/agent#learning" className="btn-quiet-sm">
              <Icon name="auto_graph" size={14} />
              Open learning
            </Link>
          }
        >
          <BriefLearningPanel learning={learning} />
        </SurfaceSection>
      </div>

      <BriefFunnelSummary
        hasMomentum={hasMomentum}
        signals={actions.qualified_signals_7d}
        contacts={contactReadiness.signal_backed}
        drafts={draftedSignals7d}
        sent={totalSent7d}
        replies={actions.replies_7d}
        meetings={actions.meetings_7d}
        priority={priority}
      />
    </div>
  );
}

function BriefPrimaryAction({ priority }: { priority: BriefPriority }) {
  return (
    <section className="group rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)] sm:p-6">
      <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <span
          className={`grid size-11 place-items-center rounded-[10px] transition-transform duration-300 group-hover:scale-105 ${TONE_BG[priority.tone]}`}
        >
          <Icon name={priority.icon} size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Today
          </p>
          <h2
            className="mt-1 text-[22px] font-semibold leading-tight text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)", letterSpacing: 0 }}
          >
            {priority.title}
          </h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-[var(--color-text-2)]">
            {priority.detail}
          </p>
        </div>
        {priority.action === "prepare_outreach" ? (
          <form action={prepareQualifiedSignalsAction}>
            <input
              type="hidden"
              name="return_to"
              value="/dashboard/agent#review-queue"
            />
            <input type="hidden" name="limit" value="25" />
            <PendingSubmitButton
              className="btn-solid-sm w-fit"
              icon={priority.icon}
              iconSize={14}
              pendingLabel="Preparing"
            >
              {priority.label}
            </PendingSubmitButton>
          </form>
        ) : (
          <Link href={priority.href} className="btn-solid-sm w-fit">
            <Icon name={priority.icon} size={14} />
            {priority.label}
          </Link>
        )}
      </div>
    </section>
  );
}

function BriefApprovalsCard({ pendingReviews }: { pendingReviews: number }) {
  return (
    <section className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Needs your thumb
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            {pendingReviews > 0
              ? `${pendingReviews} judged draft${
                  pendingReviews === 1 ? " is" : "s are"
                } waiting for approval.`
              : "No drafts need review right now."}
          </p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--color-brand-yellow)] text-[#441f16]">
          <Icon name="check" size={18} />
        </span>
      </div>
      {pendingReviews > 0 ? (
        <Link href="/dashboard/agent#review-queue" className="btn-solid-sm mt-5 w-fit">
          <Icon name="rate_review" size={14} />
          Review drafts
        </Link>
      ) : (
        <Link href="/dashboard/agent#outreach" className="btn-quiet-sm mt-5 w-fit">
          <Icon name="mail" size={14} />
          View outreach
        </Link>
      )}
    </section>
  );
}

function BriefLandedCard({
  outcomeInsights,
}: {
  outcomeInsights: BriefOutcomeInsight[];
}) {
  return (
    <section id="reply-insights" className="scroll-mt-28 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            What landed
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            Replies and meetings with the conversation proof attached.
          </p>
        </div>
        <Link href="/dashboard/agent#outreach" className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open conversations
        </Link>
      </div>
      {outcomeInsights.length === 0 ? (
        <div className="mt-5">
          <BriefEmptyCard
            icon="mark_email_read"
            title="Nothing landed yet"
            hint="Send the first approved batch, then replies and meetings will collect here."
            href="/dashboard/agent#review-queue"
            label="Review drafts"
            tone="green"
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {outcomeInsights.slice(0, 4).map((insight) => (
            <OutcomeInsightRow key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </section>
  );
}

function BriefEmptyCard({
  icon,
  title,
  hint,
  href,
  label,
  tone,
}: {
  icon: string;
  title: string;
  hint: string;
  href: string;
  label: string;
  tone: BriefTone;
}) {
  return (
    <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
      <span className={`grid size-10 place-items-center rounded-[10px] ${TONE_BG[tone]}`}>
        <Icon name={icon} size={18} />
      </span>
      <p className="mt-4 text-sm font-semibold text-[var(--color-text-1)]">
        {title}
      </p>
      <p className="mt-2 max-w-[56ch] text-sm leading-6 text-[var(--color-text-3)]">
        {hint}
      </p>
      <Link href={href} className="btn-quiet-sm mt-4 w-fit">
        <Icon name="arrow_forward" size={14} />
        {label}
      </Link>
    </div>
  );
}

function BriefFunnelSummary({
  hasMomentum,
  signals,
  contacts,
  drafts,
  sent,
  replies,
  meetings,
  priority,
}: {
  hasMomentum: boolean;
  signals: number;
  contacts: number;
  drafts: number;
  sent: number;
  replies: number;
  meetings: number;
  priority: BriefPriority;
}) {
  const steps = [
    { label: "Signals", value: signals, href: "/dashboard/agent#qualified-signals" },
    { label: "Contacts", value: contacts, href: "/dashboard/agent#verified-contacts" },
    { label: "Drafts", value: drafts, href: "/dashboard/agent#review-queue" },
    { label: "Sent", value: sent, href: "/dashboard/agent#outreach" },
    { label: "Replies", value: replies, href: "/dashboard/brief#reply-insights" },
    { label: "Meetings", value: meetings, href: "/dashboard/brief#reply-insights" },
  ];

  return (
    <section className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          This week at a glance
        </p>
        <Link href="/dashboard/agent" className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open Agent
        </Link>
      </div>
      {hasMomentum ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {steps.map((step, index) => (
            <span key={step.label} className="contents">
              <BriefFunnelChip {...step} />
              {index < steps.length - 1 ? (
                <Icon
                  name="arrow_forward"
                  size={14}
                  className="text-[var(--color-text-4)]"
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-[12px] bg-[var(--color-ink-2)] px-4 py-4">
          <p className="text-sm leading-6 text-[var(--color-text-2)]">
            Nothing has shipped yet. {priority.detail}
          </p>
        </div>
      )}
    </section>
  );
}

function BriefFunnelChip({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_14px_28px_-24px_rgba(0,0,0,0.2)]"
    >
      <strong className="tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="text-[var(--color-text-3)]">{label}</span>
    </Link>
  );
}

function BriefHotContactRow({ contact }: { contact: BriefHotContact }) {
  const company = contact.company_name ?? contact.company_domain ?? "Unknown company";
  const signalKind = contact.latest_signal_kind.replace(/_/g, " ");
  return (
    <Link
      href={`/dashboard/agent/contacts/${contact.id}`}
      prefetch
      className="group grid gap-3 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--color-brand-blue)] text-[#0a0d27] transition-transform duration-300 group-hover:scale-105">
          <Icon name="person_search" size={17} />
        </span>
        <span className="min-w-0">
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
            {contact.latest_signal_title}
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <ContactSignalPill icon="sensors">{signalKind}</ContactSignalPill>
            <ContactSignalPill icon="mail">
              {emailStatusLabel(contact.email_status)}
            </ContactSignalPill>
            <ContactSignalPill icon="linkedin">
              {contact.linkedin_url ? "LinkedIn profile" : "LinkedIn pending"}
            </ContactSignalPill>
            {contact.contact_fit_decision ? (
              <ContactSignalPill icon="fact_check">
                {contactFitLabel(contact.contact_fit_decision)}
              </ContactSignalPill>
            ) : null}
          </span>
        </span>
      </span>
      <span className="text-xs tabular-nums text-[var(--color-text-3)]">
        {freshWhen(contact.last_signal_at)}
      </span>
    </Link>
  );
}

function ContactSignalPill({
  icon,
  children,
}: {
  icon: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
      <Icon name={icon} size={12} />
      {children}
    </span>
  );
}

function contactFitLabel(decision: string): string {
  if (decision === "fit") return "Good fit";
  if (decision === "not_fit") return "Not a fit";
  return "Needs review";
}

function emailStatusLabel(status: string): string {
  if (status === "verified") return "Verified email";
  if (status === "found") return "Email found";
  return "Email pending";
}

function briefPriority(
  actions: BriefActionState,
  channelReadiness: BriefChannelReadiness,
  totalSent7d: number,
  signalHealth: BriefSignalHealth,
): BriefPriority {
  if (actions.pending_reviews > 0) {
    return {
      detail: `${actions.pending_reviews} drafted outreach ${
        actions.pending_reviews === 1 ? "message needs" : "messages need"
      } review before sending.`,
      href: "/dashboard/agent#review-queue",
      icon: "rate_review",
      label: "Review drafts",
      title: "Approve the drafts waiting on you",
      tone: "yellow",
    };
  }
  if (actions.unhealthy_channels > 0) {
    return {
      detail: `${actions.unhealthy_channels} connected ${
        actions.unhealthy_channels === 1 ? "account needs" : "accounts need"
      } attention before the agent can send reliably.`,
      href: "/dashboard/profile#channels",
      icon: "sync_problem",
      label: "Fix accounts",
      title: "Fix the account that is blocking sends",
      tone: "pink",
    };
  }
  if (channelReadiness.connected_count === 0) {
    return {
      detail:
        "Connect Outlook or LinkedIn before qualified signals can become sent outreach.",
      href: "/dashboard/profile#channels",
      icon: "hub",
      label: "Connect accounts",
      title: "Connect Outlook or LinkedIn to start outreach",
      tone: "blue",
    };
  }
  if (signalHealth.watched_sources === 0) {
    return {
      detail:
        "Add your first signal source so the agent has timing evidence to qualify.",
      href: "/dashboard/profile#signal-setup",
      icon: "sensors",
      label: "Add signals",
      title: "Add a signal source",
      tone: "green",
    };
  }
  if (actions.qualified_signals_7d > 0 && totalSent7d === 0) {
    return {
      action: "prepare_outreach",
      detail:
        "Qualified signals are ready, but no email or LinkedIn outreach has gone out this week.",
      href: "/dashboard/agent#qualified-signals",
      icon: "send",
      label: "Prepare outreach",
      title: "Turn qualified signals into outreach",
      tone: "green",
    };
  }
  return {
    detail:
      "The agent is running. Review fresh signal mix, sent outreach, and reply evidence before changing targeting.",
    href: "/dashboard/agent",
    icon: "arrow_forward",
    label: "Open Agent",
    title: "Review the conversations in motion",
    tone: "blue",
  };
}

function BriefLearningPanel({
  learning,
}: {
  learning: BriefLearningInsight;
}) {
  const hasOutcomeLearning = Boolean(
    learning.top_signal_kind_7d || learning.top_channel_7d,
  );
  const hasRecommendation = Boolean(
    learning.strategy_summary || learning.skill_summary,
  );
  if (!hasOutcomeLearning && !hasRecommendation) {
    return (
      <BriefEmptyCard
        icon="auto_graph"
        title="No weekly learning yet"
        hint="Once replies and meetings are attributed, the agent will show what changed in sources, channels, and message patterns."
        href="/dashboard/agent#learning"
        label="Open learning"
        tone="blue"
      />
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <BriefLearningCard
        icon="sensors"
        title="Scale"
        summary={learningScaleSummary(learning)}
        updatedAt={null}
        empty="No outcome-backed signal or channel winner yet."
        tone="green"
      />
      <BriefLearningCard
        icon="auto_graph"
        title="Targeting"
        summary={learning.strategy_summary}
        updatedAt={learning.strategy_updated_at}
        empty="No targeting recommendation yet."
        tone="blue"
      />
      <BriefLearningCard
        icon="science"
        title="Messaging"
        summary={learning.skill_summary}
        updatedAt={learning.skill_updated_at}
        empty="No message recommendation yet."
        tone="yellow"
      />
    </div>
  );
}

function learningScaleSummary(learning: BriefLearningInsight): string | null {
  const signal = learning.top_signal_kind_7d
    ? `${signalKindLabel(learning.top_signal_kind_7d)} (${learning.top_signal_kind_wins_7d})`
    : null;
  const channel = learning.top_channel_7d
    ? `${briefChannelLabel(learning.top_channel_7d)} (${learning.top_channel_wins_7d})`
    : null;
  if (signal && channel) {
    return `This week's strongest outcome path is ${signal} through ${channel}. Use it to bias the next qualified outreach batch.`;
  }
  if (signal) {
    return `${signal} is the strongest signal type behind this week's useful replies or meetings.`;
  }
  if (channel) {
    return `${channel} is the strongest channel behind this week's useful replies or meetings.`;
  }
  return null;
}

function BriefLearningCard({
  icon,
  title,
  summary,
  updatedAt,
  empty,
  tone,
}: {
  icon: string;
  title: string;
  summary: string | null;
  updatedAt: Date | null;
  empty: string;
  tone: BriefTone;
}) {
  return (
    <article className="group rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`grid size-9 place-items-center rounded-[10px] transition-transform duration-300 group-hover:scale-105 ${TONE_BG[tone]}`}>
          <Icon name={icon} size={15} />
        </span>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </p>
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

function OutcomeInsightRow({ insight }: { insight: BriefOutcomeInsight }) {
  const person = insight.counterparty_name ?? "Unknown contact";
  const company = insight.company_name ? ` at ${insight.company_name}` : "";
  const needsPrep = insightNeedsMeetingPrep(insight);
  const href = insight.conversation_id
    ? `/dashboard/agent/outreach/${insight.conversation_id}${
        insight.attributed_message_id ? `#message-${insight.attributed_message_id}` : ""
      }`
    : "/dashboard/agent#outreach";
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <Link href={href} prefetch className="min-w-0">
        <span className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-pos-bg)] text-[var(--color-pos)]">
            <Icon
              name={insight.kind === "meeting_booked" ? "event_available" : "mark_email_read"}
              size={17}
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
              {outcomeLabel(insight.kind)}
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                from {person}
                {company}
              </span>
            </span>
            <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
              {insight.signal_title ??
                insight.message_subject ??
                "Conversation outcome captured"}
            </span>
            {insight.reply_intent ? (
              <span className="mt-2 block text-xs text-[var(--color-text-3)]">
                Intent: {insight.reply_intent.replace(/_/g, " ")}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {insight.meeting_prep_generated_at ? (
          <span className="rounded-[8px] bg-[var(--color-pos-bg)] px-2.5 py-1 text-xs text-[var(--color-pos)]">
            {meetingPrepLabel(insight.meeting_prep_next_action)}
          </span>
        ) : needsPrep ? (
          <form action={generateMeetingPrepAction}>
            <input
              type="hidden"
              name="return_to"
              value="/dashboard/brief#reply-insights"
            />
            <input
              type="hidden"
              name="conversation_id"
              value={insight.conversation_id ?? ""}
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
          {freshWhen(insight.occurred_at)}
        </span>
      </span>
    </article>
  );
}

function insightNeedsMeetingPrep(insight: BriefOutcomeInsight): boolean {
  return Boolean(insight.conversation_id) &&
    (insight.kind === "meeting_booked" ||
      insight.reply_intent === "meeting_intent" ||
      insight.reply_intent === "positive");
}

function meetingPrepLabel(action: string | null): string {
  if (action === "prepare_meeting") return "Meeting prep ready";
  if (action === "ask_for_times") return "Ask for times";
  if (action === "wait_for_reply") return "Wait for reply";
  if (action === "do_not_follow_up") return "Do not follow up";
  return "Prep ready";
}

function workspaceDisplayName(name: string, slug: string | null): string {
  const trimmed = name.trim();
  if (trimmed && !/^default workspace$/i.test(trimmed)) return trimmed;
  const fromSlug = slug
    ?.split(/[-_]+/)
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromSlug && !/^default workspace$/i.test(fromSlug)) return titleCase(fromSlug);
  return "your workspace";
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function briefStatusLine(
  actions: BriefActionState,
  priority: BriefPriority,
  totalSent24h: number,
  landedCount: number,
): string {
  const happened =
    totalSent24h > 0 || landedCount > 0
      ? `${totalSent24h} message${totalSent24h === 1 ? "" : "s"} went out and ${landedCount} repl${
          landedCount === 1 ? "y or meeting landed" : "ies or meetings landed"
        }`
      : actions.qualified_signals_24h > 0
        ? `${actions.qualified_signals_24h} fresh signal${
            actions.qualified_signals_24h === 1 ? "" : "s"
          } qualified`
        : "No outreach shipped yet";

  return `${happened}; ${lowerFirst(priority.detail)}`;
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function signalKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "hn") return "HN";
  if (normalized === "rss") return "RSS";
  if (normalized === "gdelt") return "GDELT";
  return normalized.replace(/_/g, " ");
}

function briefChannelLabel(channel: string): string {
  if (channel === "email") return "email";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  if (channel === "linkedin_connection") return "LinkedIn connect";
  if (channel === "linkedin_comment") return "LinkedIn comment";
  return channel.replace(/_/g, " ");
}

function outcomeLabel(kind: string): string {
  if (kind === "positive_reply") return "Positive reply";
  if (kind === "meeting_booked") return "Meeting booked";
  return kind.replace(/_/g, " ");
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

function arrayPayloadLength(
  payload: Record<string, unknown> | null,
  key: string,
): number {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
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
