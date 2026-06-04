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
  if (!session) return <CanvasEmpty label="Vaani · Content" title="No workspace selected." />;

  const pool = getPool();
  const [state, stats, contentDrafts, publishedContent] = await Promise.all([
    getAppState(pool, {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
    }),
    loadContentStats(session.workspace.id),
    loadContentDrafts(session.workspace.id),
    loadPublishedContent(session.workspace.id),
  ]);
  const reviews = state.content_reviews;
  const angles = reviews.filter((r) => !r.outcome_id);
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
              Vaani finds content worth posting.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Ideas, drafts, and useful outcomes. Review one idea at a time; Vaani learns what to stop showing.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Last seven days</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <MiniStatus label="Drafts" value={contentDrafts.length} />
              <MiniStatus label="Published" value={stats.posts_published_7d} />
              <MiniStatus label="Lift" value={stats.engagement_lift_7d} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              {published > 0
                ? `${published} ideas became posts.`
                : `${angles.length} ideas waiting for a yes or no.`}
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
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Ideas to review</h2>
          </div>
          <RecommendationLearningBadge
            accepted={learning.accepted}
            ignored={learning.ignored}
            acceptanceRate={learning.acceptance_rate}
          />
        </div>
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
            outcomeLabel="Record result"
            externalRefLabel="Published link"
          />
        )}
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="article" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Drafts</h2>
        </div>
        {contentDrafts.length === 0 ? (
          <EmptyState
            title="No drafts waiting"
            hint="Vaani will place ready-to-edit drafts here after an idea is approved."
            cta={{ href: "/dashboard/setup", label: "Tune Vaani", icon: "edit_note" }}
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {contentDrafts.map((draft) => (
              <DraftNote key={draft.id} draft={draft} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="publish" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Published outcomes</h2>
        </div>
        {publishedContent.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            hint="Published posts and lift outcomes will appear here once recorded."
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {publishedContent.map((outcome) => (
              <PublishedNote key={outcome.id} outcome={outcome} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function PublishedNote({ outcome }: { outcome: PublishedContentRow }) {
  const title = outcome.title ?? outcomeLabel(outcome.kind);
  const inner = (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-4 transition hover:border-[var(--color-line-2)]">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-pos-bg)] px-2 py-1 text-xs font-medium text-[var(--color-pos)]">
          {outcomeLabel(outcome.kind)}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {new Date(outcome.occurred_at).toLocaleDateString()}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-text-1)]">
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
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
          {draft.status === "queued" ? "Ready" : "Draft"}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {new Date(draft.created_at).toLocaleDateString()}
        </span>
      </div>
      {draft.subject ? (
        <h3 className="mt-3 text-sm font-semibold text-[var(--color-text-1)]">{draft.subject}</h3>
      ) : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-2)]">
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
