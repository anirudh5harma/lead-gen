# Agent-Native Capability Map

`ARCHITECTURE.md` stays the source of truth. This map is the merge checklist for
keeping the product agent-native as UI surfaces grow: every user action should
have a same-workspace tool, durable workflow, typed event, graph/memory
projection, and visible UI feedback where applicable.

| UI Action | Surface | Agent Tool | Runtime Path | Status |
|---|---|---|---|---|
| Read morning brief/state | `/dashboard`, `/brief` | `product.state.get` | Read derived views from primitives/events | Ready |
| Refresh morning brief from public web | `/brief`, MCP/internal Rep execution | `product.brief.refresh` | `rep.brief.refresh.exa`: Exa Search/Contents -> graph evidence sources -> `rep.brief.refreshed` | Ready |
| Read prompt-ready workspace context | MCP/internal Rep execution | `product.context.get` | Builds dynamic context from Reps, ICPs, Plays, Sources, Signals, approvals, send traces, deliverability, and recovery state | Ready |
| Read product runtime readiness | `/dashboard/ops`, `/api/health` | `product.readiness.get` | Reads environment, provider, substrate, database, schema table, and migration readiness without mutating state | Ready |
| Read Conversation trust trace | `/dashboard/conversations/[id]` | `product.conversation.trust.get` | Reads Signal, messages, judge output, approval gate, workflow steps, send/defer events, and Outcomes from the evented state | Ready |
| Extract company profile from website | `/onboarding` | `product.company.website_profile.extract` | Firecrawl + LLM, no write | Ready |
| Store company profile | `/onboarding` | `product.company.profile.configure` | `workspace.company.profiled` -> graph company | Ready |
| Enrich Profile from public web | `/dashboard/setup`, MCP/internal Rep execution | `product.profile.enrich` | `profile.bootstrap.exa`: Exa Search/Contents -> graph evidence sources -> `workspace.profile.enriched`; onboarding profile creation stays Firecrawl-only | Ready |
| Run Rep public-web research | MCP/internal Rep execution | `product.rep.research` | `rep.research.exa`: Exa Search/Contents -> graph evidence sources -> `rep.research.completed` | Ready |
| Start durable Exa research | MCP/internal Rep execution | `product.exa.research_workflow.start` | Starts one of `rep.brief.refresh.exa`, `rep.research.exa`, `draft.grounding.exa`, `content.opportunity.exa`, or `aeo.audit.exa` with a Restate/Postgres workflow runtime | Ready |
| Configure Rep | `/dashboard/setup` | `product.rep.configure` | `rep.configured` -> Rep projection | Ready |
| Configure ICP | `/dashboard/setup`, `/dashboard/campaigns` | `product.icp.configure` | `workspace.icp.configured` -> ICP projection | Ready |
| Configure Signal email Play | `/dashboard/setup` | `product.play.signal_email.configure` | `play.configured` -> Play projection | Ready |
| Configure Signal LinkedIn Play | MCP/internal Rep execution | `product.play.signal_linkedin.configure` | `play.configured` -> durable Signal-to-LinkedIn workflow with hot-path judge and native channel send/defer | Ready |
| Configure email account | `/dashboard/setup`, `/brief` | `product.email_account.configure` | `channel.account.configured` -> channel projection | Ready |
| Connect LinkedIn account | `/dashboard/setup` | `product.linkedin_account.connect_url.get` | Provider auth URL -> `linkedin.account.authorization.received` -> channel account projection -> `channel.account.connected` | Ready |
| Track company | `/dashboard/campaigns` | `product.company.track` | `workspace.company.tracked` -> graph/source projection | Ready |
| Configure signal source | `/dashboard/campaigns`, `/brief` | `product.source.configure` | `workspace.source.configured` -> source config; push sources do not enter poll maintenance | Ready |
| Configure Exa open-web Signals | `/dashboard/campaigns`, MCP/internal Rep execution | `product.signal.discover_open_web` | `signal.discover.open_web.exa` configures adapter `exa` -> durable workspace poll -> `signal.discovered` | Ready |
| Configure default aggregator | `/onboarding` | `product.sources.default_aggregator.configure` | Emits source configuration events per adapter | Ready |
| Run signal aggregator | `/dashboard/campaigns`, `/brief` | `product.sources.aggregate.run` | Starts `ingest_workspace_poll` workflow | Ready |
| Push source-backed Signal | `/api/webhooks/signals`, external source, agent tool | `product.signal.discover` | Authenticated webhook/tool emits `signal.discovered`; projector materializes `Signal` and emits `signal.ingested` | Ready |
| Submit manual signal | `/dashboard`, `/brief` | `product.signal.submit` | Manual Signal ingestion event path | Ready |
| Dispatch matched Plays | Internal/dashboard action | `product.signals.dispatch_plays` | Starts Signal email/LinkedIn Play workflows; weak or stale evidence triggers Exa draft grounding before writer/judge | Ready |
| Ground draft with public evidence | MCP/internal Rep execution, automatic Play step | `product.draft.ground` | `draft.grounding.exa`: Exa Search/Contents -> graph evidence sources -> judge/writer-ready proof summary -> draft `exa_grounding` provenance | Ready |
| Discover content opportunities | `/dashboard/content`, MCP/internal Rep execution | `product.content.opportunities.discover` | `content.opportunity.exa`: Exa Search/Contents -> graph evidence sources -> `content.opportunity.discovered` with structured opportunities/review items | Ready |
| Audit AEO coverage | `/dashboard/aeo`, MCP/internal Rep execution | `product.aeo.audit` | `aeo.audit.exa`: Exa Search/Contents -> graph evidence sources -> `aeo.audit.completed` with structured gaps/review items | Ready |
| Review Exa recommendation | `/dashboard/content`, `/dashboard/aeo`, MCP/internal Rep execution | `product.recommendation.review` | Emits `recommendation.reviewed`; ignored items leave the review canvas, accepted items stay in context as kept operator signal | Ready |
| Record recommendation Outcome | `/dashboard/content`, `/dashboard/aeo`, MCP/internal Rep execution | `product.recommendation.outcome.record` | Emits `outcome.recorded` for accepted Content/AEO recommendations with recommendation, pattern, and exemplar attribution so existing Outcome -> procedural memory learning applies | Ready |
| Approve/reject draft | `/dashboard/approvals`, `/brief` | `product.approval.decide` | Resolves workflow approval gate | Ready |
| Retry failed workflow | `/brief`, ops surfaces | `product.workflow.retry` | Durable workflow retry/resume | Ready |
| Inspect/redrive dead-lettered event delivery | `/dashboard/ops` | `product.event_dispatch.dead_letters.list`, `product.event_dispatch.redrive` | Shared workspace-scoped recovery queue; redrive resets the NATS dispatch row for replay and emits `event.dispatch.redriven` as a typed audit event | Ready |
| Provision/verify/refresh sending domain | `/brief`, deliverability surfaces | `product.sending_domain.operate` | Starts sending-domain workflow | Ready |
| CRUD graph companies/persons/sources/edges | Derived graph surfaces | `graph.companies.*`, `graph.persons.*`, `graph.sources.*`, `graph.edges.*` | Shared workspace graph tables, including node delete primitives that clean graph edges | Ready |

## Guardrails

Production proof for Exa research variants lives in `npm run verify:exa`. The
canary starts `draft.grounding.exa`, `rep.brief.refresh.exa`,
`content.opportunity.exa`, and `aeo.audit.exa` through the product workflow
entrypoint, waits for Restate completion, and verifies graph evidence, typed
events, query/content cache, usage ledger rows, and Content/AEO review payloads.
Keep it green when changing Exa runtime, cache, event, workflow, or review
projection code.

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
