# Channels — Layer 4

Each channel is a subsystem with its own SLA, its own state machine, its own deliverability concerns.

## Hard rules

1. **Every channel exposes one interface:** `send(conversation, draft) → MessageId | DeferReason`. Defer reasons are typed events back onto the bus (`channel.send.deferred`).
2. **Deliverability is first-class.** `core/channels/email/` owns owned-domain warmup, IP/domain rotation, SPF/DKIM/DMARC, bounce/complaint feedback loops, per-recipient frequency caps across all Reps in a workspace.
3. **Connected user inboxes are a separate sub-channel from owned-domain sending.** Daily ceilings on user inboxes protect personal reputation.
4. **Native APIs over publishing partners.** `core/channels/linkedin/` and `core/channels/x/` use native session pools / native APIs. Publishing partners (Typefully etc.) are a fallback, not the default.
5. **High-cost channels gate on outcome thresholds.** Voice (`core/channels/voice/`) and video (`core/channels/video/`) only fire for signals with positive-reply expected value above a configurable bar.
