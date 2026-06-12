import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { runSignalAggregatorAction } from "../actions";

export const dynamic = "force-dynamic";

interface SignalCounts {
  ingested: number;
  matched: number;
  in_play: number;
  spent: number;
}

interface SignalRow {
  id: string;
  kind: string;
  status: string;
  title: string;
  url: string | null;
  match_score: string | null;
  match_reason: string | null;
  company_name: string | null;
  freshness_at: Date;
  ingested_at: Date;
}

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  poll_cadence_sec: number;
  last_polled_at: Date | null;
  last_error: Record<string, unknown> | null;
}

async function loadSignalCounts(workspaceId: string): Promise<SignalCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{ status: string; count: string }>(
    `select status::text, count(*)::text
       from signals
      where workspace_id = $1
      group by status`,
    [workspaceId],
  );
  const counts: SignalCounts = { ingested: 0, matched: 0, in_play: 0, spent: 0 };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as keyof SignalCounts] = Number(row.count);
    }
  }
  return counts;
}

async function loadRecentSignals(workspaceId: string): Promise<SignalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<SignalRow>(
    `select s.id,
            s.kind::text as kind,
            s.status::text as status,
            s.title,
            s.url,
            s.match_score::text as match_score,
            s.match_reason,
            c.name as company_name,
            s.freshness_at,
            s.ingested_at
       from signals s
       left join graph_companies c on c.id = s.related_company_id
      where s.workspace_id = $1
      order by s.freshness_at desc nulls last, s.ingested_at desc
      limit 24`,
    [workspaceId],
  );
  return rows;
}

async function loadSources(workspaceId: string): Promise<SourceRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<SourceRow>(
    `select gs.id,
            gs.name,
            gs.kind::text as kind,
            coalesce(wsc.enabled, gs.enabled) as enabled,
            coalesce(wsc.poll_cadence_sec, 900) as poll_cadence_sec,
            coalesce(wsc.last_polled_at, gs.last_polled_at) as last_polled_at,
            wsc.last_error
       from graph_sources gs
       left join workspace_source_configs wsc
         on wsc.workspace_id = gs.workspace_id
        and wsc.source_id = gs.id
      where gs.workspace_id = $1
      order by coalesce(wsc.enabled, gs.enabled) desc,
               coalesce(wsc.last_polled_at, gs.last_polled_at) desc nulls last,
               gs.name asc
      limit 12`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function SignalsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Signals"
        title="No workspace selected."
        description="Create a prospecting profile first, then signal ingestion will start filling this queue."
      />
    );
  }

  const [counts, signals, sources] = await Promise.all([
    loadSignalCounts(workspace.id),
    loadRecentSignals(workspace.id),
    loadSources(workspace.id),
  ]);
  const actionable = counts.matched + counts.in_play;

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Signals"
        title={<>Find timing before <em>everyone else</em>.</>}
        description="Funding, hiring, launches, leadership moves, and open-web intent become Signals. Qualified Signals feed email, LinkedIn, and campaign Plays."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <HeroStat label="Matched" value={counts.matched} />
            <HeroStat label="In play" value={counts.in_play} />
            <HeroStat label="Raw" value={counts.ingested} />
            <form action={runSignalAggregatorAction}>
              <input type="hidden" name="return_to" value="/dashboard/ingestion" />
              <input type="hidden" name="limit" value="12" />
              <PendingSubmitButton
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)] active:translate-y-px"
                icon="refresh"
                pendingLabel="Refreshing"
              >
                Refresh signals
              </PendingSubmitButton>
            </form>
          </div>
        }
      />

      <SurfaceSection title="Signal sources">
        {sources.length === 0 ? (
          <EmptyState
            title="No sources configured yet"
            hint="The prospecting profile seeds the first source set. Signals stay quiet until a source is enabled."
            cta={{ href: "/dashboard/setup", label: "Tune prospecting", icon: "tune" }}
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <SurfaceSection
        title="Recent signals"
        action={
          <Link
            href="/dashboard/campaigns"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.58)] px-3 text-xs font-semibold text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)]"
          >
            <Icon name="campaign" size={14} />
            {actionable} actionable
          </Link>
        }
      >
        {signals.length === 0 ? (
          <EmptyState
            title="No signals yet"
            hint="Run ingestion after the profile is tuned. Matched signals will trigger email, LinkedIn, and campaign Plays."
            cta={{ href: "/dashboard/setup", label: "Tune prospecting", icon: "person" }}
          />
        ) : (
          <div className="grid gap-2">
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function SourceCard({ source }: { source: SourceRow }) {
  const errored = Boolean(source.last_error);
  return (
    <article className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={sourceIcon(source.kind)} size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {source.name}
          </h3>
          <p className="text-xs text-[var(--color-text-3)]">
            {source.kind.replace(/_/g, " ")}
          </p>
        </div>
        <span
          className={
            "ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-medium " +
            (source.enabled
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          {source.enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
        Last polled {timeAgo(source.last_polled_at)}. Cadence {Math.round(source.poll_cadence_sec / 60)}m.
      </p>
      {errored ? (
        <p className="mt-2 text-xs leading-5 text-[var(--color-neg)]">
          Last run had an error. The workflow will retry through the event bus.
        </p>
      ) : null}
    </article>
  );
}

function SignalCard({ signal }: { signal: SignalRow }) {
  const score = signal.match_score ? Math.round(Number(signal.match_score) * 100) : null;
  const status = signal.status.replace(/_/g, " ");
  const content = (
    <article className="grid gap-3 rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4 transition-colors hover:bg-[var(--color-ink-2)]/40 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
            {signal.kind.replace(/_/g, " ")}
          </span>
          <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)]">
            {status}
          </span>
          {score ? (
            <span className="rounded-full bg-[rgba(255,255,255,0.62)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)]">
              {score}% fit
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 text-sm font-semibold leading-5 text-[var(--color-text-1)]">
          {signal.title}
        </h3>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
          {signal.company_name ? `${signal.company_name} · ` : ""}
          Fresh {timeAgo(signal.freshness_at)} · ingested {timeAgo(signal.ingested_at)}
          {signal.match_reason ? ` · ${signal.match_reason}` : ""}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-2)]">
        <Icon name="arrow_forward" size={14} />
        Campaign-ready
      </span>
    </article>
  );
  if (signal.url) {
    return (
      <a href={signal.url} target="_blank" rel="noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

function sourceIcon(kind: string): string {
  if (kind === "job_board") return "badge";
  if (kind === "product_hunt") return "rocket_launch";
  if (kind === "rss" || kind === "newsletter") return "article";
  if (kind === "podcast") return "forum";
  if (kind === "web_monitor") return "travel_explore";
  return "sensors";
}
