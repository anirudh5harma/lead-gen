import type { Pool } from "pg";

export interface QualifiedSignalContact {
  rank: number;
  person_id: string;
  full_name: string;
  title: string | null;
  score: number;
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

export interface QualifiedSignalEmailDraft {
  conversation_id: string;
  message_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  eval_score: number | null;
  eval_passed: boolean | null;
  pending_approval_id: string | null;
  created_at: Date;
}

export interface QualifiedSignalItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  content: string | null;
  url: string | null;
  match_score: number | null;
  match_reason: string | null;
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
  email_draft: QualifiedSignalEmailDraft | null;
}

export interface QualifiedSignalWorkbench {
  signals: QualifiedSignalItem[];
  stats: {
    qualified: number;
    with_verified_contacts: number;
    with_email_draft: number;
    ready_for_review: number;
  };
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
  draft_created_at: Date | null;
  pending_approval_id: string | null;
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
        where s.workspace_id = $1
          and s.status in ('matched', 'in_play')
          and s.related_company_id is not null
        order by coalesce(s.match_score, 0) desc,
                 s.freshness_at desc,
                 s.ingested_at desc
        limit $2
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
            draft.created_at as draft_created_at,
            draft.pending_approval_id::text as pending_approval_id
       from qualified_signals s
       left join graph_companies co
         on co.id = s.related_company_id
        and co.workspace_id = s.workspace_id
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
            and e.payload->>'channel' = 'email'
          order by e.occurred_at desc
          limit 1
       ) resolved on true
       left join lateral (
         select e.payload, e.occurred_at
           from events e
          where e.workspace_id = s.workspace_id
            and e.event_type = 'contact.resolution.deferred'
            and e.payload->>'signal_id' = s.id::text
            and e.payload->>'channel' = 'email'
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
                      case when cardinality(gp.emails) > 0 then 'has_email' end
                    ], null) || array['verified_email']) as reasons,
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
                and cardinality(gp.emails) > 0
                and exists (
                  select 1
                    from jsonb_each(coalesce(gp.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                   where meta->>'verified' = 'true'
                )
              order by
                case
                  when gp.title ~* '(founder|co-founder|ceo|chief executive|owner)' then 0
                  when gp.title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 1
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
                m.eval_score,
                m.eval_passed,
                m.created_at,
                approval.id as pending_approval_id
           from conversations c
           join messages m
             on m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
            and m.direction = 'outbound'
            and m.channel = 'email'
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
      order by coalesce(s.match_score, 0) desc,
               s.freshness_at desc,
               s.ingested_at desc`,
    [workspaceId, limit],
  );

  const signals = rows.map(mapQualifiedSignalRow);
  return {
    signals,
    stats: {
      qualified: signals.length,
      with_verified_contacts: signals.filter((signal) =>
        signal.contacts.some((contact) => contact.verification.email_verified === true)
      ).length,
      with_email_draft: signals.filter((signal) => signal.email_draft).length,
      ready_for_review: signals.filter((signal) =>
        Boolean(signal.email_draft?.pending_approval_id) ||
        signal.email_draft?.status === "draft" ||
        signal.email_draft?.status === "deferred"
      ).length,
    },
  };
}

function mapQualifiedSignalRow(row: QualifiedSignalRow): QualifiedSignalItem {
  const resolvedContacts = normalizeContactCandidates(row.contact_candidates);
  const graphContacts = normalizeContactCandidates(row.graph_candidates);
  const contacts = resolvedContacts.length > 0 ? resolvedContacts : graphContacts;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    content: row.content,
    url: row.url,
    match_score: parseNumber(row.match_score),
    match_reason: row.match_reason,
    freshness_at: row.freshness_at,
    ingested_at: row.ingested_at,
    matched_at: row.matched_at,
    company: {
      id: row.company_id,
      name: row.company_name,
      domain: row.company_domain,
      industry: row.company_industry,
      description: row.company_description,
    },
    contacts,
    contact_source:
      resolvedContacts.length > 0 ? "resolution" : graphContacts.length > 0 ? "graph" : "none",
    contact_channel: row.contact_channel,
    contact_defer_reason: row.contact_defer_reason,
    email_draft: row.draft_message_id && row.draft_conversation_id && row.draft_channel && row.draft_status && row.draft_created_at
      ? {
          conversation_id: row.draft_conversation_id,
          message_id: row.draft_message_id,
          channel: row.draft_channel,
          status: row.draft_status,
          subject: row.draft_subject,
          body: row.draft_body,
          eval_score: parseNumber(row.draft_eval_score),
          eval_passed: row.draft_eval_passed,
          pending_approval_id: row.pending_approval_id,
          created_at: row.draft_created_at,
        }
      : null,
  };
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

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}
