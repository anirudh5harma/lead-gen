# Substrate — Layer 1

Durable workflows, typed event bus, storage clients, workspace auth. The non-negotiable foundation.

## Hard rules

1. **Every state change is a typed event.** Handlers emit events to `core/substrate/events/`. They do not write to tables directly.
2. **Every long-running operation is a workflow step.** `core/substrate/workflows/` is the only orchestration primitive. No Vercel cron for sequencing.
3. **Workspace is the security boundary.** All storage clients in `core/substrate/storage/` are workspace-scoped. Per-tenant LLM key routing in `core/substrate/auth/`.

## Submodules

- `events/` — typed event registry (Zod), publisher, in-memory dev bus, Postgres durable bus, and a NATS JetStream contract for future scale-out.
- `workflows/` — durable workflow runtime contracts (Step, Workflow, Checkpoint, ApprovalGate). Dev adapter runs in-process; the product runtime uses the Postgres journal today, with a Restate contract for future scale-out.
- `storage/` — Postgres + pgvector + ClickHouse clients, all workspace-aware.
- `auth/` — workspace boundary enforcement, per-tenant credential vaulting.

Production HTTP ingress uses `events/runtime.ts`, which appends the canonical
event journal in Postgres and delivers the identical event through NATS rather
than falling back to the Postgres LISTEN/NOTIFY development bridge. The
journal is currently consumed by hot-path eval gating, audit, and replay;
`event_nats_dispatches` records interrupted delivery for worker redrive.
Email provider ingress and encrypted Outlook OAuth credential lifecycle events
are materialized by `core/channels/email/projectors.ts`, run through
`npm run worker:email-projectors`. OAuth authorization and token
refresh/reauthorization therefore never mutate channel state in the callback
or Graph adapter. The worker also submits keyed Restate subscription repair
after an authorized Outlook account has been projected.

Signal classification runs through `npm run worker:signal-projectors`. Its
durable consumer emits `signal.classification.completed`; an idempotent
projector owns the Signal status update and emits derived matched/dismissed
events. Workspace source polling also emits `signal.discovered` for this
projector to materialize before classification wakes. Failed classifier calls
are left for NATS redelivery.

Restate-hosted workflows are served by `npm run worker:restate-workflows`. The
worker also runs the typed-event signal bridge: `ctx.awaitEvent` writes a
`workflow_event_waits` row, and matching bus events resolve the workflow-bound
durable promise through Restate ingress. Channel maintenance workflows hosted
there are tenant-scoped: `email_domain_warmup_sweep` and
`email_outlook_subscription_repair`.

`POST /api/internal/workflows/maintenance` is the authenticated operational
ingress for routine platform and tenant work. It starts explicitly
platform-scoped, idempotently keyed Restate invocations for
`ingest_catalog_poll` and `ingest_expire_sweep`, plus due workspace
invocations for `ingest_workspace_poll`, `email_domain_warmup_sweep`, and
`email_outlook_subscription_repair`. Platform workflows cannot invoke generic
typed-event publication without a tenant projection; event-producing ingest
logic emits against each destination workspace. The ingress does not project
or mutate domain state itself. Deployments must invoke it from their
worker/control plane using `MAINTENANCE_TRIGGER_SECRET`.
