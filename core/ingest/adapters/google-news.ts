import { rssAdapter } from "./rss.ts";
import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";

/**
 * Google News RSS adapter. Thin wrapper around the generic RSS adapter
 * that builds the right query URL from workspace config and provides a
 * sane default novelty_hint (no per-article domain extraction — Google
 * News rewrites links to its own domain).
 *
 *   config: {
 *     query:     string;
 *     hl?:       string;  // language, default 'en-US'
 *     gl?:       string;  // country, default 'US'
 *     ceid?:     string;  // combined edition id, default 'US:en'
 *   }
 *
 * kindHint: null. Stage 2 LLM classifies — Google News results span every
 * kind. Workspaces typically configure multiple Google News sources, one
 * per query (e.g., "stripe acquisition", "fintech IPO", "VP Engineering").
 */

export const googleNewsAdapter: WorkspaceAdapter = {
  id: "google_news",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const cfg = input.source.config as {
      query?: string;
      hl?: string;
      gl?: string;
      ceid?: string;
    };
    if (!cfg.query) return { items: [], cursor: input.cursor };
    const params = new URLSearchParams({
      q: cfg.query,
      hl: cfg.hl ?? "en-US",
      gl: cfg.gl ?? "US",
      ceid: cfg.ceid ?? "US:en",
    });
    const url = `https://news.google.com/rss/search?${params.toString()}`;
    return rssAdapter.poll({
      ...input,
      source: {
        ...input.source,
        config: { ...input.source.config, url, novelty_domain: undefined },
      },
    });
  },
};
