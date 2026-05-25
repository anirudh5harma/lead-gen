# Signal Ingestion — Design

## Context

The Signal primitive is the platform's *input*. Every Play, Rep, and outcome chain downstream is reactive — they fire because a signal landed. Today signals only exist when hand-inserted; this design turns the system from demand-driven to **continuously fed**, with cost discipline so the bill stays predictable.

Goals:

1. **Coverage**: capture all 12 signal kinds the schema already names — funding, hiring, leadership change, product launch, acquisition, churn risk, competitor move, podcast / press mention, regulation, expansion, layoff.
2. **Quality**: high signal-to-noise. Better to miss a marginal item than burn a Rep's reputation on a noisy match.
3. **Cost discipline**: free sources cover ~80% of value. Paid sources only when they uniquely unlock a kind no free source touches.
4. **Architecture-honest**: no Vercel crons for orchestration; ingestion runs on the durable workflow runtime, typed events at every boundary.

---

## Source matrix

Each cell shows the **best-fit signal kinds** for the source, and the cost tier. Sources rated by *unique value per dollar*, not just total signals.

| Source                            | Best for                                                          | Cost     | Phase |
|-----------------------------------|-------------------------------------------------------------------|----------|-------|
| **SEC EDGAR** (Atom + filings)    | funding (S-1), acquisition (S-4, 8-K item 2.01), leadership_change (8-K item 5.02), regulation (10-K risk factors) | Free     | 1     |
| **HackerNews** (Algolia search)   | product_launch (Show HN), competitor_move, press_mention, podcast_mention | Free     | 1     |
| **ProductHunt** (GraphQL)         | product_launch                                                    | Free     | 1     |
| **Greenhouse / Lever / Ashby** public board APIs | hiring, expansion, leadership_change (key role hires)   | Free     | 1     |
| **GDELT** Doc API                 | press_mention, regulation, churn_risk, competitor_move (broad news) | Free     | 1     |
| **RSS** (TechCrunch, Verge, custom company blogs, Substack) | press_mention, product_launch, funding (news), leadership_change | Free     | 1     |
| **Google News RSS** (per-keyword) | press_mention, podcast_mention, competitor_move                   | Free     | 1     |
| **Reddit JSON** (subreddit feeds) | competitor_move, churn_risk (user complaints), regulation         | Free     | 1     |
| **Bluesky / Mastodon**            | early-adopter social mentions                                     | Free     | 1.5   |
| **X / Twitter API Basic**         | competitor_move, product_launch, leadership_change (real-time)    | $200/mo  | 2     |
| **Listen Notes** API              | podcast_mention                                                   | $30+/mo  | 2     |
| **Crunchbase API**                | funding (deep historical), people moves                           | $$$/mo   | 3 (skip) |
| **LinkedIn scraping**             | hiring (broad), leadership_change                                  | $$$/mo   | 3 (skip) |

**Phase 1 covers all 12 signal kinds with $0 of source cost.** The only spend in Phase 1 is LLM classification — and that's metered + budgeted per workspace.

---

## Two-stage pipeline

Cost discipline is enforced by splitting ingestion into two stages: a cheap polling stage that runs everywhere, and an expensive LLM-classification stage that only runs on items that survive cheap filters.

### Stage 1 — Ingest candidates  (no LLM, high volume)

For each `(workspace, source)` pair, a durable workflow polls on a cadence:

1. Adapter fetches items since the stored cursor.
2. Lightweight rules drop obvious noise (keyword filters, date-window, language).
3. Novelty dedup (see below) drops duplicates of the same underlying event.
4. Surviving items insert into `signals` with `status='ingested'`, `kind=NULL`.
5. `signal.ingested` event published per insert.

Cadence per source (rough):
- News-style RSS: 15 min
- SEC EDGAR: 15 min
- HackerNews Algolia: 30 min
- ProductHunt: 1 h
- Greenhouse/Lever/Ashby per company: 6 h
- GDELT: 30 min
- Google News RSS keywords: 1 h

### Stage 2 — Classify + match  (LLM, batched)

Subscribed to `signal.ingested`. Pulls in batches (default N = 8) and issues **one LLM call per batch**:

- Classify each candidate into one of 12 `SignalKind`s (or `dismiss`).
- Extract structured entities: company (name + domain), person (name + title + linkedin), funding round details, role title, etc.
- Match each against the workspace's ICP → `match_score`, `match_reason`, `audience_hint`.
- Resolve entities against the knowledge graph (upsert via existing graph adapters; create `mentioned_in` edges).

Outputs per candidate:
- `signal.matched`  (if match_score ≥ workspace.match_threshold)
- `signal.dismissed`  (otherwise — kept in DB for forensics, status flips)

Batching collapses LLM calls ~8× without losing classification quality (DeepSeek handles list-classification well in JSON mode). At ~$0.001 per batch, a workspace ingesting 1k candidates / day classifies for ~$0.15 / day.

---

## Novelty / dedup

A funding round shows up in: TC → HN → Crunchbase RSS → press release. Without dedup, that's 4 signals.

Two-tier:

1. **Exact**: `novelty_key = sha256(canonical_company_domain || ':' || rough_kind_hint || ':' || iso_week(item_date))`.
   Computed by the adapter from cheap signals (extracted domain, URL keywords, date). Collision → drop, increment `novelty_count` on the original signal.

2. **Fuzzy** (Phase 1.5): pgvector cosine similarity on `title` embeddings > 0.85 within the same workspace and a 7-day window → cluster. The schema already has `embedding vector(1536)` on `signals`; needs an embedding pipeline (defer to Phase 1.5 to keep cost down — exact dedup catches the majority).

---

## Per-workspace configuration

Add to schema:

```sql
-- 015_signal_ingestion.sql
alter table workspaces add column icp jsonb not null default '{}'::jsonb;
-- icp shape: { segments: [{ name, description, must_haves, nice_to_haves }], match_threshold }

create table workspace_source_configs (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id    uuid not null references graph_sources(id) on delete cascade,
  enabled      boolean not null default true,
  poll_cadence_sec integer not null default 900,
  config_overrides jsonb not null default '{}'::jsonb,
  cursor       jsonb not null default '{}'::jsonb,   -- adapter-specific cursor state
  last_polled_at timestamptz,
  last_error   jsonb,
  primary key (workspace_id, source_id)
);

create table workspace_ingestion_budgets (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  daily_candidate_cap integer not null default 5000,
  daily_classify_cap  integer not null default 1000,
  daily_candidates_used integer not null default 0,
  daily_classify_used integer not null default 0,
  window_start timestamptz not null default now()
);
```

A workspace's ICP isn't a literal column today — putting it on `workspaces` keeps it close to the boundary that already owns auth + tenancy.

---

## Code surface (Phase 1)

```
core/ingest/
├── adapters/
│   ├── sec-edgar.ts          # Atom feed; parse 8-K item codes
│   ├── hackernews.ts         # Algolia search
│   ├── product-hunt.ts       # GraphQL
│   ├── greenhouse.ts         # public board API
│   ├── lever.ts              # public board API
│   ├── ashby.ts              # public board API
│   ├── rss.ts                # generic RSS / Atom (TC, blogs, Google News)
│   ├── gdelt.ts              # GDELT Doc API
│   └── reddit.ts             # subreddit JSON
├── novelty.ts                # novelty_key + (Phase 1.5) vector clustering
├── budget.ts                 # candidate + classify caps with rollover
├── classify.ts               # LLM batch classifier + entity extractor
├── poll-workflow.ts          # durable workflow per (workspace, source)
├── classify-workflow.ts      # durable workflow subscribed to signal.ingested
└── tools.ts                  # register a few MCP tools (signals.list, signals.dismiss)
```

Each adapter is ~80–150 lines. Each defines a `SignalSourceAdapter` with `poll(config, cursor) → { items, cursor }`.

A workspace gets ingestion running by:
1. Inserting `graph_sources` rows for each adapter it wants.
2. Inserting `workspace_source_configs` rows (with cadence + initial cursor).
3. Starting `signal_ingest:<source_kind>` workflows. The workflows persist; on restart they pick up cursors from the DB.

---

## Failure modes & cost protections

- **Source down**: adapter throws → workflow logs `signal.ingest.failed` → backs off (15 min → 1 h → 6 h) → resumes.
- **Rate limit (429)**: respect `Retry-After`; back off; reduce cadence for that source if persistent.
- **Parser breakage**: items that fail to parse get quarantined in a `signal_quarantine` table (Phase 1.5) — never crash the workflow.
- **Daily cap reached**: workflow continues to poll but inserts hit-cap signals into a `signal_overflow` audit log; no LLM is invoked.
- **Bad ICP match (over-eager)**: a `match_threshold` per workspace gates `signal.matched`. Default 0.6; tune per workspace.

---

## What we explicitly defer

- **X (Twitter) API** — $200/mo. Phase 2; ROI depends on whether the persona cares about Twitter as a signal source.
- **Listen Notes** — podcast mentions are marginal value for most ICPs. Phase 2.
- **Crunchbase / PitchBook** — paid + slow to integrate. SEC EDGAR + RSS + GDELT cover ~80% of what they offer for tech outbound. Phase 3 / skip.
- **LinkedIn scraping** — risky + costly. Phase 3 / skip.
- **Embedding pipeline** for fuzzy dedup — Phase 1 ships with exact dedup; embedding-based dedup comes when the cost of dupes becomes visible.
- **Multi-ICP per workspace** — single `workspaces.icp` jsonb for v1; promote to a table when a workspace needs more than one.

---

## Open decisions (need your call before code)

1. **ICP shape — single or many?** Foundation defaults to one ICP per workspace stored on `workspaces.icp`. Confirm — or do we need multiple ICP segments per workspace from day one?
2. **Classify-stage model**: DeepSeek V4 Pro for everything (per existing architecture), OR a smaller / cheaper DeepSeek model for the classifier batch call to push cost down further? Per-batch cost is already low; defaulting to V4 Pro keeps it simple.
3. **Per-source company tracking for Greenhouse/Lever/Ashby**: workspace declares a list of target companies, OR we maintain a curated catalog of "known tech companies on Greenhouse" and let workspaces opt in? Catalog is more useful but more work.
4. **GDELT** as a Phase 1 source — high volume and noisy. Include in Phase 1 with conservative filters, or defer to 1.5 and let RSS + Google News cover the news bucket first?
5. **Embedding generation in Phase 1**: skip (exact dedup only) and accept some dupes, OR add an embedding step in stage 1 so fuzzy dedup is available from day one? Skipping is cheaper; adding shows up as ~$0.0001 per item (DeepSeek embeddings) which adds maybe $0.10/day at 1k items.

Decisions on the above lock the schema (one migration) and the source-adapter set for the first commit.

---

## Why this design (in one paragraph)

The architecture's hardest claim about ingestion is "every state change is a typed event, no crons for orchestration." A two-stage pipeline honours that: stage 1 emits `signal.ingested` for every cheap pull, stage 2 batches off that event and emits `signal.matched` / `signal.dismissed`. The cost-shaping work happens between the stages (cheap filters + exact dedup before any LLM call), so a workspace gets autonomous, all-day signal feeding for cents — and the architecture stays honest.
