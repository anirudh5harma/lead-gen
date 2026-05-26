import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paddedCik,
  resolveKind,
  secEdgarAdapter,
  SecEdgarError,
} from "../core/ingest/adapters/sec-edgar.ts";
import type { TrackedCompany } from "../core/ingest/catalog.ts";

function company(overrides: Partial<TrackedCompany> = {}): TrackedCompany {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Stripe, Inc.",
    domain: "stripe.com",
    industry: "fintech",
    size_bucket: "500+",
    greenhouse_id: null,
    lever_id: null,
    ashby_id: null,
    workable_id: null,
    career_rss_url: null,
    sec_cik: null,
    properties: {},
    added_at: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

test("paddedCik: 10-digit zero-padded", () => {
  assert.equal(paddedCik("320193"), "0000320193");
  assert.equal(paddedCik("0000320193"), "0000320193");
  assert.equal(paddedCik("1"), "0000000001");
});

test("resolveKind: S-1 → funding", () => {
  assert.deepEqual(resolveKind("S-1", ""), { kind: "funding", detail: "S-1" });
  assert.deepEqual(resolveKind("S-1/A", ""), { kind: "funding", detail: "S-1/A" });
});

test("resolveKind: S-4 → acquisition", () => {
  assert.deepEqual(resolveKind("S-4", ""), { kind: "acquisition", detail: "S-4" });
});

test("resolveKind: 8-K item 5.02 wins over 2.01 (priority: leadership_change > acquisition > funding)", () => {
  const result = resolveKind("8-K", "2.01,5.02");
  assert.equal(result?.kind, "leadership_change");
  assert.match(result?.detail ?? "", /item 5\.02/);
});

test("resolveKind: 8-K item 2.01 → acquisition", () => {
  const result = resolveKind("8-K", "2.01");
  assert.equal(result?.kind, "acquisition");
});

test("resolveKind: 8-K item 2.03 → funding", () => {
  const result = resolveKind("8-K", "2.03");
  assert.equal(result?.kind, "funding");
});

test("resolveKind: 8-K with only uninteresting items returns null", () => {
  assert.equal(resolveKind("8-K", "1.01"), null);
  assert.equal(resolveKind("8-K", "8.01"), null);
});

test("resolveKind: form 10-K and 10-Q return null (skip noise)", () => {
  assert.equal(resolveKind("10-K", ""), null);
  assert.equal(resolveKind("10-Q", ""), null);
  assert.equal(resolveKind("4", ""), null);
});

// ─── Adapter end-to-end (mocked fetch) ─────────────────────────────────────

test("sec_edgar adapter: maps S-1 + 8-K item 5.02 + skips 10-K", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, unknown> = {};
  const fetchImpl = (async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = init.headers as Record<string, unknown>;
    return jsonResponse({
      name: "Stripe, Inc.",
      cik: "1234567",
      tickers: ["STRP"],
      filings: {
        recent: {
          accessionNumber: ["0001234567-26-000001", "0001234567-26-000002", "0001234567-26-000003"],
          form: ["S-1", "8-K", "10-K"],
          items: ["", "5.02", ""],
          filingDate: ["2026-05-20", "2026-05-22", "2026-05-23"],
          reportDate: ["", "2026-05-22", "2026-04-30"],
          primaryDocument: ["filing-s1.htm", "filing-8k.htm", "annual-report.htm"],
          primaryDocDescription: ["S-1", "8-K", "10-K"],
        },
      },
    });
  }) as unknown as typeof fetch;

  const result = await secEdgarAdapter.poll({
    company: company({ sec_cik: "1234567" }),
    cursor: {},
    fetchImpl,
  });

  assert.equal(capturedUrl, "https://data.sec.gov/submissions/CIK0001234567.json");
  // SEC requires a UA — we should have one.
  assert.ok(String(capturedHeaders["User-Agent"]).length > 0);

  // S-1 + 8-K item 5.02 surface; 10-K is filtered out.
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.external_ids_seen.sort(), [
    "0001234567-26-000001",
    "0001234567-26-000002",
  ]);

  const s1 = result.items.find((i) => i.external_id === "0001234567-26-000001")!;
  assert.equal(s1.kind, "funding");
  assert.match(s1.title, /Stripe.*S-1/);
  assert.match(String(s1.url), /\/Archives\/edgar\/data\/1234567\//);

  const eightK = result.items.find((i) => i.external_id === "0001234567-26-000002")!;
  assert.equal(eightK.kind, "leadership_change");
  assert.match(eightK.content ?? "", /item 5\.02/);
  assert.equal((eightK.structured as { form: string }).form, "8-K");
});

test("sec_edgar adapter: empty sec_cik skips the network entirely", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  await secEdgarAdapter.poll({
    company: company({ sec_cik: null }),
    cursor: {},
    fetchImpl,
  });
  assert.equal(calls, 0);
});

test("sec_edgar adapter: non-2xx throws SecEdgarError", async () => {
  const fetchImpl = (async () =>
    new Response("rate-limited", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(
    secEdgarAdapter.poll({
      company: company({ sec_cik: "1234567" }),
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof SecEdgarError && err.status === 429,
  );
});

test("sec_edgar adapter: missing filings.recent returns empty result, not error", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ name: "Empty Co", cik: "1234567" })) as unknown as typeof fetch;
  const result = await secEdgarAdapter.poll({
    company: company({ sec_cik: "1234567" }),
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.external_ids_seen, []);
});
