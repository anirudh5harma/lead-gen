import type { CatalogAdapter } from "./types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";

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
};

export function getCatalogAdapter(id: string): CatalogAdapter | undefined {
  return catalogAdapters[id];
}

export function listCatalogAdapterIds(): string[] {
  return Object.keys(catalogAdapters);
}
