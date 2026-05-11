# Bombsell v2 — Two Engines, Composable Agents, Outcome-Based Pricing

> Status: implemented, not yet deployed/committed. Restructure of the v1 single "loop" into two composable engines.
> (This file was reconstructed after an accidental local deletion — content condensed; the code is the source of truth.)

---

## 1. Product shape

Two end-to-end **engines** a user can set up:
- **Outbound Engine** — signal → account match → enrich → safety → draft → send → reply → book / follow-up
- **Content Engine** — idea → write → edit → schedule → publish → learn (LinkedIn / X)

Both are ordered chains of **agents**. Every agent runs independently — UI "Run now" button, standalone cron, or A2A call. Users toggle agents on/off per workspace and pick an autonomy mode per agent. Nobody is locked into the full chain. A **reward loop** watches each workspace's outcomes and tunes that workspace's agents (signal weights, draft tone/templates, content angles, send/post times, persona priority, mailbox weighting).

Inspired by ColdIQ's "GTM Flywheel" (Outbound + LinkedIn Content) — but self-serve product, not a managed service.

---

## 2. Agent catalog (the building blocks)

**Shared / foundation:** ICP Agent · Signal Ingestion Agent (`signal-worker`) · Enrichment Agent (`enrich-worker`, Apollo + email-finder) · Reward/Tuning Agent (`self-improvement/engine.ts`).

**Outbound stack:** Account Matching (`match-worker`) · Drafting (`outreach-worker.draft`, DeepSeek) · Deliverability/Safety (`safety-worker`) · Sending (`outreach-worker.send`, `oauth/sender.ts`) · Reply (`reply-worker`) · Booking (`booking-worker`) · Follow-up (`followup-worker`).

**Content stack (new):** Idea Generation (`idea-worker`) · Content Writing (`writer`) · Editing/Brand-Voice (`editor`) · Scheduling/Publishing (`publisher`) · Engagement (`engagement`) · Repurpose (`repurpose`) — all under the `bombsell.content.*` tool namespace + `bombsell.idea.*`; served by `lib/agents/workers/idea-worker.ts` + `content-worker.ts`.

**Add-ons (off by default):** Insight Agent · CRM Agent (Team plan only). **Operator Agent** = the generic pipeline runner.

`AgentRole` (in `lib/agents/protocol/types.ts`) was extended with: `idea`, `writer`, `editor`, `publisher`, `engagement`, `repurpose`.

---

## 3. Backend

- **`workspace_agents`** (migration 065) — per-workspace per-agent `enabled` / `autonomy` (`research_only` | `approve_first` | `autopilot`) / `config` / `health` / `last_run_at`. `lib/agents/core/workspace-agents.ts`: `loadWorkspaceAgents` (defaults if unseeded), `isAgentEnabled`, `getAutonomy`, `getAgentConfig`, `seedWorkspaceAgents` (called from `/api/profile` on first onboard, with the engines the user picked), `updateWorkspaceAgent`.
- **Engines model** — `lib/agents/core/engines.ts`: `Engine`, `Autonomy`, `AGENT_ENGINE` map, `ADDON_ROLES`, `OUTBOUND_PIPELINE` (9 steps) / `CONTENT_PIPELINE` (6 steps) with a `required?` + `acting?` flag per step. `workflow-types.ts` adds `outbound` & `content` canonical pipelines (+ `engine` field; legacy `full-funnel`/`signal-to-insight`/`enrich-and-outreach`/`reply-handling` kept for A2A).
- **Operator runtime** (`operator-worker.ts`) — `bombsell.operator.orchestrate` loads `workspace_agents`, skips disabled steps (blocks if a `required` agent is off), and on `acting` steps enforces autonomy: `research_only` → skip, `approve_first` → pause + `needs_approval` event, `autopilot` → run. Same runner powers single-agent invocation. `dispatchTask` (`supervisor.ts`) writes `workspace_agents.health` / `last_run_at` after each task; `workerMap` += `bombsell.idea` → idea-worker, `bombsell.content` → content-worker.
- **Content infra** (migration 066) — `content_ideas`, `posts` (status draft→edited→scheduled→published→failed; eval_score, metrics jsonb), `social_accounts` (the managed/posting partner), `workspace_llm_keys` (BYO Claude/ChatGPT). `gtm_eval_traces.trace_type` widened with `content_post_quality` + `content_engagement` (+ `post_id` col). `lib/gtm/content-eval.ts` — pre-publish lint + trace recorder. Content workers do: idea.generate (LLM angles from recent leads+positioning → content_ideas) / content.write / .thread / .edit (rewrite-to-fix + eval) / .schedule / .publish (eval gate ≥50 → posting partner) / .metrics (partner metrics → posts.metrics + content_engagement trace + winner debit) / .repurpose.
- **LLM abstraction** — `lib/llm/index.ts` `complete()`: default DeepSeek ("Bombsell Default LLM", credit-billed) or workspace-connected Anthropic/OpenAI key (BYO → no LLM charge). `/api/integrations/llm` GET/POST/DELETE (POST does a live key-validation call).
- **Posting partner = Post for Me** (managed) — see §5.
- **Reward loop, per-workspace** — `lib/agents/self-improvement/engine.ts` `applyWorkspaceTuning({workspaceId,userId,clientId,engine})` (compute hints → apply workspace-scoped `gtm_icp_signals` weights → persist `agent_tuning_hints` w/ workspace+engine → write `workspace_tuning_log`) + `listActiveWorkspaces`. `app/api/cron/agent-self-improvement` iterates active workspaces; GET runs the loop when called with the Vercel-cron Bearer; covers content roles in health recovery.
- **A2A** — every agent still callable via `/api/a2a/*`. `lib/bombsell-sdk.ts` (`bombsell.ideas.*` + `bombsell.content.*`), `/api/docs/agents` (workflow enum += outbound/content), `/docs` page (Content engine group), `app/agents/page.tsx` (17-agent roster) updated.
- **Outcome credits** (migration 067) — `credit_ledger` (grant/debit, workspace-scoped, idempotent per outcome via unique indexes on lead_id/post_id), `user_profiles.monthly_credit_grant` + `credits_granted_at`. `lib/credits/outcomes.ts`: `debitOutcome` (idempotent value-event debit; decrements `lead_credit_balance` mirror + writes ledger; allows negative — never blocks a happened outcome), `grantCredits`, `postCrossedEngagementBar`, `OUTCOME_COST`. Hooks: `lib/reply-agent.ts` `processInboundReply` (positive reply → debit, booked → debit) — that fn is invoked by `app/api/webhooks/gmail` + `outlook`; `booking-worker` (`bombsell.booking.status` reports booked → debit); `content-worker` (`bombsell.content.publish` → `content_post_published` debit; `bombsell.content.metrics` crossing the bar → `content_post_winner` debit). `reply-worker` also debits if `leadId` passed.
- **Plans** — `lib/lead-credits.ts` adds `launch` + `team` tiers (legacy free/growth/scale/enterprise kept for back-compat). `lib/plan-access.ts` re-laddered (`free < launch < growth < scale < team < enterprise`) + `hasTeamFeatures()`. CRM agent enable gated to Team in `/api/workspace-agents`. Billing (Dodo Payments): `lib/dodo.ts` `PRODUCT_IDS` += launch/team monthly/annual (env `DODO_PRODUCT_LAUNCH_*` / `DODO_PRODUCT_TEAM_*`), `createSubscriptionCheckoutUrl` accepts the four tiers; `/api/billing/subscription/checkout` accepts them; `/api/billing/webhook` on subscription create/renew sets `plan` + `monthly_credit_grant` (from `getTierConfig(tier).includedLeads`) + calls `grantCredits` for the period's bundle. Credit-pack purchase (`/api/billing/credits/checkout`) wired to the pricing-page PAYG tiles. `app/api/cron/grant-monthly-credits` (daily) tops up wallets by `monthly_credit_grant`.
- **Team** (migration 068) — `can_access_workspace(uid, workspace_id)` SECURITY DEFINER helper (personal id OR owned `client_accounts` OR accepted `workspace_members`); all v2 tables re-policied workspace-aware. Sidebar workspace switcher (PATCH `/api/clients`). Legacy `plan` values relabeled (`growth`→`launch`, `scale`/`enterprise`→`team`) — migration first widens the `user_profiles_plan_check` / `subscriptions_plan_check` CHECK constraints, then relabels.

### Migrations
`065_two_engines_phase1.sql` · `066_content_engine.sql` · `067_outcome_credits_and_plans.sql` · `068_team_rls_and_plan_relabel.sql` — run in order, on top of `064`. (`062` gives `agent_cost_catalog`, `057` gives `workspace_members` — prerequisites already in the repo.)

---

## 4. Frontend

- **Sidebar** (`DashboardShell.tsx`) — grouped: **Outbound** (Pipeline = OutreachView, Signals = AccountsView) · **Content** (ContentView) · **System** (Agents, Integrations, Settings). `content` added to `View` type. Workspace switcher when the user belongs to ≥1 workspace.
- **Onboarding** (`app/onboarding/page.tsx`) — Step 2 leads with an **Engines to run** picker (Outbound / Content toggle cards); `engines` posted to `/api/profile` → `seedWorkspaceAgents`.
- **ContentView** (new) — tabs **Ideas** (generate + approve/reject + "Draft post") / **Composer** (per-post editor: edit hook/body, run editor agent, schedule, publish; eval-score badge + failure tags) / **Calendar** (scheduled + published) / **Performance** (refresh metrics + impressions/likes/comments/reposts table). Backed by `/api/content` (GET ideas|posts; POST actions generate_ideas/write/edit/schedule/publish/repurpose/metrics/set_idea_status; PATCH manual edit).
- **AgentsView** — new default **Stacks** tab: agents grouped Outbound/Content/Shared, each row = enable toggle + autonomy `<select>` (gated to acting agents), live-saved via `/api/workspace-agents` (GET list, PATCH `{role,enabled?,autonomy?,config?}`). Existing Fleet / Pipelines / Activity tabs kept.
- **HomeView** — new **What's Working** panel (reward-loop cycles from `/api/workspace-tuning`).
- **IntegrationsView** — "Content publishing" group: when the managed partner is configured shows **Connect LinkedIn / Connect X** + connected-accounts list (with Disconnect); otherwise a "drafts only for now" note. "AI models" group: Bombsell Default LLM (active) + connect Claude/ChatGPT modal. (BYO Buffer/Typefully/Ayrshare tiles/modals removed from the UI; their adapters remain in code.)
- **Settings → Credits & outcomes** block (`CreditLedger`) — balance, monthly grant, recent `/api/credit-ledger` entries. (`Block` labels: 01 Profile · 02 ICP · 03 Automation · 04 Billing · 05 Credits & outcomes · 06 Session.)
- **Pricing page** — two tiers (Launch $49 / Team $149, monthly+annual), outcome-credit hero + "what burns a credit" FAQ, credit top-up packs ($25/$50/$100 → 50/120/250 credits via `/api/billing/credits/checkout`), Enterprise = "talk to us" footnote.

---

## 5. Content partner — Post for Me (managed)

https://www.postforme.dev — unified social-posting API, one company key, hosted OAuth, white-label once your platform apps are approved.

`lib/social/postforme.ts` — **validated against the OpenAPI spec at https://api.postforme.dev/docs**:
- `createConnectUrl({platform,redirectUrl,externalId})` → `POST /v1/social-accounts/auth-url` body `{platform, external_id, redirect_url_override}` → `{url}`
- `listAccounts({externalId?,platform?})` → `GET /v1/social-accounts?external_id=&platform=&status=connected` → `{data:[{id,platform,username,status,external_id,...}]}`
- `publish({accountIds,caption,scheduledAt?,media?,externalId?,thread?})` → `POST /v1/social-posts` `{caption, social_accounts, scheduled_at?, media?, external_id?}` → `{id,status}` (status `processed`→published, `scheduled`→scheduled)
- `getPostMetrics(postId)` → `GET /v1/social-post-results?post_id=` — engagement dug best-effort out of per-account `platform_data` (platform-specific)
- `disconnectAccount(id)` → `POST /v1/social-accounts/{id}/disconnect`

Base `https://api.postforme.dev`, Bearer auth, env `POSTFORME_API_KEY` (+ optional `POSTFORME_API_BASE`). Platform ids match ours exactly (`linkedin`, `x`). No native X-thread field — threads joined into the caption.

**Connect flow:** `POST /api/integrations/social/connect {platform}` → writes a pending `social_accounts` row + returns the Post for Me auth URL (with `redirect_url_override = <origin>/api/auth/postforme/callback?platform=…`). User authorizes → Post for Me redirects to `/api/auth/postforme/callback` → that handler re-lists the workspace's accounts (`?external_id=<workspaceId>`) and activates the matching row → redirects to `/dashboard?view=integrations&social_connected=N`.

**Redirect URL you must configure:** in the Post for Me dashboard, set the default OAuth redirect URL to `https://<your-app-domain>/api/auth/postforme/callback`. (We also pass it per-call as `redirect_url_override`, but Post for Me may require redirect URLs to be allow-listed, and the dashboard default is the safety net.)

`getSocialAdapter` (`lib/social/publisher.ts`) prefers `PostForMeAdapter` (when `POSTFORME_API_KEY` is set) → Buffer/Typefully/Ayrshare BYO adapters (code only, not surfaced) → `ManualAdapter` (no external call). `social_accounts.partner` allows `postforme | typefully | buffer | ayrshare | manual`.

---

## 6. Pricing

Two subscription tiers; **tier price = features only**, everything variable = outcome credits.

| | **Launch** | **Team** |
|---|---|---|
| Price | $49/mo · $490/yr | $149/mo · $1490/yr |
| Audience | solo | teams |
| Engines | Outbound + Content | Outbound + Content |
| Adds | — | team workspaces + member roles, shared pipeline/inbox, **CRM agent**, 10 inboxes |
| Inboxes | 3 | 10 |
| Monthly outcome-credit bundle | **100** | **350** |
| Autopilot, BYO LLM key | yes | yes |
| Overage | buy credit packs | buy credit packs |

**Credit top-up packs:** $25 → 50 credits · $50 → 120 · $100 → 250.

**`OUTCOME_COST`** (debited on the event; idempotent per workspace+event+lead/post; never blocked — balance may go negative): positive reply **1** · booked meeting **5** · post published **1** · post "winner" bonus **2** · verified contact **1**. Drafting / idea generation / research-only agent runs are free.

**"Post that worked":** engagement-rate ≥ 3% on ≥ 500 impressions, OR ≥ 25 raw engagements where impressions aren't reported.

Reply vs booking debits stack (separate event types, each once per lead → positive-then-booked lead costs 1 + 5 = 6).

(All these numbers are launch defaults — revisit with usage data; they live in `lib/lead-credits.ts` and `lib/credits/outcomes.ts`.)

---

## 7. Still outstanding (intentionally deferred)

- Real billing-renewal hooks fully exercised end-to-end (Stripe/Dodo products for `launch`/`team` must exist in the dashboard); credit-pack flow relies on the existing `lead_credits` Dodo product.
- New free-tier users have `monthly_credit_grant = 0` until they upgrade (the webhook sets it). Starter 10 credits (`grantStarterLeadCredits`) still granted on signup.
- In-memory task queue (`supervisor.ts`) — fine for now; move to a DB-backed queue before autopilot-at-scale.
- Post for Me metrics are platform-specific blobs in `platform_data` — the best-effort key mapping in `getPostMetrics` may need per-platform tuning once real data flows.
- Team RLS relies on `workspace_members.accepted_at` being set on invite acceptance (existing team flow).

---

## 8. Go-live runbook

1. **Migrations** — apply `065`, `066`, `067`, `068` in order (Supabase).
2. **Dodo** — create Launch ($49/$490) and Team ($149/$1490) products; set `DODO_PRODUCT_LAUNCH_MONTHLY/ANNUAL`, `DODO_PRODUCT_TEAM_MONTHLY/ANNUAL` (existing `DODO_*` vars unchanged). Point the Dodo webhook at `/api/billing/webhook`.
3. **Post for Me** — sign up at postforme.dev, get an API key (Quickstart needs no platform approval; switch to White Label later for your brand on the OAuth screen). Set `POSTFORME_API_KEY` (+ `POSTFORME_API_BASE` only if their base URL differs). In the Post for Me dashboard set the default OAuth redirect URL to `https://<your-app>/api/auth/postforme/callback`.
4. **Env** — confirm `DEEPSEEK_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, Supabase keys, mail OAuth, Apollo, Resend, etc. Check the Vercel cron count in `vercel.json` fits your plan (~16 entries).
5. **Deploy.**
6. **Smoke test** — onboarding engine picker → `workspace_agents` seeded; Agents → Stacks toggle/autonomy; pricing checkout (subscription + PAYG); Settings → Credits ledger; Integrations → Connect LinkedIn/X (Post for Me OAuth round-trip) + connect a Claude/ChatGPT key (live-validated); Content tab: generate ideas → draft → edit → publish → Calendar/Performance; run the `outbound` pipeline from Agents → Pipelines (with `approve_first` it pauses at the send step); an inbound positive/booked reply → `credit_ledger` debit row appears.
