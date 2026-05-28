import {
  EmptyState,
  MetricCard,
  SectionHeader,
} from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface IngestionCounts {
  candidates_24h: number;
  signals_ingested_24h: number;
  matched_24h: number;
  dismissed_24h: number;
  expired_24h: number;
}

interface BudgetRow {
  daily_candidate_cap: number;
  daily_classify_cap: number;
  daily_candidates_used: number;
  daily_classify_used: number;
  window_start: Date;
}

interface IcpRow {
  id: string;
  name: string;
  enabled: boolean;
  match_threshold: string;
  must_haves_count: number;
  nice_to_haves_count: number;
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

interface OverflowRow {
  reason: string;
  count: string;
  most_recent: Date;
}

async function loadCounts(workspaceId: string): Promise<IngestionCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    candidates_24h: string;
    signals_ingested_24h: string;
    matched_24h: string;
    dismissed_24h: string;
    expired_24h: string;
  }>(
    `select
       (select count(*)::text from signal_candidates sc
          join signal_candidate_fanouts f on f.candidate_id = sc.id
         where f.workspace_id = $1 and sc.ingested_at >= now() - interval '24 hours') as candidates_24h,
       (select count(*)::text from signals where workspace_id = $1 and ingested_at >= now() - interval '24 hours') as signals_ingested_24h,
       (select count(*)::text from signals where workspace_id = $1 and status = 'matched' and ingested_at >= now() - interval '24 hours') as matched_24h,
       (select count(*)::text from signals where workspace_id = $1 and status = 'dismissed' and ingested_at >= now() - interval '24 hours') as dismissed_24h,
       (select count(*)::text from signals where workspace_id = $1 and status = 'spent' and ingested_at >= now() - interval '24 hours') as expired_24h`,
    [workspaceId],
  );
  return {
    candidates_24h: Number(rows[0].candidates_24h),
    signals_ingested_24h: Number(rows[0].signals_ingested_24h),
    matched_24h: Number(rows[0].matched_24h),
    dismissed_24h: Number(rows[0].dismissed_24h),
    expired_24h: Number(rows[0].expired_24h),
  };
}

async function loadBudget(workspaceId: string): Promise<BudgetRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<BudgetRow>(
    `select daily_candidate_cap, daily_classify_cap,
            daily_candidates_used, daily_classify_used, window_start
       from workspace_ingestion_budgets where workspace_id = $1`,
    [workspaceId],
  );
  return rows[0] ?? null;
}

async function loadIcps(workspaceId: string): Promise<IcpRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<IcpRow>(
    `select id, name, enabled, match_threshold::text as match_threshold,
            jsonb_array_length(must_haves) as must_haves_count,
            jsonb_array_length(nice_to_haves) as nice_to_haves_count,
            description
       from workspace_icps
      where workspace_id = $1
      order by enabled desc, name`,
    [workspaceId],
  );
  return rows;
}

async function loadWorkspaceSources(
  workspaceId: string,
): Promise<WorkspaceSourceRow[]> {
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
      order by wsc.last_polled_at desc nulls last, gs.name`,
    [workspaceId],
  );
  return rows;
}

async function loadCatalogPolls(
  workspaceId: string,
): Promise<PlatformPollRow[]> {
  const pool = getPool();
  // For each tracked company in this workspace, show the most recent
  // poll cursor across all platform sources that watch it. This is the
  // workspace's view of catalog-poll activity even though the actual
  // polls run platform-wide.
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
      limit 50`,
    [workspaceId],
  );
  return rows;
}

async function loadRecentSignals(
  workspaceId: string,
): Promise<RecentSignalRow[]> {
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
      limit 20`,
    [workspaceId],
  );
  return rows;
}

async function loadOverflow(workspaceId: string): Promise<OverflowRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<OverflowRow>(
    `select reason, count(*)::text as count, max(occurred_at) as most_recent
       from signal_overflow
      where workspace_id = $1
        and occurred_at >= now() - interval '24 hours'
      group by reason
      order by max(occurred_at) desc`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusCls(status: string): string {
  switch (status) {
    case "matched":
      return "bg-[var(--color-accent-bg)] text-[var(--color-accent)]";
    case "dismissed":
      return "bg-[var(--color-ink-3)] text-[var(--color-text-3)]";
    case "spent":
      return "bg-[var(--color-ink-3)] text-[var(--color-text-3)]";
    default:
      return "bg-[var(--color-ink-3)] text-[var(--color-text-2)]";
  }
}

function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

export default async function IngestionPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader
          eyebrow="ingestion"
          title="No workspace yet"
          subtitle="Create a workspace and configure ICPs before ingestion can run."
        />
        <EmptyState
          title="No workspace found"
          hint="Seed a workspace, then refresh."
        />
      </>
    );
  }

  const [counts, budget, icps, wsSources, catalogPolls, recent, overflow] =
    await Promise.all([
      loadCounts(workspace.id),
      loadBudget(workspace.id),
      loadIcps(workspace.id),
      loadWorkspaceSources(workspace.id),
      loadCatalogPolls(workspace.id),
      loadRecentSignals(workspace.id),
      loadOverflow(workspace.id),
    ]);

  return (
    <>
      <SectionHeader
        eyebrow="ingestion"
        title="Signal ingestion"
        subtitle="What's flowing in, what's matching, what's running into a cap."
      />

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
        <MetricCard
          label="Candidates"
          value={counts.candidates_24h}
          hint="last 24h · shared pool"
        />
        <MetricCard
          label="Ingested"
          value={counts.signals_ingested_24h}
          hint="workspace signals"
        />
        <MetricCard
          label="Matched"
          value={counts.matched_24h}
          hint="passed ICP threshold"
        />
        <MetricCard
          label="Dismissed"
          value={counts.dismissed_24h}
          hint="classifier rejected"
        />
        <MetricCard
          label="Expired"
          value={counts.expired_24h}
          hint="TTL or upstream"
        />
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Daily budget
        </h2>
        {budget ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BudgetBar
              label="Candidates"
              used={budget.daily_candidates_used}
              cap={budget.daily_candidate_cap}
              windowStart={budget.window_start}
            />
            <BudgetBar
              label="Classify (LLM)"
              used={budget.daily_classify_used}
              cap={budget.daily_classify_cap}
              windowStart={budget.window_start}
            />
          </div>
        ) : (
          <EmptyState
            title="No budget row yet"
            hint="Pollers create the budget row on first run; nothing has run for this workspace."
          />
        )}
        {overflow.length > 0 ? (
          <div className="mt-4 border border-[var(--color-line-1)] rounded-lg px-4 py-3 bg-[var(--color-ink-0)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] mb-2">
              Overflow · last 24h
            </p>
            <ul className="space-y-1">
              {overflow.map((o) => (
                <li key={o.reason} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-[var(--color-text-3)] w-44">
                    {o.reason}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-1)] tabular-nums">
                    {o.count} dropped
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] ml-auto">
                    last {timeAgo(o.most_recent)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          ICP segments
        </h2>
        {icps.length === 0 ? (
          <EmptyState
            title="No ICPs configured"
            hint="Stage 2 dismisses every signal until at least one ICP segment is defined."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {icps.map((i) => (
              <li key={i.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                      (i.enabled
                        ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                        : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]")
                    }
                  >
                    {i.enabled ? "enabled" : "disabled"}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {i.name}
                  </p>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums">
                    threshold {Number(i.match_threshold).toFixed(2)}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-24 text-right">
                    {i.must_haves_count} must · {i.nice_to_haves_count} nice
                  </span>
                </div>
                {i.description ? (
                  <p className="font-serif text-[var(--color-text-2)] text-sm mt-1 italic truncate">
                    {i.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Workspace sources
        </h2>
        {wsSources.length === 0 ? (
          <EmptyState
            title="No workspace sources"
            hint="Per-workspace adapters (custom RSS, Reddit subs, Google News keywords, HN front, ProductHunt) live here once configured."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {wsSources.map((s) => (
              <li key={s.source_id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-28">
                    {s.source_kind}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {s.source_name}
                  </p>
                  {s.enabled ? null : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded bg-[var(--color-ink-3)] text-[var(--color-text-3)]">
                      disabled
                    </span>
                  )}
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-24 text-right">
                    {timeAgo(s.last_polled_at)}
                  </span>
                </div>
                {s.last_error?.message ? (
                  <p className="font-mono text-xs text-[var(--color-accent)] mt-1 truncate">
                    error: {s.last_error.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Catalog polls
        </h2>
        {catalogPolls.length === 0 ? (
          <EmptyState
            title="No catalog companies tracked"
            hint="Add companies via workspace_tracked_companies to fan platform-wide polls (Greenhouse / Lever / Ashby / Workable / SEC EDGAR) out to this workspace."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {catalogPolls.map((p, idx) => (
              <li key={`${p.company_id}-${p.adapter}-${idx}`} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-24">
                    {p.adapter}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {p.company_name ?? "(unknown)"}
                  </p>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-24 text-right">
                    {timeAgo(p.last_polled_at)}
                  </span>
                </div>
                {p.last_error?.message ? (
                  <p className="font-mono text-xs text-[var(--color-accent)] mt-1 truncate">
                    error: {p.last_error.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Recent signals
        </h2>
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing ingested yet"
            hint="When pollers run, the last 20 signals will show here with their classification status."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {recent.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-24">
                    {s.kind ?? "—"}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {s.title}
                  </p>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                      statusCls(s.status)
                    }
                  >
                    {s.status}
                  </span>
                  {s.match_score ? (
                    <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums">
                      match {Number(s.match_score).toFixed(2)}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {timeAgo(s.ingested_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BudgetBar({
  label,
  used,
  cap,
  windowStart,
}: {
  label: string;
  used: number;
  cap: number;
  windowStart: Date;
}) {
  const percent = pct(used, cap);
  // Saturate the bar color once usage crosses 80 %.
  const color =
    percent >= 100
      ? "bg-[var(--color-accent)]"
      : percent >= 80
        ? "bg-[var(--color-accent)] opacity-80"
        : "bg-[var(--color-text-2)]";
  return (
    <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
          {label}
        </p>
        <p className="font-mono text-xs text-[var(--color-text-3)] tabular-nums">
          {used} / {cap}
        </p>
      </div>
      <div className="h-2 mt-3 rounded bg-[var(--color-ink-3)] overflow-hidden">
        <div
          className={"h-full " + color}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="font-mono text-[10px] text-[var(--color-text-4)] mt-2">
        window started {timeAgo(windowStart)}
      </p>
    </div>
  );
}
