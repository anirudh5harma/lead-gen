import type { CatalogAdapter } from "./types.ts";
import type { WorkspaceAdapter } from "./_workspace-types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";
import { workableAdapter } from "./workable.ts";
import { secEdgarAdapter } from "./sec-edgar.ts";
import { rssAdapter } from "./rss.ts";
import { hnFrontAdapter } from "./hn-front.ts";
import { hnWhosHiringAdapter } from "./hn-whos-hiring.ts";
import { productHuntAdapter } from "./product-hunt.ts";
import { redditAdapter } from "./reddit.ts";
import { googleNewsAdapter } from "./google-news.ts";
import { xSearchAdapter } from "./x-search.ts";

/**
 * Adapter registry. Lookup by id. Adapters are registered statically here
 * so the poll workflow can find them by the `adapter` column on
 * platform_signal_sources.
 *
 * New adapters land by being added to `catalogAdapters` (or
 * `workspaceAdapters` when that exists in a later commit).
 */

export const catalogAdapters: Record<string, CatalogAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workable: workableAdapter,
  sec_edgar: secEdgarAdapter,
};

export function getCatalogAdapter(id: string): CatalogAdapter | undefined {
  return catalogAdapters[id];
}

export function listCatalogAdapterIds(): string[] {
  return Object.keys(catalogAdapters);
}

// ─── Workspace adapters ───────────────────────────────────────────────────

export const workspaceAdapters: Record<string, WorkspaceAdapter> = {
  rss: rssAdapter,
  hn_front: hnFrontAdapter,
  hn_whos_hiring: hnWhosHiringAdapter,
  product_hunt: productHuntAdapter,
  reddit: redditAdapter,
  google_news: googleNewsAdapter,
  x_search: xSearchAdapter,
};

export function getWorkspaceAdapter(id: string): WorkspaceAdapter | undefined {
  return workspaceAdapters[id];
}

export function listWorkspaceAdapterIds(): string[] {
  return Object.keys(workspaceAdapters);
}
