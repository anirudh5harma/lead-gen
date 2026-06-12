import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  getProductRecommendationSurface,
  verifiedProductWorkspaceSession,
} from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { auditAeoAction } from "../actions";
import {
  RecommendationLearningBadge,
  RecommendationReviewGrid,
} from "../recommendation-review";

export const dynamic = "force-dynamic";

export default async function AeoPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <SurfaceHero
        kicker="Bodh · AEO"
        title="No workspace selected."
        description="Create a workspace, then Bodh starts watching how AI engines describe you."
      />
    );
  }

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: session.workspace.id,
    user_id: session.user_id,
  });
  const recommendations = await getProductRecommendationSurface(
    pool,
    productSession,
    "aeo_gap",
  );
  const reviews = recommendations.reviews;
  const learning = recommendations.learning;
  const suggestionsToReview = reviews.filter((item) => !item.decision && !item.outcome_id);
  const savedSuggestions = reviews.filter((item) => item.decision === "accepted");
  const recorded = reviews.filter((item) => item.outcome_id).length;

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Bodh · Answer Engine Optimization"
        title={<>Make AI engines <em>cite you</em>.</>}
        description="Bodh watches how ChatGPT, Perplexity, and Google AI Overviews answer your category questions, then suggests the structured content that earns a citation."
        meta={
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <HeroStat label="To review" value={suggestionsToReview.length} />
              <HeroStat label="Saved" value={savedSuggestions.length} />
              <HeroStat label="Acted on" value={recorded} />
            </div>
            <form action={auditAeoAction} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
              <input type="hidden" name="return_to" value="/dashboard/aeo" />
              <input type="hidden" name="num_results" value="8" />
              <label className="sr-only" htmlFor="aeo-query">
                AEO audit query
              </label>
              <input
                id="aeo-query"
                name="query"
                required
                placeholder="best tools, alternatives, category questions"
                className="min-h-10 min-w-0 flex-1 rounded-md border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] px-3 text-sm text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-3)]"
              />
              <PendingSubmitButton
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)] active:translate-y-px"
                icon="neurology"
                pendingLabel="Auditing"
              >
                Audit AEO
              </PendingSubmitButton>
            </form>
          </div>
        }
      />

      <SurfaceSection
        title="Suggestions to review"
        action={
          <RecommendationLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        }
      >
        {suggestionsToReview.length === 0 ? (
          <EmptyState
            title="No new suggestions"
            hint="Fresh answer gaps will land here after an audit. Saved suggestions stay in their own section."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          <RecommendationReviewGrid
            items={suggestionsToReview}
            icon="travel_explore"
            surface="aeo"
            outcomeKind="engagement_lift"
            outcomeLabel="Mark cited"
            externalRefLabel="Link to the citation"
          />
        )}
      </SurfaceSection>

      <SurfaceSection title="Saved suggestions">
        {savedSuggestions.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            hint="Use a suggestion to keep it here while you draft the answer, update the page, or record citation lift."
          />
        ) : (
          <RecommendationReviewGrid
            items={savedSuggestions}
            icon="article"
            surface="aeo"
            outcomeKind="engagement_lift"
            outcomeLabel="Mark cited"
            externalRefLabel="Link to the citation"
          />
        )}
      </SurfaceSection>
    </div>
  );
}
