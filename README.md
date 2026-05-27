# Bombsell — pivot-v2

AI-native GTM infrastructure for agents, founders, and small teams. Outbound, online content, and campaigns on autopilot — reliably.

This branch is a clean-slate rebuild against a state-of-the-art architecture. The old codebase is preserved under [`legacy/`](./legacy) for reference.

## Read first

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the design. Five primitives (Rep, Signal, Play, Conversation, Outcome). Five layers (Substrate → Knowledge Graph → Agent Fabric → Channels → Surfaces). The non-negotiables.
- [`AGENTS.md`](./AGENTS.md) — the no-shortcuts rules. Build to the architecture; document any forced divergence in your PR.

## Layout

```
app/             # Next.js 16 routes (Surface layer). Design system preserved.
components/      # UI primitives (Toast, Icon, ui/).
core/            # The new foundation — see core/README.md
  substrate/     #   Layer 1: events, workflows, storage, auth
  graph/         #   Layer 2: knowledge graph nodes + edges
  agents/        #   Layer 3: Reps, tools, memory, eval
  channels/      #   Layer 4: email, linkedin, x, voice, video, web
  plays/         #   Layer 3: compiled Plays
  primitives/    #   Zod schemas for the five primitives
  mcp/           #   Layer 5: MCP server (external agents)
db/              # Postgres schema and migrations — see db/README.md
legacy/          # Archived previous implementation. Do not import.
```

## Foundation status

| Area                                                  | State     |
|-------------------------------------------------------|-----------|
| Directory structure                                   | ✅ landed |
| Database schema (23 migrations) + migration runner    | ✅ landed |
| Five primitives (Zod)                                 | ✅ landed |
| Event bus (in-memory + Postgres + NATS JetStream)     | ✅ landed |
| Durable workflow runtime (in-process + Postgres + Restate ingress client) | ✅ landed |
| Storage layer (pg pool + workspace-scoped sessions)   | ✅ landed |
| Agent fabric (tools, memory, eval, reps)              | ✅ landed |
| MCP envelope                                          | ✅ landed |
| Knowledge graph nodes + edges + first 13 Tools        | ✅ landed |
| Concrete memory adapters + outcome feedback bridge    | ✅ landed |
| LLM client (DeepSeek V4 Pro) + LLM-backed judge       | ✅ landed |
| Email channel (SES owned-domain + Outlook OAuth)      | ✅ landed |
| Transactional email (Resend)                          | ✅ landed |
| First Rep + Play end-to-end ("Maya", Series A cold)   | ✅ landed |
| Reply intake + classification → procedural feedback   | ✅ landed |
| SES SNS signature verification + trusted topic gating | ✅ landed |
| Dashboard membership auth + Outlook credential encryption | ✅ landed |
| Email provider webhooks → typed ingress → projector worker | ✅ landed |
| OAuth and ingestion writes through typed projections | ⏳ required |
| Dashboard UI (brief, conversations, approvals, ...)   | ✅ landed |
| Restate workflow-handler host process                 | ⏳ deployment work |
| LinkedIn / X / voice channels                         | ⏳ later  |
| Second Play + NL → spec compiler                      | ⏳ later  |

## Local development

```bash
npm install
cp .env.example .env.local # or provide the equivalent deployment variables
npm run dev      # http://localhost:3000
npm run build    # production build sanity check
```

`.env.example` is the tracked configuration contract. Production health at
`/api/health` fails closed when core authentication, database, origin, or
credential-encryption configuration is absent, and reports integrations whose
keys are not active.

### Database

Postgres 16+ with `pgvector`, `citext`, and `pgcrypto`. Set `DATABASE_URL` and apply migrations:

```bash
export DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/bombsell_dev'
npm run migrate           # apply pending migrations
npm run migrate -- --dry  # list what would apply
```

The runner records each applied file (with a checksum) in `schema_migrations` and refuses to re-apply an edited file — create a new migration instead.

### Tests

```bash
npm test                  # runs in-memory tests; DB-backed tests skip
DATABASE_URL=... npm test # runs every test, including Postgres event bus
                          # and workflow runtime integration tests
```

### LLM

DeepSeek V4 Pro is the single default for every LLM call — drafting, hot-path judges, classification. Workspaces can BYO Anthropic / OpenAI keys, but the platform default is DeepSeek (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) "Opinionated Tech Stack").

```bash
export DEEPSEEK_API_KEY=sk-...
export DEEPSEEK_MODEL=deepseek-v4-pro   # optional override
```

The LLM client (`core/agents/llm/`) exposes a provider-agnostic `LLMClient` interface so swapping providers is a single-file change.

### Try the dashboard end-to-end

```bash
# Apply migrations, then seed Maya + a Series A signal, run the cold-open
# Play with mocked LLM + SES, and simulate an inbound positive reply so
# the dashboard has real data.
npm run migrate
BOMBSELL_ALLOW_DEMO_AUTH=1 \
BOMBSELL_DEMO_USER_ID=00000000-0000-4000-8000-000000000001 \
npm run demo:seed
npm run dev
# Open http://localhost:3000/dashboard
```

The demo opt-in inserts an accepted membership for the local demo identity.
Production never permits demo authentication or arbitrary workspace-cookie
selection.

### Production adapters

NATS JetStream is the production delivery bus (see ARCHITECTURE.md). Run a
NATS server and set `NATS_URL`; the bus auto-creates the stream. Publication
first appends the canonical event to Postgres, then delivers that same event
through NATS. The append-only journal is currently required by hot-path eval
gating, audit, and replay until the event-log sink is deployed. A durable
dispatch row allows the worker to redrive a journaled event if delivery was
interrupted before JetStream acknowledged it.
Authenticated SES and Outlook webhook routes now publish provider-ingress
events only. Run their durable consumer alongside the app:

```bash
DATABASE_URL=... NATS_URL=... RESTATE_INGRESS_URL=... DEEPSEEK_API_KEY=... npm run worker:email-projectors
```

Run Signal classification and its state projector as a durable NATS consumer:

```bash
DATABASE_URL=... NATS_URL=... DEEPSEEK_API_KEY=... npm run worker:signal-projectors
```

Run the Restate workflow handler host as a separate worker and register its
endpoint with the Restate admin API:

```bash
DATABASE_URL=... APP_ORIGIN=... NATS_URL=... RESTATE_INGRESS_URL=... DEEPSEEK_API_KEY=... OPENAI_API_KEY=... MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=... npm run worker:restate-workflows
```

Production readiness requires `NATS_URL`, `RESTATE_INGRESS_URL`, and
`MAINTENANCE_TRIGGER_SECRET`.
When `NATS_URL` is absent, non-production app ingress uses the Postgres
bridge for development only; production fails closed rather than processing
off-bus.

Restate is the production workflow runtime. The adapter shipped here is
the **ingress client**: it satisfies our `WorkflowRuntime` interface
over HTTP to native keyed Restate workflows (`/<workflow>/<key>/run/send`).
Deploying Restate end-to-end also requires the `worker:restate-workflows`
handler process built on `@restatedev/restate-sdk`. The worker hosts the native
workflow handlers and runs the typed-event signal bridge that resolves
`ctx.awaitEvent` via workflow-bound durable promises. It also hosts the
workspace-scoped owned-domain warmup and Outlook subscription repair workflows.

A deployment control-plane scheduler can start due tenant maintenance without
performing any product mutation itself:

```bash
curl -X POST https://app.example.com/api/internal/workflows/maintenance \
  -H "Authorization: Bearer $MAINTENANCE_TRIGGER_SECRET"
```

That authenticated ingress submits platform-scoped catalog polling and TTL
expiry sweeps, and discovers due tenant-scoped source polls, daily
owned-domain warmup sweeps, and hourly Outlook subscription repairs. Platform
work is represented explicitly in the Restate request metadata and cannot use
tenant event publication APIs without a workspace projection. The ingress
must run from the worker/control plane, not a Vercel cron; consequential work
remains durable inside Restate.

The Postgres workflow runtime remains a development bridge: it journals
state but cannot resume parked workflows after a process restart. It is not
the production runtime described in `ARCHITECTURE.md`.

### Production blockers

The platform is not production-ready yet. The next required build sequence is:

1. Configure the control-plane schedule for `/api/internal/workflows/maintenance` in the deployed worker environment.
2. Replace remaining direct Signal creation and expiration mutations in ingestion with typed lifecycle events plus idempotent projectors. Classification decisions and Outlook OAuth authorization/refresh/reauthorization now project state from canonical events.
3. Add Microsoft Graph lifecycle-token validation and migrate or reconnect any pre-encryption Outlook accounts.
4. Wire deployment readiness for NATS/Restate workers, add operator-visible dead-letter handling for repeatedly failed dispatches, and run database, NATS, browser, deliverability, and recovery tests in a production-like environment.
5. Resolve the dependency audit findings before release.
