import type { Metadata } from "next";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { resolveQualifiedSignalContactsAction } from "@/app/dashboard/actions";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  signalDisplayTitle,
  signalSourceLabel,
} from "@/core/signals/presentation";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Outreach | Bombsell" };
export const dynamic = "force-dynamic";

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
  limit = 50,
): Promise<MatchedLeadRow[]> {
  const pool = getPool();
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
  }>(
    `select
        s.id                                                  as signal_id,
        s.title                                               as signal_title,
        coalesce(s.kind::text, 'other')                       as signal_kind,
        coalesce(s.ingested_at, s.freshness_at)               as signal_at,
        s.url                                                  as signal_url,
        gs.name                                                as source_name,
        gs.kind::text                                          as source_kind,
        co.id                                                 as company_id,
        co.name                                               as company_name,
        co.domain::text                                       as company_domain,
        co.size_bucket                                        as company_size,
        co.properties ->> 'employee_count'                    as employee_count,
        co.industry                                            as industry,
        co.properties ->> 'annual_revenue'                    as annual_revenue,
        co.properties -> 'location' ->> 'city'                as city,
        co.properties -> 'location' ->> 'state'               as state,
        co.properties -> 'location' ->> 'country'             as country,
        cr.event_type                                          as resolution_status,
        cr.defer_reason                                        as defer_reason,
        (
          select json_agg(row_to_json(c))
          from (
            select p.id            as person_id,
                   p.full_name     as full_name,
                   p.title         as title,
                   coalesce(p.emails, '{}'::text[]) as emails,
                   p.linkedin_url  as linkedin_url
              from graph_persons p
             where p.workspace_id = $1
               and (
                 p.id = s.related_person_id
                 or (co.id is not null and p.company_id = co.id)
               )
               and (
                 cardinality(coalesce(p.emails, '{}'::text[])) > 0
                 or p.linkedin_url is not null
               )
             order by cardinality(coalesce(p.emails, '{}'::text[])) desc,
                      p.updated_at desc
             limit 3
          ) c
        )::text as contacts_json
       from signals s
       left join graph_companies co
         on co.workspace_id = s.workspace_id
        and co.id = s.related_company_id
       left join graph_sources gs
         on gs.workspace_id = s.workspace_id
        and gs.id = s.source_id
       left join lateral (
         select e.event_type, e.payload ->> 'defer_reason' as defer_reason
           from events e
          where e.workspace_id = s.workspace_id
            and e.payload ->> 'signal_id' = s.id::text
            and e.event_type in ('contact.resolved', 'contact.resolution.deferred')
          order by e.occurred_at desc
          limit 1
       ) cr on true
      where s.workspace_id = $1
        and s.status in ('matched','in_play')
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '30 days'
      order by coalesce(s.ingested_at, s.freshness_at) desc
      limit $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => ({
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
    contacts: parseContacts(row.contacts_json),
  }));
}

function parseContacts(raw: string | null): MatchedLeadRow["contacts"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => ({
      person_id: String(c.person_id ?? ""),
      full_name: String(c.full_name ?? "Unknown"),
      title: c.title ?? null,
      emails: Array.isArray(c.emails) ? c.emails.map(String) : [],
      linkedin_url: c.linkedin_url ?? null,
    }));
  } catch {
    return [];
  }
}

export default async function OutreachPage() {
  const session = await getActiveWorkspaceSessionForDashboard("outreach");
  if (!session) return <OutreachEmpty />;
  const leads = await loadMatchedLeads(session.workspace.id).catch((err) => {
    console.error("[outreach] load failed", err);
    return [] as MatchedLeadRow[];
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Outreach
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Matched leads
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-[var(--color-text-3)]">
          Signals that matched your ICP. Contacts enriched with email and
          LinkedIn. Reach out one at a time or queue a Play.
        </p>
      </header>

      {leads.length === 0 ? <OutreachEmpty /> : <LeadsTable leads={leads} />}
    </div>
  );
}

function LeadsTable({ leads }: { leads: MatchedLeadRow[] }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(150px,0.9fr)_minmax(220px,1.2fr)_80px] gap-4 border-b border-[var(--color-line-1)] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)] lg:grid">
        <span>Signal</span>
        <span>Company</span>
        <span>Contacts</span>
        <span>When</span>
      </div>
      <ul className="divide-y divide-[var(--color-line-1)]">
        {leads.map((lead) => (
          <li key={lead.signal_id}>
            <LeadRow lead={lead} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeadRow({ lead }: { lead: MatchedLeadRow }) {
  const company =
    lead.company_name ?? lead.company_domain ?? "Unknown company";
  const signalKind = lead.signal_kind.replace(/_/g, " ");
  const sourceLabel = signalSourceLabel({
    sourceName: lead.source_name,
    sourceKind: lead.source_kind,
    url: lead.signal_url,
  });
  return (
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(220px,1.5fr)_minmax(150px,0.9fr)_minmax(220px,1.2fr)_80px] lg:items-start">
      <div className="min-w-0">
        <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-[var(--color-text-1)]">
          {lead.signal_title}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-3)]">
          <span className="inline-flex items-center gap-1.5 font-medium capitalize text-[var(--color-text-2)]">
            <Icon name="sensors" size={11} /> {signalKind}
          </span>
          {lead.signal_url ? (
            <a href={lead.signal_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--color-text-1)]">
              {sourceLabel} <Icon name="arrow_forward" size={10} />
            </a>
          ) : <span>{sourceLabel}</span>}
        </div>
      </div>
      <div className="min-w-0 text-[12px] leading-5 text-[var(--color-text-3)]">
        <p className="truncate text-[13px] font-medium text-[var(--color-text-1)]">{company}</p>
        {lead.company_domain ? <p className="truncate">{lead.company_domain}</p> : null}
        <p className="mt-1">
          {companyFacts(lead).join(" · ") || "Company details pending"}
        </p>
        {lead.location ? <p className="truncate">{lead.location}</p> : null}
      </div>
      <div className="min-w-0 space-y-1.5">
        {lead.contacts.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] text-[var(--color-text-3)]">
              {resolutionLabel(lead)}
            </p>
            {lead.company_id ? (
              <form action={resolveQualifiedSignalContactsAction}>
                <input type="hidden" name="signal_id" value={lead.signal_id} />
                <input type="hidden" name="return_to" value="/dashboard/outreach" />
                <button type="submit" className="btn-quiet-sm">
                  <Icon name="person_search" size={12} /> Find contacts
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          lead.contacts.map((c) => (
            <div
              key={c.person_id}
              className="flex min-w-0 items-center gap-2 text-[13px]"
            >
              <span className="truncate font-medium text-[var(--color-text-1)]">
                {c.full_name}
              </span>
              {c.title ? (
                <span className="hidden truncate text-[var(--color-text-3)] md:inline">
                  · {c.title}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {c.emails[0] ? (
                  <a
                    href={`mailto:${c.emails[0]}`}
                    className="grid size-7 place-items-center rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)] transition-colors hover:text-[var(--color-text-1)]"
                    title={c.emails[0]}
                  >
                    <Icon name="mail" size={12} />
                  </a>
                ) : null}
                {c.linkedin_url ? (
                  <a
                    href={c.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="grid size-7 place-items-center rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)] transition-colors hover:text-[var(--color-text-1)]"
                    title="LinkedIn"
                  >
                    <Icon name="linkedin" size={12} />
                  </a>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2 lg:justify-start">
        <span className="text-[12px] tabular-nums text-[var(--color-text-3)]">
          {relativeWhen(lead.signal_at)}
        </span>
      </div>
    </div>
  );
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
  return [
    headcount,
    lead.industry,
    lead.annual_revenue != null ? formatRevenue(lead.annual_revenue) : null,
  ].filter((fact): fact is string => Boolean(fact));
}

function formatRevenue(value: number): string {
  return `${new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} revenue`;
}

function resolutionLabel(lead: MatchedLeadRow): string {
  if (lead.resolution_status === "contact.resolution.deferred") {
    return lead.defer_reason
      ? `Contact search paused: ${lead.defer_reason.replace(/_/g, " ")}.`
      : "Contact search paused. Retry when ready.";
  }
  if (!lead.company_id) return "Company match pending before contact search.";
  return "No enriched contacts yet.";
}

function OutreachEmpty() {
  return (
    <EmptyState
      title="No matched leads yet"
      hint="Signal ingestion runs every 5 minutes. Connect a channel and let the ICP filter warm up — matches will appear here."
      cta={{
        href: "/dashboard/integrations",
        label: "Connect channels",
        icon: "hub",
      }}
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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
