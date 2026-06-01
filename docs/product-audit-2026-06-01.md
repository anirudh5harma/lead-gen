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
| Rep composition | Improving | `core/agents/reps/compose.ts`, `core/plays/signal-email-play.ts`, Rep primitive and setup UI | Role-agent registry is still skeletal; next product iteration should make Rep execution feel like a composed team beyond the Signal email workflow. |
| Hot-path eval | Good | `core/agents/eval`, `core/channels/email/eval-gate.ts`, Signal email Play judge step | Need richer visible "why this passed/failed" trace on each Conversation. |
| Owned-domain deliverability | Good | SES/domain workflows, warmup, feedback projectors, deliverability dashboard | Continue SES production review and real inbox feedback verification. |
| Native channels | Early | Email and dry-run LinkedIn exist; voice/video/web are placeholders | Next channel iteration should add one real native non-email action path or keep them hidden. |
| Agent-native action parity | Strong | product tools + graph tools + MCP endpoint + `test/product-tools.test.ts` parity checks | Keep updating the capability map in the same PR as any new user-visible action. |
| Context injection | Good | `product.context.get` returns prompt-ready workspace context, and the Signal email Play now injects it into writer and judge prompts | Extend the same context provider to new native-channel Plays as they become executable. |

## Fixes Applied In This Iteration

- Added `graph.companies.delete`, `graph.persons.delete`, and `graph.sources.delete` primitive tools.
- Added graph node deletion storage functions that also remove polymorphic graph edges in the same transaction.
- Changed `/api/mcp` manifest generation to list the live Tool registry instead of a hard-coded tool list.
- Updated the capability map so full graph CRUD is accurate and registry-first capability discovery is documented.
- Added `product.context.get`, a prompt-ready dynamic workspace context tool for Reps and external agents.
- Wired prompt-ready workspace context into the Signal email Rep workflow so writer and judge prompts see the same live workspace state exposed to MCP clients.
- Added automated parity checks that validate capability-map tool references and ensure the MCP manifest includes the live graph/product tool registry.
- Fixed completed-user Google OAuth return flow by making onboarding completion detection tolerant of activated workspaces and restoring the active workspace cookie on auth callback.

## Recommended Next Iteration

1. Make Rep composition executable:
   - Define role-agent prompts for researcher/writer/sender/replier.
   - Feed the dynamic context provider into future native-channel Plays.

2. Improve user-facing trust:
   - Conversation detail should show Signal, retrieved context, judge score, approval gate, send/defer reason, and outcome trace in one place.

3. Add one real native non-email path:
   - LinkedIn currently has dry-run/channel primitives; either make one native action executable through a durable Play or keep it hidden from the product surface until ready.
