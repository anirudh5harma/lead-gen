# Exa Intelligence Layer

## Purpose

Exa should be the product's public-web intelligence layer. It is not a
dashboard, a separate research product, or a replacement for native X/LinkedIn
providers. Its job is to let Reps discover, read, and monitor the public web so
Profile, Brief, Outreach, Content, Campaigns, and AEO feel autonomous from the
first user session.

This fits the architecture in `ARCHITECTURE.md`:

- Exa output becomes `Signal`, graph evidence, Rep memory, or draft grounding.
- Reps use Exa through primitive tools, not hard-coded feature flows.
- Plays compile Exa-backed research into durable workflow steps.
- Every useful result carries provenance, source URL, freshness, confidence, and
  cost metadata.
- The UI surfaces outcomes, review moments, and proof only when trust requires
  it.

Primary Exa surfaces to design around:

- Search API: <https://docs.exa.ai/reference/search>
- Contents API: <https://docs.exa.ai/reference/get-contents>
- People Search: <https://docs.exa.ai/reference/verticals/people>
- Websets: <https://docs.exa.ai/websets/api/overview>
- Pricing: <https://exa.ai/pricing>

## Product Thesis

Exa is strongest when used as hidden context for agent decisions:

```text
workspace intent
-> Exa discovers public-web evidence
-> graph stores evidence and relationships
-> Rep reasons over fresh context
-> Play proposes or performs work
-> judge verifies factual grounding
-> user sees only the brief, draft, outcome, or exception
```

The user should not experience Exa as a feed. They should experience it as:

- a profile that fills itself in,
- a Brief that knows what changed,
- outreach that cites a real reason,
- content that responds to market movement,
- campaigns that find their own target universe,
- AEO that knows where the company is missing from public answers.

## Boundaries

Use Exa for:

- Company and market profile enrichment.
- Public-web signal discovery.
- Fresh research before Rep actions.
- Draft grounding and factual evidence.
- Content opportunity discovery.
- Campaign audience expansion.
- AEO coverage and gap analysis.
- Source discovery for later dedicated adapters.

Do not use Exa for:

- Guaranteed live X/Twitter ingestion.
- Guaranteed live LinkedIn post/comment ingestion.
- Private social data.
- Contact-data verification.
- A social firehose or CRM replacement.
- Direct sends, publishing, or channel actions.

X and LinkedIn providers can be added later for the narrow gaps Exa proves are
worth paying for.

## Where Exa Fits

| Product Area | Exa Role | Stored As | User Sees |
|---|---|---|---|
| Profile | Build workspace/company/ICP context from the public web | Company nodes, Source nodes, Evidence nodes, semantic memory | A cleaner Profile, suggested positioning, competitors, audience notes |
| Reps | Retrieve fresh context before deciding or writing | Episodic research traces, semantic memory, procedural hints | Better Brief notes, better drafts, fewer generic actions |
| Signal Ingestion | Discover open-web changes and intent pages | `Signal` candidates with evidence provenance | Important changes and review moments |
| Outreach | Ground every draft in specific evidence | Draft provenance, judge context, Conversation trust trace | A draft with a real reason and proof |
| Content | Find market questions, competitor narratives, and content gaps | Content opportunity Signals, Post ideas, graph evidence | Suggested angles and drafts |
| Campaigns | Find and refresh target universes | Company/Person nodes, matched Signals, Play inputs | Campaigns that feel alive without table work |
| AEO | Audit category visibility and answer gaps | AEO coverage nodes, competitor mentions, evidence pages | Missing topics, pages to update, proof sources |

## Primitive Mapping

Exa must stay inside the five product primitives:

- `Rep`: asks Exa-backed tools for context, then decides what to do.
- `Signal`: represents a public-web change or intent moment found through Exa.
- `Play`: defines when Exa research happens and how the result gates action.
- `Conversation`: stores draft/send/reply context grounded by Exa evidence.
- `Outcome`: teaches which Exa-backed signals and evidence patterns actually
  converted.

Derived nouns like "lead", "campaign", "draft", "topic", and "AEO issue" are
views over these primitives.

## Graph Model

Exa results should be projected into the knowledge graph, not left as raw search
results.

Minimum node types:

- `Company`
- `Person`
- `Signal`
- `Source`
- `Post`
- `Message`
- `Outcome`

Recommended evidence shape:

```json
{
  "source": "exa",
  "source_url": "https://example.com/page",
  "exa_result_id": "optional-provider-id",
  "title": "Page title",
  "snippet": "Short evidence summary",
  "published_at": "2026-06-03T00:00:00.000Z",
  "fetched_at": "2026-06-03T00:00:00.000Z",
  "query": "semantic query used",
  "query_intent": "profile_bootstrap | brief_refresh | rep_research | signal_discovery | draft_grounding | content_research | aeo_audit",
  "confidence": 0.82,
  "cost_units": 1,
  "workspace_id": "..."
}
```

Recommended edges:

- `Company -MentionedIn-> Source`
- `Person -WorksAt-> Company`
- `Signal -SupportedBy-> Source`
- `Signal -MatchedBy-> Play`
- `Message -GroundedIn-> Source`
- `Outcome -InfluencedBy-> Signal`
- `Post -RespondsTo-> Signal`

If the graph cannot explain why a Rep acted, the Exa integration is incomplete.

## Tool Design

Build primitive Exa tools first. Product workflows compose them.

Recommended internal/MCP tools:

- `exa.search`: semantic search over the public web.
- `exa.get_contents`: fetch clean page contents for URLs or Exa result IDs.
- `exa.find_people`: people discovery for public profile research.
- `exa.find_companies`: company discovery from ICP or market criteria.
- `exa.webset.create`: create a constrained monitored set when a durable watch is
  useful.
- `exa.webset.results.list`: list monitored results.
- `exa.costs.get`: read workspace/provider usage and remaining budget.

Product-level tools can wrap these only when they mirror a real user action:

- `product.profile.enrich`
- `product.rep.research`
- `product.signal.discover_open_web`
- `product.draft.ground`
- `product.content.opportunities.discover`
- `product.aeo.audit`

The primitive Exa tools remain available to Reps and external MCP clients so the
system keeps action parity.

## Durable Workflows

### `profile.bootstrap.exa`

Trigger: user submits company URL during onboarding or updates Profile.

Steps:

1. Read owned website extraction from Firecrawl.
2. Search Exa for company, competitors, category pages, founder/team pages,
   customer proof, product docs, and recent announcements.
3. Fetch top contents.
4. Resolve company/person/source nodes.
5. Extract reusable profile intelligence: source domains, market terms, evidence
   cards, ICP, positioning, competitor, audience, and proof candidates.
6. Emit `workspace.profile.enriched`.
7. Update Profile and Rep context.

Output:

- Workspace profile enrichment with graph evidence, a public-web summary, and
  structured company intelligence that Reps, Plays, Content, and AEO can reuse.
- Suggested ICP and competitor context.
- First evidence set for Reps.

### `rep.brief.refresh.exa`

Trigger: scheduled durable wake, source change, or user opens Brief.

Steps:

1. Load workspace intent, active Reps, Plays, and recent Outcomes.
2. Ask Exa narrow questions tied to active goals.
3. Fetch only high-confidence contents.
4. Store evidence and candidate Signals.
5. Summarize what matters for today's Brief.

Output:

- Brief notes, review items, recent changes, and quiet exceptions.

### `signal.discover.open_web.exa`

Trigger: workspace source config, Rep-created watch, or Play-defined need.

Steps:

1. Generate constrained semantic queries from ICP, competitors, keywords, and
   active Plays.
2. Run Exa Search or read Webset results.
3. Normalize each result into a source-backed Signal candidate.
4. Deduplicate by URL, canonical company, rough kind, and time window.
5. Emit `signal.discovered`.
6. Let existing ingestion classification, matching, graph projection, and Play
   dispatch continue.

Output:

- Open-web Signals with provenance and source confidence.

### `draft.grounding.exa`

Trigger: before an outbound, reply, LinkedIn, or content draft reaches the
writer role.

Steps:

1. Load Signal, company/person graph, Rep memory, and Play.
2. Use Exa only if graph evidence is stale or weak.
3. Fetch evidence content.
4. Pass evidence to writer and judge.
5. Require judge to confirm factual grounding before approval/send.

Output:

- Drafts that have a real reason, source URL, and proof trace.

### `content.opportunity.exa`

Trigger: content Rep wake, campaign plan, or AEO gap.

Steps:

1. Search category questions, competitor narratives, launch themes, and unmet
   buyer problems.
2. Cluster results into content opportunities.
3. Store opportunity Signals and evidence.
4. Generate angles, not full drafts, until the Rep chooses or a Play gates it.

Output:

- Content opportunities and drafts grounded in market evidence.

### `aeo.audit.exa`

Trigger: profile completion, weekly wake, or user request.

Steps:

1. Generate answer-style category queries from ICP and positioning.
2. Search the public web for current answers, competitor mentions, and citation
   pages.
3. Compare workspace/company coverage against competitors.
4. Store missing topics, missing proof pages, and recommended updates.
5. Emit review items or content/page Plays.

Output:

- AEO coverage map, missing pages, and content Plays.

## Event Contract

Add typed events when implementation starts:

- `exa.query.requested`
- `exa.query.completed`
- `exa.contents.fetched`
- `exa.evidence.projected`
- `workspace.profile.enriched`
- `rep.research.completed`
- `aeo.audit.completed`
- `content.opportunity.discovered`

Do not let route handlers write Exa results directly to profile, signal, or graph
tables. Routes and UI actions start workflows or call tools; projectors own
state.

## Current Implementation Status

Implemented and verified:

- Exa client support for Search, Contents, People-style search, company-style
  search, Websets create/list, and primitive tool registration.
- Product tools for Profile enrichment, Rep research, durable Exa research
  starts, draft grounding, content opportunities, AEO audit, and open-web Signal
  source configuration.
- Restate workflow services for `profile.bootstrap.exa`,
  `rep.brief.refresh.exa`, `rep.research.exa`, `draft.grounding.exa`,
  `content.opportunity.exa`, `aeo.audit.exa`, and
  `signal.discover.open_web.exa`.
- Graph evidence projection into `graph_sources` with provider, URL, Exa result
  id, query, query intent, snippet, request id, and timestamps.
- Workspace Profile enrichment that stores public-web summary, source domains,
  market terms, positioning notes, competitor mentions, audience terms, proof
  points, evidence cards, evidence source ids, and result counts.
- Query cache in `workspace_exa_query_cache`, content cache in
  `workspace_exa_content_cache`, and append-only usage ledger in
  `workspace_exa_usage`.
- Direct Exa search/contents primitive calls are routed through the workspace
  cache/ledger with daily search, daily contents, monthly unit, and per-Play
  research gates before live Exa calls.
- Exa Webset create/list primitive calls are routed through the same
  workspace ledger and budget gates as monitored public-web research, with
  `webset_create`, `webset_list`, and deferred lifecycle rows in
  `workspace_exa_usage`.
- Brief refresh uses durable `rep.brief.refresh.exa` to gather fresh public-web
  evidence, project sources into the graph, and emit `rep.brief.refreshed` with
  notes, review items, recent changes, and quiet exceptions for the morning
  Brief surface.
- Content opportunities emit structured `opportunities` / `review_items`, and
  AEO audits emit structured `gaps` / `review_items`; both are projected into
  the Content and AEO canvas surfaces and into prompt-ready workspace context
  with graph evidence source ids and proof URLs.
- Operators can keep or skip Exa-backed Content/AEO recommendations from the
  canvas surfaces. The same capability is exposed to agents as
  `product.recommendation.review` and emits `recommendation.reviewed`, letting
  accepted recommendations remain in prompt context while ignored items leave
  the review queue.
- The latest `recommendation.reviewed` decisions are projected into lightweight
  quality metrics: reviewed, kept, skipped, keep rate, and last-reviewed time
  for all recommendations, Content opportunities, and AEO gaps. The same
  summary appears in workspace agent context so future Rep and Exa planning can
  bias toward operator-kept evidence.
- Repeated kept recommendation feedback now compounds into Rep procedural
  memory through `recommendation.learning_to_procedural_memory.v1`. The
  projector waits for at least three accepted recommendations of the same kind
  and a keep rate above the quality threshold, then emits
  `rep.memory.procedural.seeded` with kept/skipped examples. This avoids
  overfitting to a single operator click while keeping the path replayable.
- Content and AEO research now plan Exa queries with that procedural memory:
  before search, the planner retrieves active Rep exemplars for
  `recommendation:content_opportunity|stage:exa_review` or
  `recommendation:aeo_gap|stage:exa_review`, appends compact kept/skipped
  evidence hints to the Exa query, and records typed `query_plan` provenance on
  Exa request/completion/projection events.
- Signal-to-email and Signal-to-LinkedIn Plays automatically call Exa draft
  grounding when the triggering Signal lacks Exa proof or carries stale proof;
  the grounding summary reaches the writer and hot-path judge, and the draft
  stores `exa_grounding` provenance.
- `exa.costs.get` reports configured state, caps, 24-hour/monthly usage,
  remaining budget, active cache entries, cache hits, and deferred calls.
- Typed Exa event metadata for cache hits, query hashes, usage ids, content
  fetches, and evidence projection.
- Exa-sourced Signal influence on Signal-to-email and Signal-to-LinkedIn draft
  provenance and simulated Outcome properties/provenance.
- Production canary: `npm run verify:exa` starts `draft.grounding.exa`,
  `rep.brief.refresh.exa`, `content.opportunity.exa`, and `aeo.audit.exa`,
  waits for completion, and verifies evidence sources, typed
  completion/projection events, query cache, content cache, usage ledger rows,
  and Content/AEO review payloads.

Remaining hardening:

- Add outcome attribution once accepted Content/AEO recommendations are turned
  into published work or measurable answer-visibility changes.

## Cost And Quality Controls

Every Exa workflow must have:

- Workspace monthly spend cap.
- Daily query cap.
- Daily contents cap.
- Per-Play research cap.
- Query cache by `(workspace_id, query, filters, day)`.
- Content cache by canonical URL.
- Kill switch per workspace source.
- Provenance on every stored result.
- Judge or classifier before a result can trigger action.

Default rule:

```text
Search broadly, fetch narrowly, act only after graph projection and eval.
```

Current enforcement:

- Implemented: query cache, content cache, usage ledger, source-level kill switch
  and source-level call/item/spend controls for Exa open-web Signal polling,
  direct daily/monthly/per-Play gates for search, contents, and Webset
  primitives, `exa.costs.get`, graph projection, and provenance on stored Exa
  evidence.
- Partial: judge/classifier protection exists in the downstream Play/send path,
  but standalone Exa research events are evidence-gathering steps and do not
  trigger channel action by themselves.
- Implemented: aggregate operator-quality metrics for accepted/ignored
  Content/AEO recommendations from `recommendation.reviewed`.
- Implemented: repeated kept/skipped recommendation patterns can seed Rep
  procedural memory after the minimum-feedback threshold.
- Implemented: Content/AEO Exa query planning retrieves those procedural
  patterns and records typed `query_plan` provenance.
- Remaining: connect accepted recommendation patterns to downstream Outcomes
  once Content/AEO execution produces attributable result events.

## UI Contract

Exa should be mostly invisible in the product UI.

Brief:

- "What changed today?"
- "What needs review?"
- "What did the Reps do?"
- "What landed?"

Profile:

- Show suggested positioning, competitors, audience, and proof.
- Let the user accept, edit, or ignore.
- Keep raw source lists behind proof/details.

Outreach:

- Show one reason and one proof source for each draft.
- Hide source mechanics unless the user opens the trust trace.

Content:

- Show angles and drafts, not feeds.
- Let proof/citations expand inline.

Campaigns:

- Show target motion and readiness.
- Avoid source tables unless debugging.

AEO:

- Show gaps, page recommendations, and competitor coverage.
- Keep raw Exa result pages behind evidence drawers.

## Evaluation

Exa integration is useful only if it improves outcomes. Track:

- Profile completion quality after one URL.
- Percent of drafts with specific evidence.
- Generic-draft rejection rate.
- Signal-to-action conversion.
- Signal-to-positive-outcome conversion.
- Content opportunity acceptance rate.
- AEO recommendation acceptance rate.
- Cost per useful Signal.
- Cost per accepted draft.
- Cost per positive Outcome influenced by Exa.

## Implementation Phases

### Phase 1: Profile and Rep context

Build:

- `EXA_API_KEY` env support.
- Exa client with Search and Contents.
- Primitive tools: `exa.search`, `exa.get_contents`.
- `profile.bootstrap.exa` workflow.
- Graph projection for Exa evidence.
- Profile UI suggestions.

Success:

- A user enters a company URL and gets a materially richer Profile without
  manual research.

### Phase 2: Draft grounding

Build:

- `draft.grounding.exa` workflow step.
- Writer/judge context wiring.
- Conversation trust trace evidence display.

Success:

- Outreach drafts include a specific reason, evidence URL, and judge-approved
  factual grounding.

### Phase 3: Open-web Signals

Build:

- `signal.discover.open_web.exa`.
- Workspace source config for `exa`.
- Exa query budgets and URL/content cache.
- `signal.discovered` integration.

Success:

- Exa produces useful open-web Signals without flooding the Brief.

### Phase 4: Content and AEO

Build:

- `content.opportunity.exa`.
- `aeo.audit.exa`.
- AEO gap projection.
- Content opportunity review surface.

Success:

- Reps suggest market-backed content and AEO updates from public evidence.

### Phase 5: Social-provider gap fill

Build only after Exa proves which signal patterns matter:

- Dedicated X provider for fresh posts/replies.
- Dedicated LinkedIn provider for known company/person activity where legal and
  commercially justified.

Success:

- Paid social data fills measured gaps instead of becoming default ingestion.

## First Build Checklist

1. Add `EXA_API_KEY` to env contract and readiness.
2. Implement a typed Exa client.
3. Add primitive Exa tools to the registry and MCP manifest.
4. Add Exa evidence projection to the graph.
5. Build `profile.bootstrap.exa`.
6. Wire onboarding Profile enrichment through the workflow.
7. Add cost caps and caches before broad ingestion.
8. Add tests for tool registry, workflow events, graph projection, and Profile
   output.

## Non-Goals

- No raw Exa dashboard.
- No bypass around event bus or graph projection.
- No broad social scraping.
- No user-cookie LinkedIn workflows.
- No sends or posts directly from Exa results.
- No X/LinkedIn procurement until Exa-backed quality and gap data exists.
