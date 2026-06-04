# Designing AI-Native GTM Infrastructure — From Scratch

## Context

This is not an implementation plan. It is an opinionated architectural design for a state-of-the-art AI-native GTM platform that lets agents, founders, and small teams run **outbound, online content, and campaigns on autopilot — reliably**. The brief was: think independently, do not be influenced by how Bombsell is built today. The final section calls out where current Bombsell already matches the design and where it is structurally different.

The product must do three things well, in this order: (1) **decide who to talk to and what to say**, (2) **execute across channels without losing messages or burning sender reputation**, and (3) **learn from outcomes faster than a human SDR or content marketer could**. Everything in the design serves those three jobs.

---

## Current Bombsell — 60-Second Snapshot

Bombsell is a Next.js 16 + Supabase + Claude Sonnet 4.6 app. Two engines (outbound + content) orchestrated by an operator agent, 17 system agents with per-agent autonomy levels, OAuth-connected Gmail/Outlook with inbox rotation, enrichment waterfall (Apollo → FullEnrich → Hunter → ZeroBounce), signal ingestion from GDELT/HN/Product Hunt/RSS, content publishing via Typefully/Buffer/Ayrshare, MCP server for external agents, outcome-based credit ledger, agency-style workspaces. Async work runs on Vercel cron + DB-backed queues (`lead_delivery_queue`, `gtm_integration_outbox`). No durable workflow engine, no event bus, no native knowledge graph, agents are dispatched per-cron rather than long-running, prompts are inline in worker files.

---

## First Principles — What "AI-Native GTM" Actually Means

Most "AI GTM" tools are 2018 SaaS with an LLM bolted onto the compose box. AI-native means the opposite: **the agent is the primary user; the human UI is a window into agent state**. Five principles follow from that inversion.

1. **The unit of work is a long-running, durable agent — not a job.** Agents have identity, memory, taste, and a backlog. They wake on events, not crons.
2. **The unit of context is a knowledge graph, not a row in `leads`.** Every entity (person, company, signal, message, post, outcome) is a node; embeddings index it; the agent reasons over the graph.
3. **The unit of execution is a typed event on a durable bus, not an HTTP handler.** Every state change is an event. The system is replayable end-to-end.
4. **The unit of quality is an outcome-bound eval loop, not a prompt review.** Every generation gets a judge; every send/post is scored against a real outcome (reply, booked meeting, engagement, revenue). Winning patterns flow back into the prompt/example library automatically.
5. **The unit of trust is the channel, not the app.** Deliverability, brand voice, sender reputation, and approval rails are first-class subsystems with their own SLAs — not afterthoughts inside a send function.

A platform that gets these five right will outpace one that gets prompts and UI right but treats the substrate as plumbing.

---

## The Five Primitives

Everything the user touches and everything the system schedules is one of five primitives. Keep the vocabulary small.

| Primitive | What it is | Examples |
|---|---|---|
| **Rep** | A persona-bound agent with voice, memory, KPIs, and channels it owns. The user-facing identity. | "Sampark — outbound SDR," "Vaani — content," "Prayog — campaigns," "Bodh — AEO" |
| **Signal** | A typed event that may justify action. Has source, freshness, audience hint, novelty score. | Series A close, job posting, podcast mention, churn risk, competitor launch |
| **Play** | A reusable, parameterized workflow. Composed of agent steps + tool calls + approval gates. | "Founder-to-founder cold email on funding," "Series B → LinkedIn carousel" |
| **Conversation** | A durable thread across one or many channels with one counterparty. The atom of CRM. | An email thread + LinkedIn DM + a meeting, all about the same person |
| **Outcome** | A scored, attributable result. The only thing that gates learning and billing. | Positive reply, meeting booked, opportunity created, post → follower lift |

These five compose the entire mental model. **Leads, drafts, sequences, campaigns are all derived views.** The current product has ~25 tables that fight for primacy; the redesign has 5 nouns the user ever needs to learn.

---

## Architecture — Five Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ 5. SURFACES   Web UI · Mobile · MCP · REST · Slack · Email-in   │
├─────────────────────────────────────────────────────────────────┤
│ 4. CHANNELS   Email · LinkedIn · X · Voice · Video · Web/Ads    │
├─────────────────────────────────────────────────────────────────┤
│ 3. AGENT FABRIC   Reps · Plays · Tools (MCP) · Eval · Memory    │
├─────────────────────────────────────────────────────────────────┤
│ 2. KNOWLEDGE GRAPH   People · Companies · Signals · Convos      │
├─────────────────────────────────────────────────────────────────┤
│ 1. SUBSTRATE   Durable workflows · Event bus · Storage · Auth   │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Substrate

The non-negotiable foundation: **durable execution + typed event bus + multi-tenant storage**.

- **Durable workflow runtime.** Every agent step is a checkpoint. If a pod dies mid-send, work resumes. Pick one: Temporal, Restate, Inngest, or DBOS. Greenfield, I would choose **Restate** for its Postgres-native journaling and low-latency virtual actors that map cleanly to a "Rep is an actor" model. Inngest is the safer pick if the team wants a hosted control plane.
- **Event bus.** All state changes flow through one append-only log with typed events (`SignalIngested`, `DraftProposed`, `MessageSent`, `ReplyClassified`, `OutcomeScored`). Greenfield: **NATS JetStream** (cheap, lightweight, replayable) or hosted **Confluent Cloud** at scale. Events are the only thing crons or webhooks emit — never direct DB writes from handlers.
- **Storage.** Postgres for transactional state (RLS-isolated per workspace), pgvector for embeddings, **ClickHouse** for the event log replay + analytics, S3-class blob store for raw artifacts (emails, scraped HTML, generated video).
- **Auth & isolation.** Workspace is the security boundary. Per-workspace LLM key routing — a prompt for tenant A never touches tenant B's model context. Per-tenant encryption keys for stored OAuth tokens.

### Layer 2 — Knowledge Graph

A single typed graph is the agent's working memory. Not a separate DB — a logical layer over Postgres + pgvector with a property-graph access pattern.

- Nodes: `Person`, `Company`, `Signal`, `Conversation`, `Message`, `Post`, `Outcome`, `Source`, `Account` (owned inbox/social).
- Edges: `WorksAt`, `ContactedVia`, `MentionedIn`, `RepliedTo`, `Influenced`, `MatchedBy`.
- Every node carries an embedding + a typed properties bag + provenance (which agent + which source created it).
- **Why a graph, not just tables**: ICP matching, dedup, personalization, and outcome attribution all reduce to traversals. "Show me every founder we touched who was mentioned in the same TechCrunch article as someone who booked" is a 3-hop query, not a 200-line SQL CTE.
- Embeddings index every node; agents retrieve by hybrid (BM25 + vector + graph proximity), not raw vector search alone.

### Layer 3 — Agent Fabric

This is where the redesign departs most sharply from Bombsell today.

- **Rep > Agent.** A Rep is the *human-facing* persona. Underneath, a Rep is composed of role-specific agents (researcher, writer, sender, replier). The user names and tunes the Rep; the agents are an implementation detail. This collapses Bombsell's 17 system-agent fleet into ~6 Reps the user can actually reason about.
- **Memory in three tiers.** Episodic (every interaction, raw), semantic (extracted facts about people/companies, deduped), procedural (winning plays per ICP, stored as few-shot examples). Curated by retrieval into a context budget — never crammed.
- **Tools are MCP servers, always.** Outlook, LinkedIn, Apollo, HubSpot, Stripe — every integration is an MCP server (mostly hosted by us, some BYO). Agents discover tools dynamically. This makes the same agent runnable from our UI, Claude desktop, ChatGPT, or a customer's own agent framework.
- **Plays compile to durable workflows.** A Play is declarative ("when *signal*, run *steps*, gate on *approval*"). The compiler emits a Restate/Temporal workflow. Users author Plays in natural language; the system writes the YAML.
- **Autonomy is per-Play, per-channel, per-amount.** Not "agent autopilot on/off" but "Sampark can send up to 30 cold emails/day to non-customers without approval; LinkedIn DMs need a thumb-up; voice calls always need approval." Approval rails are first-class config.
- **Eval is in the hot path.** Every generation has a judge call (cheap, fast — Haiku-class). Generations below a threshold never reach the channel layer. Production traffic continuously trains the few-shot library: winning emails (those that got positive replies) become procedural memory examples for the same ICP+signal combo.

### Layer 4 — Channels

Each channel is a subsystem with its own SLA, its own state machine, its own deliverability concerns.

- **Email.** Multi-domain sending (primary + 2–3 secondary domains per workspace, auto-warmed). IP/domain rotation, SPF/DKIM/DMARC managed for the workspace, per-domain volume curves, real-time bounce/complaint feedback loops, native conversation threading. Connected user inboxes (Outlook / Microsoft 365 OAuth) handled separately for high-touch / founder-led sends, with strict daily ceilings to protect personal reputation. Gmail OAuth is intentionally out of scope.
- **LinkedIn.** A first-class channel: connection requests, InMail, comment-based engagement, DM follow-ups, post engagement (likes/replies that warm a relationship before outreach). Native via partnership/cookie session pool with per-account rate limits — not just publishing through Typefully.
- **X.** Posts, threads, replies, DMs, quote-tweets as engagement vectors.
- **Voice.** AI cold calling for high-intent signals (booked-meeting outcomes only — never spray). Real-time speech, transcript stored as messages in the conversation graph.
- **Video / Avatar.** Personalized 30-second videos for top-decile leads (HeyGen-class), gated to outcomes that justify the cost.
- **Web & Ads.** Programmatic landing-page generation per ICP segment + retargeting audiences synced from the graph (Meta / LinkedIn / Google).

A channel exposes one interface: `send(conversation, draft) → MessageId | DeferReason`. Defer reasons (warmup limit, deliverability risk, dup detection) are typed events back onto the bus.

### Layer 5 — Surfaces

- **Web UI.** Not a CRM. The default view is a **morning brief**: what your Reps did overnight, what needs your thumb, what landed. Conversation-centric, not table-centric. Real-time via SSE off the event bus.
- **MCP server.** External agents (Claude desktop, ChatGPT, customer agents) connect and use the same tools the internal Reps use. The MCP surface is the product API.
- **Email-in & Slack.** Approve/reject from any inbox. Thumb-up a draft in Slack and it sends.
- **Mobile.** Read-only morning brief + approvals. Building creation flows on mobile is not worth the effort.

---

## Reliability & Trust Posture

The hardest part of "on autopilot reliably" is the second word. The design treats reliability as a product surface, not an ops concern.

- **Durability.** Every workflow checkpointed; no work lost on deploy or crash. Idempotency keys on every external call. Dead-letter queue with a human-in-loop recovery UI — not silent failures.
- **Deliverability as a subsystem.** A dedicated service owns sender reputation: per-domain warmup curves, blocklist monitoring, postmaster feedback ingestion, automatic volume throttling when complaint rate rises, per-recipient frequency caps across all Reps.
- **Brand voice guardrails.** Per-Rep voice fingerprint (embedding of canonical examples). Drafts that drift beyond a threshold are flagged before send.
- **Observability is user-facing.** "Show your work" UI: for any sent message or post, the user sees the signal that triggered it, the retrieved context, the judge's score, the autonomy gate that let it through. Not buried in logs — a tab on every conversation.
- **Cost & rate-limit governance.** Per-workspace budgets on LLM spend, enrichment credits, channel volume. Soft and hard limits with degraded modes (skip eval, use cheaper model, queue for tomorrow).
- **Replay & forensics.** Every workflow can be replayed from the event log with a different agent version. Essential for migrating prompts without regressions.

---

## Opinionated Tech Stack (Greenfield, 2026)

| Layer | Pick | Why |
|---|---|---|
| App framework | **Next.js 16** (RSC + Server Actions) | Real-time UI off SSE, edge-friendly, team velocity |
| Runtime | **Bun** in workers, **Node** in Next | Bun for cold-start-sensitive workers; Node for Next compatibility |
| Durable workflows | **Restate** | Postgres-native journaling, virtual actor model fits Reps |
| Event bus | **NATS JetStream** | Cheap, replayable, embeddable; upgrade to Confluent later |
| Transactional DB | **Postgres 17** + **pgvector** | Workspace-RLS isolation, vector search co-located |
| Analytics / event log | **ClickHouse** | Replay + agent observability + outcome attribution |
| Object storage | **S3** (or Cloudflare R2) | Raw artifacts, generated assets |
| LLMs | **DeepSeek V4 Pro** as the single default for drafting, reasoning, hot-path judges, classification, and dedup. **BYO** Anthropic / OpenAI keys for workspaces that want them. | One vendor, one billing relationship, one set of guardrails. DeepSeek pricing absorbs the "judge every generation" workload that would otherwise need a Sonnet/Haiku-style tier split. Provider-agnostic LLM client in `core/agents/llm/` keeps swap-out cheap. |
| Tool protocol | **MCP** end-to-end | Every integration is an MCP server; UI and external agents share tools |
| Observability | **OpenTelemetry** + **Braintrust** for evals | OTel for system traces, Braintrust for prompt/eval lifecycle |
| Email infra | **Resend** for transactional; **owned domains via AWS SES** for outbound at volume; **Outlook / Microsoft Graph** for connected user-inbox sends | Separate transactional and prospecting reputation. Gmail is intentionally not supported. |
| Auth | **WorkOS** or **Supabase Auth** | SSO + SCIM-ready for upmarket without rewrite |
| Billing | **Stripe** + outcome-metered usage on top | Same outcome-based ledger model as today, cleaner primitives |
| Deploy | **Vercel** for Next, **Railway / Fly** for workers + Restate | Don't trap workers in Vercel's request model |

The non-obvious bet is **Restate + MCP as the spine**. Together they make the system replayable and the agent surface universal. Everything else is replaceable.

---

## Deltas from Current Bombsell

### What's already structurally right
- **Agentic architecture, BYO LLM keys, outcome-based credit ledger, MCP server, multi-tenant workspaces, OAuth-connected inboxes, enrichment waterfall with caching, agency-style client workspaces.** Bombsell is well ahead of typical CRMs on these axes — keep them.
- **Two-engine framing (outbound + content) with a supervisor agent** is the right product seam.
- **Per-agent autonomy levels** (research_only / approve_first / autopilot) is the right control idea — but applied at the wrong granularity (see below).

### What's structurally different in the redesign
1. **Durable workflow engine replaces Vercel cron + DB queues.** Current `lead_delivery_queue` / `gtm_integration_outbox` / `cron_runs` collapse into one Restate journal. No lost work on deploy, full replay, no `next_attempt_at` columns.
2. **Typed event bus as the only inter-component contract.** Today, handlers write directly to tables and trigger other handlers via cron. In the redesign, every state change is a typed event; cron disappears for orchestration (kept only for periodic ingestion).
3. **Knowledge graph as the substrate for personalization, dedup, attribution.** Today the graph is implicit across `signals` / `leads` / `company_contacts_cache` / `gtm_*` tables. Make it explicit and queryable.
4. **5 primitives, not 25 tables, in the user's mental model.** Rep, Signal, Play, Conversation, Outcome. Everything else is a view.
5. **17 system agents → ~6 user-named Reps.** The internal agent decomposition stays, but the user only ever configures and trusts a small number of named personas.
6. **Autonomy per Play × channel × volume**, not per-agent. "Autopilot on/off" is too coarse for real trust.
7. **Eval in the hot path.** Today drafts are eval'd async after send; in the redesign, sub-threshold drafts never reach the channel. Outcomes feed back into a per-workspace few-shot library automatically.
8. **Deliverability as a first-class subsystem** with multi-domain owned-sending alongside connected user inboxes. Today everything goes through user-connected accounts, which caps volume and risks personal reputation.
9. **Native LinkedIn / X / Voice channels**, not just publishing partners. Engagement-first sequencing (like/comment/DM) before cold outreach.
10. **Plays authored in natural language, compiled to workflows.** Today playbooks are code. In the redesign, the user describes a play, the system compiles it, the user sees the compiled workflow visually.
11. **Memory as three explicit tiers** (episodic, semantic, procedural), not implicit in tables. Procedural memory is the moat — winning outreach per ICP+signal+stage compounds with every outcome.
12. **"Show your work" observability is user-facing**, not buried in `agent_events`. Every send and post traceable end-to-end in two clicks.

### What's missing today that the redesign treats as table-stakes
- Durable workflow engine
- Typed event bus
- Explicit knowledge graph
- Owned-domain sending infrastructure with warmup
- Native LinkedIn/X engagement (beyond publishing)
- Hot-path eval gating
- Outcome → few-shot procedural memory loop
- Per-workspace voice fingerprinting & drift detection
- Replayable workflow forensics
- Per-play / per-channel / per-volume autonomy granularity
- Brand-voice and deliverability dashboards as user surfaces

---

## How to Verify This Design

This document is the deliverable; there is no code to run. To pressure-test it before any implementation:

1. **Walk three real plays end-to-end on paper**, using only the five primitives and the five layers: (a) Series A founder cold email triggered by a TechCrunch signal, (b) LinkedIn comment → DM → meeting on a podcast mention, (c) repurposing a top-performing X thread into three cold-email opening lines. If any step needs a concept outside the five primitives, the model is incomplete.
2. **Map each current Bombsell cron** (`poll-signals`, `match`, `deliver-leads`, `enrich-contacts`, `send-automation`, etc.) to a Play in the new model. Any cron that does not collapse cleanly is a sign of either a missing primitive or a workflow that should not exist.
3. **Pick one Rep and design its memory schema** (episodic / semantic / procedural). If a non-trivial state cannot be classified into one of the three, the memory model is wrong.
4. **Stress the trust layer**: enumerate every failure mode (LLM hallucinates a name, ZeroBounce is down, Outlook token expires mid-send, two Reps target the same person, a competitor signals churn on a customer). The design must have an answer for each — usually a typed defer event back onto the bus.
