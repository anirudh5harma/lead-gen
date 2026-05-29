# Signal Ingestion — Design

## Context

The Signal primitive is the platform's *input*. Every Play, Rep, and outcome chain downstream is reactive — they fire because a signal landed. Today signals only exist when hand-inserted; this design turns the system from demand-driven to **continuously fed**, with cost discipline so the bill stays predictable.

**Primary product focus: hiring signals across the web.** Users want a live picture of who in their domain is hiring for what — so the ATS adapters (Greenhouse, Lever, Ashby, plus HN "Who is hiring" and career-page RSS) are first-class. Funding / leadership / M&A / launches stay in the mix as auxiliary signals.

Goals:

1. **Hiring intelligence at scale**: track every job posting we can legally see across thousands of companies; surface what roles, functions, seniorities, and trends matter to each workspace.
2. **Cover the rest of the 12 kinds** the schema already names — funding, leadership change, product launch, acquisition, churn risk, competitor move, podcast / press mention, regulation, expansion, layoff — with secondary sources.
3. **Cost discipline**: free sources cover ~80% of value. Paid sources only when they uniquely unlock a kind no free source touches.
4. **Architecture-honest**: no Vercel crons for orchestration; ingestion runs on the durable workflow runtime, typed events at every boundary.

---

## Source matrix (decisions baked in)

### Phase 1 — hiring-first

| Source                          | Best for                                                                  | Cost | Notes |
|---------------------------------|---------------------------------------------------------------------------|------|-------|
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
| **X / Twitter API Basic** | competitor_move, product_launch, real-time mentions | $200/mo |
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
2. Lightweight rules drop obvious noise (keyword filters, date-window, language).
3. **Embedding step**: compute a DeepSeek embedding on `title + first 200 chars` of each surviving item (~$0.0001 each). Store on `signals.embedding`.
4. **Dedup, two-tier**:
   - **Exact**: `novelty_key = sha256(canonical_company_domain ':' rough_kind_hint ':' iso_week)`. Collision → drop + bump `novelty_count` on the original.
   - **Fuzzy**: pgvector cosine similarity > 0.85 against same workspace + 7-day window. Match → drop + bump `novelty_count` (a high count is itself a "this is being widely covered" signal).
5. Surviving items insert into `signals` with `status='ingested'`, `kind=NULL`.
6. `signal.ingested` event published per insert.

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
