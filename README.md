# Bombsell

AI-native outbound for founders and lean GTM teams.

Bombsell finds timely buying signals, identifies the right people, drafts
personalized outreach, and learns from replies and meetings.

Dashboard UI (Brief, Agent, Profile):

- `/dashboard/brief` — last-day and last-week qualified signals
- `/dashboard/agent` — live work, qualified signals, and conversations
- `/dashboard/profile` — company Profile, buyer fit, Outlook/LinkedIn, and settings
- `/dashboard/health` — owner-only runtime readiness
- `/dashboard/conversations/<conversation-id>` — one outreach thread

[Try Bombsell](https://www.bombsell.com)

## What it does

- Finds and qualifies company signals from the public web
- Enriches accounts and verifies contacts
- Runs email and LinkedIn outreach with approval and safety controls
- Tracks conversations, replies, meetings, and outcomes
- Improves future outreach from observed results

## How it works

1. Add your company website.
2. Connect an outreach channel.
3. Review the recommended audience and Plays.
4. Approve outreach or enable scoped automation.
5. Track replies, meetings, and learning in the dashboard.

## Run locally

Requirements: Node.js, PostgreSQL 16+, and the extensions `pgvector`,
`citext`, and `pgcrypto`.

```bash
git clone https://github.com/anirudh5harma/lead-gen.git
cd lead-gen
npm install
cp .env.example .env.local
npm run migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`.env.example` is the configuration contract. At minimum, local product flows
need Supabase credentials and `DATABASE_URL`; integrations require their
corresponding provider keys.

## Verify changes

```bash
npm test
npm run build
npm run lint
```

Database-backed tests run when `DATABASE_URL` is available and otherwise skip.

## Architecture

Bombsell is built around five product primitives: Rep, Signal, Play,
Conversation, and Outcome. Durable workflows, typed events, a knowledge graph,
and hot-path evaluation gates keep automation observable and controlled.

- [Architecture](./ARCHITECTURE.md)
- [Core runtime](./core/README.md)
- [Database](./db/README.md)
- [Production workers](./docs/production-workers.md)
- [Contributor rules](./AGENTS.md)

## Stack

Next.js 16, TypeScript, PostgreSQL, NATS JetStream, Restate, and Supabase.

## Status

Bombsell is under active development. Email is available; additional native
channel support is rolling out incrementally.
