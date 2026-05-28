import type {
  CatalogAdapter,
  CatalogPollInput,
  CatalogPollResult,
} from "./types.ts";
import type { RawCandidate } from "../types.ts";
import type { SignalKind } from "../../primitives/signal.ts";

/**
 * SEC EDGAR adapter. Polls per-company submissions via the official
 * data.sec.gov JSON endpoint.
 *
 *   GET https://data.sec.gov/submissions/CIK<10-digit-padded-cik>.json
 *
 * Requires a `User-Agent` header identifying the platform (SEC's fair-use
 * policy). The response includes `filings.recent.{accessionNumber, form,
 * items, filingDate, primaryDocument, reportDate, ...}` parallel arrays.
 *
 * Per-item kind mapping (this is why the adapter declares no static
 * kindHint — each filing's kind depends on its form + 8-K item code):
 *
 *   form S-1, S-1/A      → 'funding'             (IPO)
 *   form S-4, S-4/A      → 'acquisition'         (M&A registration)
 *   form 8-K, item 1.01  → 'other'               (material agreement; skipped)
 *   form 8-K, item 2.01  → 'acquisition'         (completed acquisition)
 *   form 8-K, item 2.03  → 'funding'             (material financial obligation)
 *   form 8-K, item 5.02  → 'leadership_change'   (officer departure / election)
 *   anything else        → skipped (we don't want every 10-K)
 *
 * The adapter is conservative — emits only filings where the kind is
 * confidently inferable. The remaining 80% of SEC noise stays out of the
 * pool.
 */

const BASE_URL = "https://data.sec.gov/submissions";

interface SecRecentFilings {
  accessionNumber: string[];
  form: string[];
  items: string[];
  filingDate: string[];
  reportDate: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

interface SecSubmissionsResponse {
  name?: string;
  cik?: string;
  tickers?: string[];
  filings?: { recent?: SecRecentFilings };
}

export class SecEdgarError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`SEC EDGAR API: ${message} (status ${status})`);
    this.name = "SecEdgarError";
    this.status = status;
  }
}

interface ItemMapping {
  kind: SignalKind;
  title: string;
}

const FORM_KIND: Record<string, SignalKind | null> = {
  "S-1": "funding",
  "S-1/A": "funding",
  "S-4": "acquisition",
  "S-4/A": "acquisition",
};

// 8-K item codes worth a signal. Item codes are dot-decimals: "1.01",
// "2.01", "5.02", etc. The JSON `items` field is a comma-separated list
// of these. We pick the highest-value item per filing.
const ITEM_8K: Record<string, ItemMapping> = {
  "2.01": { kind: "acquisition", title: "Completed acquisition or disposition of assets" },
  "2.03": { kind: "funding", title: "Material financial obligation" },
  "5.02": { kind: "leadership_change", title: "Officer departure or election" },
};

interface ResolvedKind {
  kind: SignalKind;
  detail: string;
}

function resolveKind(form: string, items: string): ResolvedKind | null {
  const formKind = FORM_KIND[form.toUpperCase()];
  if (formKind) {
    return { kind: formKind, detail: form };
  }
  if (form.toUpperCase() !== "8-K" || !items) return null;
  const codes = items
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer leadership_change > acquisition > funding when a filing has
  // multiple. (Officer changes are the highest-quality outbound signal.)
  const priority: SignalKind[] = ["leadership_change", "acquisition", "funding"];
  for (const want of priority) {
    for (const code of codes) {
      const mapping = ITEM_8K[code];
      if (mapping && mapping.kind === want) {
        return { kind: mapping.kind, detail: `8-K item ${code} — ${mapping.title}` };
      }
    }
  }
  return null;
}

function paddedCik(cik: string): string {
  return cik.replace(/^0+/, "").padStart(10, "0");
}

export const secEdgarAdapter: CatalogAdapter = {
  id: "sec_edgar",
  // Per-item kind; the adapter sets item.kind directly so the pipeline
  // doesn't fall back to anything.
  kindHint: null,
  companyKeyColumn: "sec_cik",

  async poll(input: CatalogPollInput): Promise<CatalogPollResult> {
    if (!input.company.sec_cik) {
      return { items: [], cursor: input.cursor, external_ids_seen: [] };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = `${BASE_URL}/CIK${paddedCik(input.company.sec_cik)}.json`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        // SEC requires a UA identifying the requester. Configurable via
        // env so deployments can use their own contact.
        "User-Agent":
          process.env.SEC_EDGAR_USER_AGENT ??
          "Bombsell pivot-v2 ingest (contact@bombsell.test)",
      },
    });
    if (!response.ok) {
      throw new SecEdgarError(
        `failed to fetch CIK ${input.company.sec_cik}`,
        response.status,
      );
    }
    const json = (await response.json()) as SecSubmissionsResponse;
    const recent = json.filings?.recent;
    if (!recent || !Array.isArray(recent.accessionNumber)) {
      return {
        items: [],
        cursor: { last_polled_at: new Date().toISOString(), count: 0 },
        external_ids_seen: [],
      };
    }

    const items: RawCandidate[] = [];
    const external_ids_seen: string[] = [];
    const len = recent.accessionNumber.length;
    for (let i = 0; i < len; i++) {
      const accession = recent.accessionNumber[i];
      const form = recent.form[i] ?? "";
      const itemsField = recent.items[i] ?? "";
      const filingDate = recent.filingDate[i] ?? "";
      const primaryDoc = recent.primaryDocument[i] ?? "";
      if (!accession || !form) continue;

      const resolved = resolveKind(form, itemsField);
      if (!resolved) continue;

      external_ids_seen.push(accession);
      const detail = resolved.detail;
      const company = json.name ?? input.company.name;
      const title = `${company} — ${form}${itemsField ? ` (${itemsField})` : ""}`;
      const url = primaryDoc
        ? `https://www.sec.gov/Archives/edgar/data/${paddedCik(
            input.company.sec_cik!,
          ).replace(/^0+/, "")}/${accession.replace(/-/g, "")}/${primaryDoc}`
        : undefined;
      items.push({
        external_id: accession,
        kind: resolved.kind,
        title,
        content: detail,
        url,
        structured: {
          form,
          items: itemsField,
          tickers: json.tickers ?? [],
          report_date: recent.reportDate[i] ?? null,
        },
        freshness_at: filingDate
          ? new Date(`${filingDate}T00:00:00Z`).toISOString()
          : new Date().toISOString(),
        provenance: {
          adapter: "sec_edgar",
          company_id: input.company.id,
          cik: paddedCik(input.company.sec_cik!),
          accession,
          form,
          items: itemsField,
        },
        novelty_hint: { domain: input.company.domain ?? undefined },
      });
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: items.length },
      external_ids_seen,
    };
  },
};

// Exported for tests that want to exercise the parsing without HTTP.
export { resolveKind, paddedCik };
