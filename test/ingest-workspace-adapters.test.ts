import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFeed,
  rssAdapter,
  rssFetchTimeoutMs,
} from "../core/ingest/adapters/rss.ts";
import { hnFrontAdapter, HnError } from "../core/ingest/adapters/hn-front.ts";
import {
  hnWhosHiringAdapter,
  HnHiringError,
} from "../core/ingest/adapters/hn-whos-hiring.ts";
import { productHuntAdapter } from "../core/ingest/adapters/product-hunt.ts";
import { redditAdapter, RedditError } from "../core/ingest/adapters/reddit.ts";
import { redditSearchAdapter } from "../core/ingest/adapters/reddit-search.ts";
import { googleNewsAdapter } from "../core/ingest/adapters/google-news.ts";
import { xSearchAdapter, XSearchError } from "../core/ingest/adapters/x-search.ts";
import { exaAdapter } from "../core/ingest/adapters/exa.ts";
import {
  atsSourceFromUrl,
  discoverCompanyOwnedSignalSources,
} from "../core/ingest/source-autodiscovery.ts";
import {
  listWorkspaceAdapterIds,
  workspaceAdapters,
} from "../core/ingest/adapters/registry.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/xml", ...headers },
  });
}

// ─── Registry ─────────────────────────────────────────────────────────────

test("workspace registry: adapters registered with expected kindHints", () => {
  assert.deepEqual(
    listWorkspaceAdapterIds().sort(),
    [
      "ashby",
      "exa",
      "google_news",
      "greenhouse",
      "hn_front",
      "hn_whos_hiring",
      "lever",
      "product_hunt",
      "reddit",
      "reddit_search",
      "rss",
      "sec_edgar",
      "workable",
      "x_search",
    ],
  );
  assert.equal(workspaceAdapters.rss.kindHint, null);
  assert.equal(workspaceAdapters.greenhouse.kindHint, "hiring");
  assert.equal(workspaceAdapters.lever.kindHint, "hiring");
  assert.equal(workspaceAdapters.ashby.kindHint, "hiring");
  assert.equal(workspaceAdapters.workable.kindHint, "hiring");
  assert.equal(workspaceAdapters.sec_edgar.kindHint, null);
  assert.equal(workspaceAdapters.hn_front.kindHint, null);
  assert.equal(workspaceAdapters.hn_whos_hiring.kindHint, "hiring");
  assert.equal(workspaceAdapters.product_hunt.kindHint, "product_launch");
  assert.equal(workspaceAdapters.reddit.kindHint, null);
  assert.equal(workspaceAdapters.reddit_search.kindHint, null);
  assert.equal(workspaceAdapters.google_news.kindHint, null);
  assert.equal(workspaceAdapters.exa.kindHint, null);
  assert.equal(workspaceAdapters.x_search.kindHint, null);
});

test("source autodiscovery: finds official RSS and ATS sources from a website", async () => {
  const fetchImpl = (async (url: string) => {
    if (url === "https://acme.example/") {
      return textResponse(
        `<html><head>
          <link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" />
        </head><body>
          <a href="/careers">Careers</a>
        </body></html>`,
        200,
        { "content-type": "text/html" },
      );
    }
    if (url === "https://acme.example/careers") {
      return textResponse(
        `<html><body>
          <a href="https://boards.greenhouse.io/acme">Open roles</a>
        </body></html>`,
        200,
        { "content-type": "text/html" },
      );
    }
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;

  const sources = await discoverCompanyOwnedSignalSources({
    company_name: "Acme",
    website_url: "https://acme.example",
    fetchImpl,
  });

  assert.deepEqual(
    sources.map((source) => source.adapter).sort(),
    ["greenhouse", "rss"],
  );
  const rss = sources.find((source) => source.adapter === "rss");
  assert.equal(rss?.url, "https://acme.example/blog/rss.xml");
  assert.equal(rss?.source_tier, "official");
  const greenhouse = sources.find((source) => source.adapter === "greenhouse");
  assert.equal(greenhouse?.board_slug, "acme");
  assert.equal(greenhouse?.signal_kind, "hiring");
});

test("source autodiscovery: extracts known ATS slugs from public careers URLs", () => {
  assert.equal(
    atsSourceFromUrl("https://jobs.lever.co/linear", "Linear")?.board_slug,
    "linear",
  );
  assert.equal(
    atsSourceFromUrl("https://jobs.ashbyhq.com/vercel", "Vercel")?.adapter,
    "ashby",
  );
  assert.equal(
    atsSourceFromUrl(
      "https://apply.workable.com/api/v3/accounts/acme/jobs/",
      "Acme",
    )?.board_slug,
    "acme",
  );
});

// ─── Exa adapter ─────────────────────────────────────────────────────────

test("exa adapter: searches public web and normalizes evidence candidates", async () => {
  const prior = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "exa-test";
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  let capturedKey = "";
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    capturedKey = String((init?.headers as Record<string, string>)?.["x-api-key"] ?? "");
    return jsonResponse({
      requestId: "req_1",
      results: [
        {
          id: "https://example.com/post",
          url: "https://example.com/post",
          title: "Acme launches an AI workflow",
          publishedDate: "2026-06-03T03:00:00.000Z",
          score: 0.91,
          text: "Acme launched a new AI workflow for GTM teams.",
          highlights: ["AI workflow for GTM teams"],
          summary: "Acme launched a GTM workflow product.",
        },
      ],
    });
  }) as unknown as typeof fetch;
  try {
    const result = await exaAdapter.poll({
      workspace_id: "ws",
      source: {
        id: "s",
        name: "Exa market",
        config: {
          query: "Acme AI workflow launch",
          limit: 5,
          type: "fast",
          include_domains: ["x.com", "linkedin.com"],
          exclude_domains: ["facebook.com"],
          start_published_date: "2026-06-01T00:00:00.000Z",
          signal_kind: "product_launch",
          summary: true,
        },
      },
      cursor: {},
      fetchImpl,
    });
    assert.match(capturedUrl, /api\.exa\.ai\/search/);
    assert.equal(capturedKey, "exa-test");
    assert.equal(capturedBody.query, "Acme AI workflow launch");
    assert.equal(capturedBody.type, "fast");
    assert.deepEqual(capturedBody.includeDomains, ["x.com", "linkedin.com"]);
    assert.deepEqual(capturedBody.excludeDomains, ["facebook.com"]);
    assert.equal(capturedBody.startPublishedDate, "2026-06-01T00:00:00.000Z");
    assert.deepEqual(capturedBody.contents, {
      text: { maxCharacters: 1600 },
      highlights: true,
      summary: true,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].external_id, "https://example.com/post");
    assert.equal(result.items[0].url, "https://example.com/post");
    assert.equal(result.items[0].freshness_at, "2026-06-03T03:00:00.000Z");
    assert.equal(result.items[0].provenance?.adapter, "exa");
    assert.equal(result.items[0].structured?.source, "exa");
    assert.equal(result.cursor.request_id, "req_1");
  } finally {
    if (prior === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = prior;
  }
});

test("exa adapter: social post URLs normalize into shared social structured fields", async () => {
  const prior = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "exa-test";
  const fetchImpl = (async () =>
    jsonResponse({
      requestId: "req_social",
      results: [
        {
          id: "li-post-1",
          url: "https://www.linkedin.com/posts/acme_hiring-we-are-hiring-a-founding-ae-activity-123",
          title: "We are hiring a founding AE",
          publishedDate: "2026-06-18T03:00:00.000Z",
          author: "Acme",
          text: "We are hiring a founding AE and revops lead.",
          highlights: ["founding AE", "revops lead"],
          summary: "Acme is hiring GTM roles.",
        },
      ],
    })) as unknown as typeof fetch;
  try {
    const result = await exaAdapter.poll({
      workspace_id: "ws",
      source: {
        id: "s",
        name: "Exa LinkedIn posts",
        config: {
          query: "\"we are hiring\" linkedin recruiter posts",
          limit: 5,
          type: "fast",
          include_domains: ["linkedin.com"],
        },
      },
      cursor: {},
      fetchImpl,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].structured?.source, "social");
    assert.equal(result.items[0].structured?.platform, "linkedin");
    assert.equal(result.items[0].structured?.post_url, "https://www.linkedin.com/posts/acme_hiring-we-are-hiring-a-founding-ae-activity-123");
    assert.equal(result.items[0].structured?.author_name, "Acme");
    assert.deepEqual(result.items[0].structured?.matched_keywords, ["we are hiring"]);
  } finally {
    if (prior === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = prior;
  }
});

// ─── RSS adapter ──────────────────────────────────────────────────────────

test("rss adapter: parses RSS 2.0 with guid, title, link, content", async () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0">
    <channel>
      <title>Test Feed</title>
      <item>
        <guid>https://example.com/post-1</guid>
        <title>Series A closed</title>
        <link>https://example.com/post-1</link>
        <description>&lt;p&gt;A &lt;strong&gt;Series A&lt;/strong&gt; round of $20M.&lt;/p&gt;</description>
        <pubDate>Sun, 25 May 2026 12:00:00 GMT</pubDate>
        <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Jane Reporter</dc:creator>
      </item>
      <item>
        <guid>https://example.com/post-2</guid>
        <title>Another headline</title>
        <link>https://example.com/post-2</link>
        <pubDate>Mon, 26 May 2026 12:00:00 GMT</pubDate>
      </item>
    </channel>
  </rss>`;
  const items = await parseFeed(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].external_id, "https://example.com/post-1");
  assert.equal(items[0].title, "Series A closed");
  assert.match(items[0].content ?? "", /A Series A round of \$20M\./);
});

test("rss adapter: parses Atom <feed><entry>", async () => {
  const xml = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Test Atom</title>
    <entry>
      <id>tag:example.com,2026:1</id>
      <title>Atom Title</title>
      <link href="https://example.com/atom-1" />
      <summary>The summary.</summary>
      <updated>2026-05-25T12:00:00Z</updated>
    </entry>
  </feed>`;
  const items = await parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].external_id, "tag:example.com,2026:1");
  assert.equal(items[0].title, "Atom Title");
});

test("rss adapter: poll fetches the config.url and applies novelty_domain", async () => {
  let captured = "";
  let signal: AbortSignal | undefined;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    captured = url;
    signal = init?.signal as AbortSignal | undefined;
    return textResponse(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><guid>g1</guid><title>x</title><link>https://example.com/x</link>
        <pubDate>${new Date(Date.now() - 86_400_000).toUTCString()}</pubDate></item>
    </channel></rss>`);
  }) as unknown as typeof fetch;
  const result = await rssAdapter.poll({
    workspace_id: "ws",
    source: {
      id: "s",
      name: "x",
      config: {
        url: "https://example.com/feed.xml",
        novelty_domain: "example.com",
        fetch_timeout_ms: 5000,
        max_age_days: 365,
      },
    },
    cursor: {},
    fetchImpl,
  });
  assert.equal(captured, "https://example.com/feed.xml");
  assert.ok(signal);
  assert.equal(result.items.length, 1);
  assert.equal((result.items[0].novelty_hint ?? {}).domain, "example.com");
});

test("rss adapter: fetch timeout config is bounded", () => {
  assert.equal(rssFetchTimeoutMs({}), 10_000);
  assert.equal(rssFetchTimeoutMs({ fetch_timeout_ms: "2500" }), 2500);
  assert.equal(rssFetchTimeoutMs({ fetch_timeout_ms: 90_000 }), 30_000);
  assert.equal(rssFetchTimeoutMs({ fetch_timeout_ms: 0 }), 10_000);
});

test("rss adapter: missing config.url is a no-op", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return textResponse("");
  }) as unknown as typeof fetch;
  const result = await rssAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 0);
  assert.equal(calls, 0);
});

// ─── X search adapter ────────────────────────────────────────────────────

test("x_search adapter: official X recent search normalizes tweets and authors", async () => {
  const prior = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = "x-token";
  let capturedUrl = "";
  let capturedAuth = "";
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    return jsonResponse({
      data: [
        {
          id: "1800000000000000001",
          text: "Looking for an Apollo alternative for outbound.",
          author_id: "42",
          created_at: "2026-06-03T01:02:03.000Z",
          conversation_id: "1800000000000000000",
          public_metrics: { retweet_count: 1, reply_count: 2 },
        },
      ],
      includes: {
        users: [{ id: "42", username: "anne", name: "Anne" }],
      },
    });
  }) as unknown as typeof fetch;
  try {
    const result = await xSearchAdapter.poll({
      workspace_id: "ws",
      source: {
        id: "s",
        name: "X intent",
        config: {
          provider: "x_official",
          query: '"Apollo alternative" -is:retweet lang:en',
          limit: 10,
        },
      },
      cursor: {},
      fetchImpl,
    });
    assert.match(capturedUrl, /api\.x\.com\/2\/tweets\/search\/recent/);
    assert.match(capturedUrl, /tweet\.fields=/);
    assert.equal(capturedAuth, "Bearer x-token");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].external_id, "1800000000000000001");
    assert.equal(result.items[0].url, "https://x.com/anne/status/1800000000000000001");
    assert.equal(result.items[0].provenance?.provider, "x_official");
    assert.equal(result.items[0].structured?.source, "social");
    assert.equal(result.items[0].structured?.platform, "x");
    assert.equal(result.items[0].structured?.author_handle, "anne");
    assert.equal(result.items[0].structured?.author_profile_url, "https://x.com/anne");
    assert.deepEqual(result.items[0].structured?.matched_keywords, ["apollo alternative"]);
    assert.equal(result.cursor.provider, "x_official");
  } finally {
    if (prior === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prior;
  }
});

test("x_search adapter: TwitterAPI.io advanced search uses API key and since_time cursor", async () => {
  const prior = process.env.TWITTERAPI_IO_API_KEY;
  process.env.TWITTERAPI_IO_API_KEY = "twio-key";
  let capturedUrl = "";
  let capturedKey = "";
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedKey = String((init?.headers as Record<string, string>)?.["X-API-Key"] ?? "");
    return jsonResponse({
      tweets: [
        {
          id: "1900000000000000001",
          text: "We are switching from our current outbound tool.",
          createdAt: "2026-06-03T02:00:00.000Z",
          author: {
            userName: "kai",
            name: "Kai",
            url: "https://x.com/kai",
          },
          entities: {
            urls: [
              {
                expanded_url: "https://jobs.techtree.dev/openings/sdr",
              },
            ],
          },
          metrics: { reply_count: 3 },
        },
      ],
    });
  }) as unknown as typeof fetch;
  try {
    const result = await xSearchAdapter.poll({
      workspace_id: "ws",
      source: {
        id: "s",
        name: "X switchers",
        config: {
          provider: "twitterapi_io",
          query: '"switching from" outbound',
        },
      },
      cursor: { last_polled_at: "2026-06-03T01:00:00.000Z" },
      fetchImpl,
    });
    assert.match(capturedUrl, /api\.twitterapi\.io\/twitter\/tweet\/advanced_search/);
    assert.match(decodeURIComponent(capturedUrl), /since_time:1780448340/);
    assert.equal(capturedKey, "twio-key");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].url, "https://x.com/kai/status/1900000000000000001");
    assert.equal(result.items[0].provenance?.provider, "twitterapi_io");
    assert.equal(result.items[0].structured?.source, "social");
    assert.equal(result.items[0].structured?.platform, "x");
    assert.equal(result.items[0].structured?.author_handle, "kai");
    assert.equal(result.items[0].structured?.author_profile_url, "https://x.com/kai");
    assert.equal(result.items[0].structured?.company_domain, "techtree.dev");
    assert.deepEqual(result.items[0].structured?.matched_keywords, ["switching from"]);
  } finally {
    if (prior === undefined) delete process.env.TWITTERAPI_IO_API_KEY;
    else process.env.TWITTERAPI_IO_API_KEY = prior;
  }
});

test("x_search adapter: missing provider token fails before fetch", async () => {
  const prior = process.env.SOCIALDATA_API_KEY;
  delete process.env.SOCIALDATA_API_KEY;
  let calls = 0;
  try {
    await assert.rejects(
      xSearchAdapter.poll({
        workspace_id: "ws",
        source: {
          id: "s",
          name: "X source",
          config: { provider: "socialdata", query: "outbound recommendations" },
        },
        cursor: {},
        fetchImpl: (async () => {
          calls += 1;
          return jsonResponse({});
        }) as unknown as typeof fetch,
      }),
      (err) => err instanceof XSearchError && /SOCIALDATA_API_KEY/.test(err.message),
    );
    assert.equal(calls, 0);
  } finally {
    if (prior !== undefined) process.env.SOCIALDATA_API_KEY = prior;
  }
});

// ─── HN front ─────────────────────────────────────────────────────────────

test("hn_front adapter: pulls top stories and only fetches unseen items", async () => {
  const calls: string[] = [];
  const items: Record<number, unknown> = {
    1: { id: 1, type: "story", title: "Story 1", url: "https://example.com/1", time: Math.floor(Date.now() / 1000) - 60 },
    2: { id: 2, type: "story", title: "Story 2", url: "https://example.com/2", time: Math.floor(Date.now() / 1000) - 50 },
    3: { id: 3, type: "story", title: "Story 3", url: "https://example.com/3", time: Math.floor(Date.now() / 1000) - 40 },
  };
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("topstories.json")) return jsonResponse([1, 2, 3]);
    const match = url.match(/item\/(\d+)\.json/);
    if (match) return jsonResponse(items[Number(match[1])]);
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  const first = await hnFrontAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { limit: 3, max_age_days: 365 } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(first.items.length, 3);
  // Subsequent poll with the same cursor → no new items, just a topstories call.
  calls.length = 0;
  const second = await hnFrontAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { limit: 3 } },
    cursor: first.cursor,
    fetchImpl,
  });
  assert.equal(second.items.length, 0);
  assert.equal(calls.filter((u) => u.includes("item/")).length, 0);
});

test("hn_front adapter: skips non-story items + missing titles", async () => {
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("topstories.json")) return jsonResponse([1, 2]);
    if (url.includes("item/1.json"))
      return jsonResponse({ id: 1, type: "job", title: "Jobs" });
    if (url.includes("item/2.json"))
      return jsonResponse({ id: 2, type: "story", title: "Real story", time: Math.floor(Date.now() / 1000) - 60 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const result = await hnFrontAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { limit: 5 } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Real story");
});

test("hn_front adapter: topstories failure throws HnError", async () => {
  const fetchImpl = (async () =>
    new Response("", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    hnFrontAdapter.poll({
      workspace_id: "ws",
      source: { id: "s", name: "x", config: {} },
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof HnError && err.status === 500,
  );
});

// ─── HN Who-is-hiring ─────────────────────────────────────────────────────

test("hn_whos_hiring adapter: finds latest thread + pulls unseen comments", async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes("hn.algolia.com")) {
      return jsonResponse({
        hits: [
          { objectID: "41000000", title: "Ask HN: Who is hiring? (May 2026)", author: "whoishiring" },
          { objectID: "40999999", title: "Some other story", author: "someone" },
        ],
      });
    }
    if (url.includes("item/41000000.json")) {
      return jsonResponse({ id: 41000000, type: "story", title: "Ask HN: Who is hiring?", kids: [42000001, 42000002] });
    }
    if (url.includes("item/42000001.json")) {
      return jsonResponse({
        id: 42000001,
        type: "comment",
        text: "Acme | Senior Engineer | SF | REMOTE\n\nBuild the platform.",
        by: "founder",
        time: 1717000000,
      });
    }
    if (url.includes("item/42000002.json")) {
      return jsonResponse({
        id: 42000002,
        type: "comment",
        text: "Beta | Sales Lead | Remote\n\nSell software.",
        by: "ceo",
        time: 1717000010,
      });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  const result = await hnWhosHiringAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 2);
  assert.match(result.items[0].title, /^Acme \| Senior Engineer/);
  assert.equal((result.cursor as { thread_id: number }).thread_id, 41000000);

  // Re-poll with the same cursor → no new comments.
  const second = await hnWhosHiringAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: result.cursor,
    fetchImpl,
  });
  assert.equal(second.items.length, 0);
});

test("hn_whos_hiring adapter: cursor resets when month rolls over", async () => {
  let callCount = 0;
  const fetchImpl = (async (url: string) => {
    if (url.includes("hn.algolia.com")) {
      callCount += 1;
      // First call → April; second call (later) → May.
      const id = callCount === 1 ? "41000000" : "41000001";
      const title =
        callCount === 1
          ? "Ask HN: Who is hiring? (April 2026)"
          : "Ask HN: Who is hiring? (May 2026)";
      return jsonResponse({ hits: [{ objectID: id, title }] });
    }
    if (url.includes("item/41000000.json")) {
      return jsonResponse({ id: 41000000, type: "story", kids: [42000001] });
    }
    if (url.includes("item/42000001.json")) {
      return jsonResponse({ id: 42000001, type: "comment", text: "Apr-1 | x", time: 1 });
    }
    if (url.includes("item/41000001.json")) {
      return jsonResponse({ id: 41000001, type: "story", kids: [43000001] });
    }
    if (url.includes("item/43000001.json")) {
      return jsonResponse({ id: 43000001, type: "comment", text: "May-1 | y", time: 2 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  const apr = await hnWhosHiringAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: {},
    fetchImpl,
  });
  assert.equal(apr.items.length, 1);

  const may = await hnWhosHiringAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: apr.cursor,
    fetchImpl,
  });
  assert.equal(may.items.length, 1);
  assert.equal((may.cursor as { thread_id: number }).thread_id, 41000001);
});

test("hn_whos_hiring adapter: Algolia failure throws HnHiringError", async () => {
  const fetchImpl = (async () =>
    new Response("", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    hnWhosHiringAdapter.poll({
      workspace_id: "ws",
      source: { id: "s", name: "x", config: {} },
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof HnHiringError && err.status === 503,
  );
});

// ─── ProductHunt ──────────────────────────────────────────────────────────

test("product_hunt adapter: no token → no-op (cursor preserved)", async () => {
  // Ensure the env doesn't leak a token from the test runner.
  const prior = process.env.PRODUCT_HUNT_TOKEN;
  delete process.env.PRODUCT_HUNT_TOKEN;
  try {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await productHuntAdapter.poll({
      workspace_id: "ws",
      source: { id: "s", name: "x", config: {} },
      cursor: { x: 1 },
      fetchImpl,
    });
    assert.equal(calls, 0);
    assert.deepEqual(result.cursor, { x: 1 });
    assert.equal(result.items.length, 0);
  } finally {
    if (prior !== undefined) process.env.PRODUCT_HUNT_TOKEN = prior;
  }
});

test("product_hunt adapter: maps newest posts", async () => {
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer t-1");
    return jsonResponse({
      data: {
        posts: {
          edges: [
            {
              node: {
                id: "ph-1",
                name: "WidgetPro",
                tagline: "Build widgets fast",
                description: "A widget builder.",
                url: "https://producthunt.com/posts/widgetpro",
                website: "https://widgetpro.test",
                votesCount: 240,
                createdAt: "2026-05-25T12:00:00Z",
                topics: { edges: [{ node: { name: "Developer Tools" } }] },
              },
            },
          ],
        },
      },
    });
  }) as unknown as typeof fetch;
  const result = await productHuntAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "ph", config: { token: "t-1", max_age_days: 365 } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, "ph-1");
  assert.match(result.items[0].title, /WidgetPro/);
  assert.match(result.items[0].title, /Build widgets fast/);
});

// ─── Reddit ───────────────────────────────────────────────────────────────

test("reddit adapter: missing subreddit → no-op", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const result = await redditAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: {} },
    cursor: {},
    fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(result.items.length, 0);
});

test("reddit adapter: maps a subreddit listing", async () => {
  const fetchImpl = (async (url: string) => {
    assert.match(url, /\/r\/startups\/new\.json\?limit=10/);
    return jsonResponse({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc1",
              name: "t3_abc1",
              title: "Anyone using Vercel + Postgres?",
              selftext: "Curious how teams scale.",
              permalink: "/r/startups/comments/abc1/",
              author: "user",
              score: 42,
              num_comments: 7,
              created_utc: 1717000000,
              domain: "self.startups",
            },
          },
        ],
      },
    });
  }) as unknown as typeof fetch;
  const result = await redditAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { subreddit: "startups", limit: 10 } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.external_id, "t3_abc1");
  assert.equal(item.url, "https://www.reddit.com/r/startups/comments/abc1/");
  assert.equal((item.structured as { subreddit: string }).subreddit, "startups");
});

test("reddit adapter: non-2xx throws RedditError", async () => {
  const fetchImpl = (async () =>
    new Response("blocked", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(
    redditAdapter.poll({
      workspace_id: "ws",
      source: { id: "s", name: "x", config: { subreddit: "startups" } },
      cursor: {},
      fetchImpl,
    }),
    (err) => err instanceof RedditError && err.status === 429,
  );
});

// ─── Reddit search ────────────────────────────────────────────────────────

test("reddit_search adapter: empty subreddit list → no-op", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const result = await redditSearchAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { subreddits: [], keywords: ["ai"] } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(result.items.length, 0);
});

test("reddit_search adapter: keyword-filtered items include matched_keywords", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return jsonResponse({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "z1",
              name: "t3_z1",
              title: "Best cold email tools for outbound?",
              selftext: "We are trying to scale outbound and hate spamming.",
              permalink: "/r/SaaS/comments/z1/",
              subreddit: "SaaS",
              score: 12,
              num_comments: 3,
              created_utc: 1717000000,
              domain: "self.SaaS",
            },
          },
          {
            kind: "t3",
            data: {
              id: "z2",
              name: "t3_z2",
              title: "Kubernetes cluster tips",
              selftext: "Nothing related",
              permalink: "/r/SaaS/comments/z2/",
              subreddit: "SaaS",
              score: 0,
              num_comments: 0,
              created_utc: 1717000000,
              domain: "self.SaaS",
            },
          },
        ],
      },
    });
  }) as unknown as typeof fetch;
  const result = await redditSearchAdapter.poll({
    workspace_id: "ws",
    source: {
      id: "s",
      name: "x",
      config: {
        subreddits: ["SaaS"],
        keywords: ["cold email", "outbound"],
        limit_per_sub: 5,
      },
    },
    cursor: {},
    fetchImpl,
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /\/r\/SaaS\/search\.json\?q=/);
  assert.equal(result.items.length, 1);
  const structured = result.items[0]!.structured as {
    subreddit: string;
    matched_keywords: string[];
  };
  assert.equal(structured.subreddit, "SaaS");
  assert.deepEqual(structured.matched_keywords.sort(), ["cold email", "outbound"]);
});

test("reddit_search adapter: no-keyword mode returns all posts", async () => {
  const fetchImpl = (async (url: string) => {
    assert.match(url, /\/r\/marketing\/new\.json/);
    return jsonResponse({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "a1",
              name: "t3_a1",
              title: "Any post here",
              subreddit: "marketing",
              permalink: "/r/marketing/comments/a1/",
              score: 1,
              num_comments: 0,
              created_utc: 1717000000,
            },
          },
        ],
      },
    });
  }) as unknown as typeof fetch;
  const result = await redditSearchAdapter.poll({
    workspace_id: "ws",
    source: {
      id: "s",
      name: "x",
      config: { subreddits: ["marketing"] },
    },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
});

// ─── Google News ──────────────────────────────────────────────────────────

test("google_news adapter: builds the search URL and delegates to RSS", async () => {
  let captured = "";
  const fetchImpl = (async (url: string) => {
    captured = url;
    return textResponse(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><guid>g1</guid><title>A funding round</title><link>https://example.com/a</link>
        <pubDate>${new Date(Date.now() - 86_400_000).toUTCString()}</pubDate></item>
    </channel></rss>`);
  }) as unknown as typeof fetch;
  const result = await googleNewsAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "gn", config: { query: "fintech funding", max_age_days: 365 } },
    cursor: {},
    fetchImpl,
  });
  assert.match(captured, /^https:\/\/news\.google\.com\/rss\/search\?/);
  assert.match(captured, /q=fintech\+funding/);
  assert.match(captured, /hl=en-US/);
  assert.equal(result.items.length, 1);
});

test("google_news adapter: missing query → no-op", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("");
  }) as unknown as typeof fetch;
  const result = await googleNewsAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "gn", config: {} },
    cursor: {},
    fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(result.items.length, 0);
});

// ─── Freshness window ──────────────────────────────────────────────────────

test("hn_front adapter: drops items older than max_age_days", async () => {
  const now = Math.floor(Date.now() / 1000);
  const oldTime = now - 30 * 24 * 3600;
  const recentTime = now - 3600;
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("topstories.json")) return jsonResponse([1, 2]);
    if (url.includes("item/1.json"))
      return jsonResponse({ id: 1, type: "story", title: "Old story", time: oldTime });
    if (url.includes("item/2.json"))
      return jsonResponse({ id: 2, type: "story", title: "Recent story", time: recentTime });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const result = await hnFrontAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { limit: 5, max_age_days: 14 } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Recent story");
});

test("rss adapter: drops items older than max_age_days (default 14)", async () => {
  const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toUTCString();
  const recentDate = new Date(Date.now() - 3600 * 1000).toUTCString();
  const fetchImpl = (async () =>
    textResponse(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><guid>g-old</guid><title>Old</title><link>https://example.com/old</link>
        <pubDate>${oldDate}</pubDate></item>
      <item><guid>g-new</guid><title>Recent</title><link>https://example.com/new</link>
        <pubDate>${recentDate}</pubDate></item>
    </channel></rss>`)) as unknown as typeof fetch;
  const result = await rssAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "x", config: { url: "https://example.com/feed.xml" } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, "g-new");
});

test("product_hunt adapter: drops items older than max_age_days (default 7)", async () => {
  const oldDate = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const recentDate = new Date(Date.now() - 3600 * 1000).toISOString();
  const fetchImpl = (async () =>
    jsonResponse({
      data: {
        posts: {
          edges: [
            { node: { id: "ph-old", name: "OldApp", createdAt: oldDate } },
            { node: { id: "ph-new", name: "NewApp", createdAt: recentDate } },
          ],
        },
      },
    })) as unknown as typeof fetch;
  const result = await productHuntAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "ph", config: { token: "t-1" } },
    cursor: {},
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, "ph-new");
});
