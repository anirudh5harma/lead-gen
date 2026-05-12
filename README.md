# Bombsell

Agentic GTM for solo operators, agencies, and small teams.

Bombsell runs two engines off a shared fleet of agents:

- **Outbound** — ingests public buying signals, matches them against an ICP, enriches contacts, drafts and sends outreach through connected inboxes, classifies replies, sends booking links, and schedules follow-ups.
- **Content** — turns those same signals plus the workspace's positioning into LinkedIn / X post ideas, drafts and edits them, schedules / publishes via a posting partner, pulls engagement, and repurposes what performs.

Every agent runs independently. An "engine" is just a default pipeline over a set of agents. A workspace decides which agents are on and how much agency each one gets.

## Agent fleet

The fleet is the capability catalog (`lib/agents/core/registry.ts`); per-workspace state — enabled / autonomy / config — lives in `workspace_agents` (`lib/agents/core/workspace-agents.ts`).

| Engine | Agents |
|---|---|
| Outbound | `signal` · `match` · `enrich` · `safety` · `outreach` · `reply` · `booking` · `followup` |
| Content | `idea` · `writer` · `editor` · `publisher` · `engagement` · `repurpose` |
| Shared / add-on / control | `insight` · `crm` (Team plan) · `operator` |

**Autonomy** applies to *acting* agents — the ones that touch the outside world (`outreach` send, `booking`, `followup`, `publisher`, `crm`):

- `research_only` — the acting step is skipped.
- `approve_first` (default) — the pipeline pauses for human approval before the acting step.
- `autopilot` — the acting step runs unattended.

Research-only agents (signal, match, enrich, safety, reply, idea, writer, editor, engagement, repurpose, insight) always run when enabled. Add-on agents (`insight`, `crm`, `repurpose`, `engagement`) are off until explicitly turned on; `crm` additionally requires the Team plan.

## Pipelines

Pipelines are ordered `(role, tool)` step lists run by the `operator` agent. Only enabled agents' steps run; acting steps respect the agent's autonomy mode. Definitions live in `lib/agents/core/workflow-types.ts`:

- **Outbound Engine** — signal → match → enrich → safety → draft → send → reply → booking → followup
- **Content Engine** — idea → write → edit → schedule/publish → metrics → repurpose
- **Full Funnel** — outbound, then a content pass on the same signals
- **Signal to Insight** — signal → match → insight
- **Enrich & Outreach** — enrich → draft → send
- **Reply Handling** — reply → booking → followup

Dispatch one from the dashboard (Agents → Pipelines), `POST /api/a2a/workflows`, or MCP.

## Dashboard

| View | What |
|---|---|
| Home | Today's queue and command bar |
| Pipeline | Outbound — priority leads, drafts, sent, replies |
| Signals | Outbound — accounts, signals, fit scores, watchlist |
| Content | Content — ideas, composer, calendar, performance |
| Agents | Agent stacks, fleet health, pipelines, live activity |
| Integrations | Sending inboxes, social posting, CRM, signal sources |
| Settings | Profile, billing, team, preferences, pipeline diagnostics |

## Plans & credits

Two plans — the price buys features; usage (leads worked, posts published) is metered in **outcome credits**.

- **Launch** — both engines, all agents, per-agent autonomy / autopilot, 3 connected inboxes, default or bring-your-own LLM, monthly included outcome credits.
- **Team** — everything in Launch plus team workspaces & member roles, the CRM agent, more connected inboxes, a larger monthly credit grant.

Outcome credits are spent on *outcomes*, never on attempts: a positive reply, a booked meeting, a published post (plus a bonus when it crosses an engagement bar), and hard third-party costs (verified contacts). Drafting, idea generation, and research-only runs are free. Running out never blocks an outcome — the balance goes negative until the monthly grant renews or a credit pack is bought. Agent-to-agent (A2A) calls draw from the same balance on the same outcome basis.

**Lead unlocks** are a separate prepaid pool used to reveal contacts on signal-feed leads beyond the included monthly quota; CRM-imported records don't consume signal-feed quota. Configure `LEAD_CREDITS_PER_DOLLAR` to change the top-up conversion rate.

**Bring your own LLM** — connect a Claude or ChatGPT key (`workspace_llm_keys`) and drafting / content writing run on that key with no LLM credit charge; otherwise the Bombsell Default LLM (DeepSeek) is used. See `lib/llm/index.ts`.

## Core data flow

### Outbound
1. `poll-signals` fetches Google News / GDELT / Product Hunt / press-wire candidates, expands account-centric monitoring from `monitored_accounts` (owned feeds, job boards, monitored-company news), shortlists, extracts structured signals, clusters near-duplicate events by novelty key, embeds, and inserts into `signals`.
2. `monitored_accounts` is refreshed from watchlists, recently delivered leads, and queued matches so account monitoring survives across cron runs.
3. `leads/match` retrieves recent-signal candidates via pgvector plus watchlist/keyword prefilters, LLM-reranks a bounded top slice (boosted toward historically good outcomes for the workspace), and queues matches in `lead_delivery_queue`.
4. `deliver-leads` drains that backlog into `leads`, using included monthly quota first and prepaid lead unlocks after, and reorders the pending backlog with the same outcome-feedback maps.
5. `enrich-contacts` backfills contact emails via cache plus a provider waterfall, with staged ZeroBounce validation and validation-result caching, targeting 2–3 usable contacts per company.
6. The user (or an autopilot pipeline) drafts and sends outreach from the feed; the `safety` agent / outbound policy gate validates against unsubscribe, blocked companies, recipient validation, and rate limits before send.
7. `send-followups` sends pre-generated follow-ups when no reply is detected.
8. Gmail / Outlook webhooks mark replies, classify intent, and stop scheduled follow-ups; positive intent can trigger a booking link.

### Content
1. `generate-content-ideas` (or the dashboard) runs the `idea` agent over recent signals + workspace positioning → scored rows in `content_ideas`.
2. The `writer` agent drafts a `posts` row per platform (hook / body / optional thread).
3. The `editor` agent does a brand-voice + format pass and an eval (`eval_score`, `eval_failed`).
4. Scheduling a post (status `scheduled` with `scheduled_at`) is the user's approval; `publish-posts` publishes scheduled posts whose time has passed. "Publish now" and autopilot Content pipelines publish immediately (the latter through `operator`, which enforces `publisher` autonomy).
5. `poll-post-metrics` pulls impressions / likes / comments / reposts via the posting partner, records engagement eval traces, and debits a winner outcome when a post crosses the engagement bar.
6. The `repurpose` agent turns top posts into fresh angles back in `content_ideas`.

Posting partners: `postforme`, `typefully`, `buffer`, `ayrshare`, or `manual` (no external call — the user posts by hand). See `lib/social/publisher.ts`.

## MCP server

Bombsell exposes product state to agent frameworks over an official MCP Streamable HTTP endpoint:

- Endpoint: `POST /api/mcp`
- Auth: OAuth browser flow with dynamic client registration and PKCE
- Discovery: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`

```bash
codex mcp add bombsell --url https://your-domain.com/api/mcp
codex mcp login bombsell --scopes bombsell:read,bombsell:write:safe

claude mcp add --transport http bombsell https://your-domain.com/api/mcp
```

Tools include `get_gtm_context`, `list_leads`, `get_lead`, `update_lead_status`, `list_watchlist`, `add_watchlist_company`, `list_feed_sessions`, `search_signal_timeline`. Resources: `bombsell://workspace/profile`, `bombsell://leads/recent`, `bombsell://watchlist`, `bombsell://feed-sessions`.

## Agent-to-agent (A2A)

`/api/a2a/*` lets external agents list the fleet, inspect capabilities, dispatch tasks, and run pipelines. Auth is a user session, an `AGENT_API_SECRET` header, or a per-agent key (`bsk_agt_…`). Calls are rate-limited and metered on the same outcome credit basis; per-tool costs are advertised at `/docs`. Infrastructure: migration `060_a2a_agent_infrastructure.sql`, `lib/a2a/*`.

## Cron jobs

Schedules live in [vercel.json](/Users/anirudhsharma/Documents/lead-gen/vercel.json:1). Each writes a row into `cron_runs`, which powers the in-app diagnostics view.

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/poll-signals` | `0 0,12 * * *` | Ingest signals; opportunistically kicks match + delivery |
| `/api/leads/match` | `10 0,12 * * *` | Fallback/backfill: populate the delivery backlog |
| `/api/cron/deliver-leads` | `20 0,12 * * *` | Fallback/backfill: batch queued leads into feeds |
| `/api/cron/send-followups` | `30 0,12 * * *` | Send due follow-ups |
| `/api/cron/send-automation` | `*/15 * * * *` | Process the outbound automation queue |
| `/api/cron/enrich-contacts` | `40 0,12 * * *` | Backfill / validate contacts |
| `/api/cron/renew-inbox-watches` | `0 3 * * *` | Renew Gmail / Outlook push subscriptions |
| `/api/cron/publish-content` | `*/10 * * * *` | Publish due distribution jobs |
| `/api/cron/poll-avatar-videos` | `*/10 * * * *` | Poll avatar-video render jobs |
| `/api/cron/ingest-content-inspiration` | `15 2 * * *` | Refresh content-inspiration sources |
| `/api/cron/deliver-webhooks` | `*/5 * * * *` | Retry pending outbound webhook deliveries |
| `/api/cron/publish-posts` | `*/10 * * * *` | Publish scheduled Content-engine posts whose time has passed |
| `/api/cron/poll-post-metrics` | `25 */6 * * *` | Pull engagement metrics for published posts |
| `/api/cron/agent-self-improvement` | `*/15 * * * *` | Roll up agent feedback into tuning hints |
| `/api/cron/generate-content-ideas` | `5 6 * * *` | Daily idea generation per active workspace |
| `/api/cron/grant-monthly-credits` | `30 4 * * *` | Grant the monthly outcome-credit allowance |

All cron handlers require `Authorization: Bearer ${CRON_SECRET}`.

## Local development

### Prerequisites
- Node.js 22+
- Supabase project with migrations applied
- Env vars for Supabase, DeepSeek, Dodo (incl. `DODO_PRODUCT_LEAD_CREDITS` — a one-time / pay-what-you-want product for lead-unlock top-ups), Resend, Gmail, Outlook, FullEnrich, Hunter/Apollo, ZeroBounce, posting partner (optional), `CRON_SECRET`, `AGENT_API_SECRET`

### Install and run
```bash
npm install
npm run dev
```

### Checks
```bash
npm run lint
npm test          # node --test over test/ and __tests__/
```

## Migrations

SQL migrations live in `supabase/migrations/`. Apply them before deploying code that depends on them. Recent ones:

- `060_a2a_agent_infrastructure.sql` — agent identities, A2A keys, rate-limit tiers, events
- `063_agent_rate_limit_and_draft_eval.sql` — agent rate-limit tiers, draft eval
- `064_gtm_eval_traces.sql` — eval traces
- `065_two_engines_phase1.sql` — `workspace_agents`, ICP signals, agent tuning hints, workspace tuning log
- `066_content_engine.sql` — `content_ideas`, `posts`, `social_accounts`, `workspace_llm_keys`, content eval traces
- `067_outcome_credits_and_plans.sql` — `credit_ledger`, monthly credit grants
- `068_team_rls_and_plan_relabel.sql` — team RLS, plan relabel

> `055_*` and `056_*` exist twice (an explore/autopilot migration and a marketing/content one share each prefix). They are applied in this deployment; treat the prefix as historical and keep new migrations strictly increasing.

## Internal ops

- Diagnostics at `/internal/ops`, separate from the user dashboard; allow access via `INTERNAL_OPS_ALLOWED_EMAILS`.
- JSON: `/api/internal/ops/ranking`, also accepting `Bearer` auth with `INTERNAL_OPS_SECRET` or `CRON_SECRET`.
- Includes a weekly review block comparing the last 7 days to the prior 7 and surfacing tuning recommendations for source supply, queue health, and delivery quality.

## Diagnostics

The Settings view has a pipeline diagnostics panel: recent cron health, recent signal-candidate extraction counts, user-level enrichment / follow-up / account counts, and recent lead match explanations from `match_debug`. Check it before reaching for Vercel logs. The Agents → Activity tab is the live event stream (`agent_events`).
