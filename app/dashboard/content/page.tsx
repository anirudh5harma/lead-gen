import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getAppState } from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  RecommendationLearningBadge,
  RecommendationReviewGrid,
} from "../recommendation-review";

export const dynamic = "force-dynamic";

interface ContentOutcomeStats {
  posts_published_7d: number;
  engagement_lift_7d: number;
}

async function loadContentStats(workspaceId: string): Promise<ContentOutcomeStats> {
  const pool = getPool();
  const { rows } = await pool.query<{
    posts_published_7d: string;
    engagement_lift_7d: string;
  }>(
    `select
       (select count(*)::text from outcomes
          where workspace_id = $1 and kind = 'post_published'
            and recorded_at >= now() - interval '7 days') as posts_published_7d,
       (select count(*)::text from outcomes
          where workspace_id = $1 and kind = 'engagement_lift'
            and recorded_at >= now() - interval '7 days') as engagement_lift_7d`,
    [workspaceId],
  );
  return {
    posts_published_7d: Number(rows[0]?.posts_published_7d ?? 0),
    engagement_lift_7d: Number(rows[0]?.engagement_lift_7d ?? 0),
  };
}

export default async function ContentPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) return <CanvasEmpty label="Vaani · Content" title="No workspace selected." />;

  const pool = getPool();
  const [state, stats] = await Promise.all([
    getAppState(pool, {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
    }),
    loadContentStats(session.workspace.id),
  ]);
  const reviews = state.content_reviews;
  const drafts = reviews.filter((r) => !r.outcome_id);
  const published = reviews.filter((r) => r.outcome_id).length;
  const learning = state.recommendation_quality.content_opportunity;

  return (
    <>
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <p className="brief-kicker">Vaani · Content</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Vaani is writing what&apos;s worth publishing.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Angles, drafts, and the lift that follows. Vaani only surfaces what passes review.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Last seven days</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <MiniStatus label="Drafts" value={drafts.length} />
              <MiniStatus label="Published" value={stats.posts_published_7d} />
              <MiniStatus label="Lift" value={stats.engagement_lift_7d} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              {published > 0
                ? `${published} angles already turned into Outcomes.`
                : "Mark a draft published to start the loop."}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name="edit_note" size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Angles to review</h2>
          </div>
          <RecommendationLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        </div>
        {reviews.length === 0 ? (
          <EmptyState
            title="No angles yet"
            hint="When Vaani finds a question or proof worth turning into a post, it lands here."
          />
        ) : (
          <RecommendationReviewGrid
            items={reviews}
            icon="lightbulb"
            surface="content"
            outcomeKind="post_published"
            outcomeLabel="Mark published"
            externalRefLabel="Published URL"
          />
        )}
      </section>
    </>
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
