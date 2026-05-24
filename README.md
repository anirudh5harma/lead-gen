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
| Database schema (14 migrations) + migration runner  | ✅ landed |
| Five primitives (Zod)                               | ✅ landed |
| Event bus (in-memory + Postgres via LISTEN/NOTIFY)  | ✅ landed |
| Durable workflow runtime (in-process + Postgres)    | ✅ landed |
| Storage layer (pg pool + workspace-scoped sessions) | ✅ landed |
| Agent fabric (tools, memory, eval, reps)            | ✅ landed |
| MCP envelope                                        | ✅ landed |
| Knowledge graph nodes + edges + first 13 Tools      | ✅ landed |
| Concrete memory adapters + outcome feedback bridge  | ✅ landed |
| LLM client (DeepSeek V4 Pro) + LLM-backed judge     | ✅ landed |
| Email channel (SES owned-domain + Outlook OAuth)    | ✅ landed |
| Transactional email (Resend)                        | ✅ landed |
| First Rep + Play end-to-end ("Maya", Series A cold) | ✅ landed |
| Production adapters (NATS, Restate)                 | ⏳ stubs  |
| Reply intake + classification → procedural feedback | ⏳ next   |
| LinkedIn / X / voice channels                       | ⏳ later  |

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

### LLM

DeepSeek V4 Pro is the single default for every LLM call — drafting, hot-path judges, classification. Workspaces can BYO Anthropic / OpenAI keys, but the platform default is DeepSeek (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) "Opinionated Tech Stack").

```bash
export DEEPSEEK_API_KEY=sk-...
export DEEPSEEK_MODEL=deepseek-v4-pro   # optional override
```

The LLM client (`core/agents/llm/`) exposes a provider-agnostic `LLMClient` interface so swapping providers is a single-file change.
