# Agent-Native Capability Map

`ARCHITECTURE.md` stays the source of truth. This map is the merge checklist for
keeping the product agent-native as UI surfaces grow: every user action should
have a same-workspace tool, durable workflow, typed event, graph/memory
projection, and visible UI feedback where applicable.

| UI Action | Surface | Agent Tool | Runtime Path | Status |
|---|---|---|---|---|
| Read morning brief/state | `/dashboard`, `/brief` | `product.state.get` | Read derived views from primitives/events | Ready |
| Read prompt-ready workspace context | MCP/internal Rep execution | `product.context.get` | Builds dynamic context from Reps, ICPs, Plays, Sources, Signals, approvals, send traces, deliverability, and recovery state | Ready |
| Read Conversation trust trace | `/dashboard/conversations/[id]` | `product.conversation.trust.get` | Reads Signal, messages, judge output, approval gate, workflow steps, send/defer events, and Outcomes from the evented state | Ready |
| Extract company profile from website | `/onboarding` | `product.company.website_profile.extract` | Firecrawl + LLM, no write | Ready |
| Store company profile | `/onboarding` | `product.company.profile.configure` | `workspace.company.profiled` -> graph company | Ready |
| Configure Rep | `/dashboard/setup` | `product.rep.configure` | `rep.configured` -> Rep projection | Ready |
| Configure ICP | `/dashboard/setup`, `/dashboard/ingestion` | `product.icp.configure` | `workspace.icp.configured` -> ICP projection | Ready |
| Configure Signal email Play | `/dashboard/setup` | `product.play.signal_email.configure` | `play.configured` -> Play projection | Ready |
| Configure Signal LinkedIn Play | MCP/internal Rep execution | `product.play.signal_linkedin.configure` | `play.configured` -> durable Signal-to-LinkedIn workflow with hot-path judge and native channel send/defer | Ready |
| Configure email account | `/dashboard/setup`, `/brief` | `product.email_account.configure` | `channel.account.configured` -> channel projection | Ready |
| Track company | `/dashboard/ingestion` | `product.company.track` | `workspace.company.tracked` -> graph/source projection | Ready |
| Configure signal source | `/dashboard/ingestion`, `/brief` | `product.source.configure` | `workspace.source.configured` -> source config; push sources do not enter poll maintenance | Ready |
| Configure default aggregator | `/onboarding` | `product.sources.default_aggregator.configure` | Emits source configuration events per adapter | Ready |
| Run signal aggregator | `/dashboard/ingestion`, `/brief` | `product.sources.aggregate.run` | Starts `ingest_workspace_poll` workflow | Ready |
| Push source-backed Signal | `/api/webhooks/signals`, external source, agent tool | `product.signal.discover` | Authenticated webhook/tool emits `signal.discovered`; projector materializes `Signal` and emits `signal.ingested` | Ready |
| Submit manual signal | `/dashboard`, `/brief` | `product.signal.submit` | Manual Signal ingestion event path | Ready |
| Dispatch matched Plays | Internal/dashboard action | `product.signals.dispatch_plays` | Starts Signal email Play workflows | Ready |
| Approve/reject draft | `/dashboard/approvals`, `/brief` | `product.approval.decide` | Resolves workflow approval gate | Ready |
| Retry failed workflow | `/brief`, ops surfaces | `product.workflow.retry` | Durable workflow retry/resume | Ready |
| Redrive dead-lettered event delivery | `/dashboard/ops` | `product.event_dispatch.redrive` | Shared substrate redrive primitive resets workspace-scoped NATS dispatch for replay | Ready |
| Provision/verify/refresh sending domain | `/brief`, deliverability surfaces | `product.sending_domain.operate` | Starts sending-domain workflow | Ready |
| CRUD graph companies/persons/sources/edges | Derived graph surfaces | `graph.companies.*`, `graph.persons.*`, `graph.sources.*`, `graph.edges.*` | Shared workspace graph tables, including node delete primitives that clean graph edges | Ready |

## Guardrails

- Add/update this map in the same PR as any new user-visible action.
- Add the corresponding tool in `core/product/tools.ts` or a primitive graph/channel
  tool before the UI ships.
- `/api/mcp` builds its manifest from the live Tool registry, so capability
  discovery must stay registry-first rather than duplicating hard-coded tool
  lists.
- `test/product-tools.test.ts` parses this map and fails when a referenced
  `product.*` or `graph.*` tool is missing from the registry, and also verifies
  the MCP manifest includes every registered product/graph tool.
- Prefer primitive tools. Domain shortcuts are allowed only when the primitive
  tools remain available and the shortcut mirrors a real UI action.
- Handlers and routes authenticate and translate intent. Durable work belongs in
  `core/substrate/workflows/`; state changes must emit typed events and project
  from the event log.
- Any direct table write that remains in bootstrap/helper code must be treated as
  technical debt unless it is a projector or storage primitive.

## Known Divergence To Repay

- Workspace genesis still inserts the `workspaces` row before publishing
  `workspace.created` because the append-only `events.workspace_id` column has a
  foreign key to `workspaces(id)`. The event now carries replayable workspace
  metadata and projects the owner membership, but a fully event-first workspace
  lifecycle needs a substrate migration for platform/genesis events.
- Local/demo bootstrap now emits typed `rep.configured`, `play.configured`,
  `channel.account.configured`, `rep.memory.procedural.seeded`, and
  `workspace.member.accepted` events for seeded primitives and membership
  repair. Sending-domain catch-up is driven by re-projecting
  `channel.account.configured` when the owned-domain row is missing.
- User configuration events use content-addressed idempotency keys: retrying the
  exact same configuration dedupes, while actual Rep/Play/ICP/source/channel
  changes append new replayable events.
