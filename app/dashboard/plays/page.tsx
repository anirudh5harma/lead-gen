import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getAppState, type ProductBriefItem } from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { reviewRecommendationAction } from "../actions";

export const dynamic = "force-dynamic";

interface PlayRow {
  id: string;
  name: string;
  description: string | null;
  declaration: string;
  status: string;
  version: number;
  runs_24h: string;
  last_run_at: Date | null;
}

async function loadPlays(workspaceId: string): Promise<PlayRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PlayRow>(
    `select p.id, p.name, p.description, p.declaration,
            p.status::text as status, p.version,
            (select count(*)::text from play_runs pr
              where pr.workspace_id = $1 and pr.play_id = p.id
                and pr.created_at >= now() - interval '24 hours') as runs_24h,
            (select max(pr.created_at) from play_runs pr
              where pr.workspace_id = $1 and pr.play_id = p.id) as last_run_at
       from plays p
      where p.workspace_id = $1
      order by p.updated_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function PlaysPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return <CanvasEmpty label="Content" title="No workspace selected." />;
  }
  const pool = getPool();
  const [plays, state] = await Promise.all([
    loadPlays(session.workspace.id),
    getAppState(pool, {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
    }),
  ]);
  const activePlays = plays.filter((play) => play.status === "active");
  const recentRun = plays.find((play) => play.last_run_at);
  const reviews = state.content_reviews;
  const learning = state.recommendation_quality.content_opportunity;

  return (
    <>
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <p className="brief-kicker">Content</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              The plays Bombsell can turn into words.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Keep the library small. Each play is a reusable way to turn a real signal into outreach or content with the right review rule.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Library shape</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniStatus label="Active" value={activePlays.length} />
              <MiniStatus label="Total" value={plays.length} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              {recentRun?.last_run_at
                ? `Last movement ${new Date(recentRun.last_run_at).toLocaleDateString()}.`
                : "Runs will appear after the first real signal moves."}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name="travel_explore" size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Angles to review</h2>
          </div>
          <ReviewLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        </div>
        {reviews.length === 0 ? (
          <EmptyState
            title="No fresh angles yet"
            hint="When Exa finds market questions or competitor narratives, they will appear here."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {reviews.map((item, index) => (
              <ReviewNote key={`${item.title}:${index}`} item={item} icon="lightbulb" />
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {plays.length === 0 ? (
          <EmptyState
            title="No content plays yet"
            hint="Shape the profile first, then Bombsell can compile a small set of plays."
          />
        ) : (
          plays.map((play) => <PlayNote key={play.id} play={play} />)
        )}
      </section>
    </>
  );
}

function ReviewNote({ item, icon }: { item: ProductBriefItem; icon: string }) {
  return (
    <article className="section-note">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon">
          <Icon name={icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-6 text-[var(--color-text-1)]">{item.title}</h3>
          <p className="mt-2 line-clamp-4 text-sm leading-6 text-[var(--color-text-2)]">{item.detail}</p>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-xs font-semibold text-[var(--color-accent)]"
            >
              View proof
            </a>
          ) : null}
          <ReviewActions item={item} />
        </div>
      </div>
    </article>
  );
}

function ReviewActions({ item }: { item: ProductBriefItem }) {
  if (!item.review_id) return null;
  if (item.decision === "accepted") {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.62)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)]">
        <Icon name="check" size={14} />
        Kept for the Rep
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <form action={reviewRecommendationAction}>
        <input type="hidden" name="review_id" value={item.review_id} />
        <input type="hidden" name="decision" value="accepted" />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
        >
          <Icon name="check" size={14} />
          Keep
        </button>
      </form>
      <form action={reviewRecommendationAction}>
        <input type="hidden" name="review_id" value={item.review_id} />
        <input type="hidden" name="decision" value="ignored" />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)] transition active:translate-y-px"
        >
          <Icon name="close" size={14} />
          Skip
        </button>
      </form>
    </div>
  );
}

function ReviewLearningBadge({
  accepted,
  ignored,
  acceptanceRate,
}: {
  accepted: number;
  ignored: number;
  acceptanceRate: number | null;
}) {
  if (accepted + ignored === 0) return null;
  const rate = acceptanceRate == null ? null : `${Math.round(acceptanceRate * 100)}% kept`;
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-3)]">
      <Icon name="auto_awesome" size={14} />
      <span>{accepted} kept</span>
      <span>{ignored} skipped</span>
      {rate ? <span>{rate}</span> : null}
    </p>
  );
}

function PlayNote({ play }: { play: PlayRow }) {
  return (
    <article className="section-note">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon">
          <Icon name="edit_square" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">{play.name}</h2>
            <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
              v{play.version}
            </span>
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs text-[var(--color-accent)]">
              {play.status}
            </span>
          </div>
          {play.description ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">{play.description}</p>
          ) : null}
          <p className="mt-4 line-clamp-4 rounded-[10px] bg-[rgba(255,255,255,0.58)] p-3 text-sm leading-6 text-[var(--color-text-2)]">
            {play.declaration}
          </p>
          <p className="mt-3 text-xs text-[var(--color-text-3)]">
            {play.runs_24h} runs today. Last {play.last_run_at ? new Date(play.last_run_at).toLocaleDateString() : "never"}.
          </p>
        </div>
      </div>
    </article>
  );
}

function MiniStatus({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.56)] p-3">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}

function CanvasEmpty({ label, title }: { label: string; title: string }) {
  return (
    <section className="section-canvas p-6">
      <p className="brief-kicker">{label}</p>
      <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">{title}</h1>
    </section>
  );
}
