import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { resolveQualifiedSignalContactsAction } from "@/app/dashboard/actions";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  contactResolutionStatusLabel,
  normalizedSignalHeading,
  signalCategoryLabel,
  signalDisplayTitle,
  signalSourceLabel,
} from "@/core/signals/presentation";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Outreach | Bombsell" };
export const dynamic = "force-dynamic";

const SIGNAL_KINDS = [
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "expansion",
  "competitor_move",
  "press_mention",
  "podcast_mention",
  "regulation",
  "layoff",
  "churn_risk",
] as const;

interface OutreachFilters {
  q: string;
  kind: string | null;
  readiness: "ready" | "missing" | null;
  freshness: 1 | 7 | 30;
  size: string | null;
  industry: string | null;
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
  match_score: number | null;
  match_reason: string | null;
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
  limit = 60,
): Promise<MatchedLeadRow[]> {
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
    match_score: string | null;
    match_reason: string | null;
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
  }>(
    `with recent_signals as materialized (
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
          and coalesce(s.ingested_at, s.freshness_at) >= now() - make_interval(days => $5)
          and ($3::text is null or s.kind::text = $3)
          and ($7::text is null or co.size_bucket = $7)
          and ($8::text is null or co.industry ilike $8)
          and (
            $6::text is null
            or co.name ilike $6
            or co.domain::text ilike $6
            or s.title ilike $6
            or s.match_reason ilike $6
          )
          and (
            $4::text is null
            or (
              $4 = 'ready'
              and exists (
                select 1
                  from graph_persons rp
                 where rp.workspace_id = s.workspace_id
                   and (
                     rp.id = s.related_person_id
                     or (s.related_company_id is not null and rp.company_id = s.related_company_id)
                   )
                   and (
                     cardinality(coalesce(rp.emails, '{}'::text[])) > 0
                     or rp.linkedin_url is not null
                   )
              )
            )
            or (
              $4 = 'missing'
              and not exists (
                select 1
                  from graph_persons mp
                 where mp.workspace_id = s.workspace_id
                   and (
                     mp.id = s.related_person_id
                     or (s.related_company_id is not null and mp.company_id = s.related_company_id)
                   )
                   and (
                     cardinality(coalesce(mp.emails, '{}'::text[])) > 0
                     or mp.linkedin_url is not null
                   )
              )
            )
          )
        order by coalesce(s.ingested_at, s.freshness_at) desc
        limit $2
     )
     select
        s.id                                      as signal_id,
        s.title                                   as signal_title,
        coalesce(s.kind::text, 'other')           as signal_kind,
        coalesce(s.ingested_at, s.freshness_at)   as signal_at,
        s.url                                     as signal_url,
        gs.name                                   as source_name,
        gs.kind::text                             as source_kind,
        s.match_score::text                       as match_score,
        s.match_reason                            as match_reason,
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
               and (
                 cardinality(coalesce(p.emails, '{}'::text[])) > 0
                 or p.linkedin_url is not null
               )
             order by cardinality(coalesce(p.emails, '{}'::text[])) desc,
                      p.updated_at desc
             limit 2
          ) c
        )::text as contacts_json
       from recent_signals s
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
      order by coalesce(s.ingested_at, s.freshness_at) desc`,
    [
      workspaceId,
      limit,
      filters.kind,
      filters.readiness,
      filters.freshness,
      search,
      filters.size,
      filters.industry ? `%${filters.industry}%` : null,
    ],
  );

  return rows.map((row) => ({
    signal_id: row.signal_id,
    signal_title: signalDisplayTitle(row.signal_title),
    signal_kind: row.signal_kind,
    signal_at: row.signal_at,
    signal_url: row.signal_url,
    source_name: row.source_name,
    source_kind: row.source_kind,
    match_score: numericValue(row.match_score),
    match_reason: row.match_reason,
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
    contacts: parseContacts(row.contacts_json),
  }));
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
          Outreach
        </p>
        <h1 className="mt-3 text-[32px] font-bold leading-tight tracking-[-0.02em] text-[var(--color-text-1)]">
          Matched leads
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
  const leads = await loadMatchedLeads(session.workspace.id, filters).catch((err) => {
    console.error("[outreach] load failed", err);
    return [] as MatchedLeadRow[];
  });

  return (
    <section className="space-y-3">
      <OutreachFilters filters={filters} resultCount={leads.length} />
      {leads.length === 0 ? (
        hasFilters(filters) ? (
          <FilteredEmpty noun="leads" />
        ) : (
          <OutreachEmpty />
        )
      ) : (
        <LeadsTable leads={leads} />
      )}
    </section>
  );
}

function OutreachFilters({
  filters,
  resultCount,
}: {
  filters: OutreachFilters;
  resultCount: number;
}) {
  return (
    <form
      action="/dashboard/outreach"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <label className="relative min-w-0 flex-1 sm:min-w-[260px]">
        <span className="sr-only">Search leads</span>
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)]" />
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Search account, domain, signal…"
          className="h-9 w-full rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] pl-9 pr-3 text-[13px] text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
        />
      </label>
      <FilterSelect name="kind" label="All signals" value={filters.kind}>
        {SIGNAL_KINDS.map((kind) => (
          <option key={kind} value={kind}>{signalCategoryLabel(kind)}</option>
        ))}
      </FilterSelect>
      <FilterSelect name="readiness" label="Any contact" value={filters.readiness}>
        <option value="ready">Contact ready</option>
        <option value="missing">Needs contact</option>
      </FilterSelect>
      <FilterSelect name="freshness" label="Last 30 days" value={String(filters.freshness)}>
        <option value="1">Last 24 hours</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
      </FilterSelect>
      <details className="relative" open={Boolean(filters.size || filters.industry)}>
        <summary className="btn-quiet-sm h-9 cursor-pointer list-none justify-center">
          More filters
          {(filters.size ? 1 : 0) + (filters.industry ? 1 : 0) > 0 ? (
            <span className="text-[10px] text-[var(--color-accent)]">
              {(filters.size ? 1 : 0) + (filters.industry ? 1 : 0)}
            </span>
          ) : null}
        </summary>
        <div className="mt-2 grid min-w-[220px] gap-2 rounded-[7px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-3 shadow-lg sm:absolute sm:right-0 sm:top-full sm:z-20">
          <FilterSelect name="size" label="Any company size" value={filters.size}>
            {["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"].map((size) => (
              <option key={size} value={size}>{size} employees</option>
            ))}
          </FilterSelect>
          <label>
            <span className="sr-only">Industry</span>
            <input
              name="industry"
              defaultValue={filters.industry ?? ""}
              placeholder="Industry"
              className="h-9 w-full rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 text-[12px] text-[var(--color-text-2)] outline-none focus:border-[var(--color-line-3)]"
            />
          </label>
        </div>
      </details>
      <button type="submit" className="btn-quiet-sm h-9 justify-center">Apply</button>
      {hasFilters(filters) ? (
        <Link href="/dashboard/outreach" className="px-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">
          Clear
        </Link>
      ) : null}
      <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--color-text-4)]">
        {resultCount} results
      </span>
    </form>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string | null;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-9 rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-2.5 text-[12px] text-[var(--color-text-2)] outline-none focus:border-[var(--color-line-3)]"
      >
        <option value="">{label}</option>
        {children}
      </select>
    </label>
  );
}

function OutreachResultsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading matched leads</p>
      <div className="dashboard-loader-skeleton h-16 rounded-[8px]" />
      <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)]">
        <TableHeader />
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="grid gap-5 border-t border-[var(--color-line-1)] px-4 py-4 lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(110px,.65fr)_minmax(190px,1.1fr)_80px]">
            {[0, 1, 2, 3, 4].map((cell) => (
              <div key={cell} className="dashboard-loader-skeleton h-10" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableHeader() {
  return (
    <div className="hidden gap-5 bg-[var(--color-ink-1)] px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] lg:grid lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(110px,.65fr)_minmax(190px,1.1fr)_80px]">
      <span>Account</span>
      <span>Signal</span>
      <span>Fit</span>
      <span>Contact</span>
      <span>Detected</span>
    </div>
  );
}

function LeadsTable({ leads }: { leads: MatchedLeadRow[] }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <TableHeader />
      <ul className="divide-y divide-[var(--color-line-1)]">
        {leads.map((lead) => <LeadRow key={lead.signal_id} lead={lead} />)}
      </ul>
    </div>
  );
}

function LeadRow({ lead }: { lead: MatchedLeadRow }) {
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
    <li className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_minmax(110px,.65fr)_minmax(190px,1.1fr)_80px] lg:items-start lg:gap-5">
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
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tabular-nums text-[var(--color-text-1)]">
          {formatFitScore(lead.match_score)}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-3)]">
          {lead.match_reason ?? "Matched to your active ICP"}
        </p>
      </div>
      <ContactCell lead={lead} />
      <span className="text-[11.5px] tabular-nums text-[var(--color-text-3)]">
        {relativeWhen(lead.signal_at)}
      </span>
    </li>
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
  const freshness = Number(single(params.freshness));
  const readiness = single(params.readiness);
  return {
    q: single(params.q).trim(),
    kind: single(params.kind) || null,
    readiness: readiness === "ready" || readiness === "missing" ? readiness : null,
    freshness: freshness === 1 || freshness === 7 ? freshness : 30,
    size: single(params.size) || null,
    industry: single(params.industry).trim() || null,
  };
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasFilters(filters: OutreachFilters): boolean {
  return Boolean(filters.q || filters.kind || filters.readiness || filters.size || filters.industry || filters.freshness !== 30);
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

function formatFitScore(score: number | null): string {
  if (score == null) return "Matched";
  const percent = score <= 1 ? Math.round(score * 100) : Math.round(score);
  return `${Math.max(0, Math.min(100, percent))}% fit`;
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
