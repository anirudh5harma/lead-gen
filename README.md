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
| OAuth and ingestion writes through typed projections | ✅ landed |
| Catalog fanout via `signal.discovered` + projector    | ✅ landed |
| TTL / upstream expiry via `signal.expiry.requested`   | ✅ landed |
| Vercel-cron deployed control-plane scheduling         | ✅ landed |
| Microsoft Graph lifecycle-token validation + legacy reconnect | ✅ landed |
| Dead-letter queue + operator redrive surface          | ✅ landed |
| Dashboard UI (brief, conversations, approvals, ingestion, deliverability, ops) | ✅ landed |
| Recovery / NATS / SES verification smoke harnesses    | ✅ landed |
| Restate workflow-handler host process                 | ⏳ deployment work |
| Auto-trigger of Plays on `signal.matched`             | ✅ landed |
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
keys are not active. In production `nats_restate` mode, health also checks the
Restate admin deployment list and reports stale worker URIs/services when the
required workflow handlers are missing.

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
events only. In production, prefer the consolidated worker when the hosted NATS
account has a tight active-connection limit:

```bash
DATABASE_URL=... APP_ORIGIN=... NATS_URL=... RESTATE_INGRESS_URL=... DEEPSEEK_API_KEY=... OPENAI_API_KEY=... MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=... npm run worker:production
```

For larger NATS accounts, the same image can be split into the durable
consumers below. Run the email consumer alongside the app:

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

Before pushing a worker image, run the static release contract check:

```bash
npm run verify:worker-release
```

It verifies the Restate-capable worker entrypoints register every workflow
service that production readiness and `npm run verify:restate` require.

Deploy these worker processes on a long-running container runtime. On AWS, use
ECS Express Mode for new deployments and migrations from App Runner-style
services. For managed services that need an HTTP health check, run
`npm run worker:managed` with `WORKER_TARGET_COMMAND` set to the target worker,
including `worker:production` or `worker:restate-workflows` for the Restate
handler host. Restate-capable managed workers use `WORKER_HEALTH_PORT=9081` by
default so the health server does not collide with the Restate handler on
`RESTATE_WORKFLOW_PORT=9080`.

Production readiness requires `NATS_URL`, `RESTATE_INGRESS_URL`, and
`MAINTENANCE_TRIGGER_SECRET`. Set `BOMBSELL_SUBSTRATE=nats_restate` when the
NATS broker and Restate handler deployment are live; `postgres` is the
development bridge.
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

A deployment control-plane scheduler starts due tenant maintenance without
performing any product mutation itself. Vercel Cron drives this in production
(`vercel.json` schedules `*/5 * * * *`); any external scheduler can also call
it directly:

```bash
curl -X POST https://app.example.com/api/internal/workflows/maintenance \
  -H "Authorization: Bearer $MAINTENANCE_TRIGGER_SECRET"
```

The route accepts either `MAINTENANCE_TRIGGER_SECRET` or Vercel-injected
`CRON_SECRET` as the Bearer value, and accepts both GET and POST so Vercel
Cron's default GET works alongside external POST schedulers.

That authenticated ingress submits platform-scoped catalog polling and TTL
expiry sweeps, and discovers due tenant-scoped source polls, daily
owned-domain warmup sweeps, and hourly Outlook subscription repairs.
Subscriptions missing `lifecycleNotificationUrl` are detected by the same
discovery and migrated via DELETE+recreate. Platform work is represented
explicitly in the Restate request metadata and cannot use tenant event
publication APIs without a workspace projection. Consequential work remains
durable inside Restate.

The Postgres workflow runtime remains a development bridge: it journals
state but cannot resume parked workflows after a process restart. It is not
the production runtime described in `ARCHITECTURE.md`.

### Deploy checklist

Before promoting a deploy, work through each section. Items marked **REQUIRED**
fail the platform closed; **RECOMMENDED** items degrade gracefully.

#### 1. Environment variables

**REQUIRED (runtime fails closed if absent):**

- `DATABASE_URL` — Postgres 16+ with `pgvector`, `citext`, `pgcrypto`.
- `APP_ORIGIN` — public origin used for webhook callbacks (no trailing slash).
- `SESSION_SECRET` — random 32+ bytes for OAuth state integrity.
- `CREDENTIALS_ENCRYPTION_KEY` — base64-encoded 32-byte root key; per-account
  OAuth tokens are envelope-encrypted from this.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — dashboard
  identity provider.
- `NATS_URL` — JetStream broker; production refuses to fall back to Postgres.
- `RESTATE_INGRESS_URL` — Restate cloud / self-hosted ingress.
- `RESTATE_ADMIN_URL` — Restate admin API used by `npm run verify:restate`;
  defaults to `RESTATE_INGRESS_URL` with port `9070` when unset.
- `RESTATE_BEARER_TOKEN` — bearer token for protected Restate Cloud /
  self-hosted ingress. Optional only for unauthenticated local Restate.
- `MAINTENANCE_TRIGGER_SECRET` — bearer secret the maintenance route accepts
  (set to the same value as `CRON_SECRET` on Vercel deployments).

**REQUIRED FOR DEPLOYED FEATURES (the feature stops, the platform still runs):**

- `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_MODEL`) — the default LLM for every
  drafting, judging, and classification call. Without it, drafts cannot be
  produced.
- `OPENAI_API_KEY` — embedding model for signal ingestion (DeepSeek does not
  yet ship embeddings).
- `AWS_REGION`, `AWS_SNS_TOPIC_ARNS` — owned-domain sending via SES;
  `AWS_SNS_TOPIC_ARNS` is the comma-separated list of trusted SNS topic ARNs
  the webhook accepts.
- `SES_CONFIGURATION_SET` — SES configuration set attached to owned-domain
  outbound sends so delivery, bounce, and complaint events reach SNS. Defaults
  to `bombsell-outbound` in the worker.
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` —
  Outlook OAuth.
- `RESEND_API_KEY` — transactional product email (welcome, alerts).
- `PRODUCT_HUNT_TOKEN`, `REDDIT_USER_AGENT`, `SEC_EDGAR_USER_AGENT` — per-source
  ingestion adapters.

**RECOMMENDED:**

- `CRON_SECRET` — Vercel auto-injects when a Cron is configured under the
  project. The maintenance route accepts either `MAINTENANCE_TRIGGER_SECRET`
  or `CRON_SECRET`, so setting both to the same value lets either scheduler
  drive the same deployment.
- `MICROSOFT_TENANT_ID` — single-tenant deployments restrict Graph lifecycle
  tokens to this exact tenant. Multi-tenant deployments leave it unset and
  rely on the audience + signature check.
- `SNS_VERIFY_SIGNATURES=1` — keep on in production; only the local test
  harness sets this to `0`.
- `DATABASE_POOL_MAX` — defaults to 10.
- `NATS_STREAM_MAX_BYTES` — JetStream events stream byte cap. Hosted NATS
  accounts may require a bounded value such as `67108864`.
- `NATS_STREAM_MAX_AGE_MS` — JetStream events stream max age, default 30 days.
- `RESTATE_WORKFLOW_PORT` — the Restate workflow worker port (default 9080).
- `RESTATE_WORKFLOW_HTTP1` — set to `1` when the worker is behind a managed
  HTTP/1.1 proxy.
- `WORKER_TARGET_COMMAND` — background worker selected by the managed-worker
  health wrapper (`worker:production`, `worker:email-projectors`,
  `worker:signal-projectors`, `worker:projectors`, or
  `worker:restate-workflows`).
- `WORKER_HEALTH_PORT` — health port exposed by managed background workers.
  Defaults to `9081` for Restate-capable managed targets and `9080` otherwise.
- `OUTLOOK_DEFAULT_DAILY_CAP` — connected-inbox per-day send ceiling
  (default 25).
- `BOMBSELL_ALLOW_DEMO_AUTH`, `BOMBSELL_DEMO_USER_ID` — **leave unset in
  production**; they only enable the local demo cookie shortcut.

The runtime contract is enforced by `core/config/env.ts` and `test/env-contract.test.ts` — every `process.env` read in app, core, lib, or scripts is asserted to be a declared key.

#### 2. Database migrations

```bash
DATABASE_URL=... npm run migrate
```

Required migrations (latest two added by this batch):

- `025_signal_candidate_fanouts_loose_fk.sql` — loosens FK so the catalog
  fanout audit row can be written before the async projector materializes
  the signal.
- `026_event_dispatch_dead_letter.sql` — adds `dead_lettered` status and
  `dead_lettered_at` column to the NATS dispatch table.

#### 3. Long-running workers

Each runs as its own process; all three are required for production:

```bash
npm run worker:email-projectors       # SES/Outlook ingress → channel projectors
npm run worker:signal-projectors      # classify + signal projectors
npm run worker:restate-workflows      # Restate handler host + signal bridge
```

Register the Restate worker endpoint with the Restate admin API (see
[Restate docs](https://docs.restate.dev)) and
[`docs/production-workers.md`](./docs/production-workers.md).

#### 4. Scheduler

`vercel.json` schedules `*/5 * * * *` against
`/api/internal/workflows/maintenance`. Confirm Vercel Cron is enabled
under the project and that `CRON_SECRET` matches `MAINTENANCE_TRIGGER_SECRET`.

On non-Vercel hosts, point your scheduler at the same URL with the same
bearer; the route accepts both GET and POST.

#### 5. Post-deploy smoke tests

Run all three against the deployed environment:

```bash
DATABASE_URL=... npm run verify:recovery   # dispatch DLQ schema + redrive flip
DATABASE_URL=... NATS_URL=... npm run verify:nats   # publish + delivery round-trip
RESTATE_INGRESS_URL=... RESTATE_BEARER_TOKEN=... npm run verify:restate # registered workflows
DATABASE_URL=... npm run verify:ses        # bounce → message → outcome pipeline
AWS_REGION=... AWS_SNS_TOPIC_ARNS=... npm run verify:aws-ses # SES account + SNS config
```

#### 6. Operator surfaces to bookmark

- `/dashboard/ingestion` — per-source poll status, budget burn, recent
  signals.
- `/dashboard/deliverability` — sending-domain warmup, bounce + complaint
  rates, channel-account health.
- `/dashboard/ops` — pending / delivered / dead-lettered NATS dispatches
  with one-click redrive on the DLQ rows.

#### Known follow-ups (do not block launch)

- Deploy and register the `worker:restate-workflows` handler host outside
  Vercel, then verify Restate lists the workflow services.
- `npm audit` findings should be resolved before release.
