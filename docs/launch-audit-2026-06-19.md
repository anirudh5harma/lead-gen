# Launch Audit — 2026-06-19

Target: first 100 users tomorrow. Pipeline:
Profile/ICP → lead matching → outreach → meetings.

## TL;DR

Spine is wired. Three env-config blockers stand between current state and a
working pipeline for live users. Two product gaps are DEGRADED (multi-turn
reply loop, automated meeting booking) but acceptable for the first 100. One
UX gap (signal-ingestion latency on onboarding) needs a loader state.

## Lane status

| Lane | Status | Severity |
|------|--------|----------|
| Onboarding wiring | WIRED | OK |
| Signal ingestion | WIRED | OK |
| Contact enrichment (email) | DEGRADED w/o `HUNTER_API_KEY` or `EXA_API_KEY` | BLOCKER |
| Contact enrichment (LinkedIn URL) | DEGRADED w/o `HUNTER_API_KEY` or `EXA_API_KEY` | BLOCKER |
| Email send (Outlook) | WIRED | OK |
| Email send (Resend/SES owned domain) | DISABLED by default | OK (gated) |
| LinkedIn send | STUB w/o `LINKEDIN_PROVIDER_*` | BLOCKER |
| Draft + judge | WIRED, judge rejects silently | DEGRADED |
| Reply triage | WIRED, single-turn only | DEGRADED |
| Meeting prep | WIRED (suggests times, no booking) | POLISH |

## Production env blockers (must set before launch)

```
EXA_API_KEY                    # already production-required; verify set
HUNTER_API_KEY                 # add — without it LinkedIn URL discovery dies
ZEROBOUNCE_API_KEY             # add — stricter email verification
LINKEDIN_PROVIDER_URL          # add — LinkedIn send transport endpoint
LINKEDIN_PROVIDER_HEALTH_URL   # add — health check probe
LINKEDIN_PROVIDER_API_KEY      # add — bearer for the transport
LINKEDIN_PROVIDER_WEBHOOK_SECRET  # add — inbound reply auth
LINKEDIN_PROVIDER_AUTH_URL     # optional, derived from URL origin if absent
MICROSOFT_CLIENT_ID            # already required
MICROSOFT_CLIENT_SECRET        # already required
MICROSOFT_REDIRECT_URI         # already required
```

Hit `GET /api/health/readiness` after setting; expect every check `ok`.

Live `LINKEDIN_PROVIDER_*` env scheme already validated by
[`core/product/health.ts`](core/product/health.ts) but the keys are not
declared in [`render.yaml`](render.yaml) — add them there too so deploys
fail loudly if missing.

## Findings

### BLOCKER · Contact discovery providers unconfigured by default

- File: [`core/contacts/providers.ts`](core/contacts/providers.ts)
- Without `HUNTER_API_KEY` or `EXA_API_KEY` the discovery provider list is
  empty. Every new signal that has no prior `graph_persons` row resolves to
  zero contacts; play dispatch emits `signal.outreach.gated`
  (`gate: "contact_fit"`); zero outreach.
- Verified env vars: `EXA_API_KEY` marked production-required, `HUNTER_API_KEY`
  marked optional. Promote `HUNTER_API_KEY` to production-required for the
  launch window.

### BLOCKER · LinkedIn transport silently fails when env missing

- File: [`scripts/production-worker.ts`](scripts/production-worker.ts)
  `createProductLinkedInTransport()` returns `createUnconfiguredLinkedInTransport()`
  if either `LINKEDIN_PROVIDER_URL` or `LINKEDIN_PROVIDER_API_KEY` is
  missing. Unconfigured transport throws on every send.
- LinkedIn plays will mark sends rejected. No graceful fallback to email.
- Either: (a) supply the env vars now and stand up the provider service, or
  (b) gate signal-to-LinkedIn play registration on env presence so the
  workflow does not register at all when LinkedIn is offline.

### DEGRADED · Judge rejection has no surface

- File: [`core/plays/signal-email-play.ts`](core/plays/signal-email-play.ts)
  sub-threshold drafts are marked `draft_rejected` and dropped. User does
  not see which signals failed eval or why.
- For the first 100 users this is tolerable but it hides quality regressions.
  Surface a "Rejected drafts" tab in `/dashboard/agent` with the signal,
  draft, judge score, judge reason, and a "send anyway" override.

### DEGRADED · Reply triage is single-turn

- File: [`core/plays/reply-email-play.ts`](core/plays/reply-email-play.ts)
  triggers on every inbound message; drafts one reply each time. No
  scheduled follow-up if the prospect goes silent.
- For launch this is acceptable because every reply triggers the loop, but
  add a cron-like daily sweep that proposes a follow-up draft on
  conversations where outbound is the last turn and N days have passed.

### DEGRADED · Email verification silently downgrades

- File: [`core/contacts/providers.ts`](core/contacts/providers.ts)
  if neither `HUNTER_API_KEY` nor `ZEROBOUNCE_API_KEY` is configured the
  email verifier is undefined and sends bypass verification.
- Add a startup assertion in production worker: require at least one of
  `HUNTER_API_KEY` or `ZEROBOUNCE_API_KEY`. Fail fast if absent.

### DEGRADED · No automated meeting booking

- File: [`core/agents/langgraph/graphs/calendar-prep.ts`](core/agents/langgraph/graphs/calendar-prep.ts)
  meeting prep returns `suggested_times`. It does not create an Outlook
  calendar event or send an `.ics`.
- Acceptable for first-100 launch. UX: render the prep panel with a "Send
  calendar invite" form pre-filled from suggested times; the user clicks
  send manually.

### POLISH · Signal ingestion latency on onboarding

- File: [`app/onboarding/actions.ts`](app/onboarding/actions.ts)
  first `runWorkspaceSignalIngestion({ limit: 4 })` call is `{ wait: false }`.
- First Brief paint may show empty signals for ~30 seconds.
- Either await it (the user already sees the loading state) or render a
  scripted skeleton + retry on the Brief that explains "your first signals
  arrive in ~30s". The second option keeps onboarding click-through low.

### POLISH · LinkedIn env vars missing from render.yaml

- File: [`render.yaml`](render.yaml)
  the seven `LINKEDIN_PROVIDER_*` keys validated by
  `formatLinkedInProviderCheck` are not declared. Render deploys can ship
  without them and only fail at runtime.

## Launch checklist (block on every box)

- [ ] Set production env: `EXA_API_KEY`, `HUNTER_API_KEY`,
      `ZEROBOUNCE_API_KEY`, all five `LINKEDIN_PROVIDER_*` keys.
- [ ] Declare every env key in `render.yaml`.
- [ ] `GET /api/health/readiness` returns `ready: true`, every check `ok`.
- [ ] End-to-end smoke: create a fresh workspace, submit a website,
      observe first `signal.matched` event within five minutes, observe
      first outbound `message.sent` (Outlook + LinkedIn) within fifteen.
- [ ] Force one inbound reply on the smoke conversation; verify reply
      classification fires and an outbound reply draft lands in the
      review queue.
- [ ] Force one `meeting_intent` reply; verify meeting prep produces
      suggested times.
- [ ] Confirm Brief renders cleanly on mobile + desktop after the new
      design ships (done — see commit `aff43b2`).

## Post-launch backlog (week 1)

1. "Rejected drafts" tab in `/dashboard/agent`.
2. Daily follow-up sweep on conversations idle N days.
3. Automated `.ics` / Outlook calendar event creation when meeting_intent
   detected.
4. Health-check banner in dashboard chrome when any provider is
   misconfigured.
5. Onboarding live progress: stream `workspace.activation.*` events to the
   client so the user sees company profile, ICP, sources, first signal
   land in real time.
