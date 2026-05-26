import type {
  CatalogAdapter,
  CatalogPollInput,
  CatalogPollResult,
} from "./types.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Greenhouse public job board adapter. Free API, no auth.
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 *
 * Returns every active job posting. There's no "since" cursor — we treat
 * the API as a snapshot and diff against `last_external_ids` to detect
 * new + expired postings.
 *
 * Field mapping → RawCandidate:
 *   external_id        = job.id (number → string)
 *   title              = job.title
 *   content            = strip HTML from job.content
 *   url                = job.absolute_url
 *   structured         = { departments, offices, location, function, seniority }
 *   freshness_at       = job.updated_at
 *   provenance         = subset of the raw payload for forensics
 *   novelty_hint       = { domain: company.domain }
 */

const BASE_URL = "https://boards-api.greenhouse.io/v1";

interface GreenhouseJob {
  id: number;
  title: string;
  content?: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
  departments?: Array<{ id: number; name: string }>;
  offices?: Array<{ id: number; name: string }>;
}

interface GreenhouseListResponse {
  jobs: GreenhouseJob[];
  meta?: { total: number };
}

export class GreenhouseError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`Greenhouse API: ${message} (status ${status})`);
    this.name = "GreenhouseError";
    this.status = status;
  }
}

export const greenhouseAdapter: CatalogAdapter = {
  id: "greenhouse",
  kindHint: "hiring",
  companyKeyColumn: "greenhouse_id",

  async poll(input: CatalogPollInput): Promise<CatalogPollResult> {
    if (!input.company.greenhouse_id) {
      return { items: [], cursor: input.cursor, external_ids_seen: [] };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `${BASE_URL}/boards/${encodeURIComponent(input.company.greenhouse_id)}/jobs?content=true`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new GreenhouseError(
        `failed to fetch ${input.company.greenhouse_id}`,
        response.status,
      );
    }
    const json = (await response.json()) as GreenhouseListResponse;
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    const items: RawCandidate[] = [];
    const external_ids_seen: string[] = [];
    for (const job of jobs) {
      if (job.id == null || !job.title) continue;
      const external_id = String(job.id);
      external_ids_seen.push(external_id);

      const structured = extractStructured(job);

      items.push({
        external_id,
        title: job.title,
        content: job.content ? stripHtml(job.content) : undefined,
        url: job.absolute_url,
        structured,
        freshness_at: job.updated_at ?? new Date().toISOString(),
        provenance: {
          adapter: "greenhouse",
          company_id: input.company.id,
          greenhouse_slug: input.company.greenhouse_id,
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

function extractStructured(job: GreenhouseJob): Record<string, unknown> {
  const departments = (job.departments ?? []).map((d) => d.name).filter(Boolean);
  const offices = (job.offices ?? []).map((o) => o.name).filter(Boolean);
  const location = job.location?.name;
  return {
    departments,
    offices,
    location,
    function: inferFunction(departments, job.title),
    seniority: inferSeniority(job.title),
  };
}

// Order matters: more specific keywords first. `designer` precedes the
// marketing regex because "Brand Designer" should classify as design,
// not as marketing-brand. Conversely "Brand Manager" should land in
// marketing — so `brand` only appears under marketing.
const FUNCTION_KEYWORDS: Array<[string, RegExp]> = [
  ["engineering", /(engineer|developer|software|platform|infra|sre|data)/i],
  ["product", /(product\s*manager|product\s*designer|product\s*lead)/i],
  ["design", /(designer|\bux\b|\bui\b)/i],
  ["sales", /(sales|account|business\s*development|bdr|sdr)/i],
  ["marketing", /(marketing|growth|\bbrand\b|content)/i],
  ["operations", /(operations|ops|finance|legal|\bhr\b|people)/i],
  ["support", /(support|customer\s*success|\bcs\b)/i],
];

function inferFunction(departments: string[], title: string): string | null {
  const haystack = [departments.join(" "), title].join(" ").toLowerCase();
  for (const [name, re] of FUNCTION_KEYWORDS) {
    if (re.test(haystack)) return name;
  }
  return null;
}

const SENIORITY_RULES: Array<[string, RegExp]> = [
  ["c_level", /\b(chief|cxo|ceo|cto|cfo|coo|cmo|cro|cpo)\b/i],
  ["vp", /\b(vp|vice\s*president)\b/i],
  ["director", /\b(director|head\s*of)\b/i],
  ["principal", /\b(principal|distinguished)\b/i],
  ["staff", /\b(staff)\b/i],
  ["senior", /\b(senior|sr\.)\b/i],
  ["lead", /\b(lead|team\s*lead)\b/i],
  ["mid", /\b(mid\s*level|ii\b|iii\b)\b/i],
  ["junior", /\b(junior|jr\.|entry\s*level|intern)\b/i],
];

function inferSeniority(title: string): string | null {
  for (const [level, re] of SENIORITY_RULES) {
    if (re.test(title)) return level;
  }
  return null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
