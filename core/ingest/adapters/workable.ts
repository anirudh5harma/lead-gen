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
 * Workable public job board adapter. Free, no auth.
 *
 *   GET https://apply.workable.com/api/v3/accounts/<slug>/jobs/
 *
 * Returns `{ total, results: [{ id, title, shortcode, code, state, full_title,
 * description, requirements, benefits, employment_type, country, city,
 * department, function, application_url, ... }] }`.
 *
 * Only items with state='published' are surfaced; closed jobs return as
 * state='closed' and we treat them as expired by NOT including them in the
 * external_ids_seen set.
 */

const BASE_URL = "https://apply.workable.com/api/v3/accounts";

interface WorkableJob {
  id: string;
  title: string;
  full_title?: string;
  shortcode?: string;
  state?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  employment_type?: string;
  country?: string;
  city?: string;
  region?: string;
  location?: { country?: string; city?: string; region?: string };
  department?: string;
  function?: string;
  application_url?: string;
  published_on?: string;
}

interface WorkableResponse {
  total?: number;
  results?: WorkableJob[];
}

export class WorkableError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`Workable API: ${message} (status ${status})`);
    this.name = "WorkableError";
    this.status = status;
  }
}

export const workableAdapter: CatalogAdapter = {
  id: "workable",
  kindHint: "hiring",
  companyKeyColumn: "workable_id",

  async poll(input: CatalogPollInput): Promise<CatalogPollResult> {
    if (!input.company.workable_id) {
      return { items: [], cursor: input.cursor, external_ids_seen: [] };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `${BASE_URL}/${encodeURIComponent(input.company.workable_id)}/jobs/`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new WorkableError(
        `failed to fetch ${input.company.workable_id}`,
        response.status,
      );
    }
    const json = (await response.json()) as WorkableResponse;
    const jobs = Array.isArray(json?.results) ? json.results : [];
    const items: RawCandidate[] = [];
    const external_ids_seen: string[] = [];
    for (const job of jobs) {
      if (!job.id || !job.title) continue;
      // Closed / drafted postings are treated as expired — leave them out
      // of external_ids_seen so the poll workflow's diff flips downstream
      // candidates to expired.
      if (job.state && job.state !== "published") continue;
      external_ids_seen.push(job.id);

      const departments = [job.department, job.function].filter(Boolean) as string[];
      const locationStr = [job.city, job.region, job.country]
        .filter(Boolean)
        .join(", ") || job.location?.city || undefined;
      const fullText = [job.description, job.requirements, job.benefits]
        .filter(Boolean)
        .join("\n\n");
      const content = fullText ? stripHtml(fullText) : undefined;

      items.push({
        external_id: job.id,
        title: job.title,
        content,
        url: job.application_url,
        structured: {
          departments,
          declared_function: job.function ?? null,
          location: locationStr,
          employment_type: job.employment_type ?? null,
          shortcode: job.shortcode ?? null,
          function: inferFunction([...departments, job.title, job.function ?? ""]),
          seniority: inferSeniority(job.title),
        },
        freshness_at: job.published_on ?? new Date().toISOString(),
        provenance: {
          adapter: "workable",
          company_id: input.company.id,
          workable_slug: input.company.workable_id,
          raw_id: job.id,
        },
        novelty_hint: { domain: input.company.domain ?? undefined },
      });
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: jobs.length },
      external_ids_seen,
    };
  },
};
