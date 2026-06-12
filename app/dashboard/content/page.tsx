import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  getProductRecommendationSurface,
  verifiedProductWorkspaceSession,
} from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { discoverContentOpportunitiesAction } from "../actions";
import {
  RecommendationLearningBadge,
  RecommendationReviewGrid,
} from "../recommendation-review";

export const dynamic = "force-dynamic";

interface ContentOutcomeStats {
  posts_published_7d: number;
  engagement_lift_7d: number;
}

interface ContentDraftRow {
  id: string;
  subject: string | null;
  body: string | null;
  status: string;
  created_at: Date;
}

interface PublishedContentRow {
  id: string;
  kind: string;
  score: string;
  title: string | null;
  external_ref: string | null;
  occurred_at: Date;
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

async function loadContentDrafts(workspaceId: string): Promise<ContentDraftRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ContentDraftRow>(
    `select m.id, m.subject, m.body, m.status::text as status, m.created_at
       from messages m
       join conversations c on c.id = m.conversation_id
       join reps r on r.id = c.rep_id
      where m.workspace_id = $1
        and m.direction = 'outbound'
        and m.status in ('draft','queued')
        and m.channel in ('x_post','linkedin_comment','web','other')
        and lower(r.name) = 'vaani'
      order by m.created_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

async function loadPublishedContent(workspaceId: string): Promise<PublishedContentRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PublishedContentRow>(
    `select id,
            kind::text as kind,
            score::text as score,
            properties #>> '{recommendation_item,title}' as title,
            properties->>'external_ref' as external_ref,
            occurred_at
       from outcomes
      where workspace_id = $1
        and kind in ('post_published','engagement_lift','follower_lift')
      order by occurred_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

export default async function ContentPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <SurfaceHero
        kicker="Vaani · Content"
        title="No workspace selected."
        description="Create a workspace, then Vaani starts shaping content ideas worth posting."
      />
    );
  }

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: session.workspace.id,
    user_id: session.user_id,
  });
  const [recommendations, stats, contentDrafts, publishedContent] = await Promise.all([
    getProductRecommendationSurface(
      pool,
      productSession,
      "content_opportunity",
    ),
    loadContentStats(session.workspace.id),
    loadContentDrafts(session.workspace.id),
    loadPublishedContent(session.workspace.id),
  ]);
  const reviews = recommendations.reviews;
  const angles = reviews.filter((r) => !r.outcome_id);
  const learning = recommendations.learning;

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Vaani · Content"
        title={<>Post what is <em>worth posting</em>.</>}
        description="Vaani turns proof, questions, and recent moves into one-liner angles. Save the useful ones, shape them into posts, and Vaani learns from what actually gets published."
        meta={
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <HeroStat label="Ideas open" value={angles.length} />
              <HeroStat label="Drafts" value={contentDrafts.length} />
              <HeroStat label="Published 7d" value={stats.posts_published_7d} />
              <HeroStat label="Lift 7d" value={stats.engagement_lift_7d} />
            </div>
            <form action={discoverContentOpportunitiesAction} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
              <input type="hidden" name="return_to" value="/dashboard/content" />
              <input type="hidden" name="num_results" value="8" />
              <label className="sr-only" htmlFor="content-query">
                Content research query
              </label>
              <input
                id="content-query"
                name="query"
                required
                placeholder="pricing objections, buyer questions, competitor proof"
                className="min-h-10 min-w-0 flex-1 rounded-md border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] px-3 text-sm text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-3)]"
              />
              <PendingSubmitButton
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)] active:translate-y-px"
                icon="travel_explore"
                pendingLabel="Finding ideas"
              >
                Find ideas
              </PendingSubmitButton>
            </form>
          </div>
        }
      />

      <SurfaceSection
        title="Ideas to review"
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
            title="No ideas yet"
            hint="When Vaani finds a question or proof worth turning into a post, it lands here."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          <RecommendationReviewGrid
            items={reviews}
            icon="lightbulb"
            surface="content"
            outcomeKind="post_published"
            outcomeLabel="Mark published"
            externalRefLabel="Published link"
          />
        )}
      </SurfaceSection>

      <SurfaceSection title="Drafts ready to edit">
        {contentDrafts.length === 0 ? (
          <EmptyState
            title="No drafts waiting"
            hint="Native content drafting will use the same saved ideas and outcome learning once the publishing channel is connected."
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {contentDrafts.map((draft) => (
              <DraftNote key={draft.id} draft={draft} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <SurfaceSection title="Published outcomes">
        {publishedContent.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            hint="Once posts go live and lift is recorded, results land here."
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {publishedContent.map((outcome) => (
              <PublishedNote key={outcome.id} outcome={outcome} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function PublishedNote({ outcome }: { outcome: PublishedContentRow }) {
  const title = outcome.title ?? outcomeLabel(outcome.kind);
  const inner = (
    <article className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4 transition-colors hover:bg-[var(--color-ink-2)]/40">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-pos-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-pos)]">
          {outcomeLabel(outcome.kind)}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {new Date(outcome.occurred_at).toLocaleDateString()}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-[14px] font-semibold leading-5 text-[var(--color-text-1)]">
        {title}
      </h3>
    </article>
  );
  if (!outcome.external_ref) return inner;
  return (
    <a href={outcome.external_ref} target="_blank" rel="noreferrer">
      {inner}
    </a>
  );
}

function DraftNote({ draft }: { draft: ContentDraftRow }) {
  const body = draft.body ?? "(empty draft)";
  return (
    <article className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)]">
          {draft.status === "queued" ? "Ready" : "Draft"}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {new Date(draft.created_at).toLocaleDateString()}
        </span>
      </div>
      {draft.subject ? (
        <h3 className="mt-3 text-[14px] font-semibold text-[var(--color-text-1)]">{draft.subject}</h3>
      ) : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-text-2)]">
        {body}
      </p>
    </article>
  );
}

function outcomeLabel(kind: string): string {
  if (kind === "post_published") return "Published";
  if (kind === "engagement_lift") return "Lift";
  if (kind === "follower_lift") return "Audience lift";
  return kind.replace(/_/g, " ");
}
