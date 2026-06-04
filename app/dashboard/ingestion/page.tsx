import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

interface CampaignCounts {
  qualified_today: number;
  ideas_week: number;
  outcomes_week: number;
}

interface QualifiedSignalRow {
  id: string;
  title: string;
  match_score: string | null;
  freshness_at: Date;
  ingested_at: Date;
}

interface CampaignIdeaRow {
  id: string;
  play_name: string;
  rep_name: string | null;
  status: string;
  output: Record<string, unknown> | null;
  outcome_count: string;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

async function loadCounts(workspaceId: string): Promise<CampaignCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    qualified_today: string;
    ideas_week: string;
    outcomes_week: string;
  }>(
    `select
       (select count(*)::text
          from signals
         where workspace_id = $1
           and status = 'matched'
           and ingested_at >= now() - interval '24 hours') as qualified_today,
       (select count(*)::text
          from play_runs
         where workspace_id = $1
           and created_at >= now() - interval '7 days') as ideas_week,
       (select count(*)::text
          from outcomes
         where workspace_id = $1
           and occurred_at >= now() - interval '7 days') as outcomes_week`,
    [workspaceId],
  );
  return {
    qualified_today: Number(rows[0]?.qualified_today ?? 0),
    ideas_week: Number(rows[0]?.ideas_week ?? 0),
    outcomes_week: Number(rows[0]?.outcomes_week ?? 0),
  };
}

async function loadQualifiedSignals(workspaceId: string): Promise<QualifiedSignalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<QualifiedSignalRow>(
    `select id,
            title,
            match_score::text as match_score,
            freshness_at,
            ingested_at
       from signals
      where workspace_id = $1
        and status = 'matched'
      order by freshness_at desc nulls last, ingested_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

async function loadCampaignIdeas(workspaceId: string): Promise<CampaignIdeaRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<CampaignIdeaRow>(
    `select pr.id,
            p.name as play_name,
            coalesce(run_rep.name, default_rep.name) as rep_name,
            pr.status::text as status,
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
  if (!d) return "recently";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
          Create a profile, then Prayog will turn good signals into campaign ideas.
        </p>
      </section>
    );
  }

  const [counts, signals, ideas] = await Promise.all([
    loadCounts(workspace.id),
    loadQualifiedSignals(workspace.id),
    loadCampaignIdeas(workspace.id),
  ]);

  return (
    <>
      <section className="section-canvas overflow-hidden">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[1fr_360px]">
          <div>
            <p className="brief-kicker">Prayog · Campaigns</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Prayog is finding campaigns worth trying.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Qualified signals become campaign ideas, then the winners earn more room.
            </p>

            <div className="relative mt-10 min-h-[340px]">
              <div className="graph-link left-[16%] top-[32%] w-[34%] rotate-[7deg]" />
              <div className="graph-link left-[48%] top-[50%] w-[30%] -rotate-[10deg]" />
              <CanvasNote
                className="left-[4%] top-[8%]"
                title="Today"
                value={`${counts.qualified_today} qualified`}
                detail="Fresh opportunities that fit the profile"
              />
              <CanvasNote
                className="right-[6%] top-[16%]"
                title="Next"
                value={`${counts.ideas_week} ideas`}
                detail="Small campaigns shaped this week"
              />
              <div className="brief-node section-note left-1/2 top-1/2 w-[min(64vw,300px)] -translate-x-1/2 -translate-y-1/2">
                <p className="text-sm text-[var(--color-text-3)]">Prayog</p>
                <h3 className="mt-2 text-3xl font-semibold text-[var(--color-text-1)]">
                  {signals[0]?.title ?? "Waiting for the next strong signal"}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
                  The page stays quiet until there is something worth acting on.
                </p>
              </div>
              <CanvasNote
                className="bottom-[10%] left-[10%]"
                title="Learning"
                value={`${counts.outcomes_week} outcomes`}
                detail="Replies, conversions, and useful movement"
              />
              <CanvasNote
                className="bottom-[15%] right-[8%]"
                title="Guardrail"
                value="Review first"
                detail="Nothing expands without useful evidence"
              />
            </div>
          </div>

          <aside className="section-note h-fit">
            <div className="flex items-center gap-3">
              <span className="brief-note-icon">
                <Icon name="target" size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-1)]">
                  Campaign rhythm
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
                  Prayog keeps the work small until a real response proves it deserves more.
                </p>
              </div>
            </div>
            <dl className="mt-6 grid gap-3">
              <Metric label="Qualified today" value={counts.qualified_today} />
              <Metric label="Ideas this week" value={counts.ideas_week} />
              <Metric label="Outcomes this week" value={counts.outcomes_week} />
            </dl>
          </aside>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Qualified signals">
          {signals.length === 0 ? (
            <EmptyState
              title="No qualified signals yet"
              hint="Tune the profile once, then good-fit opportunities will appear here."
              cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
            />
          ) : (
            <div className="grid gap-2">
              {signals.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Campaign ideas">
          {ideas.length === 0 ? (
            <EmptyState
              title="No campaign ideas yet"
              hint="Prayog will suggest the first small campaign once a signal looks useful."
            />
          ) : (
            <div className="grid gap-2">
              {ideas.map((idea) => (
                <CampaignIdeaNote key={idea.id} idea={idea} />
              ))}
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}

function CanvasNote({
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.58)] px-4 py-3">
      <dt className="text-xs text-[var(--color-text-3)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-[var(--color-text-1)]">{value}</dd>
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

function CampaignIdeaNote({ idea }: { idea: CampaignIdeaRow }) {
  const learning = stringOutput(idea.output, "decision") ?? stringOutput(idea.output, "lift");
  const ended = idea.ended_at
    ? `learned ${timeAgo(idea.ended_at)}`
    : `started ${timeAgo(idea.started_at ?? idea.created_at)}`;
  const outcomes = Number(idea.outcome_count);
  return (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">
          {idea.rep_name ?? "Prayog"}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">{ended}</span>
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-5 text-[var(--color-text-1)]">
        {idea.play_name}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
        {outcomes > 0
          ? `${outcomes} useful ${outcomes === 1 ? "outcome" : "outcomes"}`
          : "Waiting for the first useful response"}
        {learning ? `. Learning: ${learning}` : ""}
      </p>
    </article>
  );
}

function stringOutput(output: Record<string, unknown> | null, key: string): string | null {
  const value = output?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function SignalRow({ signal }: { signal: QualifiedSignalRow }) {
  const score = signal.match_score ? Math.round(Number(signal.match_score) * 100) : null;
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">
          Qualified
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {timeAgo(signal.freshness_at ?? signal.ingested_at)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-text-1)]">
        {signal.title}
      </p>
      {score ? <p className="mt-2 text-xs text-[var(--color-text-3)]">{score}% fit</p> : null}
    </div>
  );
}
