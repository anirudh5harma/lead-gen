# Signal Ingestion — Design

## Context

The Signal primitive is the platform's *input*. Every Play, Rep, and outcome chain downstream is reactive — they fire because a signal landed. Today signals only exist when hand-inserted; this design turns the system from demand-driven to **continuously fed**, with cost discipline so the bill stays predictable.

Exa is now treated as a first-class public-web intelligence layer across
Profile, Reps, Signals, Outreach, Content, Campaigns, and AEO. This document
covers Signal ingestion specifics; the broader product architecture lives in
[`docs/exa-intelligence-layer.md`](./exa-intelligence-layer.md).

**Primary product focus: hiring signals across the web.** Users want a live picture of who in their domain is hiring for what — so the ATS adapters (Greenhouse, Lever, Ashby, plus HN "Who is hiring" and career-page RSS) are first-class. Funding / leadership / M&A / launches stay in the mix as auxiliary signals.

Goals:

1. **Hiring intelligence at scale**: track every job posting we can legally see across thousands of companies; surface what roles, functions, seniorities, and trends matter to each workspace.
2. **Cover the rest of the 12 kinds** the schema already names — funding, leadership change, product launch, acquisition, churn risk, competitor move, podcast / press mention, regulation, expansion, layoff — with secondary sources.
3. **Cost discipline**: free sources cover ~80% of value. Paid sources only when they uniquely unlock a kind no free source touches.
4. **Architecture-honest**: no Vercel crons for orchestration; ingestion runs on the durable workflow runtime, typed events at every boundary.

---

## Source matrix (decisions baked in)

### Social-signal research update — 2026-06-02

Octolens' social-signal playbook is directionally right for this product:
LinkedIn is only one formal surface; high-intent GTM signals are scattered
across Reddit, Hacker News, X, YouTube, newsletters, podcasts, GitHub, and
developer communities. The useful taxonomy is:

- **Buying intent**: alternatives, recommendations, category questions, pain
  point descriptions.
- **Competitive windows**: competitor complaints, pricing/API/feature changes,
  migrations, "switched from" posts.
- **Market motion**: category narratives, launches, trends, and technical
  debates that change timing.

Architecture implication: these are still `Signal`s, not new user-facing nouns.
Each source must enter through either `product.signal.discover`,
`/api/webhooks/signals`, or a durable workspace poll workflow, then continue
through graph projection, ICP matching, hot-path eval, and per-Play/channel
approval gates.

Legal/acquisition decision:

| Surface | Best current approach | Why |
|---|---|---|
| Hacker News | Keep native HN Firebase/Algolia adapters | Official HN API exposes public data near real time and currently has no stated rate limit; cheap and clean. |
| Reddit | Keep native subreddit adapter for bounded, OAuth-ready use; add commercial access review before broad scale | Reddit's official Data API is the authorized path and commercial/significant usage can require approval/fees. Use descriptive user agents, caching, tight subreddit/keyword scope, and source budgets. |
| X/Twitter | Add one narrow, usage-priced unofficial/provider-backed X data API only after native/free sources prove which queries matter | SocialData/TwitterAPI.io-style APIs are materially cheaper than social-listening suites when we cap keyword rules and store only normalized `Signal`s. |
| LinkedIn | Avoid broad LinkedIn listening at launch. If needed, test targeted company-page/post actors for known accounts only | LinkedIn is the highest cost/risk surface. Do not use cookies, user sessions, profile crawling, or broad people scraping in the product path. |
| Cross-platform social listening | Defer Octolens/Trigify/Syften until signal quality proves the subscription cost | Aggregators are useful, but they are not the cheapest way to validate the first live signal loop. |

Practical startup provider stack:

| Tier | Providers to test | Fit | Risk posture |
|---|---|---|---|
| **Signal-listening aggregators** | Octolens, Trigify, Syften | Useful later when we need managed cross-platform coverage and team routing. | Higher recurring cost. Defer until free/native + narrow paid APIs prove signal-to-outcome value. |
| **Dedicated social data APIs** | SocialData / TwitterAPI.io for X; Data365 for broader social data | Better when a source proves high-volume enough that we want cheaper per-item X/search access or raw structured feeds. | Medium. Treat as provider-backed unofficial access; require kill switches, provenance, monthly budget caps, and a replacement path. |
| **Scraper marketplaces** | Apify Actors for X and LinkedIn company posts; Bright Data for enterprise-scale public web data | Good for experiments, narrow backfills, and monitoring known company/profile URLs when aggregators miss a source. | Highest operational/compliance risk. Never put user cookies in the system. Keep off the hot path until provider terms, data deletion, and anti-abuse behavior are signed off. |
| **Native/free sources** | HN Firebase/Algolia, RSS, Google News, Product Hunt, bounded Reddit JSON/API | Keep owning these because they are cheap, stable enough, and already fit the workflow/event architecture. | Low, but Reddit commercial scale still needs terms review. |
| **AI web/search substrates** | Exa Search/Contents/Websets | Best for broad web discovery, profile enrichment, Rep research, draft grounding, content/AEO discovery, long-tail company/person research, "what changed?" monitors, and source discovery when no dedicated social provider has coverage. | Low-to-medium. It is web search/crawl, not a guaranteed LinkedIn/X firehose; use it to find and enrich evidence, not as the only social ingestion layer. |
| **B2B graph + live signal APIs** | Crustdata Company/Person/Job/Social Post/Watcher APIs | Strong candidate for our graph backbone: company/person enrichment, hiring/funding/company-event signals, recent public posts by person/company, keyword post search, and agent/MCP use. | Medium. Enterprise/live endpoints may be plan-specific; verify freshness, LinkedIn/social coverage, redistribution rights, and whether post search can be called at our cadence. |
| **Packaged AI GTM operators** | Gojiberry-style products | Useful competitive/product inspiration: detect buying/social signals, match ICP, score leads, then launch LinkedIn/email outreach. | Not a source layer unless they expose an API. Public positioning suggests the winning UX is "tell the agent your ICP and get warm leads," not a dashboard of feeds. |

Recommended provider order:

1. **Company-owned and official feeds first**: autodiscover RSS/Atom feeds and
   known ATS boards from the user's website, then poll Greenhouse, Lever, Ashby,
   Workable, SEC EDGAR, HN, Google News RSS, Product Hunt, and bounded Reddit.
   This is the cheapest path and already runs through durable
   `ingest_workspace_poll`.
2. **Paid X provider gateway after query proof**: use the `x_search` workspace
   adapter to compare official X API with SocialData/TwitterAPI.io-style
   providers for 5-10 tightly scoped searches. Enforce source-level item/call
   quotas, monthly spend caps, kill switches, provenance, and dedupe by tweet id
   before storing.
3. **Targeted LinkedIn company-post experiment** only for known company pages
   and public posts, via an Apify/Bright Data/Data365-style provider that does
   not require cookies or user accounts. Keep it off the hot path until terms,
   data deletion, and rate behavior are reviewed.
4. **Exa intelligence layer before X/LinkedIn procurement**: use Exa for
   profile enrichment, Rep research, draft grounding, open-web Signals, content
   opportunities, and AEO audits. Do not count it as a LinkedIn/X firehose,
   and do not add it to the default signup aggregator automatically.
5. **Crustdata or Octolens later** only after cheap sources prove that managed
   coverage would save enough engineering time or improve outcome volume.

Competitor/product inference:

- **Gojiberry** is likely composing several provider layers rather than owning
  every feed: LinkedIn/social engagement, job changes, hiring activity, funding
  and enrichment, then ICP scoring and outreach. Public FAQ language maps almost
  exactly to our primitives: `Signal` detection, `Rep`/ICP matching, and
  `Play` execution across LinkedIn/email. Treat it as product proof that the
  user should see warm outcomes, not raw source plumbing.
- **Crustdata** appears to package a proprietary/indexed B2B graph plus live
  retrieval APIs: company/person/job indexed search, web search/fetch, social
  posts, watcher APIs, and MCP/agent access. For us, it is more strategic than a
  one-off scraper because it can fill both graph enrichment and signal
  acquisition.
- **Exa** is not a LinkedIn/X replacement. It is the AI-native public-web
  intelligence layer: agents use it to discover current evidence, monitor broad
  web changes, fetch clean content with citations, ground drafts, enrich
  profiles, and find AEO/content gaps. Use it before Crustdata/Octolens for the
  first product loop, and use dedicated social providers later only for measured
  gaps.

This keeps the product agent-native: external aggregators are source adapters,
not alternate workflows. They push normalized mentions into the same typed event
bus, and Reps see them as ordinary `Signal`s with source confidence,
provenance, and channel-specific response guidance.

Implementation convention: configure provider trials through
`product.source.configure` with `adapter: "webhook"` and a paid-provider label
such as `x_official`, `socialdata`, `twitterapi_io`, `apify`, `data365`,
`exa`, `crustdata`, or `octolens`. The projector stores the provider and quota
metadata on `graph_sources.config/properties`, keeps the source out of poll
maintenance, and stamps ingested `Signal` provenance with the same provider
unless the upstream payload overrides it. Providers still send the normalized
`bombsell_signal_v1` payload to `/api/webhooks/signals`; provider-specific
fetch/scrape mechanics stay outside the product spine. Free streams such as HN,
Reddit, RSS, Google News, Product Hunt, and ATS job boards stay native adapters
rather than paid push providers.

For X, prefer `adapter: "x_search"` over webhook glue. It is a pure workspace
adapter that reads provider credentials from environment
(`X_API_BEARER_TOKEN`, `SOCIALDATA_API_KEY`, or `TWITTERAPI_IO_API_KEY`),
normalizes posts into source-backed `Signal` candidates, and lets the durable
workspace poll workflow own cursors, `max_daily_calls`, `max_daily_items`,
embedding, dedupe, and `signal.discovered` publication.

References to recheck before procurement or provider enablement:

- Octolens social-signal playbook and pricing: <https://octolens.com/blog/track-social-signals>, <https://octolens.com/pricing>
- Trigify and Syften social-listening surfaces: <https://www.trigify.io/>, <https://syften.com/>
- Exa intelligence layer: <https://exa.ai/docs/reference/search>, <https://docs.exa.ai/reference/get-contents>, <https://docs.exa.ai/websets/api/overview>, <https://exa.ai/pricing>
- Crustdata B2B graph, post APIs, and pricing: <https://docs.crustdata.com/general/introduction>, <https://crustdata.com/apis/posts>, <https://crustdata.com/pricing>
- Gojiberry product positioning/FAQ: <https://gojiberry.ai/faq>, <https://gojiberry.ai/>
- X official and provider-backed X data APIs: <https://docs.x.com/x-api/getting-started/about-x-api>, <https://docs.socialdata.tools/getting-started/pricing/>, <https://twitterapi.io/twitter-api-pricing>
- Scraper marketplace options to test carefully: <https://apify.com/apidojo/tweet-scraper>, <https://apify.com/harvestapi/linkedin-company-posts>, <https://data365.co/solutions/ai-apis>
- HN official public API: <https://github.com/HackerNews/API>
- Reddit Data API Terms: <https://redditinc.com/policies/data-api-terms>
- X API docs and pricing: <https://docs.x.com/x-api/getting-started/about-x-api>
- LinkedIn User Agreement and developer access docs: <https://www.linkedin.com/legal/user-agreement>, <https://learn.microsoft.com/linkedin/>

### Phase 1 — official-source-first, hiring-heavy

| Source                          | Best for                                                                  | Cost | Notes |
|---------------------------------|---------------------------------------------------------------------------|------|-------|
| **Company website autodiscovery** | company-owned RSS/Atom feeds and ATS links from the homepage/careers pages | Free | Signup/default aggregator discovers official sources without adding setup friction |
| **Greenhouse** public board API | hiring (broad — thousands of tech companies use Greenhouse)               | Free | Polled per company; we maintain a curated catalog (see Q3 decision) |
| **Lever** public board API      | hiring                                                                    | Free | Same per-company pattern |
| **Ashby** public board API      | hiring (growing, mid-market)                                              | Free | Same per-company pattern |
| **Workable** public board       | hiring (SMB + startups)                                                   | Free | Same per-company pattern |
| **HackerNews "Who is hiring"**  | hiring (monthly thread; high-signal startup roles)                         | Free | Algolia API to fetch comments |
| **Career-page RSS** generic     | hiring (companies that don't use a known ATS — fallback)                   | Free | Generic Atom/RSS parser |
| **SEC EDGAR**                   | funding (S-1), acquisition (S-4, 8-K item 2.01), leadership_change (5.02), layoff (WARN-Act adjacent) | Free | Auxiliary |
| **HackerNews** front + Show HN  | product_launch, competitor_move, press_mention                            | Free | Algolia API |
| **ProductHunt** GraphQL         | product_launch                                                            | Free | |
| **RSS** (TC, Verge, custom blogs, Substack, Google News per-keyword) | press_mention, funding (news), leadership_change | Free | Generic adapter |
| **Reddit JSON** (subreddit)     | competitor_move, churn_risk (user complaints), regulation                 | Free | |

### Phase 1.5

| Source                | Best for                              | Cost | Why deferred |
|-----------------------|---------------------------------------|------|--------------|
| **GDELT** Doc API     | broad news, regulation, M&A           | Free | Noisy; let RSS + Google News stress-test the news bucket first |
| **Bluesky / Mastodon**| social mentions (early-adopter)       | Free | Low volume in tech persona today; revisit when X is decided |

### Phase 2

| Source                  | Best for                                          | Cost     |
|-------------------------|---------------------------------------------------|----------|
| **X / Twitter official API** | competitor_move, product_launch, real-time mentions | usage-priced; recheck before enabling |
| **Listen Notes**          | podcast_mention                                   | $30+/mo |

### Skip

- **Crunchbase / PitchBook** — paid + slow; SEC EDGAR + RSS + GDELT cover ~80% of what they offer for outbound.
- **LinkedIn scraping** — risky, costly, and reproduces what the ATS adapters already see.

---

## Two-stage pipeline

Cost discipline is enforced by splitting ingestion into two stages: a cheap acquisition stage that runs everywhere, and an expensive LLM-classification stage that only runs on items that survive cheap filters.

### Stage 1 — Ingest candidates  (cheap, high volume)

Polling is an adapter, not the architecture. The ingestion primitive is
`signal.discovered`: any source can push a normalized item immediately, and the
projector materializes the Signal + emits `signal.ingested`. Poll workflows are
only the catch-up/backfill adapter for sources that do not offer a webhook,
stream, or native event feed.

For push-capable sources:

1. External source, MCP agent, or connector calls the source-backed discovery
   primitive (`product.signal.discover`) or authenticated webhook
   (`POST /api/webhooks/signals` with `SIGNAL_WEBHOOK_SECRET`).
2. The primitive applies dedup, budget, cheap ICP filters, and embeddings.
3. It publishes `signal.discovered` with an idempotency key derived from
   `(workspace, source, external_id)`.
4. The signal projector owns `signals` materialization and emits
   `signal.ingested`.

For pull-only sources, each `(workspace, source)` durable workflow polls on a cadence:

1. Adapter fetches items since the stored cursor.
2. Official-source quality metadata is attached before materialization:
   `source_tier`, `source_authority`, `source_credibility`, `buying_intent`,
   `timing`, and `signal_quality`. The classifier prompt and ICP cheap filters
   both see this metadata, so fresh official buying-intent signals spend budget
   before noisy aggregators.
3. Lightweight rules drop obvious noise (keyword filters, date-window, language).
4. **Embedding step**: compute a DeepSeek embedding on `title + first 200 chars` of each surviving item (~$0.0001 each). Store on `signals.embedding`.
5. **Dedup, two-tier**:
   - **Exact**: `novelty_key = sha256(canonical_company_domain ':' rough_kind_hint ':' iso_week)`. Collision → drop + bump `novelty_count` on the original.
   - **Fuzzy**: pgvector cosine similarity > 0.85 against same workspace + 7-day window. Match → drop + bump `novelty_count` (a high count is itself a "this is being widely covered" signal).
6. Surviving items insert into `signals` with `status='ingested'`, `kind=NULL`.
7. `signal.ingested` event published per insert.

Cadence per source (rough — tunable per workspace via `workspace_source_configs.poll_cadence_sec`):

- Greenhouse / Lever / Ashby / Workable per company: 6 h
- HN "Who is hiring" thread: poll the active month's thread every 1 h
- SEC EDGAR: 15 min
- HN front + ProductHunt: 30 min
- News RSS / Google News keywords: 15-30 min
- Career-page RSS: 6 h
- Reddit subreddits: 1 h

### Stage 2 — Classify + match  (LLM, batched)

Subscribed to `signal.ingested`. Pulls in batches (default N = 8) and issues **one DeepSeek V4 Pro call per batch**:

- Classify each candidate into one of 12 `SignalKind`s (or `dismiss`).
- For hiring signals, extract structured info: role title, function (eng / sales / product / etc.), seniority (junior / senior / lead / VP / C-level), location, remote_ok, posted_at.
- For other kinds, extract relevant entities (company, person, funding amount, etc.).
- Resolve entities against the knowledge graph (upsert via existing graph adapters; create `mentioned_in` edges).
- **Match against EVERY ICP segment in the workspace**; pick the best-matching segment with score above its threshold. Emit `signal.matched` with the segment id, or `signal.dismissed`.

Batching collapses LLM calls ~8× without losing classification quality. At ~$0.001 per batch with V4 Pro, a workspace ingesting 1k candidates / day classifies for ~$0.15 / day.

---

## Per-workspace configuration (locked schema)

```sql
-- 015_signal_ingestion.sql

-- Multiple ICP segments per workspace (Team plan exposes this in the UI).
create table workspace_icps (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,                       -- e.g. "Fintech founders, Series A+"
  description     text not null,                       -- prose used by the matcher LLM
  must_haves      jsonb not null default '[]'::jsonb,  -- hard filters
  nice_to_haves   jsonb not null default '[]'::jsonb,
  match_threshold numeric(5,4) not null default 0.6,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Tracked companies (for ATS polling) + their domains / handles.
-- Foundation ships a CURATED catalog of ~1000 known tech companies
-- with greenhouse/lever/ashby/workable board ids; workspaces opt in
-- per company OR by filter ("all fintech series A+").
create table tracked_companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  domain          citext,
  industry        text,
  size_bucket     text,
  greenhouse_id   text,    -- if uses Greenhouse, the public board name (slug)
  lever_id        text,
  ashby_id        text,
  workable_id     text,
  career_rss_url  text,
  properties      jsonb not null default '{}'::jsonb,
  added_at        timestamptz not null default now()
);
-- This table is workspace-AGNOSTIC: the catalog is shared. Workspaces
-- opt in via workspace_tracked_companies below.

create unique index tracked_companies_domain_idx on tracked_companies (domain) where domain is not null;

create table workspace_tracked_companies (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  company_id    uuid not null references tracked_companies(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (workspace_id, company_id)
);

-- Per-(workspace, graph_source) cursor + cadence + budget state.
create table workspace_source_configs (
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  source_id         uuid not null references graph_sources(id) on delete cascade,
  enabled           boolean not null default true,
  poll_cadence_sec  integer not null default 900,
  config_overrides  jsonb not null default '{}'::jsonb,
  cursor            jsonb not null default '{}'::jsonb,
  last_polled_at    timestamptz,
  last_error        jsonb,
  primary key (workspace_id, source_id)
);

-- Daily ingestion budgets (candidates pulled, classify calls used).
create table workspace_ingestion_budgets (
  workspace_id          uuid primary key references workspaces(id) on delete cascade,
  daily_candidate_cap   integer not null default 5000,
  daily_classify_cap    integer not null default 1000,
  daily_candidates_used integer not null default 0,
  daily_classify_used   integer not null default 0,
  window_start          timestamptz not null default now()
);

-- Audit overflow when the cap is reached.
create table signal_overflow (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  source_id     uuid references graph_sources(id) on delete set null,
  reason        text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null default now()
);
```

Notes:

- **Multi-ICP** locked via `workspace_icps`. The matcher iterates segments and picks the best-scoring one above its threshold; a signal can match one segment but not another.
- **Tracked companies catalog** is workspace-agnostic — the platform maintains it. Workspaces opt in per company, OR via a filter (industry + size bucket); the filter resolves to a set of tracked_companies on save and stores them in `workspace_tracked_companies`. This makes the catalog reusable and avoids each workspace duplicating the work.

---

## Code surface (Phase 1)

```
core/ingest/
├── adapters/
│   ├── greenhouse.ts         # public board API; per-company poll
│   ├── lever.ts              # public board API; per-company poll
│   ├── ashby.ts              # public board API; per-company poll
│   ├── workable.ts           # public board API; per-company poll
│   ├── hn-whos-hiring.ts     # monthly Ask HN thread via Algolia
│   ├── career-rss.ts         # generic Atom/RSS for /careers feeds
│   ├── sec-edgar.ts          # filings atom feed; classify by form/item code
│   ├── hackernews.ts         # front + Show HN + keyword search
│   ├── product-hunt.ts       # GraphQL launches
│   ├── rss.ts                # generic RSS / Atom (TC, blogs, Google News)
│   └── reddit.ts             # subreddit JSON
├── novelty.ts                # novelty_key + pgvector fuzzy dedup
├── embeddings.ts             # DeepSeek embedding wrapper for stage 1
├── budget.ts                 # candidate + classify caps with daily rollover
├── classify.ts               # DeepSeek batch classifier + entity extractor
├── workspace-discovery.ts    # event-first source-backed signal discovery primitive
├── poll-workflow.ts          # durable workflow per (workspace, source)
├── classify-workflow.ts      # durable workflow subscribed to signal.ingested
├── catalog.ts                # tracked_companies management
└── tools.ts                  # MCP tools (signals.list, signals.dismiss, ingest.poll_now)
```

A workspace turns ingestion on by:

1. Defining one or more ICP segments in `workspace_icps`.
2. Opting in to companies (`workspace_tracked_companies`) — either explicitly or via filter.
3. Enabling sources (`workspace_source_configs`) — per default we pre-enable Greenhouse, Lever, Ashby, Workable, HN Who-is-hiring, SEC EDGAR, ProductHunt, HN front, and a default set of RSS feeds.
4. The platform starts the `signal_ingest:<source_kind>` workflows for that workspace; they persist their cursors in the DB and resume on restart.

---

## Failure modes & cost protections

- **Source down**: adapter throws → workflow logs `signal.ingest.failed` → backs off (15 min → 1 h → 6 h) → resumes.
- **Rate limit (429)**: respect `Retry-After`; back off; reduce cadence for that source if persistent.
- **Parser breakage**: items that fail to parse get quarantined; never crash the workflow.
- **Daily cap reached**: workflow continues to poll but inserts hit-cap rows into `signal_overflow`; no LLM is invoked.
- **Bad ICP match (over-eager)**: per-segment `match_threshold` gates `signal.matched`. Default 0.6; tune per segment.

---

## Decisions (locked)

| #  | Decision                                                                                  |
|----|-------------------------------------------------------------------------------------------|
| 1  | **Multi-ICP per workspace** via `workspace_icps`. Team plan exposes the UI.               |
| 2  | **DeepSeek V4 Pro everywhere** — classifier, judge, writer. One vendor, simplest billing. |
| 3  | **Hiring-first**: ATS adapters (Greenhouse/Lever/Ashby/Workable) + HN "Who is hiring" + career-page RSS are Phase 1 primary. Tracked-companies catalog is platform-owned + workspace-opt-in. |
| 4  | **GDELT deferred to Phase 1.5**. RSS + Google News + Reddit cover news first.             |
| 5  | **Embeddings + fuzzy dedup in Phase 1**. ~$0.01/day per workspace; cleaner data is worth it. |

---

## What lands in commit 1

Schema migration (`db/migrations/015_signal_ingestion.sql`) — the locked schema above.

Following commits land adapters + workflows + tests, source by source.
