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

Direct MCP setup is the fastest way to test Bombsell from Claude Code:

```bash
claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp
```

Authenticate through Claude Code's MCP flow, then ask for the Bombsell Brief,
qualified signals, sent outreach, approval gates, or reply learning. The plugin
below adds guided `/bombsell:*` skills on top of the same remote server.

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

This repo includes a local marketplace catalog for internal validation at:

```text
integrations/bombsell-claude-code-marketplace
```

Local install flow:

```text
/plugin marketplace add ./integrations/bombsell-claude-code-marketplace
/plugin install bombsell@bombsell
```

Recommended marketplace source while this plugin lives in the app monorepo:

```json
{
  "name": "bombsell",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/anirudh5harma/lead-gen.git",
    "path": "integrations/bombsell-claude-code",
    "sha": "<release-commit-sha>"
  }
}
```

Pin every dogfood release by commit SHA so users can audit the exact plugin files Claude Code installed.

## Auth

The plugin points Claude Code at Bombsell's remote HTTP MCP endpoint:

```text
https://www.bombsell.com/api/mcp
```

Public use relies on Bombsell MCP OAuth so Claude Code can authenticate with a browser consent flow and store Bombsell-scoped bearer tokens securely. Do not publish static bearer tokens, workspace IDs, or `headersHelper` scripts inside this plugin.

Bombsell exposes OAuth discovery metadata at:

```text
https://www.bombsell.com/.well-known/oauth-protected-resource
https://www.bombsell.com/.well-known/oauth-authorization-server
```

Browser PKCE consent and token issuance are implemented at `/api/mcp/oauth/authorize`, `/api/mcp/oauth/token`, and `/api/mcp/oauth/register`. Profile shows active Claude Code sessions, revocation controls, and recent MCP tool-call audit events. Public release still needs authenticated Claude Code dogfood and hosted marketplace publication.

## Safety Model

- Brief, launch check, signal review, sent outreach, draft lookup, and reply learning are read-only.
- Profile from repo is proposal-only. It returns Profile fields, buyer-fit draft, source recommendations, and apply instructions, but does not mutate Bombsell.
- Prepare outreach requires explicit confirmation and only dispatches Bombsell's existing durable Agent workflow. It creates or finds judged drafts and approval gates; it does not send.
- Approvals remain explicit and are still governed by Bombsell's channel readiness, approval policy, hot-path eval gate, and sending limits.

## Required Bombsell Tools

This plugin expects the Bombsell MCP manifest to expose:

- `bombsell_brief_get`
- `bombsell_profile_propose_from_context`
- `bombsell_launch_check`
- `bombsell_signals_list_qualified`
- `bombsell_contact_lanes_get`
- `bombsell_integrations_list`
- `bombsell_outreach_prepare`
- `bombsell_outreach_list_sent`
- `bombsell_draft_get`
- `bombsell_approvals_list`
- `bombsell_approvals_decide`
- `bombsell_learning_get`

The wrapper tools are derived from Bombsell's existing product registry; they are not a separate product API.
