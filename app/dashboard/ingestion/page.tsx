import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import type { ReactNode } from "react";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import {
  configureIcpAction,
  configureSourceAction,
  runSignalAggregatorAction,
  trackCompanyAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface IngestionCounts {
  candidates_24h: number;
  signals_ingested_24h: number;
  matched_24h: number;
}

interface IcpRow {
  id: string;
  name: string;
  enabled: boolean;
  match_threshold: string;
  description: string;
}

interface WorkspaceSourceRow {
  source_id: string;
  source_kind: string;
  source_name: string;
  enabled: boolean;
  last_polled_at: Date | null;
  last_error: { message?: string } | null;
}

interface PlatformPollRow {
  adapter: string;
  source_name: string;
  company_id: string | null;
  company_name: string | null;
  last_polled_at: Date | null;
  last_error: { message?: string } | null;
}

interface RecentSignalRow {
  id: string;
  kind: string | null;
  title: string;
  status: string;
  match_score: string | null;
  freshness_at: Date;
  ingested_at: Date;
}

interface PlayRunRow {
  id: string;
  play_name: string;
  rep_name: string | null;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  outcome_count: string;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

async function loadCounts(workspaceId: string): Promise<IngestionCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    candidates_24h: string;
    signals_ingested_24h: string;
    matched_24h: string;
  }>(
    `select
       (select count(*)::text from signal_candidates sc
          join signal_candidate_fanouts f on f.candidate_id = sc.id
         where f.workspace_id = $1 and sc.ingested_at >= now() - interval '24 hours') as candidates_24h,
       (select count(*)::text from signals where workspace_id = $1 and ingested_at >= now() - interval '24 hours') as signals_ingested_24h,
       (select count(*)::text from signals where workspace_id = $1 and status = 'matched' and ingested_at >= now() - interval '24 hours') as matched_24h`,
    [workspaceId],
  );
  return {
    candidates_24h: Number(rows[0].candidates_24h),
    signals_ingested_24h: Number(rows[0].signals_ingested_24h),
    matched_24h: Number(rows[0].matched_24h),
  };
}

async function loadIcps(workspaceId: string): Promise<IcpRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<IcpRow>(
    `select id, name, enabled, match_threshold::text as match_threshold, description
       from workspace_icps
      where workspace_id = $1
      order by enabled desc, name
      limit 6`,
    [workspaceId],
  );
  return rows;
}

async function loadWorkspaceSources(workspaceId: string): Promise<WorkspaceSourceRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<WorkspaceSourceRow>(
    `select gs.id as source_id,
            gs.kind::text as source_kind,
            gs.name as source_name,
            coalesce(wsc.enabled, gs.enabled) as enabled,
            wsc.last_polled_at,
            wsc.last_error
       from graph_sources gs
       left join workspace_source_configs wsc
              on wsc.workspace_id = gs.workspace_id and wsc.source_id = gs.id
      where gs.workspace_id = $1
      order by wsc.last_polled_at desc nulls last, gs.name
      limit 8`,
    [workspaceId],
  );
  return rows;
}

async function loadCatalogPolls(workspaceId: string): Promise<PlatformPollRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PlatformPollRow>(
    `select pss.adapter,
            pss.name as source_name,
            tc.id as company_id,
            tc.name as company_name,
            cpc.last_polled_at,
            cpc.last_error
       from workspace_tracked_companies wtc
       join tracked_companies tc on tc.id = wtc.company_id
       cross join platform_signal_sources pss
       left join catalog_poll_cursors cpc
              on cpc.source_id = pss.id and cpc.company_id = tc.id
      where wtc.workspace_id = $1
        and pss.enabled
      order by cpc.last_polled_at desc nulls last, tc.name, pss.adapter
      limit 12`,
    [workspaceId],
  );
  return rows;
}

async function loadRecentSignals(workspaceId: string): Promise<RecentSignalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RecentSignalRow>(
    `select id,
            kind::text as kind,
            title,
            status::text as status,
            match_score::text as match_score,
            freshness_at,
            ingested_at
       from signals
      where workspace_id = $1
      order by ingested_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

async function loadPlayRuns(workspaceId: string): Promise<PlayRunRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PlayRunRow>(
    `select pr.id,
            p.name as play_name,
            coalesce(run_rep.name, default_rep.name) as rep_name,
            pr.status::text as status,
            pr.input,
            pr.output,
            count(o.id)::text as outcome_count,
            pr.started_at,
            pr.ended_at,
            pr.created_at
       from play_runs pr
       join plays p on p.id = pr.play_id
       left join reps run_rep on run_rep.id = pr.rep_id
       left join reps default_rep on default_rep.id = p.default_rep_id
       left join outcomes o on o.attributed_play_run_id = pr.id
      where pr.workspace_id = $1
      group by pr.id, p.name, run_rep.name, default_rep.name
      order by pr.created_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function IngestionPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">Prayog · Campaigns</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace yet.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-2)]">
          Create a profile, then Prayog will test what scales.
        </p>
      </section>
    );
  }

  const [counts, icps, sources, companies, recent, playRuns] = await Promise.all([
    loadCounts(workspace.id),
    loadIcps(workspace.id),
    loadWorkspaceSources(workspace.id),
    loadCatalogPolls(workspace.id),
    loadRecentSignals(workspace.id),
    loadPlayRuns(workspace.id),
  ]);

  return (
    <>
      <section className="section-canvas overflow-hidden">
        <div className="section-thread section-thread-a" />
        <div className="grid lg:grid-cols-[1fr_320px]">
          <div className="p-5 sm:p-8">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="brief-kicker">Prayog · Campaigns</p>
                <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
                  Prayog is testing what scales.
                </h1>
                <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
                  Small experiments, clear review gates, only the ones with lift expand. The plumbing stays underneath.
                </p>
              </div>
              <form action={runSignalAggregatorAction}>
                <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
                  <Icon name="sync" size={16} />
                  Refresh
                </button>
              </form>
            </div>

            <div className="relative min-h-[420px]">
              <div className="graph-link left-[14%] top-[35%] w-[34%] rotate-[8deg]" />
              <div className="graph-link left-[46%] top-[50%] w-[30%] -rotate-[12deg]" />
              <SourceCard
                className="left-[6%] top-[8%]"
                title="Profile"
                value={icps[0]?.name ?? "Add profile"}
                detail={icps[0]?.description ?? "What good looks like"}
              />
              <SourceCard
                className="right-[6%] top-[18%]"
                title="Source"
                value={sources[0]?.source_name ?? "Add source"}
                detail={sources[0]?.source_kind ?? "Where to watch"}
              />
              <div className="brief-node section-note left-1/2 top-1/2 w-[min(62vw,280px)] -translate-x-1/2 -translate-y-1/2">
                <p className="text-sm text-[var(--color-text-3)]">Signals</p>
                <h3 className="mt-2 text-3xl font-semibold text-[var(--color-text-1)]">
                  {counts.signals_ingested_24h === 0 ? "Quiet" : counts.signals_ingested_24h}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
                  {counts.matched_24h} ready from {counts.candidates_24h} found today.
                </p>
              </div>
              <SourceCard
                className="bottom-[10%] left-[10%]"
                title="Company"
                value={companies[0]?.company_name ?? "Track company"}
                detail={companies[0]?.adapter ?? "Hiring, funding, mentions"}
              />
              <SourceCard
                className="bottom-[15%] right-[8%]"
                title="Ready"
                value={`${counts.matched_24h} good fit`}
                detail="Only useful work moves forward"
              />
            </div>
          </div>

          <aside className="border-t border-[var(--color-line-1)] bg-[rgba(255,255,255,0.42)] p-5 lg:border-l lg:border-t-0">
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-[var(--color-text-1)]">
                <span>Tuning</span>
                <Icon name="tune" size={16} />
              </summary>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
                Profile, companies, and sources Prayog draws from. Edit only when something stops fitting.
              </p>
            <div className="mt-4 grid gap-4">
              <MiniForm title="Profile">
                <form action={configureIcpAction} className="grid gap-3">
                  <Field name="icp_name" label="Name" defaultValue="Hiring lead profile" />
                  <TextArea
                    name="icp_description"
                    label="Good lead"
                    defaultValue="Companies showing fresh hiring intent around GTM, operations, or revenue roles."
                  />
                  <input type="hidden" name="signal_kind" value="hiring" />
                  <input type="hidden" name="match_threshold" value="0.60" />
                  <ActionButton icon="rule" label="Save" />
                </form>
              </MiniForm>
              <MiniForm title="Company">
                <form action={trackCompanyAction} className="grid gap-3">
                  <Field name="company_name" label="Company" defaultValue="Acme Payroll" />
                  <Field name="company_domain" label="Domain" defaultValue="acmepayroll.example" />
                  <input type="hidden" name="company_industry" value="B2B SaaS" />
                  <input type="hidden" name="greenhouse_id" value="" />
                  <input type="hidden" name="lever_id" value="" />
                  <ActionButton icon="add_business" label="Track" />
                </form>
              </MiniForm>
              <MiniForm title="Source">
                <form action={configureSourceAction} className="grid gap-3">
                  <Field name="source_name" label="Source" defaultValue="Hiring signal search" />
                  <Field name="source_query" label="Search" defaultValue="B2B SaaS hiring funding launch" />
                  <input type="hidden" name="source_adapter" value="google_news" />
                  <input type="hidden" name="source_provider" value="" />
                  <input type="hidden" name="source_url" value="" />
                  <input type="hidden" name="subreddit" value="SaaS" />
                  <input type="hidden" name="signal_kind" value="hiring" />
                  <input type="hidden" name="poll_interval_minutes" value="60" />
                  <ActionButton icon="rss_feed" label="Save" />
                </form>
              </MiniForm>
            </div>
            </details>
          </aside>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="science" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Recent experiments</h2>
        </div>
        {playRuns.length === 0 ? (
          <EmptyState
            title="No experiments yet"
            hint="Prayog will show campaign runs here once a Play fires."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {playRuns.map((run) => (
              <PlayRunNote key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Recent leads">
          {recent.length === 0 ? (
            <EmptyState
              title="No leads yet"
              hint="Refresh sources to fill this page."
              cta={{ href: "/dashboard/setup", label: "Add source", icon: "rss_feed" }}
            />
          ) : (
            <div className="grid gap-2">
              {recent.map((signal) => (
                <LeadRow key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Watched sources">
          {sources.length === 0 ? (
            <EmptyState
              title="No sources yet"
              hint="Add a source to start watching."
              cta={{ href: "/dashboard/setup", label: "Add source", icon: "rss_feed" }}
            />
          ) : (
            <div className="grid gap-2">
              {sources.map((source) => (
                <NoteRow
                  key={source.source_id}
                  title={source.source_name}
                  label={source.source_kind}
                  meta={source.enabled ? `updated ${timeAgo(source.last_polled_at)}` : "disabled"}
                />
              ))}
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}

function PlayRunNote({ run }: { run: PlayRunRow }) {
  const decision = stringOutput(run.output, "decision") ?? stringOutput(run.output, "status");
  const lift = stringOutput(run.output, "lift") ?? stringOutput(run.output, "outcome_kind");
  const arms = armsText(run.input) ?? armsText(run.output);
  const ended = run.ended_at ? `ended ${timeAgo(run.ended_at)}` : `started ${timeAgo(run.started_at ?? run.created_at)}`;
  return (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">
          {run.rep_name ?? "Rep"}
        </span>
        <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
          {run.status.replace(/_/g, " ")}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">{ended}</span>
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-5 text-[var(--color-text-1)]">
        {run.play_name}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
        {Number(run.outcome_count)} outcomes
        {arms ? `. ${arms}` : ""}
        {decision ? `. Decision ${decision}` : ""}
        {lift ? `. Lift ${lift}` : ""}
      </p>
    </article>
  );
}

function armsText(record: Record<string, unknown> | null): string | null {
  const arms = record?.arms ?? record?.variants ?? record?.experiments;
  if (Array.isArray(arms) && arms.length > 0) {
    return `${arms.length} ${arms.length === 1 ? "arm" : "arms"}`;
  }
  if (typeof arms === "number" && Number.isFinite(arms) && arms > 0) {
    return `${arms} ${arms === 1 ? "arm" : "arms"}`;
  }
  return null;
}

function stringOutput(output: Record<string, unknown> | null, key: string): string | null {
  const value = output?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function SourceCard({
  className,
  title,
  value,
  detail,
}: {
  className: string;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`brief-node section-note ${className} w-[min(56vw,248px)]`}>
      <p className="text-xs text-[var(--color-text-3)]">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">{detail}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section-canvas p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-1)]">{title}</h2>
      {children}
    </section>
  );
}

function MiniForm({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] p-3">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-1)]">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <textarea
        name={name}
        rows={3}
        defaultValue={defaultValue}
        className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
      />
    </label>
  );
}

function ActionButton({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="inline-flex min-h-9 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-3 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

function NoteRow({ title, label, meta }: { title: string; label: string; meta: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-3">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--color-text-3)]">
        {label}. {meta}
      </p>
    </div>
  );
}

function LeadRow({ signal }: { signal: RecentSignalRow }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">
          {signal.kind ?? "signal"}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {timeAgo(signal.ingested_at)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-text-1)]">
        {signal.title}
      </p>
      {signal.match_score ? (
        <p className="mt-2 text-xs text-[var(--color-text-3)]">
          Fit {Number(signal.match_score).toFixed(2)}
        </p>
      ) : null}
    </div>
  );
}
