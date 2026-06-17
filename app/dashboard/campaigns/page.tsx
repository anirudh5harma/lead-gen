import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import {
  optimizeCampaignStrategyAction,
  optimizePlaySkillsAction,
  recordCampaignOutcomeAction,
} from "../actions";

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

interface CampaignStrategyVariant {
  variant_key: string;
  play_name: string;
  rep_name: string | null;
  channel: string | null;
  segment_key: string;
  sample_count: number;
  outcome_count: number;
  reply_outcomes: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  reply_rate: number;
  positive_outcome_rate: number;
  meeting_rate: number;
  negative_outcome_rate: number;
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: "double_down" | "hold" | "reduce" | "not_enough_proof";
  explanation: string;
}

interface CampaignStrategyState {
  recommendation_id: string;
  summary: string;
  generated_at: string;
  occurred_at: Date;
  variants: CampaignStrategyVariant[];
}

interface SkillOptimizationRecommendation {
  skill_key: string;
  pattern_key: string;
  channel: string | null;
  segment_key: string;
  rep_name: string | null;
  sample_count: number;
  outcome_count: number;
  reply_outcomes: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  reply_rate: number;
  positive_outcome_rate: number;
  meeting_rate: number;
  negative_outcome_rate: number;
  memory_win_count: number;
  memory_loss_count: number;
  memory_delta_score: number;
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: CampaignStrategyVariant["recommendation"];
  next_action: "apply_play_gate" | "review_reduce" | "keep_learning" | "no_change";
  explanation: string;
}

interface SkillOptimizationState {
  recommendation_id: string;
  summary: string;
  generated_at: string;
  occurred_at: Date;
  recommendations: SkillOptimizationRecommendation[];
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

async function loadLatestCampaignStrategy(
  workspaceId: string,
): Promise<CampaignStrategyState | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    payload: unknown;
    occurred_at: Date;
  }>(
    `select payload, occurred_at
       from events
      where workspace_id = $1
        and event_type = 'campaign.strategy.recommended'
      order by occurred_at desc
      limit 1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = parseCampaignStrategy(row.payload);
  return parsed ? { ...parsed, occurred_at: row.occurred_at } : null;
}

async function loadLatestSkillOptimization(
  workspaceId: string,
): Promise<SkillOptimizationState | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    payload: unknown;
    occurred_at: Date;
  }>(
    `select payload, occurred_at
       from events
      where workspace_id = $1
        and event_type = 'play.skill.optimization.recommended'
      order by occurred_at desc
      limit 1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = parseSkillOptimization(row.payload);
  return parsed ? { ...parsed, occurred_at: row.occurred_at } : null;
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
        kicker="Plays"
        title="No workspace yet."
        description="Create a prospecting profile, then Signals can become email and LinkedIn Plays."
      />
    );
  }

  const [counts, signals, ideas, strategy, skillOptimization] = await Promise.all([
    loadCounts(workspace.id),
    loadQualifiedSignals(workspace.id),
    loadCampaignIdeas(workspace.id),
    loadLatestCampaignStrategy(workspace.id),
    loadLatestSkillOptimization(workspace.id),
  ]);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Plays"
        title={<>Run small bets. <em>Scale the winners.</em></>}
        description="Qualified signals become email and LinkedIn Plays. Approve a small bet, watch replies and meetings, then let outcomes sharpen the next run."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <HeroStat label="Qualified today" value={counts.qualified_today} />
            <HeroStat label="Ideas this week" value={counts.ideas_week} />
            <HeroStat label="Outcomes this week" value={counts.outcomes_week} />
          </div>
        }
      />

      <SurfaceSection title="Strategy optimizer">
        <div className="flex flex-wrap items-center gap-2">
          <form action={optimizeCampaignStrategyAction}>
            <input type="hidden" name="return_to" value="/dashboard/plays" />
            <input type="hidden" name="lookback_days" value="30" />
            <input type="hidden" name="min_samples" value="3" />
            <PendingSubmitButton
              className="btn-solid"
              icon="auto_graph"
              pendingLabel="Optimizing"
            >
              Optimize
            </PendingSubmitButton>
          </form>
          {strategy ? (
            <span className="text-xs text-[var(--color-text-3)]">
              Updated {timeAgo(strategy.occurred_at)}
            </span>
          ) : null}
        </div>
        {strategy ? (
          <StrategyOptimizerPanel strategy={strategy} />
        ) : (
          <EmptyState
            title="No strategy recommendation yet"
            hint="Play learning will appear after outcomes are attributed to recent runs."
          />
        )}
      </SurfaceSection>

      <SurfaceSection title="Play Skill optimizer">
        <div className="flex flex-wrap items-center gap-2">
          <form action={optimizePlaySkillsAction}>
            <input type="hidden" name="return_to" value="/dashboard/plays" />
            <input type="hidden" name="lookback_days" value="30" />
            <input type="hidden" name="min_samples" value="3" />
            <PendingSubmitButton
              className="btn-solid"
              icon="science"
              pendingLabel="Optimizing skills"
            >
              Optimize skills
            </PendingSubmitButton>
          </form>
          {skillOptimization ? (
            <span className="text-xs text-[var(--color-text-3)]">
              Updated {timeAgo(skillOptimization.occurred_at)}
            </span>
          ) : null}
        </div>
        {skillOptimization ? (
          <SkillOptimizerPanel skillOptimization={skillOptimization} />
        ) : (
          <EmptyState
            title="No Play Skill recommendation yet"
            hint="After Play outcomes and procedural memory accumulate, Bombsell will recommend which email and LinkedIn frameworks deserve more or less volume."
          />
        )}
      </SurfaceSection>

      <SurfaceSection title="Qualified signals worth a Play">
        {signals.length === 0 ? (
          <EmptyState
            title="No qualified signals yet"
            hint="Tune prospecting once, then good-fit timing signals will appear here."
            cta={{ href: "/dashboard/settings#profile", label: "Update profile", icon: "person" }}
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <SurfaceSection title="Play ideas in flight">
        {ideas.length === 0 ? (
          <EmptyState
            title="No Play ideas yet"
            hint="A Play will appear once a signal has enough fit, contact data, and channel confidence."
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

function SkillOptimizerPanel({
  skillOptimization,
}: {
  skillOptimization: SkillOptimizationState;
}) {
  const topRecommendations = skillOptimization.recommendations.slice(0, 3);
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <p className="text-[14px] leading-5 text-[var(--color-text-1)]">
          {skillOptimization.summary}
        </p>
      </div>
      {topRecommendations.length === 0 ? null : (
        <div className="grid gap-2 lg:grid-cols-3">
          {topRecommendations.map((recommendation) => (
            <SkillRecommendationCard
              key={`${recommendation.skill_key}:${recommendation.pattern_key}:${recommendation.channel ?? "any"}`}
              recommendation={recommendation}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillRecommendationCard({
  recommendation,
}: {
  recommendation: SkillOptimizationRecommendation;
}) {
  const utility = Math.round(recommendation.utility_score * 100);
  return (
    <article className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
          {strategyLabel(recommendation.recommendation)}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {skillNextActionLabel(recommendation.next_action)}
        </span>
      </div>
      <h3 className="mt-3 text-[14px] font-semibold leading-5 text-[var(--color-text-1)]">
        {humanizeSkillKey(recommendation.skill_key)}
      </h3>
      <p className="mt-1 text-xs text-[var(--color-text-3)]">
        {recommendation.rep_name ?? "Play Rep"}
        {recommendation.channel ? ` · ${recommendation.channel}` : ""}
        {recommendation.segment_key !== "all" ? ` · ${recommendation.segment_key}` : ""}
        {` · ${recommendation.sample_count} samples`}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <MetricPill label="Reply" value={percentRate(recommendation.reply_rate)} />
        <MetricPill label="Outcome" value={percentRate(recommendation.positive_outcome_rate)} />
        <MetricPill label="Utility" value={`${utility}%`} />
        <MetricPill
          label="Memory"
          value={`${recommendation.memory_win_count}/${recommendation.memory_loss_count}`}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
        {recommendation.explanation}
      </p>
    </article>
  );
}

function StrategyOptimizerPanel({ strategy }: { strategy: CampaignStrategyState }) {
  const topVariants = strategy.variants.slice(0, 3);
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <p className="text-[14px] leading-5 text-[var(--color-text-1)]">
          {strategy.summary}
        </p>
      </div>
      {topVariants.length === 0 ? null : (
        <div className="grid gap-2 lg:grid-cols-3">
          {topVariants.map((variant) => (
            <StrategyVariantCard key={variant.variant_key} variant={variant} />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyVariantCard({ variant }: { variant: CampaignStrategyVariant }) {
  const utility = Math.round(variant.utility_score * 100);
  const allocation = Math.round(variant.allocation_weight * 100);
  return (
    <article className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
          {strategyLabel(variant.recommendation)}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {allocation}% allocation
        </span>
      </div>
      <h3 className="mt-3 text-[14px] font-semibold leading-5 text-[var(--color-text-1)]">
        {variant.play_name}
      </h3>
      <p className="mt-1 text-xs text-[var(--color-text-3)]">
        {variant.rep_name ?? "Play Rep"}
        {variant.channel ? ` · ${variant.channel}` : ""}
        {variant.segment_key !== "all" ? ` · ${variant.segment_key}` : ""}
        {` · ${variant.sample_count} samples`}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <MetricPill label="Reply" value={percentRate(variant.reply_rate)} />
        <MetricPill label="Outcome" value={percentRate(variant.positive_outcome_rate)} />
        <MetricPill label="Meeting" value={percentRate(variant.meeting_rate)} />
        <MetricPill label="Utility" value={`${utility}%`} />
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
        {variant.explanation}
      </p>
    </article>
  );
}

function MetricPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-[color:var(--color-line-2)] px-2 py-1.5">
      <div className="font-semibold text-[var(--color-text-1)]">{value}</div>
      <div className="text-[10.5px] text-[var(--color-text-3)]">{label}</div>
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
    <article className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-accent)]">
          {agentDisplayName(idea.rep_name)}
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
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[color:var(--color-line-2)] pt-3">
        <CampaignOutcomeButton
          playRunId={idea.id}
          kind="opportunity_created"
          label={outcomes > 0 ? "Add useful" : "Useful"}
          icon="check_circle"
        />
        <CampaignOutcomeButton
          playRunId={idea.id}
          kind="meeting_booked"
          label="Meeting"
          icon="event_available"
        />
      </div>
    </article>
  );
}

function CampaignOutcomeButton({
  playRunId,
  kind,
  label,
  icon,
}: {
  playRunId: string;
  kind: "opportunity_created" | "meeting_booked";
  label: string;
  icon: string;
}) {
  return (
    <form action={recordCampaignOutcomeAction}>
      <input type="hidden" name="return_to" value="/dashboard/plays" />
      <input type="hidden" name="play_run_id" value={playRunId} />
      <input type="hidden" name="outcome_kind" value={kind} />
      <PendingSubmitButton
        className="btn-quiet-sm"
        icon={icon}
        iconSize={15}
        pendingLabel="Saving"
      >
        {label}
      </PendingSubmitButton>
    </form>
  );
}

function stringOutput(output: Record<string, unknown> | null, key: string): string | null {
  const value = output?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseCampaignStrategy(payload: unknown): Omit<CampaignStrategyState, "occurred_at"> | null {
  const record = recordValue(payload);
  if (!record) return null;
  const variants = Array.isArray(record.variants)
    ? record.variants.map(parseCampaignVariant).filter(isCampaignStrategyVariant)
    : [];
  return {
    recommendation_id: stringValue(record.recommendation_id) ?? "unknown",
    summary: stringValue(record.summary) ?? "No Play variants have enough activity yet.",
    generated_at: stringValue(record.generated_at) ?? new Date().toISOString(),
    variants,
  };
}

function parseSkillOptimization(payload: unknown): Omit<SkillOptimizationState, "occurred_at"> | null {
  const record = recordValue(payload);
  if (!record) return null;
  const recommendations = Array.isArray(record.recommendations)
    ? record.recommendations
      .map(parseSkillRecommendation)
      .filter(isSkillOptimizationRecommendation)
    : [];
  return {
    recommendation_id: stringValue(record.recommendation_id) ?? "unknown",
    summary: stringValue(record.summary) ?? "No Play Skills have enough evidence yet.",
    generated_at: stringValue(record.generated_at) ?? new Date().toISOString(),
    recommendations,
  };
}

function isSkillOptimizationRecommendation(
  value: SkillOptimizationRecommendation | null,
): value is SkillOptimizationRecommendation {
  return value != null;
}

function parseSkillRecommendation(value: unknown): SkillOptimizationRecommendation | null {
  const record = recordValue(value);
  if (!record) return null;
  const skill_key = stringValue(record.skill_key);
  const pattern_key = stringValue(record.pattern_key);
  const recommendation = strategyRecommendation(record.recommendation);
  const next_action = skillNextAction(record.next_action);
  if (!skill_key || !pattern_key || !recommendation || !next_action) return null;
  const sample_count = numberPayload(record.sample_count);
  const reply_outcomes = numberPayload(record.reply_outcomes);
  const positive_outcomes = numberPayload(record.positive_outcomes);
  const negative_outcomes = numberPayload(record.negative_outcomes);
  const meeting_outcomes = numberPayload(record.meeting_outcomes);
  return {
    skill_key,
    pattern_key,
    channel: stringValue(record.channel),
    segment_key: stringValue(record.segment_key) ?? "all",
    rep_name: stringValue(record.rep_name),
    sample_count,
    outcome_count: numberPayload(record.outcome_count),
    reply_outcomes,
    positive_outcomes,
    negative_outcomes,
    meeting_outcomes,
    reply_rate: ratePayload(record.reply_rate, reply_outcomes, sample_count),
    positive_outcome_rate: ratePayload(record.positive_outcome_rate, positive_outcomes, sample_count),
    meeting_rate: ratePayload(record.meeting_rate, meeting_outcomes, sample_count),
    negative_outcome_rate: ratePayload(record.negative_outcome_rate, negative_outcomes, sample_count),
    memory_win_count: numberPayload(record.memory_win_count),
    memory_loss_count: numberPayload(record.memory_loss_count),
    memory_delta_score: numberPayload(record.memory_delta_score),
    utility_score: numberPayload(record.utility_score),
    confidence: numberPayload(record.confidence),
    allocation_weight: numberPayload(record.allocation_weight),
    recommendation,
    next_action,
    explanation: stringValue(record.explanation) ?? "Outcome evidence is still being collected.",
  };
}

function isCampaignStrategyVariant(
  value: CampaignStrategyVariant | null,
): value is CampaignStrategyVariant {
  return value != null;
}

function parseCampaignVariant(value: unknown): CampaignStrategyVariant | null {
  const record = recordValue(value);
  if (!record) return null;
  const variant_key = stringValue(record.variant_key);
  const play_name = stringValue(record.play_name);
  const recommendation = strategyRecommendation(record.recommendation);
  if (!variant_key || !play_name || !recommendation) return null;
  const sample_count = numberPayload(record.sample_count);
  const reply_outcomes = numberPayload(record.reply_outcomes);
  const positive_outcomes = numberPayload(record.positive_outcomes);
  const negative_outcomes = numberPayload(record.negative_outcomes);
  const meeting_outcomes = numberPayload(record.meeting_outcomes);
  return {
    variant_key,
    play_name,
    rep_name: stringValue(record.rep_name),
    channel: stringValue(record.channel),
    segment_key: stringValue(record.segment_key) ?? "all",
    sample_count,
    outcome_count: numberPayload(record.outcome_count),
    reply_outcomes,
    positive_outcomes,
    negative_outcomes,
    meeting_outcomes,
    reply_rate: ratePayload(record.reply_rate, reply_outcomes, sample_count),
    positive_outcome_rate: ratePayload(record.positive_outcome_rate, positive_outcomes, sample_count),
    meeting_rate: ratePayload(record.meeting_rate, meeting_outcomes, sample_count),
    negative_outcome_rate: ratePayload(record.negative_outcome_rate, negative_outcomes, sample_count),
    utility_score: numberPayload(record.utility_score),
    confidence: numberPayload(record.confidence),
    allocation_weight: numberPayload(record.allocation_weight),
    recommendation,
    explanation: stringValue(record.explanation) ?? "Outcome evidence is still being collected.",
  };
}

function strategyRecommendation(
  value: unknown,
): CampaignStrategyVariant["recommendation"] | null {
  if (
    value === "double_down" ||
    value === "hold" ||
    value === "reduce" ||
    value === "not_enough_proof"
  ) {
    return value;
  }
  return null;
}

function skillNextAction(value: unknown): SkillOptimizationRecommendation["next_action"] | null {
  if (
    value === "apply_play_gate" ||
    value === "review_reduce" ||
    value === "keep_learning" ||
    value === "no_change"
  ) {
    return value;
  }
  return null;
}

function strategyLabel(value: CampaignStrategyVariant["recommendation"]): string {
  if (value === "double_down") return "Double down";
  if (value === "reduce") return "Reduce";
  if (value === "not_enough_proof") return "Explore";
  return "Hold";
}

function skillNextActionLabel(value: SkillOptimizationRecommendation["next_action"]): string {
  if (value === "apply_play_gate") return "Apply at Play gate";
  if (value === "review_reduce") return "Review reduce";
  if (value === "keep_learning") return "Keep learning";
  return "No change";
}

function humanizeSkillKey(value: string): string {
  return value
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberPayload(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratePayload(value: unknown, numerator: number, denominator: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(parsed)) return clampRate(parsed);
  return denominator > 0 ? clampRate(numerator / denominator) : 0;
}

function percentRate(value: number): string {
  return `${Math.round(clampRate(value) * 100)}%`;
}

function clampRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function agentDisplayName(name: string | null): string {
  if (!name || name === "Sampark" || name === "Prayog") return "Outbound agent";
  return name;
}

function SignalRow({ signal }: { signal: QualifiedSignalRow }) {
  const score = signal.match_score ? Math.round(Number(signal.match_score) * 100) : null;
  return (
    <div className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
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
