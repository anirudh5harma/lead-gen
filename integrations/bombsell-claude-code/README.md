# Bombsell Claude Code Plugin

Run Bombsell from Claude Code without leaving the repo you are launching.

This plugin packages Bombsell's remote MCP server and six focused skills:

- `/bombsell:brief` reads the operating Brief.
- `/bombsell:profile-from-repo` turns repo/product context into a proposal-only Profile update.
- `/bombsell:launch-check` checks whether Profile, channels, signals, and outreach are ready.
- `/bombsell:signal-review` groups qualified signals by verified email, LinkedIn readiness, draft readiness, and blockers.
- `/bombsell:prepare-outreach` prepares judged outreach drafts without sending.
- `/bombsell:reply-insights` summarizes reply and meeting learning.

## Install For Dogfood

From this repository:

```bash
claude --plugin-dir ./integrations/bombsell-claude-code
```

Then run:

```text
/reload-plugins
/bombsell:brief
```

For marketplace dogfood, publish this directory through a Bombsell-controlled Claude Code plugin marketplace and install it as `bombsell@bombsell`.

## Auth

The plugin points Claude Code at Bombsell's remote HTTP MCP endpoint:

```text
https://www.bombsell.com/api/mcp
```

Public use requires Bombsell MCP OAuth so Claude Code can authenticate with a browser flow and store refreshable tokens securely. Do not publish static bearer tokens, workspace IDs, or `headersHelper` scripts inside this plugin. Private dogfood can use local Claude Code MCP configuration outside this package while the OAuth path is being completed.

Bombsell exposes OAuth discovery metadata at:

```text
https://www.bombsell.com/.well-known/oauth-protected-resource
https://www.bombsell.com/.well-known/oauth-authorization-server
```

Browser consent and token issuance are the remaining backend steps before public plugin auth is ready.

## Safety Model

- Brief, launch check, signal review, sent outreach, draft lookup, and reply learning are read-only.
- Profile from repo is proposal-only. It returns Profile fields, buyer-fit draft, source recommendations, and apply instructions, but does not mutate Bombsell.
- Prepare outreach requires explicit confirmation and only dispatches Bombsell's existing durable Agent workflow. It creates or finds judged drafts and approval gates; it does not send.
- Approvals remain explicit and are still governed by Bombsell's channel readiness, approval policy, hot-path eval gate, and sending limits.

## Required Bombsell Tools

This plugin expects the Bombsell MCP manifest to expose:

- `bombsell.brief.get`
- `bombsell.profile.propose_from_context`
- `bombsell.launch.check`
- `bombsell.signals.list_qualified`
- `bombsell.contact_lanes.get`
- `bombsell.outreach.prepare`
- `bombsell.outreach.list_sent`
- `bombsell.draft.get`
- `bombsell.approvals.list`
- `bombsell.approvals.decide`
- `bombsell.learning.get`

The wrapper tools are derived from Bombsell's existing product registry; they are not a separate product API.
