# Product Capability Audit - 2026-06-19

Bombsell launch promise reviewed against the product surface, MCP/API surface,
and backend flow.

## Visitor De-Anonymization

Status: available through installable visitor script and signed
visitor-intent webhook.

- `/visitor.js` posts consented website visits to
  `POST /api/collect/visitors`; anonymous or opted-out visits are skipped until
  a company, email, or LinkedIn identity is present.
- `POST /api/webhooks/visitors` accepts signed source-backed visitor identity
  events from RB2B, Clearbit, Factors, Warmly, or a custom de-anonymization
  provider.
- Visitor company, person, page, LinkedIn, email, and intent score fields are
  converted into website-intent Signals through the existing evented Signal
  discovery path.
- Profile and Agent output destinations now show Visitor de-anonymization as an
  available intake path.

Cookieless identity resolution and provider OAuth/app marketplace installs
remain future connector work.

## Automated Personalized Outreach

Status: available through Agent.

- Qualified Signals flow to verified contacts, judged email/LinkedIn drafts,
  approval gates, connected Outlook/LinkedIn sends, sent proof, reply capture,
  and meeting prep.
- The hot-path eval gate still blocks low-quality drafts before channel send.
- Agent and MCP surfaces keep outreach under review/approval and channel caps.

## Intent Signals And Lead Scoring

Status: available.

- Open-web, source-backed, webhook, and visitor-intent events become Signals.
- Source quality, buying intent, freshness, novelty, ICP fit, `match_score`,
  contact confidence, and draft eval scores are visible in the product flow.
- Weak-signal warnings now flag no signal volume, non-qualifying signals,
  qualified signals without verified contacts, and reachable contacts without
  judged drafts.

## CRM Integration

Status: available as MCP/API handoff with configurable webhook delivery;
native CRM OAuth remains next.

- Profile and Agent output destinations now expose CRM sync as available for
  qualified-contact handoff through Bombsell's MCP/API tools.
- External agents and automation layers can pull qualified signals and contact
  lanes through `bombsell.signals.list_qualified` and
  `bombsell.contacts.list_lanes`.
- External agents can now call `bombsell.crm_handoff.queue` to emit typed
  `crm.handoff.queued` events containing signal proof, verified email or
  LinkedIn profile data, judged/sent outreach context, and reply/meeting
  outcomes for CRM delivery.
- When the CRM destination has a webhook URL, Bombsell posts the handoff package
  immediately and records `crm.handoff.webhook.delivered` or
  `crm.handoff.webhook.failed` with endpoint host, status code, retryability,
  and last-delivery status visible in Profile.
- Profile now includes CRM handoff setup for HubSpot, Salesforce, Pipedrive,
  Attio, Folk, Clay, or a custom webhook. Saving it emits
  `crm.destination.configured` and stores the destination as a `crm`
  `channel_accounts` row.
- Native HubSpot, Salesforce, Pipedrive, Attio, Folk, or Clay OAuth sync can
  reuse the same evented destination model after launch traffic confirms the
  handoff contract.

## Claude Code Plugin

Status: planned with tool contract documented.

- `docs/bombsell-claude-code-plugin-plan-2026-06-19.md` defines the first
  plugin shape, MCP tools, write confirmations, auth model, and launch workflow.
- The plugin should expose Brief, qualified Signals, contact lanes, outreach
  preparation, approvals, sent proof, CRM handoff queueing, integrations, and
  learning without creating new user-facing product nouns.
