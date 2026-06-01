# Product Audit — 2026-06-01

Source of truth: `ARCHITECTURE.md`. Current branch: `main`, after `git fetch origin` and fast-forward check.

## Current State

- Production health is green at `https://www.bombsell.com/api/health`: environment, NATS credentials, Restate ingress, substrate mode, database, tables, and migrations all report `ok`.
- The product now has the main pivot-v2 substrate in place: typed event registry, Postgres event journal, NATS dispatch/dead-letter path, Restate workflow ingress, workflow maintenance trigger, explicit graph nodes/edges, five primitive tables, MCP surface, owned-domain email workflows, hot-path draft eval gate, outcome/memory projections, and dashboard surfaces for Brief/Profile/Campaigns/Review/Outreach/Deliverability/AEO.
- The default user surface is aligned with the planned abstraction: `/dashboard` is Brief, and the sidebar nouns map to derived views over the five primitives.
- The capability map exists at `docs/agent-native-capability-map.md` and is now registry-first for MCP discovery.

## Architecture Audit

| Area | State | Evidence | Gap / Risk |
|---|---|---|---|
| Durable workflow runtime | Strong | `core/substrate/workflows`, Restate host/bridge, production health `substrate=ok` | Local `.env.local` still uses the Postgres bridge; use `nats_restate` when testing production-like flows. |
| Typed event bus | Strong | `core/substrate/events/registry.ts`, NATS journal adapter, dead-letter UI | Some bootstrap/genesis writes remain known divergence because workspace rows must exist before workspace-scoped events. |
| Knowledge graph | Good and improving | `graph_companies`, `graph_persons`, `graph_sources`, `graph_edges`, graph MCP tools | Node delete primitives were missing; fixed in this iteration. |
| Five primitives | Good | migrations `006`-`010`, dashboard derived views | Legacy folder still contains old CRM/cron concepts; keep it quarantined or remove once no longer needed. |
| Rep composition | Improving | `core/agents/reps/compose.ts`, Signal email and Signal LinkedIn Plays, inbound reply handling, Rep primitive and setup UI | Email/LinkedIn Plays use composed researcher/writer/sender roles, and inbound email composes the owning Rep's replier role for intent triage; response drafting/approval for replies is still next. |
| Hot-path eval | Good | `core/agents/eval`, `core/channels/email/eval-gate.ts`, Signal email Play judge step, Conversation trust trace | Next step is making brand-voice drift checks richer than the current judge notes. |
| Owned-domain deliverability | Good | SES/domain workflows, warmup, feedback projectors, deliverability dashboard | Continue SES production review and real inbox feedback verification. |
| Native channels | Improving | Email and a durable Signal-to-LinkedIn Play exist; LinkedIn currently uses the native channel abstraction with dry-run transport until a production session provider is connected | Voice/video/web are placeholders; LinkedIn needs production session/OAuth transport before real external sends. |
| Agent-native action parity | Strong | product tools + graph tools + MCP endpoint + `test/product-tools.test.ts` parity checks | Keep updating the capability map in the same PR as any new user-visible action. |
| Context injection | Good | `product.context.get` returns prompt-ready workspace context, and the Signal email Play now injects it into writer and judge prompts | Extend the same context provider to new native-channel Plays as they become executable. |
| User-facing trust trace | Improving | Conversation detail reads email/LinkedIn workflow runs, lifecycle events, outcomes, approvals, and `rep.role.completed` events | Brand-voice drift and deliverability explanations still need richer event payloads before the trace can explain them deeply. |

## Fixes Applied In This Iteration

- Added `graph.companies.delete`, `graph.persons.delete`, and `graph.sources.delete` primitive tools.
- Added graph node deletion storage functions that also remove polymorphic graph edges in the same transaction.
- Changed `/api/mcp` manifest generation to list the live Tool registry instead of a hard-coded tool list.
- Updated the capability map so full graph CRUD is accurate and registry-first capability discovery is documented.
- Added `product.context.get`, a prompt-ready dynamic workspace context tool for Reps and external agents.
- Wired prompt-ready workspace context into the Signal email Rep workflow so writer and judge prompts see the same live workspace state exposed to MCP clients.
- Added automated parity checks that validate capability-map tool references and ensure the MCP manifest includes the live graph/product tool registry.
- Fixed completed-user Google OAuth return flow by making onboarding completion detection tolerant of activated workspaces and restoring the active workspace cookie on auth callback.
- Added `product.conversation.trust.get` and wired the Conversation detail view to show the Signal, retrieved context/procedural pattern, judge result, approval gate, channel send/defer state, and Outcome in one proof trace.
- Added `play.signal_to_linkedin.v1`, a durable Signal-to-LinkedIn Play that runs Rep research, LinkedIn draft generation, hot-path eval, per-Play channel policy, approval gate, and native channel send/defer through typed events.
- Added `product.play.signal_linkedin.configure` so agents can configure Signal-backed LinkedIn Plays with the same registry-first MCP discovery as UI-backed actions.
- Moved Signal LinkedIn draft/send behavior behind Rep role agents and composed the Rep with researcher, LinkedIn writer, and LinkedIn sender roles inside the durable workflow.
- Implemented the Rep replier role for inbound email intent triage, episodic memory capture, and outcome recommendation while preserving the typed reply/outcome event spine.
- Added `rep.role.completed` as a typed trust event and publish it from email, LinkedIn, and inbound replier role execution.
- Updated Conversation trust trace to find both email and LinkedIn Play workflow runs and summarize recent Rep role work.

## Recommended Next Iteration

1. Make Rep composition executable:
   - Add response drafting/approval for positive and neutral replies.
   - Persist reply draft proposals through the same hot-path eval and approval rail as outbound drafts.

2. Productionize the native LinkedIn path:
   - Replace the dry-run LinkedIn transport with a real session/OAuth provider, rate-limit telemetry, and recovery UX before exposing real external sends broadly.

3. Improve user-facing trust depth:
   - Add richer brand-voice drift and deliverability explanations to the Conversation trust trace once those signals are available in the event payloads.
