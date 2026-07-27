import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { DraftPreviewButton, type ReviewDraftPreview } from "@/components/dashboard/DraftPreviewButton";
import { LeadsFilters } from "@/components/dashboard/LeadsFilters";
import { resolveQualifiedSignalContactsAction } from "@/app/dashboard/actions";
import { getPool } from "@/core/substrate/storage/index.ts";
import { SIGNAL_OUTREACH_ELIGIBILITY_SQL } from "@/core/product/signal-outreach-eligibility";
import {
  contactResolutionStatusLabel,
  normalizedSignalHeading,
  signalCategoryLabel,
  signalDisplayTitle,
  signalSourceLabel,
} from "@/core/signals/presentation";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Leads | Bombsell" };
export const dynamic = "force-dynamic";

const SIGNAL_KINDS = [
  "hiring",
  "funding",
  "acquisition",
  "leadership_change",
  "product_launch",
  "expansion",
  "competitor_move",
  "press_mention",
  "podcast_mention",
  "regulation",
  "layoff",
  "churn_risk",
] as const;

const PAGE_SIZE = 20;

interface OutreachFilters {
  q: string;
  kind: string | null;
  readiness: "email" | "linkedin" | null;
  size: string | null;
  page: number;
}

type OutreachSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

interface MatchedLeadRow {
  signal_id: string;
  signal_title: string;
  signal_kind: string;
  signal_at: Date;
  signal_url: string | null;
  source_name: string | null;
  source_kind: string | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_size: string | null;
  employee_count: number | null;
  industry: string | null;
  annual_revenue: number | null;
  location: string | null;
  resolution_status: string | null;
  defer_reason: string | null;
  draft: ReviewDraftPreview | null;
  contacts: Array<{
    person_id: string;
    full_name: string;
    title: string | null;
    emails: string[];
    linkedin_url: string | null;
  }>;
}

async function loadMatchedLeads(
  workspaceId: string,
  filters: OutreachFilters,
  includeDrafts: boolean,
): Promise<{ leads: MatchedLeadRow[]; total: number }> {
  const pool = getPool();
  const search = filters.q ? `%${filters.q}%` : null;
  const { rows } = await pool.query<{
    signal_id: string;
    signal_title: string;
    signal_kind: string;
    signal_at: Date;
    signal_url: string | null;
    source_name: string | null;
    source_kind: string | null;
    company_id: string | null;
    company_name: string | null;
    company_domain: string | null;
    company_size: string | null;
    employee_count: string | null;
    industry: string | null;
    annual_revenue: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    resolution_status: string | null;
    defer_reason: string | null;
    contacts_json: string | null;
    draft_message_id: string | null;
    draft_conversation_id: string | null;
    draft_subject: string | null;
    draft_body: string | null;
    draft_channel: string | null;
    draft_eval_score: string | null;
    total_count: string;
  }>(
    `with qualified_signals as materialized (
       select s.id, s.title, s.kind, s.ingested_at, s.freshness_at, s.url,
              s.source_id, s.related_company_id, s.related_person_id,
              s.workspace_id, s.match_score, s.match_reason,
              co.name as company_name, co.domain::text as company_domain,
              co.size_bucket as company_size, co.industry,
              co.properties
         from signals s
         left join graph_companies co
           on co.workspace_id = s.workspace_id
          and co.id = s.related_company_id
        where s.workspace_id = $1
          and s.status in ('matched','in_play')
          and (${SIGNAL_OUTREACH_ELIGIBILITY_SQL})
          and ($2::text is null or s.kind::text = $2)
          and ($5::text is null or co.size_bucket = $5)
          and (
            $4::text is null
            or co.name ilike $4
            or co.domain::text ilike $4
            or s.title ilike $4
            or s.match_reason ilike $4
          )
          and (
            $3::text is null
            or (
              $3 = 'email'
              and exists (
                select 1
                  from graph_persons rp
                 where rp.workspace_id = s.workspace_id
                   and (
                     rp.id = s.related_person_id
                     or (s.related_company_id is not null and rp.company_id = s.related_company_id)
                   )
                   and exists (
                     select 1
                       from jsonb_each(
                         coalesce(rp.properties->'email_verification', '{}'::jsonb)
                       ) as ready_email(email, meta)
                      where meta->>'verified' = 'true'
                   )
              )
            )
            or (
              $3 = 'linkedin'
              and exists (
                select 1
                  from graph_persons mp
                 where mp.workspace_id = s.workspace_id
                   and (
                     mp.id = s.related_person_id
                     or (s.related_company_id is not null and mp.company_id = s.related_company_id)
                   )
                   and mp.linkedin_url ~* '^https?://(www\.)?linkedin\.com/(in|company)/'
              )
            )
          )
     )
     select
        count(*) over()::text                    as total_count,
        s.id                                      as signal_id,
        s.title                                   as signal_title,
        coalesce(s.kind::text, 'other')           as signal_kind,
        coalesce(s.ingested_at, s.freshness_at)   as signal_at,
        s.url                                     as signal_url,
        gs.name                                   as source_name,
        gs.kind::text                             as source_kind,
        s.related_company_id                      as company_id,
        s.company_name,
        s.company_domain,
        s.company_size,
        s.properties ->> 'employee_count'         as employee_count,
        s.industry,
        s.properties ->> 'annual_revenue'         as annual_revenue,
        s.properties -> 'location' ->> 'city'     as city,
        s.properties -> 'location' ->> 'state'    as state,
        s.properties -> 'location' ->> 'country'  as country,
        cr.event_type                             as resolution_status,
        cr.defer_reason,
        draft.message_id                          as draft_message_id,
        draft.conversation_id                     as draft_conversation_id,
        draft.subject                             as draft_subject,
        draft.body                                as draft_body,
        draft.channel                             as draft_channel,
        draft.eval_score::text                    as draft_eval_score,
        (
          select json_agg(row_to_json(c))
          from (
            select p.id as person_id, p.full_name, p.title,
                   coalesce(p.emails, '{}'::text[]) as emails,
                   p.linkedin_url
              from graph_persons p
             where p.workspace_id = $1
               and (
                 p.id = s.related_person_id
                 or (s.related_company_id is not null and p.company_id = s.related_company_id)
               )
               and nullif(btrim(p.full_name), '') is not null
               and lower(btrim(p.full_name)) not in (
                 'unknown', 'unknown person', 'unnamed', 'untitled', 'n/a', 'na'
               )
               and (
                 p.linkedin_url ~* '^https?://(www\.)?linkedin\.com/(in|company)/'
                 or exists (
                   select 1
                     from jsonb_each(
                       coalesce(p.properties->'email_verification', '{}'::jsonb)
                     ) as displayed_email(email, meta)
                    where meta->>'verified' = 'true'
                 )
               )
             order by cardinality(coalesce(p.emails, '{}'::text[])) desc,
                      p.updated_at desc
             limit 2
          ) c
        )::text as contacts_json
       from qualified_signals s
       left join graph_sources gs
         on gs.workspace_id = s.workspace_id
        and gs.id = s.source_id
       left join lateral (
         select e.event_type, e.payload ->> 'defer_reason' as defer_reason
           from events e
          where e.workspace_id = s.workspace_id
            and e.payload ? 'signal_id'
            and e.payload ->> 'signal_id' = s.id::text
            and e.event_type in ('contact.resolved', 'contact.resolution.deferred')
          order by e.occurred_at desc
          limit 1
       ) cr on true
       left join lateral (
         select m.id as message_id,
                c.id as conversation_id,
                m.subject,
                m.body,
                m.channel::text as channel,
                coalesce(m.eval_score, (judged.payload->>'eval_score')::numeric) as eval_score
           from conversation_signals cs
           join conversations c
             on c.workspace_id = cs.workspace_id
            and c.id = cs.conversation_id
           join messages m
             on m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
           left join lateral (
             select e.payload
               from events e
              where e.workspace_id = m.workspace_id
                and e.event_type = 'draft.judged'
                and e.payload->>'message_id' = m.id::text
              order by e.occurred_at desc
              limit 1
           ) judged on true
          where $6::boolean
            and cs.workspace_id = s.workspace_id
            and cs.signal_id = s.id
            and m.direction = 'outbound'
            and m.status = 'draft'
            and coalesce(
              case
                when judged.payload ? 'passed' then (judged.payload->>'passed')::boolean
                else null
              end,
              m.eval_passed,
              false
            )
          order by m.created_at desc
          limit 1
       ) draft on true
      order by coalesce(s.ingested_at, s.freshness_at) desc
      limit $7
      offset $8`,
    [
      workspaceId,
      filters.kind,
      filters.readiness,
      search,
      filters.size,
      includeDrafts,
      PAGE_SIZE,
      (filters.page - 1) * PAGE_SIZE,
    ],
  );

  return {
    total: Number(rows[0]?.total_count ?? 0),
    leads: rows.map((row) => ({
    signal_id: row.signal_id,
    signal_title: signalDisplayTitle(row.signal_title),
    signal_kind: row.signal_kind,
    signal_at: row.signal_at,
    signal_url: row.signal_url,
    source_name: row.source_name,
    source_kind: row.source_kind,
    company_id: row.company_id,
    company_name: row.company_name,
    company_domain: row.company_domain,
    company_size: row.company_size,
    employee_count: numericValue(row.employee_count),
    industry: row.industry,
    annual_revenue: numericValue(row.annual_revenue),
    location: [row.city, row.state, row.country].filter(Boolean).join(", ") || null,
    resolution_status: row.resolution_status,
    defer_reason: row.defer_reason,
    draft: row.draft_message_id && row.draft_conversation_id && row.draft_body
      ? {
          messageId: row.draft_message_id,
          conversationId: row.draft_conversation_id,
          companyName: row.company_name ?? row.company_domain ?? "Company",
          contactName: null,
          signalHeading: normalizedSignalHeading({
            kind: row.signal_kind,
            companyName: row.company_name,
            evidenceTitle: signalDisplayTitle(row.signal_title),
          }),
          subject: row.draft_subject,
          body: row.draft_body,
          channel: row.draft_channel ?? "email",
          evalScore: numericValue(row.draft_eval_score),
        }
      : null,
    contacts: parseContacts(row.contacts_json),
    })),
  };
}

export default function OutreachPage({
  searchParams,
}: {
  searchParams: OutreachSearchParams;
}) {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Leads
        </p>
        <h1 className="mt-3 text-[32px] font-bold leading-tight tracking-[-0.02em] text-[var(--color-text-1)]">
          Qualified leads
        </h1>
        <p className="mt-2 max-w-[68ch] text-[14px] leading-6 text-[var(--color-text-3)]">
          Prioritized accounts and contacts, organized by the Signal that makes now the right time.
        </p>
      </header>

      <Suspense fallback={<OutreachResultsSkeleton />}>
        <OutreachLeads searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OutreachLeads({
  searchParams,
}: {
  searchParams: OutreachSearchParams;
}) {
  const filters = parseFilters(await searchParams);
  const session = await getActiveWorkspaceSessionForDashboard("outreach");
  if (!session) return <OutreachEmpty />;
  const reviewMode = session.workspace.autonomy_mode === "review_only";
  const result = await loadMatchedLeads(session.workspace.id, filters, reviewMode).catch((err) => {
    console.error("[outreach] load failed", err);
    return { leads: [] as MatchedLeadRow[], total: 0 };
  });

  return (
    <section className="space-y-3">
      <LeadsFilters
        key={filters.q}
        filters={filters}
        resultCount={result.total}
        signalKinds={SIGNAL_KINDS.map((kind) => ({ value: kind, label: signalCategoryLabel(kind) }))}
      />
      {result.leads.length === 0 ? (
        hasFilters(filters) ? (
          <FilteredEmpty noun="leads" />
        ) : (
          <OutreachEmpty />
        )
      ) : (
        <>
          <LeadsTable leads={result.leads} reviewMode={reviewMode} />
          <LeadsPagination filters={filters} total={result.total} />
        </>
      )}
    </section>
  );
}

function OutreachResultsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading matched leads</p>
      <div className="dashboard-loader-skeleton h-16 rounded-[8px]" />
      <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)]">
        <TableHeader reviewMode />
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="grid gap-5 border-t border-[var(--color-line-1)] px-4 py-4 lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(190px,1.1fr)_minmax(116px,.7fr)_80px]">
            {[0, 1, 2, 3, 4].map((cell) => (
              <div key={cell} className="dashboard-loader-skeleton h-10" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableHeader({ reviewMode }: { reviewMode: boolean }) {
  return (
    <div className={
      "hidden gap-5 bg-[var(--color-ink-1)] px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] lg:grid " +
      (reviewMode
        ? "lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(190px,1.1fr)_minmax(116px,.7fr)_80px]"
        : "lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(190px,1.1fr)_80px]")
    }>
      <span>Account</span>
      <span>Signal</span>
      <span>Contact</span>
      {reviewMode ? <span>Draft</span> : null}
      <span>Detected</span>
    </div>
  );
}

function LeadsTable({ leads, reviewMode }: { leads: MatchedLeadRow[]; reviewMode: boolean }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <TableHeader reviewMode={reviewMode} />
      <ul className="divide-y divide-[var(--color-line-1)]">
        {leads.map((lead) => <LeadRow key={lead.signal_id} lead={lead} reviewMode={reviewMode} />)}
      </ul>
    </div>
  );
}

function LeadRow({ lead, reviewMode }: { lead: MatchedLeadRow; reviewMode: boolean }) {
  const company = lead.company_name ?? lead.company_domain ?? "Unknown company";
  const sourceLabel = signalSourceLabel({
    sourceName: lead.source_name,
    sourceKind: lead.source_kind,
    url: lead.signal_url,
  });
  const heading = normalizedSignalHeading({
    kind: lead.signal_kind,
    companyName: lead.company_name,
    evidenceTitle: lead.signal_title,
  });

  return (
    <li className={
      "grid gap-4 px-4 py-4 lg:items-start lg:gap-5 " +
      (reviewMode
        ? "lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(190px,1.1fr)_minmax(116px,.7fr)_80px]"
        : "lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(190px,1.1fr)_80px]")
    }>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-[var(--color-text-1)]">{company}</p>
        {lead.company_domain ? <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-3)]">{lead.company_domain}</p> : null}
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-4)]">
          {companyFacts(lead).join(" · ") || lead.location || "Firmographics pending"}
        </p>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <span className="shrink-0 rounded-[4px] bg-[var(--color-ink-2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-2)]">
            {signalCategoryLabel(lead.signal_kind)}
          </span>
          <p className="line-clamp-1 text-[13px] font-medium text-[var(--color-text-1)]">{heading}</p>
        </div>
        <p className="mt-1 line-clamp-1 text-[11.5px] text-[var(--color-text-3)]">{lead.signal_title}</p>
        <p className="mt-1 text-[10.5px] text-[var(--color-text-4)]">
          {lead.signal_url ? (
            <a href={lead.signal_url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-text-2)]">
              {sourceLabel} ↗
            </a>
          ) : sourceLabel}
        </p>
      </div>
      <ContactCell lead={lead} />
      {reviewMode ? <DraftCell lead={lead} /> : null}
      <span className="text-[11.5px] tabular-nums text-[var(--color-text-3)]">
        {relativeWhen(lead.signal_at)}
      </span>
    </li>
  );
}

function DraftCell({ lead }: { lead: MatchedLeadRow }) {
  if (!lead.draft) {
    return <p className="text-[11.5px] leading-4 text-[var(--color-text-4)]">Draft pending</p>;
  }

  const contact = lead.contacts[0];
  return (
    <div className="min-w-0">
      <p className="mb-1 truncate text-[10.5px] font-medium text-[var(--color-pos)]">Ready to review</p>
      <DraftPreviewButton
        draft={{
          ...lead.draft,
          contactName: contact?.full_name ?? null,
        }}
      />
    </div>
  );
}

function ContactCell({ lead }: { lead: MatchedLeadRow }) {
  const contact = lead.contacts[0];
  if (!contact) {
    return (
      <div className="min-w-0">
        <p className="line-clamp-2 text-[11px] leading-4 text-[var(--color-text-3)]">{resolutionLabel(lead)}</p>
        {lead.company_id ? (
          <form action={resolveQualifiedSignalContactsAction} className="mt-2">
            <input type="hidden" name="signal_id" value={lead.signal_id} />
            <input type="hidden" name="return_to" value="/dashboard/outreach" />
            <button type="submit" className="btn-quiet-sm">
              <Icon name="person_search" size={12} /> Find contact
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-[var(--color-text-1)]">{contact.full_name}</p>
        <p className="truncate text-[11px] text-[var(--color-text-3)]">{contact.title ?? "Contact enriched"}</p>
        {lead.contacts.length > 1 ? <p className="mt-0.5 text-[10px] text-[var(--color-text-4)]">+{lead.contacts.length - 1} more</p> : null}
      </div>
      <span className="flex shrink-0 gap-1">
        {contact.emails[0] ? (
          <a href={`mailto:${contact.emails[0]}`} title={contact.emails[0]} className="grid size-7 place-items-center rounded-[5px] border border-[var(--color-line-1)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">
            <Icon name="mail" size={12} />
          </a>
        ) : null}
        {contact.linkedin_url ? (
          <a href={contact.linkedin_url} target="_blank" rel="noreferrer" title="LinkedIn" className="grid size-7 place-items-center rounded-[5px] border border-[var(--color-line-1)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">
            <Icon name="linkedin" size={12} />
          </a>
        ) : null}
      </span>
    </div>
  );
}

function parseFilters(params: Record<string, string | string[] | undefined>): OutreachFilters {
  const readiness = single(params.readiness);
  const rawPage = Number(single(params.page));
  return {
    q: single(params.q).trim(),
    kind: single(params.kind) || null,
    readiness: readiness === "email" || readiness === "linkedin" ? readiness : null,
    size: single(params.size) || null,
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasFilters(filters: OutreachFilters): boolean {
  return Boolean(filters.q || filters.kind || filters.readiness || filters.size);
}

function LeadsPagination({ filters, total }: { filters: OutreachFilters; total: number }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(filters.page, totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  const visiblePages = pageRange(currentPage, totalPages);

  return (
    <nav className="flex flex-col gap-3 px-1 pt-1 sm:flex-row sm:items-center sm:justify-between" aria-label="Leads pagination">
      <p className="text-[12px] tabular-nums text-[var(--color-text-3)]">
        Showing {start}–{end} of {total} qualified leads
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1" aria-label={`Page ${currentPage} of ${totalPages}`}>
          <PaginationLink filters={filters} page={currentPage - 1} disabled={currentPage === 1}>Previous</PaginationLink>
          {visiblePages.map((page) => (
            <PaginationLink key={page} filters={filters} page={page} current={page === currentPage}>{page}</PaginationLink>
          ))}
          <PaginationLink filters={filters} page={currentPage + 1} disabled={currentPage === totalPages}>Next</PaginationLink>
        </div>
      ) : null}
    </nav>
  );
}

function PaginationLink({
  filters,
  page,
  current = false,
  disabled = false,
  children,
}: {
  filters: OutreachFilters;
  page: number;
  current?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return <span className="inline-flex h-8 items-center rounded-[6px] px-2.5 text-[11px] text-[var(--color-text-4)]">{children}</span>;
  }

  return (
    <Link
      href={leadsHref(filters, page)}
      aria-current={current ? "page" : undefined}
      className={
        "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] " +
        (current
          ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]"
          : "text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
      }
    >
      {children}
    </Link>
  );
}

function pageRange(currentPage: number, totalPages: number): number[] {
  const first = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const last = Math.min(totalPages, first + 4);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function leadsHref(filters: OutreachFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.readiness) params.set("readiness", filters.readiness);
  if (filters.size) params.set("size", filters.size);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/dashboard/outreach?${query}` : "/dashboard/outreach";
}

function parseContacts(raw: string | null): MatchedLeadRow["contacts"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((contact) => ({
      person_id: String(contact.person_id ?? ""),
      full_name: String(contact.full_name ?? "Unknown"),
      title: contact.title ?? null,
      emails: Array.isArray(contact.emails) ? contact.emails.map(String) : [],
      linkedin_url: contact.linkedin_url ?? null,
    }));
  } catch {
    return [];
  }
}

function numericValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function companyFacts(lead: MatchedLeadRow): string[] {
  const headcount = lead.employee_count != null
    ? `${lead.employee_count.toLocaleString()} employees`
    : lead.company_size;
  return [headcount, lead.industry, lead.location].filter((fact): fact is string => Boolean(fact));
}

function resolutionLabel(lead: MatchedLeadRow): string {
  if (lead.resolution_status === "contact.resolution.deferred") {
    return contactResolutionStatusLabel(lead.defer_reason);
  }
  if (!lead.company_id) return "Company match pending";
  return "No enriched contact yet";
}

function FilteredEmpty({ noun }: { noun: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[var(--color-line-2)] px-5 py-12 text-center">
      <p className="text-[14px] font-medium text-[var(--color-text-1)]">No {noun} match these filters</p>
      <Link href="/dashboard/outreach" className="mt-2 inline-block text-[12px] text-[var(--color-accent)] hover:underline">Clear filters</Link>
    </div>
  );
}

function OutreachEmpty() {
  return (
    <EmptyState
      title="No matched leads yet"
      hint="Signal ingestion runs continuously. Connect a channel and let the ICP filter warm up."
      cta={{ href: "/dashboard/integrations", label: "Connect channels", icon: "hub" }}
    />
  );
}

function relativeWhen(at: Date): string {
  const diffMs = Date.now() - new Date(at).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
