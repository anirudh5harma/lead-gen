# Outreach Pipeline Verification - 2026-06-08

This note audits the current pivot-v2 path from captured Signal to connected-inbox outreach, then defines the contact-enrichment waterfall needed before scaling outbound.

## Current Verified Path

The implemented email path follows the architecture:

1. Signal ingestion emits typed lifecycle events (`signal.discovered`, `signal.ingested`, `signal.classification.completed`, `signal.matched`).
2. `dispatchSignalPlaysOnce` maps a matched Signal to an active Play and target Person, then starts `play.signal_to_email.v1`.
3. `createSignalToEmailPlayWorkflow` opens a Conversation, runs researcher and writer role agents, proposes a draft, runs `eval.hot_path`, enforces Play channel policy, requests approval when required, and sends through the Email channel.
4. The Email channel refuses unjudged or failed drafts, applies sender health and recipient frequency caps, and sends through the connected inbox or configured owned-domain channel.
5. Reply ingestion projects inbound email into the Conversation, classifies intent, records Outcome, and updates procedural memory so later drafts retrieve winning or losing examples.

Relevant tests already cover the most important chain:

- `test/play-cold-open-projector-chain.test.ts`: candidate fanout through Signal projectors into Play dispatch and send.
- `test/play-cold-open-outcome-loop.test.ts`: sent cold open, inbound positive reply, Outcome, and procedural-memory score update.
- `test/channels-email-send.test.ts`: eval-gate enforcement, sender readiness, and recipient frequency-cap deferrals.
- `test/channels-email-projectors.test.ts` and `test/channels-email-reply.test.ts`: reply and bounce/complaint projection into outcomes.

## Current Gap

Before this branch, the workflow assumed a target `graph_persons` row already existed with a usable email or LinkedIn profile. `dispatchSignalPlaysOnce` selected the first eligible Person at the Signal's related company, which was acceptable for seeded demos but not for production.

This branch now inserts a durable contact-resolution workflow before Play dispatch. The remaining gap is connected-inbox repair: local, DB-backed, and live contact-provider paths are covered, but this workspace cannot complete strict live outreach verification until Microsoft OAuth can renew Graph subscriptions.

## Recommended Waterfall

Model this as a Play-adjacent durable workflow, not as direct handler logic:

`contact.resolve_for_signal.v1`

Branch status:

- Implemented in this branch: durable workflow shell, typed `contact.resolved` / `contact.resolution.deferred` events, graph-cache ranking, provider interfaces, Exa People Search adapter, Hunter domain-search/email-finder adapter, ZeroBounce verifier, Hunter fallback verifier, worker registration, and Play dispatcher wakeup from `contact.resolved`.
- Verified locally: when the graph already has three verified email contacts, `contact.resolve_for_signal.v1` emits `contact.resolved` directly with provider order `["graph_cache"]` and does not call Exa/Hunter/verifier providers.
- Added operator smoke: `npm run verify:outreach-pipeline` verifies the local durable Signal -> contact resolution -> personalized draft -> hot-path eval -> dry-run send -> Outcome learning path, and warns when Outlook readiness cannot be inspected. The same smoke covers both a graph-cache top-three resolution and an empty-graph provider waterfall that discovers and verifies three contacts through provider adapters.
- Added DB-backed integration coverage: `test/product-worker-postgres.test.ts` now verifies a persisted `signal.matched` dispatch starts `contact.resolve_for_signal.v1`, writes `contact.resolved` with three verified graph candidates, and only then completes `play.signal_to_email.v1` against the selected Person. It runs when `DATABASE_URL` is available.
- Added opt-in live-provider smoke: run `OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1 OUTREACH_PIPELINE_VERIFY_COMPANY_NAME="Acme" OUTREACH_PIPELINE_VERIFY_COMPANY_DOMAIN=acme.com npm run verify:outreach-pipeline` from staging to create a temporary verification workspace, call the configured Exa/Hunter/ZeroBounce adapters, and clean up afterward unless `KEEP_VERIFY_WORKSPACE=1`.
- Verified live provider smoke from this workspace after adding Hunter and ZeroBounce keys: Vercel resolved through `graph_cache -> exa.people_search -> hunter.contact_discovery -> zerobounce.validate` with three verified contacts and no email send.
- Added Outlook repair operator command: `npm run repair:outlook-subscriptions` invokes the existing `email_outlook_subscription_repair` workflow for connected Outlook accounts missing or nearing subscription expiry, without sending email.
- Hardened gating: email contact resolution now emits `contact.resolved` only when it has three channel-ready verified contacts; otherwise it emits `contact.resolution.deferred` and Play dispatch does not start.
- Still vendor-backed work: configure live keys, add Apollo/FullEnrich as breadth fallbacks if Hunter coverage is weak, and run `OUTREACH_PIPELINE_STRICT=1 OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1 npm run verify:outreach-pipeline` in staging so resolver -> `contact.resolved` -> Play dispatch is paired with real connected-Outlook readiness.

Latest strict run from this workspace:

- `OUTREACH_PIPELINE_STRICT=1 npm run verify:outreach-pipeline` reached the DB and failed only the connected Outlook gate: `0/2` connected Outlook accounts had active Graph subscriptions and both had `last_error` set.
- `npm run repair:outlook-subscriptions` invoked the durable repair workflow, but Microsoft returned `invalid_client` for both accounts. The error says the configured Microsoft client secret is invalid or is the secret ID instead of the secret value.
- Next operator action: replace `MICROSOFT_CLIENT_SECRET` with the app registration's current client secret value, rerun `npm run repair:outlook-subscriptions`, then rerun `OUTREACH_PIPELINE_STRICT=1 OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1 npm run verify:outreach-pipeline`.

Input:

- `workspace_id`
- `signal_id`
- `company_id`
- `play_id`
- desired channel and persona constraints from the Play

Output:

- top three ranked `person_id`s
- channel-specific verified handles
- evidence and provenance
- defer reason when no safe contact exists

Waterfall:

1. Graph cache first
   - Query `graph_persons` at the company.
   - Prefer people with recent successful engagement, verified email metadata, LinkedIn URL, seniority/title fit, and no do-not-contact facts.
   - Return immediately if at least three fresh, channel-ready contacts exist, without spending Exa/Hunter/verification credits.

2. Exa people discovery
   - Search Exa People Search with `category: "people"` for public leadership, founder, executive, revenue, growth, sales, partnerships, and hiring-manager profiles tied to the company domain and Signal context.
   - Parse structured `entities` person metadata when present, falling back to LinkedIn profile titles only when the result still matches the company.
   - Upsert Person nodes with `properties.contact_fit` evidence and provenance.
   - Best for current public profiles and relevance ranking, not email verification.

3. Dedicated B2B contact provider
   - Use Hunter domain search / email finder for likely business emails.
   - Add Apollo or FullEnrich when enrichment breadth matters, behind the same provider adapter contract.
   - Store raw provider confidence, source, lookup time, and matched fields in Person properties.

4. Verification
   - Verify email deliverability with ZeroBounce when configured; fall back to Hunter email verifier when ZeroBounce is absent and Hunter is configured.
   - Store verification status per email in Person properties, not as an ad-hoc table.
   - Hard-bounce or complaint Outcomes update the same graph facts and suppress future sends.

5. Ranking and gating
   - Rank on role relevance, seniority, signal fit, evidence confidence, channel readiness, prior outcome learning, and frequency/trust constraints.
   - Emit `contact.resolved` when candidates are usable.
   - Emit `contact.resolution.deferred` when the best candidates are unverified, risky, missing channel handles, or blocked by trust policy.

6. Play dispatch
   - Change `dispatchSignalPlaysOnce` to require a resolved contact event or start the resolver workflow when no fresh resolution exists.
   - The email/LinkedIn Play receives an explicit `person_id` chosen by the resolver, not the first eligible graph row.

## Personalization Contract

Every draft should receive these context blocks:

- Targeting company: workspace profile, Exa-enriched positioning, audience, proof, competitors, Rep voice, Play intent.
- Targeted company: graph company facts, Signal summary, Exa draft grounding, recent public evidence, company/person fit.
- Timing: Signal freshness, event type, source URL, novelty/match reason, and why now.
- Learning: procedural exemplars for the same ICP, Signal kind, channel, stage, plus negative outcomes to avoid.

The hot-path judge should continue to see the same context the writer saw. Sub-threshold drafts must stay deferred before channel send.

Branch status:

- Implemented in this branch for email Plays: a structured personalization brief is built inside `play.signal_to_email.v1`, passed to the writer, stored on the draft message, included in approval payloads, and passed to the hot-path judge.
- The LLM writer prompt now includes outcome-derived procedural examples instead of only recording exemplar IDs after the draft.
- Still to verify live: DB-backed staging send with a real connected inbox and real provider-discovered contact. The default local `verify:outreach-pipeline` probe covers the personalization/eval/learning contracts plus a simulated provider waterfall, and the opt-in live-provider smoke now proves Exa/Hunter/ZeroBounce contact resolution. Neither path sends through Microsoft Graph until Outlook readiness passes.

## Implementation Order

1. Done: Add contact-resolution event types and workflow skeleton.
2. Done: Add provider adapter interfaces for Exa people discovery, Hunter, optional Apollo/FullEnrich, and email verifier.
3. Done: Add provider-backed graph projection for Exa/Hunter-discovered contacts and per-email verification metadata.
4. Done: Change `dispatchSignalPlaysOnce` to start resolution before Play dispatch and wake again on `contact.resolved`.
5. Done for local/in-memory email Play: writer and judge both receive the targeting company, targeted company/contact, timing, evidence, and outcome-learning context.
6. Done for DB-backed graph-cache coverage: the product worker Postgres test verifies persisted resolver and Play workflow rows plus the selected contact in the Conversation.
7. Done for local/operator smoke: `verify:outreach-pipeline` packages the top-three graph-cache resolver, provider-waterfall resolver, personalized email Play, eval gate, dry-run channel send, and Outcome learning loop into one repeatable command.
8. Done for opt-in live-provider harness: `OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1 npm run verify:outreach-pipeline` can now create a temporary staging workspace and exercise the real provider adapters without sending email.
9. Done for connected-inbox repairability: `npm run repair:outlook-subscriptions` runs the existing durable Outlook subscription repair workflow from an operator shell.
10. Next: Fix Microsoft OAuth client secret, rerun Outlook subscription repair, then run live staging verification: no graph contact starts resolver, resolver produces contacts through Exa/Hunter/verifier, Play uses highest-ranked verified contact, unverified contacts defer safely, and connected-inbox send remains behind eval plus approval/trust gates.
