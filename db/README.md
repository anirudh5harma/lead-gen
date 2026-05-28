# `db/` — Schema and Migrations

The Postgres schema for the pivot-v2 foundation. Aligned to [`/ARCHITECTURE.md`](../ARCHITECTURE.md).

## Layout

```
db/
├── migrations/   # Ordered SQL migrations (001_*.sql, 002_*.sql, ...)
└── seed/         # Optional seed data (dev fixtures, demo workspaces)
```

## Migration order (foundation)

| #   | File                                    | Establishes                                                       |
|-----|-----------------------------------------|-------------------------------------------------------------------|
| 001 | `001_extensions_and_tenancy.sql`        | `pgvector`, `citext`, `pgcrypto`; workspaces + members + RLS helpers |
| 002 | `002_substrate_events.sql`              | Append-only typed event log (the bus's durable backing store)     |
| 003 | `003_substrate_workflows.sql`           | Durable workflow runs, steps, checkpoints, approval gates         |
| 004 | `004_graph_nodes.sql`                   | Knowledge graph nodes: persons, companies, sources (with vectors) |
| 005 | `005_graph_edges.sql`                   | Typed edges for graph traversal                                   |
| 006 | `006_primitive_signal.sql`              | Signal primitive                                                  |
| 007 | `007_primitive_conversation.sql`        | Conversation + Message (cross-channel thread)                     |
| 008 | `008_primitive_rep.sql`                 | Rep persona + three-tier memory (episodic/semantic/procedural)    |
| 009 | `009_primitive_play.sql`                | Play definition (NL + compiled spec) + Play runs                  |
| 010 | `010_primitive_outcome.sql`             | Outcome (scored, attributable result)                             |
| 011 | `011_channel_accounts.sql`              | Channel accounts (Gmail/LinkedIn/X/...) + owned sending domains   |
| 012 | `012_rls_policies.sql`                  | Row-level security: workspace is the boundary                     |
| 013 | `013_event_notify_trigger.sql`          | Postgres event notification bridge                                |
| 014 | `014_channel_kinds_outlook.sql`         | Explicit Outlook channel-account kind                             |
| 015 | `015_signal_ingestion.sql`              | Workspace ICPs, tracked companies, source config and budgets       |
| 016 | `016_signal_candidates.sql`             | Shared candidate pool, fanout and embedding support                |
| 017 | `017_platform_signal_sources.sql`       | Platform catalog source polling and expiration event support       |
| 018 | `018_signal_overflow_polymorphic.sql`   | Signal overflow source generalization                              |
| 019 | `019_sec_cik_column.sql`                | SEC EDGAR company identity                                         |
| 020 | `020_signals_kind_nullable.sql`         | Classifier-owned optional signal kind                              |
| 021 | `021_event_idempotency_keys.sql`        | Retry-safe typed event publication                                 |
| 022 | `022_outcome_projection_idempotency.sql` | Retry-safe Outcome projection from ingress events                  |
| 023 | `023_event_nats_dispatches.sql`         | Durable journal-to-NATS dispatch and redrive tracking              |
| 024 | `024_workflow_event_waits.sql`          | Restate workflow typed-event wait registry                         |

## Conventions

- **Workspace is the security boundary.** Every tenant-scoped table carries `workspace_id uuid not null references workspaces(id) on delete cascade`. RLS is mandatory.
- **Identifiers** are `uuid` defaulting to `gen_random_uuid()` (from `pgcrypto`).
- **Timestamps** are `timestamptz` defaulting to `now()`. Use `occurred_at` / `started_at` / `ended_at` — not `created_at` where the domain term is clearer.
- **JSONB for open-ended fields** (`properties`, `payload`, `persona`). Index with GIN where queried.
- **Embeddings** are `vector(1536)` (OpenAI/text-embedding-3-small dimensions; adjust per model). Index with `ivfflat` or `hnsw`.
- **Provenance** is mandatory on graph nodes: `provenance jsonb` records which agent/source produced the row.
- **Events are append-only.** Never `UPDATE` or `DELETE` from `events`.
