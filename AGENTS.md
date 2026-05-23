# Build to the Architecture, Not Around It

`ARCHITECTURE.md` is the source of truth for this codebase. We are pivoting (the `pivot-v2` line of work) toward an AI-native GTM platform — durable workflow runtime, typed event bus, explicit knowledge graph, five primitives (Rep, Signal, Play, Conversation, Outcome), hot-path eval gating, owned-domain deliverability, native channels. Read `ARCHITECTURE.md` before you write code that touches any of those areas.

**Stick to the plan. Do not take shortcuts or "simpler routes" that bypass the architecture.**

- Do not reach for a Vercel cron when the design calls for a durable workflow step. Add it to the workflow runtime instead, even if it costs a day.
- Do not write directly to tables from a handler when the design calls for a typed event on the bus. Emit the event.
- Do not collapse the knowledge graph back into ad-hoc tables because a query is faster to write that way. Extend the graph.
- Do not add a new "system agent" when the design calls for a Rep composed of role agents. Compose the Rep.
- Do not bolt autonomy onto a per-agent toggle when the design calls for per-Play × channel × volume gating. Gate at the Play.
- Do not ship a generation path without a hot-path judge. Sub-threshold drafts never reach the channel.
- Do not invent new user-facing nouns. Everything maps to one of the five primitives or it is a derived view.

If a constraint (time, dependency, missing infra) genuinely forces a deviation, **say so explicitly in the PR description and link the part of `ARCHITECTURE.md` you are diverging from**. Track it as a known divergence to repay, not a silent shortcut.

Every change is aimed at state-of-the-art. Reliability, observability, eval, and trust are first-class — not afterthoughts. If you find yourself reasoning "we can add that later," re-read the trust posture section of `ARCHITECTURE.md` before continuing.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
