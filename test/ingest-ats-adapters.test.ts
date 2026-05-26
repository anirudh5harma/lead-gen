import { test } from "node:test";
import assert from "node:assert/strict";
import { leverAdapter, LeverError } from "../core/ingest/adapters/lever.ts";
import { ashbyAdapter, AshbyError } from "../core/ingest/adapters/ashby.ts";
import {
  workableAdapter,
  WorkableError,
} from "../core/ingest/adapters/workable.ts";
import type { TrackedCompany } from "../core/ingest/catalog.ts";
import {
  catalogAdapters,
  listCatalogAdapterIds,
} from "../core/ingest/adapters/registry.ts";

function company(overrides: Partial<TrackedCompany> = {}): TrackedCompany {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Stripe",
    domain: "stripe.com",
    industry: "fintech",
    size_bucket: "500+",
    greenhouse_id: null,
    lever_id: null,
    ashby_id: null,
    workable_id: null,
    career_rss_url: null,
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

// ─── Registry sanity ──────────────────────────────────────────────────────

test("registry: all four ATS adapters are registered with kindHint='hiring'", () => {
  assert.deepEqual(
    listCatalogAdapterIds().sort(),
    ["ashby", "greenhouse", "lever", "workable"],
  );
  for (const id of ["greenhouse", "lever", "ashby", "workable"]) {
    assert.equal(catalogAdapters[id].kindHint, "hiring");
  }
});

// ─── Lever ────────────────────────────────────────────────────────────────

test("lever adapter: maps a typical posting array (no envelope)", async () => {
  let captured: string | null = null;
  const fetchImpl = (async (url: string) => {
    captured = url;
    return jsonResponse([
      {
        id: "post-1",
        text: "Senior Backend Engineer",
        hostedUrl: "https://jobs.lever.co/stripe/post-1",
        createdAt: 1714579200000,
        updatedAt: 1716998400000,
        descriptionPlain: "Build robust services.",
        categories: {
          team: "Platform",
          department: "Engineering",
          location: "Remote — Americas",
          commitment: "Full-time",
          allLocations: ["Remote — Americas", "New York"],
        },
      },
    ]);
  }) as unknown as typeof fetch;

  const result = await leverAdapter.poll({
    company: company({ lever_id: "stripe" }),
    cursor: {},
    fetchImpl,
  });

  assert.equal(captured, "https://api.lever.co/v0/postings/stripe?mode=json");
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.external_id, "post-1");
  assert.equal(item.title, "Senior Backend Engineer");
  assert.equal(item.url, "https://jobs.lever.co/stripe/post-1");
  assert.equal(item.content, "Build robust services.");
  assert.equal(item.freshness_at, new Date(1716998400000).toISOString());
  const s = item.structured as {
    function: string | null;
    seniority: string | null;
    departments: string[];
    location: string;
  };
  assert.equal(s.function, "engineering");
  assert.equal(s.seniority, "senior");
  assert.deepEqual(s.departments, ["Engineering", "Platform"]);
  assert.equal(s.location, "Remote — Americas");
  assert.deepEqual(result.external_ids_seen, ["post-1"]);
});

test("lever adapter: empty lever_id skips the network", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse([]);
  }) as unknown as typeof fetch;
  const result = await leverAdapter.poll({
    company: company({ lever_id: null }),
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 0);
  assert.equal(calls, 0);
});

test("lever adapter: non-2xx throws LeverError", async () => {
  const fetchImpl = (async () =>
    new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    leverAdapter.poll({
      company: company({ lever_id: "stripe" }),
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof LeverError && err.status === 500,
  );
});

// ─── Ashby ────────────────────────────────────────────────────────────────

test("ashby adapter: maps jobs envelope and prefers descriptionPlain", async () => {
  let captured: string | null = null;
  const fetchImpl = (async (url: string) => {
    captured = url;
    return jsonResponse({
      apiVersion: "1",
      jobs: [
        {
          id: "ashby-1",
          title: "Staff Designer",
          descriptionPlain: "Lead a small design team.",
          descriptionHtml: "<p>Lead a small <em>design</em> team.</p>",
          location: "San Francisco",
          isRemote: false,
          department: "Design",
          team: "Brand",
          jobUrl: "https://jobs.ashbyhq.com/stripe/ashby-1",
          publishedAt: "2026-05-20T00:00:00Z",
          employmentType: "FullTime",
          compensation: { min: 200000, max: 260000, currency: "USD" },
        },
      ],
    });
  }) as unknown as typeof fetch;

  const result = await ashbyAdapter.poll({
    company: company({ ashby_id: "stripe" }),
    cursor: {},
    fetchImpl,
  });

  assert.equal(
    captured,
    "https://api.ashbyhq.com/posting-api/job-board/stripe?includeCompensation=true",
  );
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.external_id, "ashby-1");
  // descriptionPlain wins over descriptionHtml.
  assert.equal(item.content, "Lead a small design team.");
  const s = item.structured as {
    function: string | null;
    seniority: string | null;
    departments: string[];
    is_remote: boolean;
    employment_type: string;
  };
  assert.equal(s.function, "design");
  assert.equal(s.seniority, "staff");
  assert.deepEqual(s.departments, ["Design", "Brand"]);
  assert.equal(s.is_remote, false);
  assert.equal(s.employment_type, "FullTime");
});

test("ashby adapter: empty ashby_id skips the network", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ jobs: [] });
  }) as unknown as typeof fetch;
  await ashbyAdapter.poll({
    company: company({ ashby_id: null }),
    cursor: {},
    fetchImpl,
  });
  assert.equal(calls, 0);
});

test("ashby adapter: falls back to descriptionHtml strip when plain missing", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      jobs: [
        {
          id: "ashby-2",
          title: "Senior Software Engineer",
          descriptionHtml: "<p>Hi <strong>there</strong>.</p><br/><p>Join us.</p>",
          publishedAt: "2026-05-21T00:00:00Z",
        },
      ],
    })) as unknown as typeof fetch;
  const result = await ashbyAdapter.poll({
    company: company({ ashby_id: "stripe" }),
    cursor: {},
    fetchImpl,
  });
  assert.match(result.items[0].content ?? "", /Hi there\./);
  assert.ok(!(result.items[0].content ?? "").includes("<"));
});

test("ashby adapter: non-2xx throws AshbyError", async () => {
  const fetchImpl = (async () =>
    new Response("nope", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    ashbyAdapter.poll({
      company: company({ ashby_id: "stripe" }),
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof AshbyError && err.status === 404,
  );
});

// ─── Workable ─────────────────────────────────────────────────────────────

test("workable adapter: maps published jobs only; closed states are omitted", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      total: 3,
      results: [
        {
          id: "wk-1",
          title: "VP of Engineering",
          state: "published",
          department: "Engineering",
          function: "Engineering",
          city: "San Francisco",
          region: "CA",
          country: "US",
          published_on: "2026-05-22T00:00:00Z",
          application_url: "https://apply.workable.com/stripe/j/WK1/",
        },
        {
          id: "wk-2",
          title: "Senior Recruiter",
          state: "closed",
          department: "People",
        },
        {
          id: "wk-3",
          title: "Account Executive — Enterprise",
          state: "published",
          department: "Sales",
          function: "Sales",
          published_on: "2026-05-22T00:00:00Z",
        },
      ],
    })) as unknown as typeof fetch;

  const result = await workableAdapter.poll({
    company: company({ workable_id: "stripe" }),
    cursor: {},
    fetchImpl,
  });
  // Closed job filtered out.
  assert.deepEqual(result.external_ids_seen.sort(), ["wk-1", "wk-3"]);
  const vp = result.items.find((i) => i.external_id === "wk-1")!;
  assert.equal((vp.structured as { seniority: string }).seniority, "vp");
  assert.equal((vp.structured as { function: string }).function, "engineering");
  assert.match(
    (vp.structured as { location: string }).location,
    /San Francisco/,
  );

  const ae = result.items.find((i) => i.external_id === "wk-3")!;
  assert.equal((ae.structured as { function: string }).function, "sales");
});

test("workable adapter: non-2xx throws WorkableError", async () => {
  const fetchImpl = (async () =>
    new Response("rate-limited", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(
    workableAdapter.poll({
      company: company({ workable_id: "stripe" }),
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof WorkableError && err.status === 429,
  );
});
