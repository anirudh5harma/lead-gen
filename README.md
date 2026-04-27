# Bombsell

Signal-based prospecting and outreach for solopreneurs, agencies, and small operators.

Bombsell ingests public buying signals, matches them against user or client ICPs, enriches contacts, drafts outreach, sends through connected inboxes, schedules follow-ups, and tracks replies.

## Product Model

- `Free`: 15 lead unlocks per rolling 30 days, single workspace, manual Gmail/copy handoff.
- `Pro`: 500 leads per rolling 30 days, multiple client workspaces, connected inbox sending, automated follow-ups, reply detection, Slack alerts, priority enrichment, and prepaid lead-credit top-ups.

CRM sync and CRM export are available on every plan. CRM-imported outreach records land in a separate feed and do not consume signal-feed lead quota.

Lead credits are prepaid top-ups. By default, each $1 adds 4 additional lead unlocks after the included monthly quota is exhausted; configure `LEAD_CREDITS_PER_DOLLAR` to change the conversion rate.

Leads are quota-limited at feed-ingestion time, not at send time. Follow-ups do not consume lead quota.

## Core Data Flow

1. `poll-signals` fetches Google News and press-wire candidates, expands monitored-account coverage with owned-feed and monitored-company news discovery, shortlists them, extracts structured signals, clusters near-duplicate events, embeds them, and inserts into `signals`.
2. `monitored_accounts` is refreshed from watchlists, recent delivered leads, and queued matches so account-centric monitoring survives across cron runs.
3. `leads/match` uses pgvector candidate retrieval plus watchlist/keyword prefilters, then LLM-reranks only a bounded top slice before queueing matched opportunities in `lead_delivery_queue`.
4. `deliver-leads` drains that backlog hourly into `leads`, using included monthly quota first and prepaid lead credits after quota is exhausted.
5. Explore searches and CRM imports are stored as separate feed sessions so users can export, automate, and work each batch independently.
6. `enrich-contacts` backfills contact emails via cache plus provider waterfall, with staged ZeroBounce validation and validation-result caching to control credit burn while still targeting 2-3 usable contacts per company.
7. Users draft or send outreach from the feed.
8. `send-followups` sends pre-generated follow-ups for paid plans when no reply has been detected.
9. Gmail/Outlook webhooks mark replies and stop scheduled follow-ups.

## Cron Jobs

Cron schedules live in [vercel.json](/Users/anirudhsharma/Documents/lead-gen/vercel.json:1).

- `/api/cron/poll-signals`: hourly, top-of-hour.
- `/api/leads/match`: hourly at `:10` to populate the delivery backlog.
- `/api/cron/deliver-leads`: hourly at `:20` to batch queued leads into user feeds.
- `/api/cron/send-followups`: hourly at `:25`.
- `/api/cron/enrich-contacts`: every 2 hours at `:20`.
- `/api/cron/renew-inbox-watches`: daily.

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
- Environment variables for Supabase, DeepSeek, Dodo, Resend, Gmail, Outlook, FullEnrich, Hunter, ZeroBounce, and cron auth
- `DODO_PRODUCT_LEAD_CREDITS` must point to a one-time/pay-what-you-want Dodo product used for lead-credit top-ups.

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

- Free users are restricted to a single visible workspace.
- When a user downgrades to Free, extra workspaces are archived and archived workspace CRM sync is disabled.
- Matching only considers eligible, non-archived workspaces, so hidden workspaces cannot consume quota.
- Draft/send/follow-up logic now resolves sender context from the lead's `client_id` first, then falls back to the user profile.
- CRM sync is available on every plan. Multi-workspace CRM partitioning is available on Pro because multiple client workspaces are a Pro feature.

## Diagnostics

The dashboard settings view includes a pipeline diagnostics panel with:

- recent cron health
- recent signal-candidate extraction counts
- user-level enrichment/follow-up/account counts
- recent lead match explanations from `match_debug`

Use this before going to Vercel logs. It is faster for day-to-day triage.
