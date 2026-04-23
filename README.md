# Bombsell

Signal-based prospecting and outreach for solopreneurs, agencies, and small operators.

Bombsell ingests public buying signals, matches them against user or client ICPs, enriches contacts, drafts outreach, sends through connected inboxes, schedules follow-ups, and tracks replies.

## Product Model

- `Free`: 10 leads per rolling 30 days, single workspace, manual send via Gmail/copy handoff.
- `Pro`: 300 leads per rolling 30 days, single workspace, connected inbox sending, automated follow-ups, reply detection.
- `Max`: 1,500 leads per rolling 30 days, multiple client workspaces, CRM sync, CRM export, Slack alerts, priority enrichment.

Leads are quota-limited at feed-ingestion time, not at send time. Follow-ups do not consume lead quota.

## Core Data Flow

1. `poll-signals` fetches Google News and press-wire candidates, shortlists them, extracts structured signals, embeds them, and inserts into `signals`.
2. `leads/match` scores fresh signals against eligible workspaces and inserts matched leads while enforcing plan quotas.
3. `enrich-contacts` backfills contact emails via cache plus provider waterfall.
4. Users draft or send outreach from the feed.
5. `send-followups` sends pre-generated follow-ups for paid plans when no reply has been detected.
6. Gmail/Outlook webhooks mark replies and stop scheduled follow-ups.

## Cron Jobs

Cron schedules live in [vercel.json](/Users/anirudhsharma/Documents/lead-gen/vercel.json:1).

- `/api/cron/poll-signals`: hourly, top-of-hour.
- `/api/leads/match`: hourly at `:10` as a durable backstop even if the poll-triggered handoff fails.
- `/api/cron/send-followups`: hourly at `:15`.
- `/api/cron/enrich-contacts`: every 2 hours at `:20`.
- `/api/cron/renew-inbox-watches`: daily.
- `/api/cron/notify-workspace-downgrade`: daily.

Each cron now writes a row into `cron_runs`, which powers the in-app diagnostics view.

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
