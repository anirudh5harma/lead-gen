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
import { googleNewsAdapter } from "../core/ingest/adapters/google-news.ts";
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

test("workspace registry: all six adapters registered with expected kindHints", () => {
  assert.deepEqual(
    listWorkspaceAdapterIds().sort(),
    [
      "google_news",
      "hn_front",
      "hn_whos_hiring",
      "product_hunt",
      "reddit",
      "rss",
    ],
  );
  assert.equal(workspaceAdapters.rss.kindHint, null);
  assert.equal(workspaceAdapters.hn_front.kindHint, null);
  assert.equal(workspaceAdapters.hn_whos_hiring.kindHint, "hiring");
  assert.equal(workspaceAdapters.product_hunt.kindHint, "product_launch");
  assert.equal(workspaceAdapters.reddit.kindHint, null);
  assert.equal(workspaceAdapters.google_news.kindHint, null);
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
        <pubDate>Sun, 25 May 2026 12:00:00 GMT</pubDate></item>
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

// ─── HN front ─────────────────────────────────────────────────────────────

test("hn_front adapter: pulls top stories and only fetches unseen items", async () => {
  const calls: string[] = [];
  const items: Record<number, unknown> = {
    1: { id: 1, type: "story", title: "Story 1", url: "https://example.com/1", time: 1717000000 },
    2: { id: 2, type: "story", title: "Story 2", url: "https://example.com/2", time: 1717000010 },
    3: { id: 3, type: "story", title: "Story 3", url: "https://example.com/3", time: 1717000020 },
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
    source: { id: "s", name: "x", config: { limit: 3 } },
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
      return jsonResponse({ id: 2, type: "story", title: "Real story", time: 1717000000 });
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
    source: { id: "s", name: "ph", config: { token: "t-1" } },
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

// ─── Google News ──────────────────────────────────────────────────────────

test("google_news adapter: builds the search URL and delegates to RSS", async () => {
  let captured = "";
  const fetchImpl = (async (url: string) => {
    captured = url;
    return textResponse(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><guid>g1</guid><title>A funding round</title><link>https://example.com/a</link>
        <pubDate>Sun, 25 May 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`);
  }) as unknown as typeof fetch;
  const result = await googleNewsAdapter.poll({
    workspace_id: "ws",
    source: { id: "s", name: "gn", config: { query: "fintech funding" } },
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
