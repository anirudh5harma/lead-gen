import type { Metadata } from "next";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { EmptyState } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import { saveRedditWatchlistAction } from "./actions";

export const metadata: Metadata = { title: "Reddit marketing | Bombsell" };
export const dynamic = "force-dynamic";

interface RedditThread {
  signal_id: string;
  title: string;
  subreddit: string;
  url: string | null;
  author: string | null;
  score: number | null;
  num_comments: number | null;
  matched_keywords: string[];
  ingested_at: Date;
}

interface RedditWatchlist {
  subreddits: string[];
  keywords: string[];
  source_id: string | null;
  enabled: boolean;
}

async function loadWatchlist(workspaceId: string): Promise<RedditWatchlist> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    config: Record<string, unknown> | null;
    enabled: boolean;
  }>(
    `select gs.id, gs.config, coalesce(wsc.enabled, gs.enabled) as enabled
       from graph_sources gs
       left join workspace_source_configs wsc
         on wsc.workspace_id = gs.workspace_id and wsc.source_id = gs.id
      where gs.workspace_id = $1
        and (gs.config->>'adapter' = 'reddit_search'
             or gs.config->>'adapter' = 'reddit')
      order by gs.created_at desc
      limit 1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) {
    return { subreddits: [], keywords: [], source_id: null, enabled: false };
  }
  const config = row.config ?? {};
  return {
    source_id: row.id,
    enabled: row.enabled,
    subreddits: Array.isArray(config.subreddits)
      ? (config.subreddits as string[])
      : typeof config.subreddit === "string"
        ? [config.subreddit]
        : [],
    keywords: Array.isArray(config.keywords)
      ? (config.keywords as string[])
      : [],
  };
}

async function loadRedditThreads(
  workspaceId: string,
  limit = 40,
): Promise<RedditThread[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    title: string;
    properties: Record<string, unknown> | null;
    ingested_at: Date;
  }>(
    `select s.id,
            s.title,
            s.properties,
            coalesce(s.ingested_at, s.freshness_at) as ingested_at
       from signals s
       join graph_sources gs on gs.id = s.source_id
      where s.workspace_id = $1
        and (
          gs.config->>'adapter' = 'reddit_search'
          or gs.config->>'adapter' = 'reddit'
          or s.properties->>'channel' = 'reddit'
        )
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '30 days'
      order by coalesce(s.ingested_at, s.freshness_at) desc
      limit $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => {
    const props = row.properties ?? {};
    const structured =
      typeof props.structured === "object" && props.structured
        ? (props.structured as Record<string, unknown>)
        : {};
    return {
      signal_id: row.id,
      title: row.title,
      subreddit:
        (structured.subreddit as string) ??
        (props.subreddit as string) ??
        "",
      url: (props.url as string) ?? (structured.url as string) ?? null,
      author:
        (structured.author as string) ?? (props.author as string) ?? null,
      score: numberOrNull(structured.score ?? props.score),
      num_comments: numberOrNull(structured.num_comments ?? props.num_comments),
      matched_keywords: Array.isArray(structured.matched_keywords)
        ? (structured.matched_keywords as string[])
        : [],
      ingested_at: row.ingested_at,
    };
  });
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default async function RedditPage() {
  const session = await getActiveWorkspaceSessionForDashboard("reddit");
  if (!session) return <RedditEmpty />;

  const [watchlist, threads] = await Promise.all([
    loadWatchlist(session.workspace.id).catch(
      () => ({ subreddits: [], keywords: [], source_id: null, enabled: false }),
    ),
    loadRedditThreads(session.workspace.id).catch(() => [] as RedditThread[]),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Reddit marketing
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Threads to jump on
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-[var(--color-text-3)]">
          Discovers relevant Reddit threads for your ICP. Comment yourself — we
          don&apos;t auto-post in v1.
        </p>
      </header>

      <WatchlistCard watchlist={watchlist} />

      {threads.length === 0 ? (
        <RedditNoThreads hasWatchlist={watchlist.subreddits.length > 0} />
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <ThreadCard key={thread.signal_id} thread={thread} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchlistCard({ watchlist }: { watchlist: RedditWatchlist }) {
  return (
    <form
      action={saveRedditWatchlistAction}
      className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-1)]">
          Watchlist
        </h2>
        <span className="text-[12px] text-[var(--color-text-3)]">
          {watchlist.enabled ? "Active" : "Off"}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-3)]">
        Comma-separated. We poll each subreddit hourly for new threads matching
        your keywords.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-[13px]">
          <span className="font-medium text-[var(--color-text-2)]">Subreddits</span>
          <input
            name="subreddits"
            defaultValue={watchlist.subreddits.join(", ")}
            placeholder="SaaS, startups, sales, marketing"
            className="w-full rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-[14px] text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
          />
        </label>
        <label className="grid gap-1.5 text-[13px]">
          <span className="font-medium text-[var(--color-text-2)]">Keywords</span>
          <input
            name="keywords"
            defaultValue={watchlist.keywords.join(", ")}
            placeholder="cold email, outbound, lead gen tools"
            className="w-full rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-[14px] text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <PendingSubmitButton
          className="btn-solid-sm"
          icon="save"
          iconSize={12}
          pendingLabel="Saving"
        >
          Save watchlist
        </PendingSubmitButton>
      </div>
    </form>
  );
}

function ThreadCard({ thread }: { thread: RedditThread }) {
  return (
    <li className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--color-brand-pink)] text-[#9a0103]">
          <Icon name="campaign" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-[var(--color-text-1)]">
            {thread.title}
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-3)]">
            r/{thread.subreddit || "unknown"}
            {thread.author ? ` · u/${thread.author}` : ""}
            {" · "}
            {relativeWhen(thread.ingested_at)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-text-3)]">
            {thread.score != null ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="auto_graph" size={11} />
                {thread.score}
              </span>
            ) : null}
            {thread.num_comments != null ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="forum" size={11} />
                {thread.num_comments}
              </span>
            ) : null}
            {thread.matched_keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)]"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
        {thread.url ? (
          <a
            href={thread.url}
            target="_blank"
            rel="noreferrer"
            className="btn-quiet-sm shrink-0"
          >
            <Icon name="arrow_forward" size={12} />
            Open
          </a>
        ) : null}
      </div>
    </li>
  );
}

function RedditNoThreads({ hasWatchlist }: { hasWatchlist: boolean }) {
  return (
    <EmptyState
      title={hasWatchlist ? "No threads yet — first poll pending" : "Set a watchlist first"}
      hint={
        hasWatchlist
          ? "We check every hour. New threads matching your keywords will land here."
          : "Add a few subreddits and keywords to start watching."
      }
    />
  );
}

function RedditEmpty() {
  return <EmptyState title="No workspace loaded" />;
}

function relativeWhen(at: Date): string {
  const diffMs = Date.now() - new Date(at).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
