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
| Rep composition | Partial | `core/agents/reps/compose.ts`, Rep primitive and setup UI | Role-agent registry is still skeletal; next product iteration should make Rep execution feel like a composed team, not just one workflow. |
| Hot-path eval | Good | `core/agents/eval`, `core/channels/email/eval-gate.ts`, Signal email Play judge step | Need richer visible "why this passed/failed" trace on each Conversation. |
| Owned-domain deliverability | Good | SES/domain workflows, warmup, feedback projectors, deliverability dashboard | Continue SES production review and real inbox feedback verification. |
| Native channels | Early | Email and dry-run LinkedIn exist; voice/video/web are placeholders | Next channel iteration should add one real native non-email action path or keep them hidden. |
| Agent-native action parity | Good | product tools + graph tools + MCP endpoint | Need parity tests that compare dashboard actions to registry tools automatically. |
| Context injection | Weak | MCP exposes tools, but no rich runtime system prompt/context builder for Reps | Highest-leverage next iteration: build a workspace context provider for Reps/MCP clients. |

## Fixes Applied In This Iteration

- Added `graph.companies.delete`, `graph.persons.delete`, and `graph.sources.delete` primitive tools.
- Added graph node deletion storage functions that also remove polymorphic graph edges in the same transaction.
- Changed `/api/mcp` manifest generation to list the live Tool registry instead of a hard-coded tool list.
- Updated the capability map so full graph CRUD is accurate and registry-first capability discovery is documented.

## Recommended Next Iteration

1. Build a dynamic workspace context provider for agent execution and MCP discovery:
   - Inject active Rep, Play, Sources, pending approvals, recent Signals, recent Conversations, deliverability status, available tools, and current autonomy gates.
   - Use user-facing vocabulary from the UI: Brief, Outreach, Content, Campaigns, AEO, Profile.
   - Add a `product.context.get` read tool or include context in `product.state.get` with a prompt-ready markdown view.

2. Add parity verification:
   - A test that enumerates dashboard server actions and checks the corresponding product/graph tool exists in the registry.
   - A test that verifies `/api/mcp` manifest includes every registered tool after graph/product registration.

3. Make Rep composition executable:
   - Define role-agent prompts for researcher/writer/sender/replier.
   - Feed the dynamic context provider into the Signal email Play and future native-channel Plays.

4. Improve user-facing trust:
   - Conversation detail should show Signal, retrieved context, judge score, approval gate, send/defer reason, and outcome trace in one place.
