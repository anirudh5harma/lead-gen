# `core/` — The Foundation

This is the spine of the pivot-v2 architecture. **Do not bypass it.** See [`/ARCHITECTURE.md`](../ARCHITECTURE.md) for the full design, and [`/AGENTS.md`](../AGENTS.md) for the no-shortcuts rules.

## Layers

| Path                   | Layer (ARCHITECTURE.md)        | What lives here                                                                 |
|------------------------|--------------------------------|---------------------------------------------------------------------------------|
| `core/substrate/`      | Layer 1 — Substrate            | Durable workflow runtime, typed event bus, storage clients, workspace auth      |
| `core/graph/`          | Layer 2 — Knowledge Graph      | Node and edge types over `db/` tables; retrieval helpers                        |
| `core/agents/`         | Layer 3 — Agent Fabric         | Reps, role-agent composition, three-tier memory, MCP tool envelope, eval/judge |
| `core/channels/`       | Layer 4 — Channels             | Email, LinkedIn, X, Voice, Video, Web/Ads — each with its own state machine     |
| `core/plays/`          | Layer 3                        | Declarative Plays that compile to durable workflows                             |
| `core/primitives/`     | All layers                     | The five primitives (Rep, Signal, Play, Conversation, Outcome) as Zod schemas   |
| `core/mcp/`            | Layer 5 — Surfaces             | MCP server: external agents use the same tools internal Reps use                |

## Hard rules

- Every state change goes through `core/substrate/events/` — never write directly to tables from a handler.
- Every long-running operation goes through `core/substrate/workflows/` — no Vercel crons for orchestration.
- Every generation that reaches a channel passes a hot-path judge in `core/agents/eval/`.
- Every channel implements `send(conversation, draft) → MessageId | DeferReason`.
- The five primitives in `core/primitives/` are the only user-facing nouns. Everything else is a derived view.

If a constraint forces a deviation, document it in the PR and link the section of `ARCHITECTURE.md` you are diverging from.
