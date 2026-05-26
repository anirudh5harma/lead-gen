import type { CatalogAdapter } from "./types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";
import { workableAdapter } from "./workable.ts";

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
};

export function getCatalogAdapter(id: string): CatalogAdapter | undefined {
  return catalogAdapters[id];
}

export function listCatalogAdapterIds(): string[] {
  return Object.keys(catalogAdapters);
}
