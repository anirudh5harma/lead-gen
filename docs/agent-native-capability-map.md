# Agent-Native Capability Map

`ARCHITECTURE.md` stays the source of truth. This map is the merge checklist for
keeping the product agent-native as UI surfaces grow: every user action should
have a same-workspace tool, durable workflow, typed event, graph/memory
projection, and visible UI feedback where applicable.

| UI Action | Surface | Agent Tool | Runtime Path | Status |
|---|---|---|---|---|
| Read morning brief/state | `/dashboard` | `product.state.get` | Read derived views from primitives/events | Ready |
| Refresh morning brief from public web | MCP/internal Rep execution | `product.brief.refresh` | `rep.brief.refresh.exa`: Exa Search/Contents -> graph evidence sources -> `rep.brief.refreshed` | Ready |
| Read prompt-ready workspace context | MCP/internal Rep execution | `product.context.get` | Builds dynamic context from Reps, ICPs, Plays, Sources, Signals, approvals, send traces, deliverability, and recovery state | Ready |
| Recall shared company brain | MCP/internal Rep execution | `product.company_brain.recall` | `workspace.company_brain.recall` / `company_brain.recall_graph.v1` builds a workspace-scoped, source-referenced brief from Profile, Signals, Outcomes, meeting prep notes, graph memory, procedural memory, and optional Memory Store connector status; emits `company.memory.recalled` | Ready |
| Refresh living company-brain brief | MCP/internal Rep execution | `product.company_brain.brief.refresh` | `workspace.company_brain.brief` / `company_brain.brief_graph.v1` turns the same scoped memory into a compact workspace/ICP/account/campaign/decision/ask/objection/proof/vertical brief and emits `company.brief.updated` | Ready |
| Refresh vertical intelligence | MCP/internal Rep execution | `product.vertical_intelligence.refresh` | `workspace.vertical_intelligence.refresh` / `vertical.intelligence_graph.v1` writes source-referenced Profile, ICP, semantic memory, and Play-skill performance facts back into graph company memory; emits `vertical.intelligence.updated` for prompt context | Ready |
| Read product runtime readiness | `/dashboard/health`, `/api/health` | `product.readiness.get` | Reads environment, provider, substrate, database, schema table, and migration readiness without mutating state | Ready |
| Read workspace launch gate | `/dashboard/setup`, MCP/internal Rep execution | `product.launch.readiness.get` | `workspace.channel.readiness` / `channel.readiness_graph.v1` checks profile, ICP, Rep, Signal sources, Plays, Outlook reply sync, LinkedIn health, blockers, warnings, and next action before external outreach starts | Ready |
| Read agent observability summary | `/dashboard/health`, MCP/internal Rep execution | `product.agent_observability.summary.get` | Reads redacted `agent.trace.span.recorded`, `agent.trace.exported`, and `agent.trace.eval_failed` events into trace-level LangGraph/tool/LLM cost, primitive refs, export, and failed-eval summaries without exporting raw prompt or message payloads | Ready |
| Read Conversation trust trace | `/dashboard/conversations/[id]` | `product.conversation.trust.get` | Reads Signal, messages, judge output, approval gate, workflow steps, send/defer events, and Outcomes from the evented state | Ready |
| Generate meeting prep | `/dashboard/conversations/[id]`, meeting-intent or positive `reply.classified`, MCP/internal Rep execution | `product.meeting.prep.generate` | `workspace.meeting.prep` / `meeting.prep_graph.v1` generates source-referenced prep from the message thread, prospect/company/user/Rep profile, original Signal, topic, and Outcomes, then emits `meeting.prep.generated`; meeting-intent or positive replies start the workflow through `product-meeting-prep-dispatcher-v1`; availability is omitted without calendar consent; generated prep is recalled by the shared company brain with Conversation, message-thread, Signal, Outcome, person, company, Rep, and user refs | Ready |
| Extract company profile from website | `/onboarding` | `product.company.website_profile.extract` | Firecrawl + LLM, no write | Ready |
| Draft Profile and ICP from website | `/onboarding`, MCP/internal Rep execution | `product.profile_icp.draft` | `workspace.profile.icp` / `profile.icp_graph.v1` emits `workspace.profile.drafted` and `icp.drafted` from source-backed website evidence without configuring Reps, Plays, sources, channels, or sends | Ready |
| Run website URL to full setup | `/onboarding`, MCP/internal Rep execution | `product.activation.setup.run` | `workspace.activation.setup` / `activation.setup_graph.v1` turns a website URL into source-backed Profile/ICP drafts, Rep, email/LinkedIn Plays, low-cost default Signal sources, and Outlook/LinkedIn launch gates, then starts `workspace.signal.ingestion` for the initial source poll without matching leads or sending outreach | Ready |
| Store company profile | `/onboarding` | `product.company.profile.configure` | `workspace.company.profiled` -> graph company | Ready |
| Enrich Profile from public web | MCP/internal Rep execution | `product.profile.enrich` | `profile.bootstrap.exa`: Exa Search/Contents -> graph evidence sources -> `workspace.profile.enriched`; visible Profile setup and onboarding stay Firecrawl-only | Ready |
| Run Rep public-web research | MCP/internal Rep execution | `product.rep.research` | `rep.research.exa`: Exa Search/Contents -> graph evidence sources -> `rep.research.completed` | Ready |
| Start durable Exa research | MCP/internal Rep execution | `product.exa.research_workflow.start` | Starts one of `rep.brief.refresh.exa`, `rep.research.exa`, or `draft.grounding.exa` with a Restate/Postgres workflow runtime | Ready |
| Configure Rep | `/dashboard/setup` | `product.rep.configure` | `rep.configured` -> Rep projection | Ready |
| Configure ICP | `/dashboard/setup`, `/dashboard/campaigns` | `product.icp.configure` | `workspace.icp.configured` -> ICP projection | Ready |
| Configure Signal email Play | `/dashboard/setup` | `product.play.signal_email.configure` | `play.configured` -> Play projection | Ready |
| Configure Signal LinkedIn Play | MCP/internal Rep execution | `product.play.signal_linkedin.configure` | `play.configured` -> durable Signal-to-LinkedIn workflow with hot-path judge and native channel send/defer | Ready |
| Inspect/select outreach Play Skills | MCP/internal Rep execution | `product.play.skills.list`, `product.play.skills.select` | `workspace.outreach.skill_selection` / `outreach.skill_selection_graph.v1` reads the versioned email, LinkedIn, and reply skill registry; selected skill metadata flows into draft provenance, judge context, and Play run output | Ready |
| Personalize outbound message | MCP/internal Rep execution, automatic Play step | `product.message.personalize` | `workspace.message.personalization` / `message.personalization_graph.v1` composes Rep writer roles, graph context, vertical intelligence, procedural memory, and selected Play Skill into draft provenance; emits `message.personalized` before `draft.proposed` and hot-path eval | Ready |
| Judge outbound draft | MCP/internal Rep execution, automatic Play step | `product.draft.eval.gate` | `workspace.eval.gate` / `eval.gate_graph.v1` runs the hot-path judge on the draft, emits `draft.judged`, emits `draft.rejected` on failures, and never sends outreach directly | Ready |
| Triage inbound reply | Outlook reply sync, MCP/internal Rep execution | `product.reply.triage` | `workspace.reply.triage` / `reply.triage_graph.v1` routes inbound email through Conversation matching, the Rep replier role, semantic/episodic memory, `reply.classified`, and positive/negative Outcome recording; meeting-intent or positive replies now wake meeting prep and meeting-intent/positive/neutral replies wake reply follow-up through independent durable dispatchers | Ready |
| Connect Outlook inbox | `/dashboard/setup`, `/dashboard/deliverability` | `product.outlook_account.connect_url.get` | Microsoft OAuth URL -> `email.outlook.authorization.received` -> `oauth_outlook` channel account projection -> `channel.account.connected` | Ready |
| Connect Outlook calendar for prep | `/dashboard/conversations/[id]`, MCP/internal Rep execution | `product.outlook_calendar.connect_url.get`, `product.outlook_calendar.availability.get` | Explicit Microsoft consent path requests `Calendars.ReadBasic`, reuses an existing Outlook account by Microsoft user id, and exposes free/busy readiness for `workspace.meeting.prep` without forcing generic Outlook reconnect | Ready |
| Configure optional owned sender | `/dashboard/deliverability` | `product.email_account.configure` | `channel.account.configured` -> optional owned-domain channel projection | Ready |
| Connect LinkedIn account | `/dashboard/setup` | `product.linkedin_account.connect_url.get` | Provider auth URL -> `linkedin.account.authorization.received` -> channel account projection -> `channel.account.connected` | Ready |
| Track company | `/dashboard/campaigns` | `product.company.track` | `workspace.company.tracked` -> graph/source projection | Ready |
| Configure signal source | `/dashboard/campaigns`, MCP/internal Rep execution | `product.source.configure` | `workspace.source.configured` -> source config; push sources do not enter poll maintenance | Ready |
| Discover source mix | MCP/internal Rep execution | `product.sources.default_aggregator.configure`, `product.signal.discover_open_web` | `workspace.source.discovery` / `source.discovery_graph.v1` composes low-cost native aggregators plus optional Exa open-web source configuration through typed source events | Ready |
| Configure Exa open-web Signals | `/dashboard/campaigns`, MCP/internal Rep execution | `product.signal.discover_open_web` | `signal.discover.open_web.exa` configures adapter `exa` -> durable workspace poll -> `signal.discovered` | Ready |
| Configure default aggregator | `/onboarding` | `product.sources.default_aggregator.configure` | Autodiscovers company-owned RSS/Atom and official ATS sources from the website, then emits free/native source configuration events for Google News, HN front, HN Who's Hiring, and Product Hunt | Ready |
| Autonomous signal ingestion | `/onboarding` completion, autonomous workspace workers, MCP/internal Rep execution | `product.signal.ingestion.run` | `workspace.signal.ingestion` / `signal.ingestion_graph.v1` starts due source poll workflows through `product.sources.poll.start`; onboarding starts the same durable Signal workflow after website activation setup; the existing `ingest_workspace_poll` workflow emits `signal.discovered` / `signal.ingested`, and matching remains a separate LangGraph step. Dashboard surfaces observe this process; they do not ask users to start ingestion manually. | Ready |
| Run Signal matching | MCP/internal Rep execution, automatic `signal.ingested` dispatcher | `product.signal.matching.run` | `workspace.signal.matching` / `lead.matching_graph.v1` scores one ingested Signal against Profile/ICP through `product.signal.match`; shared dispatcher `product-signal-matching-workflow-dispatcher-v1` starts matching from `signal.ingested`, emits `signal.classification.completed`, and keeps outreach gated behind later `signal.matched` Play dispatch | Ready |
| Record campaign Outcome | `/dashboard/campaigns`, MCP/internal Rep execution | `product.campaign.outcome.record` | Emits `outcome.recorded` for a Prayog Play run with Play, Rep, pattern, and exemplar attribution so existing Outcome -> procedural memory learning applies | Ready |
| Optimize campaign strategy | `/dashboard/campaigns`, MCP/internal Rep execution | `product.campaign.strategy.optimize` | `workspace.campaign.strategy` / `campaign.strategy_graph.v1` scores Play variants from attributable Outcomes, reply rate, positive Outcome rate, meeting rate, and negative Outcome rate, then emits `campaign.strategy.recommended`; matched Signal dispatch now applies same-Play/channel/segment winning skill variants as the actual Play `skill_key` while reduced variants emit `campaign.dispatch.skipped` | Ready |
| Optimize Play Skills | `/dashboard/campaigns`, MCP/internal Rep execution | `product.play.skills.optimize` | `workspace.skill.optimizer` / `skill.optimizer_graph.v1` combines campaign reply/Outcome rates with `rep.memory.procedural.updated` signals, then emits advisory `play.skill.optimization.recommended` recommendations without mutating Plays outside the Play gate | Ready |
| Resolve reachable contacts for a matched Signal | MCP/internal Rep execution | `product.contact.waterfall.resolve` | `workspace.contact.waterfall` / `contact.waterfall_graph.v1` starts the official `contact.resolve_for_signal.v1` graph-cache-first provider waterfall, records `contact.waterfall.step` spans, and waits for `contact.resolved` or `contact.resolution.deferred` when the runtime can complete synchronously | Ready |
| Push source-backed Signal | `/api/webhooks/signals`, external source, agent tool | `product.signal.discover` | Authenticated webhook/tool emits `signal.discovered`; projector materializes `Signal` and emits `signal.ingested` | Ready |
| Submit manual signal | MCP/internal Rep execution | `product.signal.submit` | Manual Signal ingestion event path | Ready |
| Dispatch matched Plays | Internal/dashboard action | `product.signals.dispatch_plays` | Starts Signal email/LinkedIn Play workflows after contact waterfall resolution; campaign allocation can substitute a compatible learned Play Skill into the workflow input, and the Play writer honors that skill in draft provenance before hot-path judge/send | Ready |
| Ground draft with public evidence | MCP/internal Rep execution, automatic Play step | `product.draft.ground` | `draft.grounding.exa`: Exa Search/Contents -> graph evidence sources -> judge/writer-ready proof summary -> draft `exa_grounding` provenance | Ready |
| Approve/reject draft | `/dashboard/review` | `product.approval.decide` | Resolves workflow approval gate | Ready |
| Retry failed workflow | `/dashboard/health`, MCP/internal Rep execution | `product.workflow.retry` | Durable workflow retry/resume | Ready |
| Inspect/redrive dead-lettered event delivery | `/dashboard/health` | `product.event_dispatch.dead_letters.list`, `product.event_dispatch.redrive` | Shared workspace-scoped recovery queue; redrive resets the NATS dispatch row for replay and emits `event.dispatch.redriven` as a typed audit event | Ready |
| Provision/verify/refresh sending domain | `/dashboard/deliverability`, MCP/internal Rep execution | `product.sending_domain.operate` | Starts sending-domain workflow | Ready |
| CRUD graph companies/persons/sources/edges | Derived graph surfaces | `graph.companies.*`, `graph.persons.*`, `graph.sources.*`, `graph.edges.*` | Shared workspace graph tables, including node delete primitives that clean graph edges | Ready |

## Guardrails

Production proof for active Exa research variants lives in `npm run verify:exa`.
The active product surface should cover `draft.grounding.exa`,
`rep.brief.refresh.exa`, `rep.research.exa`, and open-web signal discovery.
Legacy Content/AEO workflow canaries remain in the script until the worker
release contract is deliberately migrated, but those paths are not exposed as
user or agent tools in the current prospecting/outbound wedge.

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
