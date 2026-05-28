import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Reddit subreddit adapter. Workspace-driven. Free, rate-limited.
 *
 *   GET https://www.reddit.com/r/<subreddit>/new.json?limit=N
 *
 *   config: { subreddit: string, limit?: number — default 50 }
 *
 * Reddit blocks default User-Agents; we set a polite one and let
 * deployments override via REDDIT_USER_AGENT env. kindHint is null —
 * subreddits are mixed; LLM classifies.
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
  domain?: string;
  link_flair_text?: string;
}

interface RedditListing {
  data?: { children?: Array<{ kind: string; data?: RedditPostData }> };
}

export class RedditError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`Reddit: ${message} (status ${status})`);
    this.name = "RedditError";
    this.status = status;
  }
}

export const redditAdapter: WorkspaceAdapter = {
  id: "reddit",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const cfg = input.source.config as { subreddit?: string; limit?: number };
    if (!cfg.subreddit) {
      return { items: [], cursor: input.cursor };
    }
    const limit = cfg.limit ?? 50;
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `https://www.reddit.com/r/${encodeURIComponent(cfg.subreddit)}/new.json?limit=${limit}`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          process.env.REDDIT_USER_AGENT ??
          "Bombsell-pivot-v2-ingest/1.0 (https://bombsell.test)",
      },
    });
    if (!response.ok) {
      throw new RedditError(`fetch /r/${cfg.subreddit} failed`, response.status);
    }
    const json = (await response.json()) as RedditListing;
    const children = json.data?.children ?? [];
    const items: RawCandidate[] = [];
    for (const child of children) {
      const post = child?.data;
      if (!post?.id || !post.title) continue;
      const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : undefined;
      items.push({
        external_id: post.name ?? post.id,
        title: post.title,
        content: post.selftext,
        url: permalink ?? post.url,
        structured: {
          subreddit: cfg.subreddit,
          author: post.author ?? null,
          score: post.score ?? null,
          comments: post.num_comments ?? null,
          domain: post.domain ?? null,
          flair: post.link_flair_text ?? null,
        },
        freshness_at:
          typeof post.created_utc === "number"
            ? new Date(post.created_utc * 1000).toISOString()
            : new Date().toISOString(),
        provenance: { adapter: "reddit", subreddit: cfg.subreddit, raw_id: post.id },
      });
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: items.length },
    };
  },
};
