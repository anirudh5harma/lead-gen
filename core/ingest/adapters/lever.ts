import type {
  CatalogAdapter,
  CatalogPollInput,
  CatalogPollResult,
} from "./types.ts";
import type { RawCandidate } from "../types.ts";
import {
  inferFunction,
  inferSeniority,
  stripHtml,
} from "./_hiring-heuristics.ts";

/**
 * Lever public job board adapter. Free, no auth.
 *
 *   GET https://api.lever.co/v0/postings/<slug>?mode=json
 *
 * Returns an array of postings (no envelope). Mode `json` includes the
 * structured fields; `descriptionPlain` carries the plain-text body.
 */

const BASE_URL = "https://api.lever.co/v0/postings";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: {
    commitment?: string;
    location?: string;
    team?: string;
    department?: string;
    allLocations?: string[];
  };
}

export class LeverError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`Lever API: ${message} (status ${status})`);
    this.name = "LeverError";
    this.status = status;
  }
}

export const leverAdapter: CatalogAdapter = {
  id: "lever",
  kindHint: "hiring",
  companyKeyColumn: "lever_id",

  async poll(input: CatalogPollInput): Promise<CatalogPollResult> {
    if (!input.company.lever_id) {
      return { items: [], cursor: input.cursor, external_ids_seen: [] };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `${BASE_URL}/${encodeURIComponent(input.company.lever_id)}?mode=json`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new LeverError(
        `failed to fetch ${input.company.lever_id}`,
        response.status,
      );
    }
    const json = (await response.json()) as unknown;
    const postings = Array.isArray(json) ? (json as LeverPosting[]) : [];
    const items: RawCandidate[] = [];
    const external_ids_seen: string[] = [];
    for (const p of postings) {
      if (!p.id || !p.text) continue;
      external_ids_seen.push(p.id);
      const department = p.categories?.department ?? null;
      const team = p.categories?.team ?? null;
      const allDepartments = [department, team].filter(Boolean) as string[];
      const contentRaw = p.descriptionPlain ?? p.description ?? "";
      const content = p.descriptionPlain
        ? contentRaw
        : contentRaw
          ? stripHtml(contentRaw)
          : undefined;
      const freshness =
        typeof p.updatedAt === "number"
          ? new Date(p.updatedAt).toISOString()
          : typeof p.createdAt === "number"
            ? new Date(p.createdAt).toISOString()
            : new Date().toISOString();

      items.push({
        external_id: p.id,
        title: p.text,
        content,
        url: p.hostedUrl ?? p.applyUrl,
        structured: {
          departments: allDepartments,
          location: p.categories?.location ?? null,
          all_locations: p.categories?.allLocations ?? [],
          commitment: p.categories?.commitment ?? null,
          function: inferFunction([...allDepartments, p.text]),
          seniority: inferSeniority(p.text),
        },
        freshness_at: freshness,
        provenance: {
          adapter: "lever",
          company_id: input.company.id,
          lever_slug: input.company.lever_id,
          raw_id: p.id,
        },
        novelty_hint: { domain: input.company.domain ?? undefined },
      });
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: postings.length },
      external_ids_seen,
    };
  },
};
