import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Multi-subreddit + keyword Reddit search adapter. Workspace-driven, free.
 *
 *   config: {
 *     subreddits: string[],
 *     keywords?: string[],       // OR-joined; empty = all posts in sub
 *     limit_per_sub?: number,    // default 25
 *   }
 *
 * Reddit blocks default User-Agents; polite UA via REDDIT_USER_AGENT env.
 * Each poll walks every subreddit; per-thread items carry matched keywords
 * in `structured` for downstream classification + UI highlighting.
 */

interface RedditPostData {
  id: string;
  name?: string;
  title?: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  author?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  subreddit?: string;
  domain?: string;
  link_flair_text?: string;
}

interface RedditListing {
  data?: { children?: Array<{ kind: string; data?: RedditPostData }> };
}

export const redditSearchAdapter: WorkspaceAdapter = {
  id: "reddit_search",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const cfg = input.source.config as {
      subreddits?: string[];
      keywords?: string[];
      limit_per_sub?: number;
    };
    const subreddits = (cfg.subreddits ?? []).filter(Boolean).slice(0, 20);
    if (subreddits.length === 0) {
      return { items: [], cursor: input.cursor };
    }
    const keywords = (cfg.keywords ?? [])
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const limitPerSub = Math.min(50, Math.max(1, cfg.limit_per_sub ?? 25));
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const query = keywords.length > 0 ? keywords.join(" OR ") : null;

    const items: RawCandidate[] = [];
    for (const sub of subreddits) {
      const url = query
        ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=${limitPerSub}`
        : `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limitPerSub}`;
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            process.env.REDDIT_USER_AGENT ??
            "Bombsell-pivot-v2-ingest/1.0 (https://bombsell.test)",
        },
      });
      if (!response.ok) {
        // Skip failing sub; keep going. Cursor error surface handled upstream.
        continue;
      }
      const json = (await response.json()) as RedditListing;
      const children = json.data?.children ?? [];
      for (const child of children) {
        const post = child?.data;
        if (!post?.id || !post.title) continue;
        const matched =
          keywords.length === 0
            ? []
            : keywords.filter((keyword) =>
                matchesKeyword(post, keyword),
              );
        if (keywords.length > 0 && matched.length === 0) continue;
        const permalink = post.permalink
          ? `https://www.reddit.com${post.permalink}`
          : undefined;
        items.push({
          external_id: post.name ?? post.id,
          title: post.title,
          content: post.selftext,
          url: permalink ?? post.url,
          structured: {
            subreddit: post.subreddit ?? sub,
            author: post.author ?? null,
            score: post.score ?? null,
            num_comments: post.num_comments ?? null,
            domain: post.domain ?? null,
            flair: post.link_flair_text ?? null,
            matched_keywords: matched,
          },
          freshness_at:
            typeof post.created_utc === "number"
              ? new Date(post.created_utc * 1000).toISOString()
              : new Date().toISOString(),
          provenance: {
            adapter: "reddit_search",
            channel: "reddit",
            subreddit: post.subreddit ?? sub,
            raw_id: post.id,
          },
        });
      }
    }

    return {
      items,
      cursor: {
        last_polled_at: new Date().toISOString(),
        count: items.length,
      },
    };
  },
};

function matchesKeyword(post: RedditPostData, keyword: string): boolean {
  const haystack = `${post.title ?? ""}\n${post.selftext ?? ""}`.toLowerCase();
  return haystack.includes(keyword);
}
