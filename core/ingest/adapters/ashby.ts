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
 * Ashby public job board adapter. Free, no auth.
 *
 *   GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
 *
 * Returns `{ apiVersion, jobs: [{ id, title, descriptionHtml, location,
 * department, team, employmentType, jobUrl, publishedAt, ... }] }`.
 */

const BASE_URL = "https://api.ashbyhq.com/posting-api/job-board";

interface AshbyJob {
  id: string;
  title: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  location?: string;
  isRemote?: boolean;
  department?: string;
  team?: string;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  employmentType?: string;
  compensation?: unknown;
}

interface AshbyResponse {
  apiVersion?: string;
  jobs?: AshbyJob[];
}

export class AshbyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`Ashby API: ${message} (status ${status})`);
    this.name = "AshbyError";
    this.status = status;
  }
}

export const ashbyAdapter: CatalogAdapter = {
  id: "ashby",
  kindHint: "hiring",
  companyKeyColumn: "ashby_id",

  async poll(input: CatalogPollInput): Promise<CatalogPollResult> {
    if (!input.company.ashby_id) {
      return { items: [], cursor: input.cursor, external_ids_seen: [] };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `${BASE_URL}/${encodeURIComponent(input.company.ashby_id)}?includeCompensation=true`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new AshbyError(
        `failed to fetch ${input.company.ashby_id}`,
        response.status,
      );
    }
    const json = (await response.json()) as AshbyResponse;
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    const items: RawCandidate[] = [];
    const external_ids_seen: string[] = [];
    for (const job of jobs) {
      if (!job.id || !job.title) continue;
      external_ids_seen.push(job.id);
      const departments = [job.department, job.team].filter(Boolean) as string[];
      const content = job.descriptionPlain
        ? job.descriptionPlain
        : job.descriptionHtml
          ? stripHtml(job.descriptionHtml)
          : undefined;

      items.push({
        external_id: job.id,
        title: job.title,
        content,
        url: job.jobUrl ?? job.applyUrl,
        structured: {
          departments,
          location: job.location ?? null,
          is_remote: job.isRemote ?? false,
          employment_type: job.employmentType ?? null,
          compensation: job.compensation ?? null,
          function: inferFunction([...departments, job.title]),
          seniority: inferSeniority(job.title),
        },
        freshness_at: job.publishedAt ?? new Date().toISOString(),
        provenance: {
          adapter: "ashby",
          company_id: input.company.id,
          ashby_slug: input.company.ashby_id,
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
