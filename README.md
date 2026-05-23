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

| Area                                       | State     |
|--------------------------------------------|-----------|
| Directory structure                        | ✅ landed |
| Database schema (12 migrations)            | ✅ landed |
| Five primitives (Zod)                      | ✅ landed |
| Event bus (typed registry + dev adapter)   | ✅ landed |
| Durable workflow runtime (dev adapter)     | ✅ landed |
| Agent fabric (tools, memory, eval, reps)   | ✅ landed |
| MCP envelope                               | ✅ landed |
| Production adapters (NATS, Restate)        | ⏳ stubs  |
| Concrete role agents + first Rep           | ⏳ next   |
| Channels (email / LinkedIn / X / ...)      | ⏳ later  |
| First Play end-to-end                      | ⏳ later  |

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build sanity check
```

Database migrations in `db/migrations/` are ordered SQL files. Apply them in order against a Postgres 16+ instance with the `pgvector`, `citext`, and `pgcrypto` extensions available. A Supabase migration shim or a direct `psql` runner both work — the foundation has no migration tool opinion yet.
