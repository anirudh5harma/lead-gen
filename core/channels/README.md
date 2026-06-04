# Channels — Layer 4

Each channel is a subsystem with its own SLA, its own state machine, its own deliverability concerns.

## Hard rules

1. **Every channel exposes one interface:** `send(conversation, draft) → MessageId | DeferReason`. Defer reasons are typed `message.deferred` events back onto the bus.
2. **Deliverability is first-class.** `core/channels/email/` owns connected-inbox caps, reply sync health, optional owned-domain warmup, SPF/DKIM/DMARC, bounce/complaint feedback loops, and per-recipient frequency caps across all Reps in a workspace.
3. **Connected Outlook inboxes are the launch path.** Owned-domain sending is an optional capacity layer for customers that want separate sending infrastructure.
4. **Native APIs over publishing partners.** `core/channels/linkedin/` and `core/channels/x/` use native session pools / native APIs. Publishing partners (Typefully etc.) are a fallback, not the default.
5. **High-cost channels gate on outcome thresholds.** Voice (`core/channels/voice/`) and video (`core/channels/video/`) only fire for signals with positive-reply expected value above a configurable bar.

## Landed channels

- `email/` — Outlook/Microsoft Graph connected inboxes plus optional owned-domain email with dry-run, SES-style transport, Postgres deliverability caps, and provider feedback ingestion.
- `linkedin/` — native LinkedIn action channel contract (`linkedin_connection`, `linkedin_dm`, `linkedin_comment`) with session-account volume gates and dry-run transport. Production provider integration plugs in behind the same transport interface.
