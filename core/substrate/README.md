# Substrate — Layer 1

Durable workflows, typed event bus, storage clients, workspace auth. The non-negotiable foundation.

## Hard rules

1. **Every state change is a typed event.** Handlers emit events to `core/substrate/events/`. They do not write to tables directly.
2. **Every long-running operation is a workflow step.** `core/substrate/workflows/` is the only orchestration primitive. No Vercel cron for sequencing.
3. **Workspace is the security boundary.** All storage clients in `core/substrate/storage/` are workspace-scoped. Per-tenant LLM key routing in `core/substrate/auth/`.

## Submodules

- `events/` — typed event registry (Zod), publisher, in-memory dev bus + NATS JetStream adapter (production).
- `workflows/` — durable workflow runtime contracts (Step, Workflow, Checkpoint, ApprovalGate). Dev adapter runs in-process; Restate adapter for production.
- `storage/` — Postgres + pgvector + ClickHouse clients, all workspace-aware.
- `auth/` — workspace boundary enforcement, per-tenant credential vaulting.
