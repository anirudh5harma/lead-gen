# Product Focus: Prospecting, Signals, Outbound, Campaigns

Date: 2026-06-12

## Decision

Bombsell's product surface is narrowed to prospecting, signal ingestion,
outbound across email and LinkedIn, and campaign execution. Content and AEO are
retired from the active product surface for now.

This is a focus change, not an architecture shortcut. The five primitives stay:
Rep, Signal, Play, Conversation, and Outcome. Content and AEO become non-active
legacy workflow variants until there is a deliberate reason to bring them back.

## External Read

- AuraSell positions around replacing fragmented CRM/GTM stacks with one
  AI-native system of record and execution layer. The relevant lesson is not
  "build a full CRM now"; it is that users want one operating surface that
  removes tool switching across prospecting, selling, and RevOps.
  Source: https://www.aurasell.ai/ai-crm-and-gtm
- AuraSell's public pricing and job pages point at an enterprise/GTM-OS motion,
  with unified data and AI credits rather than a narrow content tool.
  Sources: https://www.aurasell.ai/pricing,
  https://www.aurasell.ai/job-openings/founding-sales-development-sdr-bdr-team--multiple-openings
- ZoomInfo's AI outbound framing names the four core jobs cleanly:
  signal-based prioritization, account research automation, personalized
  outreach drafting, and CRM/sequencer activation.
  Source: https://pipeline.zoominfo.com/sales/ai-outbound-prospecting
- Warmly's outbound framing reinforces timing and orchestration: use company
  news, hiring, social activity, site engagement, and competitive movement to
  personalize email and LinkedIn, then adjust follow-up timing based on
  engagement.
  Source: https://www.warmly.ai/p/blog/ai-for-outbound-sales

## First-Principles Product Shape

The customer does not want "more GTM content." They want to know:

1. Who should we target?
2. Why now?
3. Who at the account is reachable and verified?
4. What should we say on email and LinkedIn?
5. Which campaign/play is working?
6. What did outcomes teach the system?

That maps to the current primitives:

- Prospecting is a graph view over People and Companies.
- Signals are typed timing evidence.
- Outreach is Conversation plus Message over email and LinkedIn channels.
- Campaigns are Play runs with Outcome learning.
- Profile is configuration for prospecting, not a standalone destination.

## Surface Contract

Active navigation:

- Brief
- Prospecting
- Signals
- Outreach
- Campaigns

Retired from navigation:

- Content
- AEO

Legacy deep links for `/dashboard/content` and `/dashboard/aeo` should redirect
to `/dashboard/campaigns` instead of showing separate surfaces.

## Implementation Notes

- Do not delete Content/AEO backend services until the Restate release contract
  and tests are intentionally updated. They remain compatibility code, not
  active product surface.
- New work should prefer email and LinkedIn Plays, contact verification,
  signal-source configuration, campaign outcome learning, and prospect graph
  quality.
- Do not add new user-facing nouns. "Prospects" is a view over Person/Company
  graph nodes, and "Campaigns" is a Play/Outcome view.
