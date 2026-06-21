import type { Pool } from "pg";
import { scoreSignalIntent } from "../ingest/account-intent.ts";
import type { SignalKind } from "../primitives/signal.ts";

export interface QualifiedSignalContact {
  rank: number;
  person_id: string;
  full_name: string;
  title: string | null;
  score: number;
  contact_fit_decision: "fit" | "unsure" | "not_fit" | null;
  reasons: string[];
  emails: string[];
  linkedin_url: string | null;
  verification: {
    email_verified?: boolean | null;
    email_status?: string | null;
    linkedin_ready?: boolean | null;
  };
  provenance: Record<string, unknown>;
}

export interface QualifiedSignalOutreachDraft {
  conversation_id: string;
  message_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  eval_score: number | null;
  eval_passed: boolean | null;
  external_id: string | null;
  scheduled_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  latest_channel_event_type: string | null;
  latest_channel_event_at: Date | null;
  defer_reason: string | null;
  defer_detail: string | null;
  pending_approval_id: string | null;
  created_at: Date;
}

export type QualifiedSignalEmailDraft = QualifiedSignalOutreachDraft;

export interface QualifiedSignalItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  content: string | null;
  url: string | null;
  match_score: number | null;
  match_reason: string | null;
  account_intent_score?: number;
  account_signal_count?: number;
  freshness_at: Date;
  ingested_at: Date;
  matched_at: Date | null;
  company: {
    id: string | null;
    name: string | null;
    domain: string | null;
    industry: string | null;
    description: string | null;
  };
  contacts: QualifiedSignalContact[];
  contact_source: "resolution" | "graph" | "none";
  contact_channel: string | null;
  contact_defer_reason: string | null;
  outreach_draft: QualifiedSignalOutreachDraft | null;
  email_draft: QualifiedSignalOutreachDraft | null;
}

export interface QualifiedSignalWorkbench {
  signals: QualifiedSignalItem[];
  stats: {
    qualified: number;
    with_verified_contacts: number;
    with_outreach_draft: number;
    with_email_draft: number;
    ready_for_review: number;
    blocked_by_fit: number;
  };
}

export interface QualifiedSignalEmailReadiness {
  ready: boolean;
  connected_outlook_accounts: number;
  active_outlook_subscriptions: number;
  needs_reauth_outlook_accounts: number;
  errored_outlook_accounts: number;
  connected_managed_domain_accounts: number;
  status_label: string;
  detail: string;
}

interface QualifiedSignalRow {
  id: string;
  kind: string;
  status: string;
  title: string;
  content: string | null;
  url: string | null;
  match_score: string | null;
  match_reason: string | null;
  freshness_at: Date;
  ingested_at: Date;
  matched_at: Date | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_description: string | null;
  account_intent_score: string | null;
  account_signal_count: string | number | null;
  contact_candidates: unknown;
  graph_candidates: unknown;
  contact_channel: string | null;
  contact_defer_reason: string | null;
  draft_conversation_id: string | null;
  draft_message_id: string | null;
  draft_channel: string | null;
  draft_status: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_eval_score: string | null;
  draft_eval_passed: boolean | null;
  draft_external_id: string | null;
  draft_scheduled_at: Date | null;
  draft_sent_at: Date | null;
  draft_delivered_at: Date | null;
  draft_channel_event_type: string | null;
  draft_channel_event_at: Date | null;
  draft_defer_reason: string | null;
  draft_defer_detail: string | null;
  draft_created_at: Date | null;
  pending_approval_id: string | null;
}

interface EmailReadinessRow {
  connected_outlook: string | number;
  active_subscriptions: string | number;
  needs_reauth_outlook: string | number;
  errored_connected: string | number;
  connected_managed_domains: string | number;
}

export async function loadQualifiedSignalEmailReadiness(
  pool: Pool,
  workspaceId: string,
): Promise<QualifiedSignalEmailReadiness> {
  const { rows } = await pool.query<EmailReadinessRow>(
    `with relevant_accounts as (
       select *,
              coalesce(
                nullif(lower(properties ->> 'mailbox_email'), ''),
                nullif(lower(display_name), ''),
                id::text
              ) as outlook_mailbox_key
         from channel_accounts
        where workspace_id = $1
          and kind in ('oauth_outlook', 'email_domain')
     ),
     outlook_mailboxes as (
       select outlook_mailbox_key,
              bool_or(status = 'connected') as has_connected,
              bool_or(
                status = 'connected'
                and properties -> 'outlook_subscription' is not null
                and properties -> 'outlook_subscription' ->> 'clientState' is not null
                and properties -> 'outlook_subscription' ->> 'lifecycleNotificationUrl' is not null
                and (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
                      > now() + interval '15 minutes'
              ) as has_active_subscription,
              bool_or(status = 'needs_reauth') as has_needs_reauth,
              bool_or(status = 'connected' and last_error is not null) as has_connected_error
         from relevant_accounts
        where kind = 'oauth_outlook'
        group by outlook_mailbox_key
     )
     select
       (select count(*) from outlook_mailboxes where has_connected)::text as connected_outlook,
       (select count(*) from outlook_mailboxes where has_active_subscription)::text as active_subscriptions,
       (select count(*) from outlook_mailboxes where has_needs_reauth and not has_connected)::text as needs_reauth_outlook,
       (select count(*) from outlook_mailboxes where has_connected_error)::text as errored_connected,
       count(*) filter (
         where kind = 'email_domain'
           and status = 'connected'
       )::text as connected_managed_domains
       from relevant_accounts`,
    [workspaceId],
  );
  const row = rows[0] ?? {
    connected_outlook: 0,
    active_subscriptions: 0,
    needs_reauth_outlook: 0,
    errored_connected: 0,
    connected_managed_domains: 0,
  };
  const connected = numericCount(row.connected_outlook);
  const activeSubscriptions = numericCount(row.active_subscriptions);
  const needsReauth = numericCount(row.needs_reauth_outlook);
  const errored = numericCount(row.errored_connected);
  const managedDomains = numericCount(row.connected_managed_domains);
  const ready = connected > 0 && activeSubscriptions > 0 && errored === 0;
  const statusLabel = ready
    ? "Ready"
    : needsReauth > 0
      ? "Reconnect inbox"
      : connected > 0
        ? "Repairing sync"
        : "Connect inbox";
  const detail = ready
    ? `${activeSubscriptions}/${connected} Outlook inboxes have active reply sync.`
    : needsReauth > 0
      ? `${needsReauth} Outlook ${
          needsReauth === 1 ? "inbox needs" : "inboxes need"
        } Microsoft reauthorization. Reconnect Outlook before approved drafts can send.`
      : connected > 0
        ? `${activeSubscriptions}/${connected} Outlook inboxes have active reply sync. We're repairing Graph subscriptions in the background; no reconnect is needed unless Microsoft revoked the grant.`
        : "No connected Outlook inbox. Approved drafts wait until a Microsoft 365 mailbox is connected.";
  return {
    ready,
    connected_outlook_accounts: connected,
    active_outlook_subscriptions: activeSubscriptions,
    needs_reauth_outlook_accounts: needsReauth,
    errored_outlook_accounts: errored,
    connected_managed_domain_accounts: managedDomains,
    status_label: statusLabel,
    detail,
  };
}

export async function loadQualifiedSignalWorkbench(
  pool: Pool,
  workspaceId: string,
  opts: { limit?: number } = {},
): Promise<QualifiedSignalWorkbench> {
  const limit = Math.max(1, Math.min(100, Math.trunc(opts.limit ?? 50)));
  const { rows } = await pool.query<QualifiedSignalRow>(
    `with qualified_signals as (
       select s.*
         from signals s
         left join account_intent_scores seed_account_intent
           on seed_account_intent.workspace_id = s.workspace_id
          and seed_account_intent.company_id = s.related_company_id
        where s.workspace_id = $1
          and s.status in ('matched', 'in_play')
          and s.related_company_id is not null
        order by coalesce(seed_account_intent.composite_score, 0) desc,
                 coalesce(s.match_score, 0) desc,
                 s.freshness_at desc,
                 s.ingested_at desc
        limit greatest($2::int * 5, 250)
     )
     select s.id::text,
            s.kind::text as kind,
            s.status::text as status,
            s.title,
            s.content,
            s.url,
            s.match_score::text as match_score,
            s.match_reason,
            s.freshness_at,
            s.ingested_at,
            matched.occurred_at as matched_at,
            co.id::text as company_id,
            co.name as company_name,
            co.domain::text as company_domain,
            co.industry as company_industry,
            co.description as company_description,
            coalesce(account_intent.composite_score, 0)::text as account_intent_score,
            coalesce(account_intent.live_signal_count, 1) as account_signal_count,
            resolved.payload->'candidates' as contact_candidates,
            resolved.payload->>'channel' as contact_channel,
            deferred.payload->>'defer_reason' as contact_defer_reason,
            coalesce(graph_contacts.candidates, '[]'::jsonb) as graph_candidates,
            draft.conversation_id::text as draft_conversation_id,
            draft.message_id::text as draft_message_id,
            draft.channel::text as draft_channel,
            draft.status::text as draft_status,
            draft.subject as draft_subject,
            draft.body as draft_body,
            draft.eval_score::text as draft_eval_score,
            draft.eval_passed as draft_eval_passed,
            draft.external_id as draft_external_id,
            draft.scheduled_at as draft_scheduled_at,
            draft.sent_at as draft_sent_at,
            draft.delivered_at as draft_delivered_at,
            draft.channel_event_type as draft_channel_event_type,
            draft.channel_event_at as draft_channel_event_at,
            draft.defer_reason as draft_defer_reason,
            draft.defer_detail as draft_defer_detail,
            draft.created_at as draft_created_at,
            draft.pending_approval_id::text as pending_approval_id
       from qualified_signals s
       left join graph_companies co
         on co.id = s.related_company_id
        and co.workspace_id = s.workspace_id
       left join lateral (
         select ais.composite_score,
                ais.live_signal_count
           from account_intent_scores ais
          where ais.workspace_id = s.workspace_id
            and (
              ais.company_id = s.related_company_id
              or (
                co.domain is not null
                and ais.normalized_domain = co.domain
              )
            )
          order by
               case
                 when ais.company_id = s.related_company_id then 0
                 else 1
               end,
               ais.updated_at desc,
               ais.company_id asc
          limit 1
       ) account_intent on true
       left join lateral (
         select e.occurred_at
           from events e
          where e.workspace_id = s.workspace_id
            and e.event_type = 'signal.matched'
            and e.payload->>'signal_id' = s.id::text
          order by e.occurred_at desc
          limit 1
       ) matched on true
       left join lateral (
         select e.payload, e.occurred_at
           from events e
          where e.workspace_id = s.workspace_id
            and e.event_type = 'contact.resolved'
            and e.payload->>'signal_id' = s.id::text
            and e.payload->>'channel' in ('email','linkedin')
          order by e.occurred_at desc
          limit 1
       ) resolved on true
       left join lateral (
         select e.payload, e.occurred_at
           from events e
          where e.workspace_id = s.workspace_id
            and e.event_type = 'contact.resolution.deferred'
            and e.payload->>'signal_id' = s.id::text
            and e.payload->>'channel' in ('email','linkedin')
          order by e.occurred_at desc
          limit 1
       ) deferred on true
       left join lateral (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'rank', ranked.rank,
                  'person_id', ranked.id::text,
                  'full_name', ranked.full_name,
                  'title', ranked.title,
                  'score', ranked.score,
                  'contact_fit_decision', ranked.contact_fit_decision,
                  'reasons', ranked.reasons,
                  'emails', ranked.emails,
                  'linkedin_url', ranked.linkedin_url,
                  'verification', jsonb_build_object(
                    'email_verified', ranked.email_verified,
                    'email_status', ranked.email_status,
                    'linkedin_ready', ranked.linkedin_ready
                  ),
                  'provenance', ranked.provenance
                ) order by ranked.rank), '[]'::jsonb) as candidates
           from (
             select row_number() over (
                      order by
                        case gp.properties #>> '{contact_fit,decision}'
                          when 'fit' then 0
                          when 'unsure' then 1
                          when 'not_fit' then 3
                          else 2
                        end,
                        case
                          when gp.title ~* '(founder|co-founder|ceo|chief executive|owner)' then 0
                          when gp.title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 1
                          else 2
                        end,
                        gp.updated_at desc,
                        gp.full_name asc
                    ) as rank,
                    gp.id,
                    gp.full_name,
                    gp.title,
                    gp.properties #>> '{contact_fit,decision}' as contact_fit_decision,
                    coalesce((
                      select array_prepend(ev.email::citext, array_remove(gp.emails, ev.email::citext))
                        from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                       where meta->>'verified' = 'true'
                       limit 1
                    ), gp.emails) as emails,
                    gp.linkedin_url,
                    gp.provenance,
                    case
                      when gp.title ~* '(founder|co-founder|ceo|chief executive|owner)' then 0.95
                      when gp.title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 0.82
                      else 0.55
                    end as score,
                    to_jsonb(array_remove(array[
                      case when gp.title ~* '(founder|co-founder|ceo|chief executive|owner)' then 'executive_or_founder' end,
                      case when gp.title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 'gtm_leader' end,
                      case when cardinality(coalesce(gp.emails, '{}'::text[])) > 0 then 'has_email' end,
                      case when exists (
                        select 1
                          from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                         where meta->>'verified' = 'true'
                      ) then 'verified_email' end,
                      case when gp.linkedin_url is not null then 'linkedin_ready' end
                    ], null)) as reasons,
                    exists (
                      select 1
                        from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                       where meta->>'verified' = 'true'
                    ) as email_verified,
                    (
                      select meta->>'status'
                        from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                       where meta->>'verified' = 'true'
                       limit 1
                    ) as email_status,
                    gp.linkedin_url is not null as linkedin_ready
               from graph_persons gp
              where gp.workspace_id = s.workspace_id
                and gp.company_id = s.related_company_id
                and (
                  gp.linkedin_url is not null
                  or exists (
                    select 1
                      from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                     where meta->>'verified' = 'true'
                  )
                )
             order by
                case gp.properties #>> '{contact_fit,decision}'
                  when 'fit' then 0
                  when 'unsure' then 1
                  when 'not_fit' then 3
                  else 2
                end,
                case
                  when gp.title ~* '(founder|co-founder|ceo|chief executive|owner)' then 0
                  when gp.title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 1
                  else 2
                end,
                case
                  when exists (
                    select 1
                      from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                     where meta->>'verified' = 'true'
                  ) then 0
                  when gp.linkedin_url is not null then 1
                  else 2
                end,
                gp.updated_at desc,
                gp.full_name asc
              limit 3
           ) ranked
       ) graph_contacts on true
       left join lateral (
         select c.id as conversation_id,
                m.id as message_id,
                m.channel,
                m.status,
                m.subject,
                m.body,
                coalesce(m.eval_score, (judged.payload->>'eval_score')::numeric) as eval_score,
                case
                  when rejected.payload is not null then false
                  when judged.payload ? 'passed' then (judged.payload->>'passed')::boolean
                  else m.eval_passed
                end as eval_passed,
                m.external_id,
                m.scheduled_at,
                m.sent_at,
                m.delivered_at,
                m.created_at,
                channel_event.event_type as channel_event_type,
                channel_event.occurred_at as channel_event_at,
                coalesce(
                  channel_event.payload->>'defer_reason',
                  m.eval_notes->>'defer_reason',
                  m.properties->>'defer_reason',
                  rejected.payload->>'reason'
                ) as defer_reason,
                coalesce(
                  channel_event.payload->>'detail',
                  m.eval_notes->>'defer_detail',
                  m.properties->>'defer_detail',
                  rejected.payload->>'reason',
                  judged.payload #>> '{notes,critique}'
                ) as defer_detail,
                approval.id as pending_approval_id
           from conversations c
           join messages m
             on m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
            and m.direction = 'outbound'
            and m.channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
           left join lateral (
             select e.event_type,
                    e.occurred_at,
                    e.payload
               from events e
              where e.workspace_id = c.workspace_id
                and e.event_type in (
                  'message.queued',
                  'message.sent',
                  'message.deferred',
                  'message.delivered',
                  'message.bounced'
                )
                and e.payload->>'message_id' = m.id::text
             order by e.occurred_at desc
             limit 1
           ) channel_event on true
           left join lateral (
             select e.payload,
                    e.occurred_at
               from events e
              where e.workspace_id = c.workspace_id
                and e.event_type = 'draft.judged'
                and e.payload->>'message_id' = m.id::text
              order by e.occurred_at desc
              limit 1
           ) judged on true
           left join lateral (
             select e.payload,
                    e.occurred_at
               from events e
              where e.workspace_id = c.workspace_id
                and e.event_type = 'draft.rejected'
                and e.payload->>'message_id' = m.id::text
              order by e.occurred_at desc
              limit 1
           ) rejected on true
           left join lateral (
             select a.id
               from workflow_approvals a
              where a.workspace_id = c.workspace_id
                and a.decision = 'pending'
                and a.payload ? 'message_id'
                and a.payload->>'message_id' = m.id::text
              order by a.created_at desc
              limit 1
           ) approval on true
          where c.workspace_id = s.workspace_id
            and c.origin_signal_id = s.id
          order by m.created_at desc
          limit 1
       ) draft on true
      order by
               coalesce(account_intent.composite_score, 0) desc,
               case
                 when draft.message_id is not null
                   and (
                     coalesce(jsonb_array_length(coalesce(resolved.payload->'candidates', '[]'::jsonb)), 0) > 0
                     or coalesce(jsonb_array_length(coalesce(graph_contacts.candidates, '[]'::jsonb)), 0) > 0
                   ) then 0
                 when draft.message_id is not null then 1
                 when coalesce(jsonb_array_length(coalesce(resolved.payload->'candidates', '[]'::jsonb)), 0) > 0
                   or coalesce(jsonb_array_length(coalesce(graph_contacts.candidates, '[]'::jsonb)), 0) > 0 then 2
                 else 3
               end,
               coalesce(s.match_score, 0) desc,
               s.freshness_at desc,
               s.ingested_at desc
      limit greatest($2::int * 5, 250)`,
    [workspaceId, limit],
  );

  const now = new Date();
  const signals = rows
    .sort((left, right) => compareQualifiedSignalRows(left, right, now))
    .slice(0, limit)
    .map(mapQualifiedSignalRow);
  return {
    signals,
    stats: {
      qualified: signals.length,
      with_verified_contacts: signals.filter((signal) =>
        signal.contacts.some((contact) =>
          contact.verification.email_verified === true ||
          contact.verification.linkedin_ready === true
        )
      ).length,
      with_outreach_draft: signals.filter((signal) => signal.outreach_draft).length,
      with_email_draft: signals.filter((signal) => signal.outreach_draft).length,
      ready_for_review: signals.filter((signal) =>
        isOutreachDraftReadyForReview(signal.outreach_draft)
      ).length,
      blocked_by_fit: signals.filter((signal) =>
        signal.contacts.some((contact) => contact.contact_fit_decision === "not_fit")
      ).length,
    },
  };
}

function isOutreachDraftReadyForReview(
  draft: QualifiedSignalOutreachDraft | null,
): boolean {
  if (!draft) return false;
  if (draft.eval_passed === false) return false;
  return Boolean(draft.pending_approval_id) ||
    draft.status === "draft" ||
    draft.status === "deferred";
}

function numericCount(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareQualifiedSignalRows(
  left: QualifiedSignalRow,
  right: QualifiedSignalRow,
  now: Date,
): number {
  return accountIntentScore(right) - accountIntentScore(left) ||
    qualifiedSignalBucket(left) - qualifiedSignalBucket(right) ||
    signalIntentScore(right, now) - signalIntentScore(left, now) ||
    right.freshness_at.getTime() - left.freshness_at.getTime() ||
    right.ingested_at.getTime() - left.ingested_at.getTime() ||
    left.id.localeCompare(right.id);
}

function qualifiedSignalBucket(row: QualifiedSignalRow): number {
  const hasDraft = Boolean(row.draft_message_id);
  const hasContacts =
    parseJsonArray(row.contact_candidates).length > 0 ||
    parseJsonArray(row.graph_candidates).length > 0;
  if (hasDraft && hasContacts) return 0;
  if (hasDraft) return 1;
  if (hasContacts) return 2;
  return 3;
}

function signalIntentScore(row: QualifiedSignalRow, now: Date): number {
  return scoreSignalIntent({
    kind: signalKindOrNull(row.kind),
    match_score: parseNumber(row.match_score),
    freshness_at: row.freshness_at,
  }, now).intent_score;
}

function accountIntentScore(row: QualifiedSignalRow): number {
  return parseNumber(row.account_intent_score) ?? 0;
}

function mapQualifiedSignalRow(row: QualifiedSignalRow): QualifiedSignalItem {
  const resolvedContacts = normalizeContactCandidates(row.contact_candidates);
  const graphContacts = normalizeContactCandidates(row.graph_candidates);
  const contacts = resolvedContacts.length > 0 ? resolvedContacts : graphContacts;
  const outreachDraft = row.draft_message_id && row.draft_conversation_id && row.draft_channel && row.draft_status && row.draft_created_at
    ? {
        conversation_id: row.draft_conversation_id,
        message_id: row.draft_message_id,
        channel: row.draft_channel,
        status: row.draft_status,
        subject: row.draft_subject,
        body: row.draft_body,
        eval_score: parseNumber(row.draft_eval_score),
        eval_passed: row.draft_eval_passed,
        external_id: row.draft_external_id,
        scheduled_at: row.draft_scheduled_at,
        sent_at: row.draft_sent_at,
        delivered_at: row.draft_delivered_at,
        latest_channel_event_type: row.draft_channel_event_type,
        latest_channel_event_at: row.draft_channel_event_at,
        defer_reason: row.draft_defer_reason,
        defer_detail: row.draft_defer_detail,
        pending_approval_id: row.pending_approval_id,
        created_at: row.draft_created_at,
      }
    : null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: normalizeSignalDisplayText(row.title),
    content: normalizeNullableSignalDisplayText(row.content),
    url: normalizeNullableSignalDisplayText(row.url),
    match_score: parseNumber(row.match_score),
    match_reason: normalizeNullableSignalDisplayText(row.match_reason),
    account_intent_score: accountIntentScore(row),
    account_signal_count:
      row.account_signal_count == null ? 1 : numericCount(row.account_signal_count),
    freshness_at: row.freshness_at,
    ingested_at: row.ingested_at,
    matched_at: row.matched_at,
    company: {
      id: row.company_id,
      name: normalizeNullableSignalDisplayText(row.company_name),
      domain: normalizeNullableSignalDisplayText(row.company_domain),
      industry: normalizeNullableSignalDisplayText(row.company_industry),
      description: normalizeNullableSignalDisplayText(row.company_description),
    },
    contacts,
    contact_source:
      resolvedContacts.length > 0 ? "resolution" : graphContacts.length > 0 ? "graph" : "none",
    contact_channel: row.contact_channel,
    contact_defer_reason: row.contact_defer_reason,
    outreach_draft: outreachDraft,
    email_draft: outreachDraft,
  };
}

const HTML_ENTITY_NAMES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

export function normalizeSignalDisplayText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (_match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return codePointToText(codePoint, _match);
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return codePointToText(codePoint, _match);
    }
    return HTML_ENTITY_NAMES[key] ?? _match;
  });
}

function codePointToText(codePoint: number, fallback: string): string {
  if (
    Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10ffff
  ) {
    return String.fromCodePoint(codePoint);
  }
  return fallback;
}

function normalizeNullableSignalDisplayText(value: string | null): string | null {
  return value ? normalizeSignalDisplayText(value) : null;
}

export function normalizeContactCandidates(value: unknown): QualifiedSignalContact[] {
  const arr = parseJsonArray(value);
  return arr.flatMap((item, index) => {
    const record = objectValue(item);
    if (!record) return [];
    const verification = objectValue(record.verification) ?? {};
    const provenance = objectValue(record.provenance) ?? {};
    return [{
      rank: numberValue(record.rank) ?? index + 1,
      person_id: stringValue(record.person_id) ?? "",
      full_name: stringValue(record.full_name) ?? "Unknown person",
      title: nullableString(record.title),
      score: numberValue(record.score) ?? 0,
      contact_fit_decision: contactFitDecision(record.contact_fit_decision),
      reasons: stringArray(record.reasons),
      emails: stringArray(record.emails),
      linkedin_url: nullableString(record.linkedin_url),
      verification: {
        email_verified: booleanValue(verification.email_verified),
        email_status: nullableString(verification.email_status),
        linkedin_ready: booleanValue(verification.linkedin_ready),
      },
      provenance,
    }];
  }).filter((contact) => contact.person_id || contact.full_name !== "Unknown person");
}

function contactFitDecision(
  value: unknown,
): QualifiedSignalContact["contact_fit_decision"] {
  return value === "fit" || value === "unsure" || value === "not_fit"
    ? value
    : null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signalKindOrNull(value: string): SignalKind | null {
  return value === "funding" ||
      value === "hiring" ||
      value === "leadership_change" ||
      value === "product_launch" ||
      value === "acquisition" ||
      value === "churn_risk" ||
      value === "competitor_move" ||
      value === "podcast_mention" ||
      value === "press_mention" ||
      value === "regulation" ||
      value === "expansion" ||
      value === "layoff" ||
      value === "other"
    ? value
    : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}
