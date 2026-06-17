import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface ProspectRow {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  linkedin_url: string | null;
  updated_at: Date;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  conversations: string;
  last_conversation_at: Date | null;
  fresh_signals: string;
  last_signal_at: Date | null;
}

interface ProspectStats {
  people: number;
  companies: number;
  with_email: number;
  with_linkedin: number;
  reachable: number;
  fresh_signals: number;
}

async function loadProspects(workspaceId: string): Promise<ProspectRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ProspectRow>(
    `select p.id,
            p.full_name,
            p.title,
            p.emails::text[] as emails,
            p.linkedin_url,
            p.updated_at,
            co.name as company_name,
            co.domain::text as company_domain,
            co.industry as company_industry,
            (select count(*)::text
               from conversations c
              where c.workspace_id = $1
                and c.counterparty_person_id = p.id) as conversations,
            (select max(c.last_activity_at)
               from conversations c
              where c.workspace_id = $1
                and c.counterparty_person_id = p.id) as last_conversation_at,
            (select count(*)::text
               from signals s
              where s.workspace_id = $1
                and s.status in ('ingested','matched','in_play')
                and (
                  s.related_person_id = p.id
                  or (p.company_id is not null and s.related_company_id = p.company_id)
                )
                and s.ingested_at >= now() - interval '14 days') as fresh_signals,
            (select max(s.ingested_at)
               from signals s
              where s.workspace_id = $1
                and s.status in ('ingested','matched','in_play')
                and (
                  s.related_person_id = p.id
                  or (p.company_id is not null and s.related_company_id = p.company_id)
                )) as last_signal_at
       from graph_persons p
       left join graph_companies co on co.id = p.company_id
      where p.workspace_id = $1
      order by coalesce(
                 (select max(c.last_activity_at)
                    from conversations c
                   where c.workspace_id = $1
                     and c.counterparty_person_id = p.id),
                 (select max(s.ingested_at)
                    from signals s
                   where s.workspace_id = $1
                     and (
                       s.related_person_id = p.id
                       or (p.company_id is not null and s.related_company_id = p.company_id)
                     )),
                 p.updated_at
               ) desc
      limit 100`,
    [workspaceId],
  );
  return rows;
}

async function loadProspectStats(workspaceId: string): Promise<ProspectStats> {
  const pool = getPool();
  const { rows } = await pool.query<{
    people: string;
    companies: string;
    with_email: string;
    with_linkedin: string;
    reachable: string;
    fresh_signals: string;
  }>(
    `select
       (select count(*)::text
          from graph_persons p
         where p.workspace_id = $1) as people,
       (select count(*)::text
          from graph_companies co
         where co.workspace_id = $1) as companies,
       (select count(*)::text
          from graph_persons p
         where p.workspace_id = $1
           and cardinality(p.emails) > 0) as with_email,
       (select count(*)::text
          from graph_persons p
         where p.workspace_id = $1
           and p.linkedin_url is not null) as with_linkedin,
       (select count(*)::text
          from graph_persons p
         where p.workspace_id = $1
           and (cardinality(p.emails) > 0 or p.linkedin_url is not null)) as reachable,
       (select count(*)::text
          from signals s
         where s.workspace_id = $1
           and s.status in ('ingested','matched','in_play')
           and s.ingested_at >= now() - interval '14 days') as fresh_signals`,
    [workspaceId],
  );
  return {
    people: Number(rows[0]?.people ?? 0),
    companies: Number(rows[0]?.companies ?? 0),
    with_email: Number(rows[0]?.with_email ?? 0),
    with_linkedin: Number(rows[0]?.with_linkedin ?? 0),
    reachable: Number(rows[0]?.reachable ?? 0),
    fresh_signals: Number(rows[0]?.fresh_signals ?? 0),
  };
}

export default async function ProspectsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Prospects"
        title="No workspace selected."
        description="Create a workspace profile first, then Bombsell can build the people and company graph your Reps act on."
      />
    );
  }

  const [prospects, stats] = await Promise.all([
    loadProspects(workspace.id),
    loadProspectStats(workspace.id),
  ]);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Prospects"
        title={
          <>
            The people your Reps can <em>act on</em>.
          </>
        }
        description="A graph-backed view of target people, companies, channel handles, signals, and active conversations. Setup defines the ICP; this is the working market."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="People" value={stats.people} />
            <HeroStat label="Companies" value={stats.companies} />
            <HeroStat label="Fresh Signals" value={stats.fresh_signals} />
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile icon="mail" label="Email ready" value={stats.with_email} />
        <MetricTile icon="forum" label="LinkedIn ready" value={stats.with_linkedin} />
        <MetricTile icon="sensors" label="Signals 14d" value={stats.fresh_signals} />
        <MetricTile
          icon="task_alt"
          label="Coverage"
          value={coverageLabel(stats)}
        />
      </section>

      <SurfaceSection
        title="Prospect graph"
        action={
          <Link href="/dashboard/prospecting" className="btn-solid-sm">
            <Icon name="tune" size={14} />
            Tune ICP
          </Link>
        }
      >
        {prospects.length === 0 ? (
          <EmptyState
            title="No prospects in the graph yet."
            hint="Tune the company profile and signal sources so Bombsell can start collecting target people and companies."
            cta={{
              href: "/dashboard/prospecting",
              label: "Tune prospecting",
              icon: "person",
            }}
          />
        ) : (
          <div className="grid gap-2">
            {prospects.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function ProspectCard({ prospect }: { prospect: ProspectRow }) {
  const conversations = Number(prospect.conversations);
  const signals = Number(prospect.fresh_signals);
  const company = prospect.company_name ?? prospect.company_domain ?? "Unknown company";
  return (
    <article className="grid gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
            <Icon name="person" size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
              {prospect.full_name}
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {company}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-3)]">
              {prospect.title ?? "Role unknown"}
              {prospect.company_industry ? ` · ${prospect.company_industry}` : ""}
            </span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ChannelPill ready={prospect.emails.length > 0} icon="mail">
            {prospect.emails[0] ?? "No email"}
          </ChannelPill>
          <ChannelPill ready={Boolean(prospect.linkedin_url)} icon="forum">
            {prospect.linkedin_url ? "LinkedIn" : "No LinkedIn"}
          </ChannelPill>
          {signals > 0 ? (
            <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-2.5 py-1 text-xs text-[var(--color-accent)]">
              {signals} signal{signals === 1 ? "" : "s"} in 14d
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {conversations} conversation{conversations === 1 ? "" : "s"}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {activityLabel(prospect)}
        </span>
      </div>
    </article>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
        <Icon name={icon} size={16} />
      </span>
      <strong className="mt-4 block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-1 block text-xs uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {label}
      </span>
    </div>
  );
}

function ChannelPill({
  ready,
  icon,
  children,
}: {
  ready: boolean;
  icon: string;
  children: string;
}) {
  return (
    <span
      className={
        "inline-flex max-w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (ready
          ? "bg-[var(--color-ink-2)] text-[var(--color-text-2)]"
          : "bg-[var(--color-neg-bg)] text-[var(--color-neg)]")
      }
    >
      <Icon name={icon} size={13} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function coverageLabel(stats: ProspectStats): string {
  if (stats.people === 0) return "0%";
  return `${Math.round((stats.reachable / stats.people) * 100)}%`;
}

function activityLabel(prospect: ProspectRow): string {
  const value =
    prospect.last_conversation_at ?? prospect.last_signal_at ?? prospect.updated_at;
  return `Updated ${freshWhen(value)}`;
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
