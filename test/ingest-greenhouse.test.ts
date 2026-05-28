import { test } from "node:test";
import assert from "node:assert/strict";
import {
  greenhouseAdapter,
  GreenhouseError,
  stripHtml,
} from "../core/ingest/adapters/greenhouse.ts";
import type { TrackedCompany } from "../core/ingest/catalog.ts";

function fakeCompany(slug = "stripe"): TrackedCompany {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Stripe",
    domain: "stripe.com",
    industry: "fintech",
    size_bucket: "500+",
    greenhouse_id: slug,
    lever_id: null,
    ashby_id: null,
    workable_id: null,
    career_rss_url: null,
    properties: {},
    added_at: "2026-05-25T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("greenhouse adapter: maps a typical job payload to RawCandidate", async () => {
  let captured: string | null = null;
  const fetchImpl = (async (url: string) => {
    captured = url;
    return jsonResponse({
      jobs: [
        {
          id: 4242,
          title: "Staff Platform Engineer, Payments Infra",
          content: "<p>Build the platform that moves money.</p><br/><p>5+ years experience.</p>",
          absolute_url: "https://boards.greenhouse.io/stripe/jobs/4242",
          updated_at: "2026-05-24T10:00:00Z",
          location: { name: "San Francisco, CA" },
          departments: [{ id: 1, name: "Engineering" }],
          offices: [{ id: 10, name: "San Francisco" }],
        },
      ],
    });
  }) as unknown as typeof fetch;

  const result = await greenhouseAdapter.poll({
    company: fakeCompany(),
    cursor: {},
    fetchImpl,
  });

  assert.equal(captured, "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true");
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.external_id, "4242");
  assert.equal(item.title, "Staff Platform Engineer, Payments Infra");
  assert.match(item.content ?? "", /Build the platform/);
  assert.equal(item.url, "https://boards.greenhouse.io/stripe/jobs/4242");
  assert.equal(item.freshness_at, "2026-05-24T10:00:00Z");

  const s = item.structured as {
    function: string | null;
    seniority: string | null;
    departments: string[];
    location: string;
  };
  assert.equal(s.function, "engineering");
  assert.equal(s.seniority, "staff");
  assert.deepEqual(s.departments, ["Engineering"]);
  assert.equal(s.location, "San Francisco, CA");

  assert.deepEqual(result.external_ids_seen, ["4242"]);
  assert.equal((item.novelty_hint as { domain?: string }).domain, "stripe.com");
});

test("greenhouse adapter: extracts engineering vs sales function from departments + title", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      jobs: [
        {
          id: 1,
          title: "Senior Account Executive",
          updated_at: "2026-05-24T00:00:00Z",
          departments: [{ id: 1, name: "Sales" }],
        },
        {
          id: 2,
          title: "Lead Brand Designer",
          updated_at: "2026-05-24T00:00:00Z",
          departments: [{ id: 2, name: "Design" }],
        },
        {
          id: 3,
          title: "Marketing Operations Manager",
          updated_at: "2026-05-24T00:00:00Z",
          departments: [],
        },
      ],
    })) as unknown as typeof fetch;

  const result = await greenhouseAdapter.poll({
    company: fakeCompany(),
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 3);
  const fns = result.items.map((i) => (i.structured as { function: string | null }).function);
  assert.deepEqual(fns, ["sales", "design", "marketing"]);
});

test("greenhouse adapter: empty greenhouse_id returns no items, no network", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ jobs: [] });
  }) as unknown as typeof fetch;
  const result = await greenhouseAdapter.poll({
    company: { ...fakeCompany(), greenhouse_id: null },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 0);
  assert.equal(calls, 0);
});

test("greenhouse adapter: non-2xx throws GreenhouseError with status", async () => {
  const fetchImpl = (async () =>
    new Response("not found", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    greenhouseAdapter.poll({ company: fakeCompany(), cursor: {}, fetchImpl }),
    (err) => err instanceof GreenhouseError && err.status === 404,
  );
});

test("greenhouse adapter: skips jobs with missing id or title", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      jobs: [
        { id: 1, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" },
        { id: null, title: "No id" },
        { id: 2, title: "" },
      ],
    })) as unknown as typeof fetch;
  const result = await greenhouseAdapter.poll({
    company: fakeCompany(),
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, "1");
});

test("greenhouse adapter: seniority heuristic", async () => {
  const titles = [
    { id: 1, title: "Chief Technology Officer", expected: "c_level" },
    { id: 2, title: "VP of Engineering", expected: "vp" },
    { id: 3, title: "Head of Platform", expected: "director" },
    { id: 4, title: "Principal Software Engineer", expected: "principal" },
    { id: 5, title: "Staff Backend Engineer", expected: "staff" },
    { id: 6, title: "Senior Site Reliability Engineer", expected: "senior" },
    { id: 7, title: "Engineering Lead", expected: "lead" },
    { id: 8, title: "Software Engineer II", expected: "mid" },
    { id: 9, title: "Junior Software Engineer", expected: "junior" },
    { id: 10, title: "Software Engineer", expected: null },
  ];
  const fetchImpl = (async () =>
    jsonResponse({
      jobs: titles.map((t) => ({
        id: t.id,
        title: t.title,
        updated_at: "2026-05-24T00:00:00Z",
      })),
    })) as unknown as typeof fetch;
  const result = await greenhouseAdapter.poll({
    company: fakeCompany(),
    cursor: {},
    fetchImpl,
  });
  for (let i = 0; i < titles.length; i++) {
    const sen = (result.items[i].structured as { seniority: string | null }).seniority;
    assert.equal(sen, titles[i].expected, `title ${titles[i].title}`);
  }
});

test("stripHtml: removes tags + decodes common entities + collapses whitespace", () => {
  const html =
    "<p>Hi <strong>there</strong>!</p><br/><p>Visit &amp;<a href='x'>here</a> for &#39;more&#39;.</p>";
  const text = stripHtml(html);
  assert.match(text, /Hi there/);
  assert.match(text, /Visit &here for 'more'/);
  assert.ok(!text.includes("<"));
});
