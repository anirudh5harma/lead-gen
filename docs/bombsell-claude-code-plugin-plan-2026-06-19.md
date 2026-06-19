# Bombsell Claude Code Plugin Plan - 2026-06-19

## Goal

Give operators a Bombsell plugin they can use inside Claude Code to inspect
their GTM brief, prepare outreach, review approvals, queue CRM handoffs, and
pull sent-message proof without leaving existing engineering or revenue
workflows.

## Why This Matters

Ploy Grow keeps the workflow tight: identified visitors become scored accounts,
verified contacts, personalized outreach, and CRM updates. Bombsell should make
that same path available to customers who already run work from Claude Code:
the agent can answer "what happened, what is hot, what can I approve, and what
should sync to CRM" from one tool surface.

## First Plugin Shape

- Package a `.codex-plugin/plugin.json` with a Bombsell MCP server command and
  a short skill named `bombsell`.
- Auth through a workspace-scoped Bombsell API token or OAuth device code.
- Default to read-only tools until the user explicitly enables write tools.
- Require confirmation flags for channel-affecting tools.
- Keep product nouns simple: Brief, Profile/Integrations, Agent, Outreach, CRM
  handoff.

## MCP Tool Contract

- `bombsell.brief.get`: last-day and last-week qualified signals, outreach,
  replies, meetings, and next action.
- `bombsell.signals.list_qualified`: hot Signals with account, score, reasons,
  verified contacts, LinkedIn profiles, and next handoff.
- `bombsell.contact_lanes.get`: groups contacts into verified email, LinkedIn
  ready, draft ready, needs resolution, needs fit review, and blocked by fit.
- `bombsell.outreach.prepare`: creates judged drafts through the existing Agent
  workflow, never sends directly.
- `bombsell.outreach.list_sent`: sent emails and DMs with contact, signal, and
  proof links.
- `bombsell.draft.get`: full sent draft or review draft by message id.
- `bombsell.approvals.list` and `bombsell.approvals.decide`: approval gates for
  reviewable work.
- `bombsell.crm_handoff.queue`: packages CRM-ready qualified contacts with
  signal proof, verified email or LinkedIn data, outreach context, outcomes, and
  webhook delivery status when a CRM destination URL is configured.
- `bombsell.integrations.list`: connected channels, visitor-intent intake, MCP,
  and CRM handoff readiness.
- `bombsell.learning.get`: recent reply and meeting learning.

## Guardrails

- Write tools must be explicit: `confirm_prepare=true`,
  `confirm_channel_effects=true`, or `confirm_queue=true`.
- Outreach sending remains inside Bombsell channel workflows and approval gates.
- CRM sync begins as typed `crm.handoff.queued` events and posts to the
  configured CRM webhook when present. Delivery writes
  `crm.handoff.webhook.delivered` or `crm.handoff.webhook.failed`; native OAuth
  delivery can consume the same event once providers are installed.
- All tool responses return dashboard links so a human can inspect the
  underlying Brief, Agent, Outreach, or Profile surface.

## Launch Workflow

1. User installs plugin and signs into a Bombsell workspace.
2. Claude Code calls `bombsell.brief.get` and summarizes yesterday/last week.
3. If there are hot contacts, Claude Code calls `bombsell.contact_lanes.get`.
4. If drafts are missing, Claude Code asks permission and calls
   `bombsell.outreach.prepare`.
5. If CRM is connected, Claude Code asks permission and calls
   `bombsell.crm_handoff.queue`.
6. Claude Code links the operator back to Agent for approvals and sent proof.

## Build Steps

1. Add a dedicated remote MCP endpoint or stdio wrapper that authenticates to
   the Bombsell API.
2. Scaffold the Codex plugin with plugin metadata, MCP registration, and the
   `bombsell` skill.
3. Add install docs for Claude Code and Codex users.
4. Add contract tests that verify every public tool schema and confirmation
   guard.
5. Dogfood against a demo workspace with visitor intent, qualified contacts,
   judged drafts, sent outreach, and CRM handoff.
