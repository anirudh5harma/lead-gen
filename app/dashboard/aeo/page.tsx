import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
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
  const recorded = reviews.filter((item) => item.outcome_id).length;
  const open = reviews.length - recorded;

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Bodh · Answer Engine Optimization"
        title={<>Make AI engines <em>cite you</em>.</>}
        description="Bodh watches how ChatGPT, Perplexity, and Google AI Overviews answer your category questions, then suggests the structured content that earns a citation."
        meta={
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <HeroStat label="Open suggestions" value={open} />
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
              <button
                type="submit"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)] active:translate-y-px"
              >
                <Icon name="neurology" size={16} />
                Audit AEO
              </button>
            </form>
          </div>
        }
      />

      <SurfaceSection
        title="Suggestions to earn a citation"
        action={
          <RecommendationLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        }
      >
        {reviews.length === 0 ? (
          <EmptyState
            title="No suggestions yet"
            hint="Bodh runs prompts against ChatGPT, Perplexity, and AI Overviews to find category questions where you are missing, mis-described, or out-cited. Tune the profile to start."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          <RecommendationReviewGrid
            items={reviews}
            icon="travel_explore"
            surface="aeo"
            outcomeKind="engagement_lift"
            outcomeLabel="Mark cited"
            externalRefLabel="Link to the citation"
          />
        )}
      </SurfaceSection>

      <SurfaceSection title="How Bodh works">
        <ol className="grid gap-3 text-[14px] leading-6 text-[var(--color-text-2)] sm:grid-cols-3">
          <Step
            num="01"
            title="Ask the engines"
            body="Bodh prompts ChatGPT, Perplexity, and Google AI Overviews with the questions your buyers actually ask."
          />
          <Step
            num="02"
            title="Find the gap"
            body="Where you are absent, mis-named, or out-cited, that becomes a suggestion: a page, a schema, an answer."
          />
          <Step
            num="03"
            title="Record the win"
            body="When the engine starts citing you, mark it. Bodh learns which suggestions actually move visibility."
          />
        </ol>
      </SurfaceSection>
    </div>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <li className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-[var(--color-text-3)]">
        {num}
      </p>
      <p className="mt-2 text-[14px] font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-1.5 text-[13px] leading-6 text-[var(--color-text-3)]">{body}</p>
    </li>
  );
}
