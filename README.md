# Bombsell

Signal-based prospecting and outreach for solopreneurs, agencies, and small operators.

Bombsell ingests public buying signals, matches them against user or client ICPs, enriches contacts, drafts outreach, sends through connected inboxes, schedules follow-ups, and tracks replies.

## Product Model

- `Free`: 10 leads per rolling 30 days, single workspace, manual send via Gmail/copy handoff.
- `Pro`: 300 leads per rolling 30 days, single workspace, connected inbox sending, automated follow-ups, reply detection.
- `Max`: 1,500 leads per rolling 30 days, multiple client workspaces, CRM sync, CRM export, Slack alerts, priority enrichment.

Leads are quota-limited at feed-ingestion time, not at send time. Follow-ups do not consume lead quota.

## Core Data Flow

1. `poll-signals` fetches Google News and press-wire candidates, expands monitored-account coverage with owned-feed and monitored-company news discovery, shortlists them, extracts structured signals, clusters near-duplicate events, embeds them, and inserts into `signals`.
2. `monitored_accounts` is refreshed from watchlists, recent delivered leads, and queued matches so account-centric monitoring survives across cron runs.
3. `leads/match` uses pgvector candidate retrieval plus watchlist/keyword prefilters, then LLM-reranks only a bounded top slice before queueing matched opportunities in `lead_delivery_queue`.
4. `deliver-leads` drains that backlog hourly into `leads`, pacing delivery by plan limits, recent volume, queue depth, and historical engagement feedback.
5. `enrich-contacts` backfills contact emails via cache plus provider waterfall, with staged ZeroBounce validation and validation-result caching to control credit burn while still targeting 2-3 usable contacts per company.
6. Users draft or send outreach from the feed.
7. `send-followups` sends pre-generated follow-ups for paid plans when no reply has been detected.
8. Gmail/Outlook webhooks mark replies and stop scheduled follow-ups.

## Cron Jobs

Cron schedules live in [vercel.json](/Users/anirudhsharma/Documents/lead-gen/vercel.json:1).

- `/api/cron/poll-signals`: hourly, top-of-hour.
- `/api/leads/match`: hourly at `:10` to populate the delivery backlog.
- `/api/cron/deliver-leads`: hourly at `:20` to batch queued leads into user feeds.
- `/api/cron/send-followups`: hourly at `:25`.
- `/api/cron/enrich-contacts`: every 2 hours at `:20`.
- `/api/cron/renew-inbox-watches`: daily.
- `/api/cron/notify-workspace-downgrade`: daily.

Each cron now writes a row into `cron_runs`, which powers the in-app diagnostics view.

`poll-signals` now has two supply modes:

- global discovery from broad feeds like Google News, GDELT, Product Hunt, and press wires
- account-centric monitoring from `monitored_accounts`, which powers owned-feed and job-board checks at much higher volume than the old ad hoc seeding logic
- monitored-company news discovery, which runs targeted Google News searches for the highest-priority monitored accounts

Signal novelty is now event-aware:

- similar stories from different publications are clustered before insert using a novelty key plus fuzzy same-event checks
- lead dedupe prefers novelty keys when available, which reduces repeated feed items for the same event even if the source wording differs

Ranking is now adaptive:

- `leads/match` boosts candidates that resemble historically good outcomes for the workspace by company, signal type, and source
- `deliver-leads` reorders pending backlog using the same feedback maps so new replies/bookings can immediately reshape what rises to the top next

## Local Development

### Prerequisites

- Node.js 22+
- Supabase project with migrations applied
- Environment variables for Supabase, Anthropic, Dodo, Resend, Gmail, Outlook, FullEnrich, Hunter, ZeroBounce, and cron auth

### Install and run

```bash
npm install
npm run dev
```

### Checks

```bash
npm run lint
npm test
```

## Migrations

This repo uses SQL migrations in `supabase/migrations/`.

Important recent migrations:

- `013_signal_review.sql`: signal candidate review and lead `match_debug`
- `014_sequences_and_crm.sql`: reusable templates and CRM webhook sync
- `015_client_scope_constraints.sql`: multi-client uniqueness fixes
- `016_subscription_workspace_warning.sql`: workspace downgrade warning tracking
- `017_cron_runs.sql`: persistent cron execution history
- `022_lead_delivery_queue.sql`: durable matched-signal backlog and paced delivery state
- `023_monitored_accounts.sql`: workspace-specific monitored account inventory
- `024_match_candidate_signals.sql`: ANN-backed recent-signal candidate retrieval for scalable matching
- `025_signal_novelty.sql`: event-level novelty keys and indexes for duplicate suppression across similar sources
- `026_email_validation_optimization.sql`: ZeroBounce validation cache, company-level enrichment cache, and company-key-aware contact caching

## Internal Ops

- Internal diagnostics live at `/internal/ops`.
- Access is intentionally separate from the user dashboard diagnostics.
- Allow access by setting `INTERNAL_OPS_ALLOWED_EMAILS` to a comma-separated email allowlist.
- The JSON version is available at `/api/internal/ops/ranking` and also accepts `Bearer` auth with `INTERNAL_OPS_SECRET` or `CRON_SECRET`.
- The internal page now includes a weekly review block that compares the last 7 days against the prior 7 days and surfaces tuning recommendations for source supply, queue health, and delivery quality.

Apply migrations before deploying code that depends on them.

## Operational Notes

- Non-Max users are restricted to a single visible workspace.
- When a user downgrades below Max, extra workspaces are archived and archived workspace CRM sync is disabled.
- Matching only considers eligible, non-archived workspaces, so hidden workspaces cannot consume quota.
- Draft/send/follow-up logic now resolves sender context from the lead's `client_id` first, then falls back to the user profile.
- CRM sync is Max-only at both the UI and API layers.

## Diagnostics

The dashboard settings view includes a pipeline diagnostics panel with:

- recent cron health
- recent signal-candidate extraction counts
- user-level enrichment/follow-up/account counts
- recent lead match explanations from `match_debug`

Use this before going to Vercel logs. It is faster for day-to-day triage.
