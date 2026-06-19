# Product Capability Audit - 2026-06-19

Bombsell launch promise reviewed against the product surface, MCP/API surface,
and backend flow.

## Visitor De-Anonymization

Status: available through signed visitor-intent webhook.

- `POST /api/webhooks/visitors` accepts source-backed visitor identity events
  from RB2B, Clearbit, Factors, Warmly, or a custom de-anonymization provider.
- Visitor company, person, page, LinkedIn, email, and intent score fields are
  converted into website-intent Signals through the existing evented Signal
  discovery path.
- Profile and Agent output destinations now show Visitor de-anonymization as an
  available intake path.

Native embedded tracking script, cookieless identity resolution, and provider
OAuth/app marketplace installs remain future connector work.

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

Status: available as MCP/API handoff; native CRM OAuth remains next.

- Profile and Agent output destinations now expose CRM sync as available for
  qualified-contact handoff through Bombsell's MCP/API tools.
- External agents and automation layers can pull qualified signals and contact
  lanes through `bombsell.signals.list_qualified` and
  `bombsell.contacts.list_lanes`.
- Native HubSpot, Salesforce, Pipedrive, Attio, Folk, or Clay OAuth sync should
  be built as the next evented connector layer after launch traffic confirms the
  handoff model.
