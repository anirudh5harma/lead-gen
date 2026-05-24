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

| Area                                                | State     |
|-----------------------------------------------------|-----------|
| Directory structure                                 | ✅ landed |
| Database schema (13 migrations) + migration runner  | ✅ landed |
| Five primitives (Zod)                               | ✅ landed |
| Event bus (in-memory + Postgres via LISTEN/NOTIFY)  | ✅ landed |
| Durable workflow runtime (in-process + Postgres)    | ✅ landed |
| Storage layer (pg pool + workspace-scoped sessions) | ✅ landed |
| Agent fabric (tools, memory, eval, reps)            | ✅ landed |
| MCP envelope                                        | ✅ landed |
| Production adapters (NATS, Restate)                 | ⏳ stubs  |
| Knowledge graph queries + first real Tools          | ⏳ next   |
| Concrete memory adapters (Postgres-backed)          | ⏳ next   |
| LLM client + LLM-backed judge                       | ⏳ later  |
| First channel: owned-domain email                   | ⏳ later  |
| First Rep + Play end-to-end                         | ⏳ later  |

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build sanity check
```

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
