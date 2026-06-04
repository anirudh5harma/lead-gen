import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

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

export default async function CampaignsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Prayog · Campaigns"
        title="No workspace yet."
        description="Create a profile, then Prayog will turn good signals into campaign ideas."
      />
    );
  }

  const [counts, signals, ideas] = await Promise.all([
    loadCounts(workspace.id),
    loadQualifiedSignals(workspace.id),
    loadCampaignIdeas(workspace.id),
  ]);

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Prayog · Campaigns"
        title={<>Run small bets. <em>Scale the winners.</em></>}
        description="Prayog turns qualified signals into small campaign ideas. Approve one, watch the outcome, and the next idea is sharper."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Qualified today" value={counts.qualified_today} />
            <HeroStat label="Ideas this week" value={counts.ideas_week} />
            <HeroStat label="Outcomes this week" value={counts.outcomes_week} />
          </div>
        }
      />

      <SurfaceSection title="Qualified signals worth a campaign">
        {signals.length === 0 ? (
          <EmptyState
            title="No qualified signals yet"
            hint="Tune the profile once, then good-fit opportunities will appear here."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <SurfaceSection title="Campaign ideas in flight">
        {ideas.length === 0 ? (
          <EmptyState
            title="No campaign ideas yet"
            hint="Prayog will suggest the first small campaign once a signal looks useful."
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {ideas.map((idea) => (
              <CampaignIdeaNote key={idea.id} idea={idea} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function CampaignIdeaNote({ idea }: { idea: CampaignIdeaRow }) {
  const learning = stringOutput(idea.output, "decision") ?? stringOutput(idea.output, "lift");
  const ended = idea.ended_at
    ? `learned ${timeAgo(idea.ended_at)}`
    : `started ${timeAgo(idea.started_at ?? idea.created_at)}`;
  const outcomes = Number(idea.outcome_count);
  return (
    <article className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
          {idea.rep_name ?? "Prayog"}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">{ended}</span>
      </div>
      <h3 className="mt-3 text-[14px] font-semibold leading-5 text-[var(--color-text-1)]">
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
    <div className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
          Qualified
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {timeAgo(signal.freshness_at ?? signal.ingested_at)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[14px] leading-5 text-[var(--color-text-1)]">
        {signal.title}
      </p>
      {score ? <p className="mt-2 text-xs text-[var(--color-text-3)]">{score}% fit</p> : null}
    </div>
  );
}
