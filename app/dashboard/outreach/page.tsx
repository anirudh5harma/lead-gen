import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Outreach | Bombsell" };
export const dynamic = "force-dynamic";

interface MatchedLeadRow {
  signal_id: string;
  signal_title: string;
  signal_kind: string;
  signal_at: Date;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_size: string | null;
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
    company_id: string | null;
    company_name: string | null;
    company_domain: string | null;
    company_size: string | null;
    contacts_json: string | null;
  }>(
    `select
        s.id                                                  as signal_id,
        s.title                                               as signal_title,
        coalesce(s.kind::text, 'other')                       as signal_kind,
        coalesce(s.ingested_at, s.freshness_at)               as signal_at,
        co.id                                                 as company_id,
        co.name                                               as company_name,
        co.domain::text                                       as company_domain,
        co.size_bucket                                        as company_size,
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
       left join graph_companies co on co.id = s.related_company_id
      where s.workspace_id = $1
        and s.status in ('matched','in_play')
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '30 days'
      order by coalesce(s.ingested_at, s.freshness_at) desc
      limit $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => ({
    signal_id: row.signal_id,
    signal_title: row.signal_title,
    signal_kind: row.signal_kind,
    signal_at: row.signal_at,
    company_id: row.company_id,
    company_name: row.company_name,
    company_domain: row.company_domain,
    company_size: row.company_size,
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
    <div className="overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_100px_120px] gap-4 border-b border-[var(--color-line-1)] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)] md:grid">
        <span>Lead</span>
        <span>Contacts</span>
        <span>Headcount</span>
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
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_100px_120px] md:items-start md:gap-4">
      <div className="min-w-0">
        <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-[var(--color-text-1)]">
          {lead.signal_title}
        </p>
        <p className="mt-1 truncate text-[13px] text-[var(--color-text-3)]">
          {company}
          {lead.company_domain ? (
            <span className="text-[var(--color-text-4)]">
              {" · "}
              {lead.company_domain}
            </span>
          ) : null}
        </p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)]">
          <Icon name="sensors" size={11} />
          {signalKind}
        </span>
      </div>
      <div className="min-w-0 space-y-1.5">
        {lead.contacts.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-3)]">
            No enriched contacts yet.
          </p>
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
      <div className="text-[13px] tabular-nums text-[var(--color-text-2)]">
        {lead.company_size ?? "—"}
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-start">
        <span className="text-[12px] tabular-nums text-[var(--color-text-3)]">
          {relativeWhen(lead.signal_at)}
        </span>
        <Link
          href={`/dashboard/agent/signals/${lead.signal_id}`}
          className="btn-quiet-sm shrink-0"
        >
          <Icon name="arrow_forward" size={12} />
          Open
        </Link>
      </div>
    </div>
  );
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
