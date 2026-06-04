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

export default async function AeoPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return <CanvasEmpty label="Bodh · AEO" title="No workspace selected." />;
  }

  const pool = getPool();
  const state = await getAppState(pool, {
    workspace_id: session.workspace.id,
    user_id: session.user_id,
  });
  const reviews = state.aeo_reviews;
  const learning = state.recommendation_quality.aeo_gap;
  const recorded = reviews.filter((item) => item.outcome_id).length;

  return (
    <>
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <p className="brief-kicker">Bodh · AEO</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Bodh finds the answers buyers expect.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Keep only the suggestions worth acting on. When visibility improves, record the result so the next pass gets sharper.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Visibility loop</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniStatus label="Suggestions" value={reviews.length - recorded} />
              <MiniStatus label="Results" value={recorded} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              Suggestions stay lightweight here: proof, decision, and result.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name="neurology" size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Answer gaps</h2>
          </div>
          <RecommendationLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        </div>
        {reviews.length === 0 ? (
          <EmptyState
            title="No answer gaps yet"
            hint="When Bodh finds missing category answers or visibility gaps, they will land here."
          />
        ) : (
          <RecommendationReviewGrid
            items={reviews}
            icon="travel_explore"
            surface="aeo"
            outcomeKind="engagement_lift"
            outcomeLabel="Record result"
            externalRefLabel="Proof link"
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
