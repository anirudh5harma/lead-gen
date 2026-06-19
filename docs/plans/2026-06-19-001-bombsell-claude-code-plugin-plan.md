# Bombsell Claude Code Plugin Plan

Date: 2026-06-19

## Why This Matters

Claude Code users already live inside an agentic workbench that can read their
repo, run commands, create commits, and call external tools through MCP. Bombsell
should meet those users there: a founder or GTM engineer should be able to ask
Claude Code to inspect the current product, update Bombsell's Profile, review
qualified signals, prepare outreach, approve drafts, and pull reply evidence
without leaving their terminal or IDE.

This is not a replacement for the Bombsell web app. It is a distribution and
workflow surface over the same product primitives: Profile, Signal, Agent work,
Conversation, and Outcome-derived learning.

## Launch Plan Summary

The Claude Code path should launch as a controlled GTM workbench, not as a
shadow outreach app.

1. **Direct MCP now.** Keep the first install path simple:
   `claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp`.
   This validates OAuth, workspace scoping, tool discovery, revocation, and
   audit events against the production server before users install a package.
2. **Plugin dogfood next.** Use `integrations/bombsell-claude-code` for a small
   plugin footprint: one remote HTTP MCP server and six `/bombsell:*` skills.
   The skills map to the simplified product model: Brief, Profile, Agent
   signals, Agent outreach preparation, approvals, and learning.
3. **Private marketplace after proof.** Host the pinned
   `git-subdir` marketplace only after authenticated dogfood proves that the
   plugin can connect, revoke, prepare drafts, and route users back to
   `/dashboard/agent#review-queue` without leaking tokens or bypassing approval
   gates.
4. **Public marketplace last.** Submit to the Claude community marketplace only
   after `npm run verify:claude-code-plugin`, production OAuth, design-partner
   installs, privacy copy, and audit visibility are clean.

The v1 promise is: Claude Code can inspect a user's repo, propose Bombsell
Profile improvements, review qualified signals, prepare judged email/LinkedIn
drafts, and summarize replies or meetings. Bombsell still owns approval,
sending, channel readiness, eval gates, token revocation, and the audit trail.

## Launch Execution Plan

Use the Claude Code plugin as a focused distribution layer for Bombsell's core
product, not as another outreach UI. The user should feel one simple loop:
connect Bombsell, let Claude Code read product context from the repo, improve
the Bombsell Profile, review qualified signals with verified contact lanes,
prepare judged email/LinkedIn outreach, and inspect replies or meetings.

**Now: direct remote MCP.** Ship and support the raw setup command first:
`claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp`.
This proves the hard parts that matter for launch: Google/OAuth consent,
workspace selection, tool discovery, scoped bearer tokens, revocation, audit
events, and no accidental sending from external agents.

**Next: private plugin dogfood.** Install
`integrations/bombsell-claude-code` with
`claude --plugin-dir ./integrations/bombsell-claude-code`. The plugin should
show exactly one remote MCP server and six skills in Claude Code:
`brief`, `profile-from-repo`, `launch-check`, `signal-review`,
`prepare-outreach`, and `reply-insights`. No hooks, no local binaries, no
background monitors, no stdio server, and no `headersHelper` in the public
path.

**Then: pinned marketplace for design partners.** Publish the marketplace only
after authenticated dogfood passes. Use a `git-subdir` source pinned to the
release commit, keep the marketplace private at first, and run
`npm run verify:claude-code-plugin` before every catalog update.

**Finally: public/community release.** Submit publicly only when design
partners can install, authenticate, get a useful Brief, propose Profile
changes, inspect qualified signal lanes, prepare outreach without sending, open
sent proof, and revoke access without support help.

Launch gates:

- Product gate: Claude Code can answer "what happened yesterday and last week"
  with qualified signals, signal types, emails/DMs sent, replies, meetings, and
  next action.
- Profile gate: repo context produces proposal-only Profile changes and source
  recommendations; writes still require explicit Bombsell approval tools.
- Agent gate: outreach preparation creates judged drafts or approval work, but
  never sends without Bombsell channel readiness and approval gates.
- Trust gate: every MCP token has scopes, workspace ownership, revocation, and
  `mcp.tool.called` audit visibility in Profile/Integrations.
- Distribution gate: plugin validation, marketplace validation, privacy copy,
  and install docs pass before external rollout.

## Immediate Launch Track

Current Claude Code docs reinforce a focused path: ship Bombsell as a remote
HTTP MCP-backed plugin with a small skill set, then use marketplace distribution
after authenticated dogfood proves trust.

1. **Production MCP first.** Keep `https://www.bombsell.com/api/mcp` as the
   only execution path. Claude Code's HTTP MCP transport is the right fit for a
   cloud product, and Bombsell keeps OAuth, workspace scoping, eval gates,
   approvals, sending, revocation, and audit logs server-side.
2. **Plugin as workflow packaging.** The plugin should package one MCP server
   plus six skills: Brief, Profile from repo, launch check, signal review,
   prepare outreach, and reply insights. No hooks, local binaries, background
   monitors, or stdio servers in v1.
3. **Private marketplace release.** Publish a pinned marketplace entry for
   design partners only after `npm run verify:claude-code-plugin` and one
   authenticated Claude Code session have passed against production OAuth.
4. **Community marketplace after proof.** Submit publicly only after design
   partners can install, authenticate, review qualified signals, prepare drafts,
   inspect sent outreach, and revoke access without support help.

## Research Snapshot

Last checked against Anthropic Claude Code docs on 2026-06-19.

- Claude Code is available across terminal, IDE, desktop, and web, and the docs
  position MCP as the way to connect external tools and data sources.
  Source: <https://code.claude.com/docs/en/overview>
- Claude Code plugins are self-contained directories that can package skills,
  agents, hooks, MCP servers, LSP servers, monitors, and default settings.
  Source: <https://code.claude.com/docs/en/plugins>
- A plugin manifest lives at `.claude-plugin/plugin.json`. Plugin skills are
  namespaced by plugin name, which avoids command conflicts.
  Source: <https://code.claude.com/docs/en/plugins-reference>
- Plugin MCP servers can be declared in `.mcp.json` or the manifest and start
  automatically when the plugin is enabled. Claude Code supports `${CLAUDE_PLUGIN_ROOT}`,
  `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_PROJECT_DIR}` substitutions for plugin
  MCP server config.
  Source: <https://code.claude.com/docs/en/mcp>
- Claude Code supports remote HTTP, SSE, WebSocket, and local stdio MCP servers.
  MCP resources, prompts, elicitation, and tool search are supported. Tool search
  makes a larger Bombsell toolset viable if server instructions are concise.
  Source: <https://code.claude.com/docs/en/mcp>
- Claude Code supports OAuth-style remote MCP auth and `headersHelper` for
  custom auth headers. `headersHelper` is useful for private dogfood but runs a
  shell command, so the public path should prefer first-class remote MCP OAuth.
  Source: <https://code.claude.com/docs/en/mcp>
- Distribution can start with a private/company marketplace and later move to
  the Anthropic community marketplace after validation and safety review.
  Source: <https://code.claude.com/docs/en/plugin-marketplaces>
- Because the plugin lives under this monorepo today, the marketplace entry
  should use Claude Code's `git-subdir` source type with
  `path: "integrations/bombsell-claude-code"` and a pinned commit SHA for
  external dogfood. That avoids publishing the whole repo as the plugin cache
  while preserving traceability back to the exact code users installed.
  Source: <https://code.claude.com/docs/en/plugin-marketplaces>
- Claude Code's plugin manager shows users what a plugin will install: commands,
  agents, skills, hooks, MCP servers, and LSP servers. That means Bombsell's v1
  should keep its install footprint small and obvious.
  Source: <https://code.claude.com/docs/en/discover-plugins>
- Community marketplace submission requires local validation and Anthropic
  safety review. Public launch should run `claude plugin validate` before every
  submission and keep the private marketplace as the faster update channel.
  Source: <https://code.claude.com/docs/en/plugins>

## Current Bombsell Fit

Bombsell already has the core substrate for a Claude Code plugin:

- `app/api/mcp/route.ts` exposes authenticated Streamable HTTP MCP.
- `/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server`, and `/api/mcp/oauth/*` provide
  remote MCP OAuth discovery, browser consent, PKCE token issuance, and dynamic
  client registration for Claude Code-style clients.
- Profile now shows Claude Code sessions, revocation controls, and recent
  `mcp.tool.called` audit events so users can see which external-agent tools are
  touching their workspace.
- `core/product/tools.ts` registers product tools for Profile, launch readiness,
  signal ingestion, signal matching, contact waterfall, message personalization,
  draft eval, approvals, reply triage, company brain, and observability.
- `core/product/context.ts` builds prompt-ready workspace context for external
  agents.
- The GojiBerry translation work has simplified the product surface to Brief,
  Agent, and Profile, which maps naturally into Claude Code skills.

The plugin should not create a second product API. It should package access to
the existing MCP server and add Claude Code-native workflows around it.

## Product Promise

Install Bombsell in Claude Code and run GTM from the same place you build.

Example user prompts:

- "Use Bombsell to brief me on yesterday's qualified signals and replies."
- "Read this repo and update Bombsell's company profile and buyer fit."
- "Find which qualified signals are ready for email or LinkedIn outreach."
- "Prepare outreach for the top signal, but do not send without approval."
- "Show sent drafts and replies for prospects related to this launch."
- "After I merge this feature, refresh Bombsell sources and suggest who we
  should contact."

## Launch Decision

Ship two entry points:

- **Direct MCP setup now:** users can add the remote Bombsell MCP endpoint from
  Claude Code with
  `claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp`.
  This proves auth, workspace scope, tool discovery, and audit logging without
  waiting on marketplace distribution.
- **Claude Code plugin for guided workflows:** the plugin packages the same
  remote MCP server plus namespaced `/bombsell:*` skills, so users get a native
  workflow instead of remembering tool names.

The plugin already ships:

- a bundled remote HTTP MCP configuration pointed at Bombsell's existing
  `/api/mcp` endpoint
- six namespaced skills that guide users through Brief, Profile, launch
  readiness, qualified signals, outreach preparation, and reply learning
- a Bombsell-controlled marketplace catalog that can be validated locally and
  later hosted for design partners
- strict validation through `npm run verify:claude-code-plugin`

Still deferred:

- two optional read-mostly subagents for GTM operation and outreach review
- opt-in hooks for release/commit workflows after the core plugin is trusted
- hosted private marketplace publication, design-partner dogfood, then Claude
  community marketplace submission

This gives Claude Code users a native `/bombsell:*` workflow while preserving
Bombsell as the system of record for auth, workspace scope, verified contacts,
approval gates, evals, and channel sending.

## 2026-06-19 Research Update

Anthropic's current Claude Code docs make the product path clearer:

- Use **remote HTTP MCP** as the default connection. It is the recommended
  transport for cloud services, supports OAuth, reconnects automatically, and
  keeps Bombsell credentials and GTM logic server-side.
- Use a **Claude Code plugin** when we want distribution, team consistency, and
  namespaced workflows. Plugins can bundle MCP server config and skills, so
  users install Bombsell once and then run `/bombsell:*` commands instead of
  remembering raw MCP tool names.
- Keep v1 small. Claude Code displays installed plugin components, so Bombsell's
  first install should show one MCP server and six obvious skills: Brief,
  Profile-from-repo, launch check, signal review, prepare outreach, and reply
  insights.
- Treat hooks, background monitors, subagents, and local stdio servers as
  post-dogfood additions. They are powerful, but they expand the trust surface
  before the core remote MCP flow has design-partner proof.
- Public release should pass `claude plugin validate`, use marketplace-pinned
  source, include privacy and permission language, and keep the normal auth path
  free of copied tokens or shell `headersHelper` scripts.

The launch wedge is therefore not "a plugin that sends email." It is a Claude
Code GTM workbench: inspect the repo, propose Profile updates, review qualified
signals, prepare judged email/LinkedIn drafts, and pull reply/meeting learning
back into the user's launch workflow.

## 2026-06-19 Current-Docs Verification

Rechecked the public Claude Code docs during launch planning:

- The MCP reference recommends remote HTTP for cloud services, notes that OAuth
  authentication works with HTTP servers, and documents `/mcp` as the browser
  login path for authenticated remote servers.
  Source: <https://code.claude.com/docs/en/mcp>
- Claude Code first checks protected-resource metadata, then authorization
  server metadata during OAuth discovery, and supports pinned scopes in MCP
  config. Bombsell's existing `.mcp.json` should keep scopes narrow and
  explicit.
  Source: <https://code.claude.com/docs/en/mcp>
- Plugin-provided MCP servers are loaded automatically when the plugin is
  enabled, and their tools are managed through plugin installation rather than
  manual `/mcp` setup.
  Source: <https://code.claude.com/docs/en/mcp>
- The plugin manager shows what will install, including commands, agents,
  skills, hooks, MCP servers, and LSP servers. This reinforces the small v1
  footprint: one Bombsell remote MCP server and six skills.
  Source: <https://code.claude.com/docs/en/discover-plugins>
- Anthropic warns that plugins and marketplaces are highly trusted components
  that can execute local code. Bombsell v1 should avoid local stdio servers,
  hooks, monitors, and `headersHelper` in the public package.
  Source: <https://code.claude.com/docs/en/discover-plugins>

Plan adjustment: keep marketplace dogfood private until authenticated remote
MCP, audit events, token revocation, and partner install feedback are clean.
The public package should feel boring from a security perspective: no shipped
secrets, no local commands, no auto-send behavior, and no profile writes without
explicit user confirmation.

## 2026-06-19 Launch-Finalization Research Note

Rechecked the current Claude Code docs again while finalizing the product launch
surface:

- Remote HTTP remains the right default for Bombsell because the MCP reference
  describes it as the recommended transport for cloud services and documents
  OAuth authentication through `/mcp`.
  Source: <https://code.claude.com/docs/en/mcp>
- Plugin-provided MCP servers are managed through plugin install/reload, and
  Claude Code names plugin MCP tools with a plugin/server prefix. Bombsell
  should therefore keep user-facing workflows in six `/bombsell:*` skills and
  let those skills call the existing `bombsell.*` aliases.
  Source: <https://code.claude.com/docs/en/mcp>
- Tool Search is enabled by default and defers MCP tool schemas until needed.
  Bombsell's MCP instructions should stay concise, describe GTM tasks clearly,
  and avoid a giant always-loaded catalog.
  Source: <https://code.claude.com/docs/en/mcp>
- The plugin docs now emphasize that plugins are for team/community distribution
  and versioned releases, while standalone `.claude/` config is for experiments.
  Bombsell should keep private dogfood as a plugin package because design
  partners need the same installable workflow across repos.
  Source: <https://code.claude.com/docs/en/plugins>
- Team marketplace configuration can be added through `.claude/settings.json`,
  and third-party marketplaces are trusted code. For launch, Bombsell should
  keep the marketplace private, pinned, and boring: no hooks, no local binaries,
  no `headersHelper`, and no automatic sends.
  Source: <https://code.claude.com/docs/en/discover-plugins>

Launch implication: the Claude Code plugin should feel like a controlled GTM
workbench inside the developer's repo. Claude can read product context, propose
Profile changes, review qualified signal lanes, prepare judged outreach drafts,
and summarize replies/meetings. Approval, sending, revocation, audit, and
workspace scope remain Bombsell-owned server behavior.

## Build Plan

1. Direct MCP dogfood

   Ask internal users to run
   `claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp`,
   authenticate through the browser consent flow, and call the Brief, launch,
   signal, sent-outreach, approval, and learning tools from a real repo.

2. Plugin dogfood

   Run `claude --plugin-dir ./integrations/bombsell-claude-code`, then exercise
   `/bombsell:brief`, `/bombsell:profile-from-repo`,
   `/bombsell:launch-check`, `/bombsell:signal-review`,
   `/bombsell:prepare-outreach`, and `/bombsell:reply-insights` against a live
   workspace. Preparation can create judged drafts and approval gates, but it
   must not approve or send.

3. Product workflow dogfood

   Run the plugin from real customer-style repos. Have Claude Code read the
   README, package metadata, docs, launch notes, pricing copy, and route-level
   UI copy, then propose Bombsell Profile, buyer-fit, signal-source, and
   LinkedIn-behavior updates. Measure whether those proposals improve the web
   Brief and Agent queues without creating writes that bypass Bombsell approval
   and event flow.

4. Private marketplace

   Host the Bombsell marketplace catalog, keep the plugin source pinned by
   commit SHA, and run `npm run verify:claude-code-plugin` before every catalog
   update. Measure time to install, time to first useful Brief, auth failures,
   tool-call latency, and whether users naturally ask Claude Code to update
   Profile from repo context.

5. Public release

   Submit to Anthropic's community marketplace once auth, audit logging,
   privacy text, plugin validation, and partner feedback are clean. Keep the
   official Bombsell marketplace as the faster update channel for design
   partners and enterprise users.

## Plugin Shape

Repository/package name:

- `bombsell-claude-code`

Plugin namespace:

- `bombsell`

Proposed structure:

```text
integrations/bombsell-claude-code/
  .claude-plugin/
    plugin.json
  .mcp.json
  README.md
  skills/
    brief/
      SKILL.md
    profile-from-repo/
      SKILL.md
    launch-check/
      SKILL.md
    signal-review/
      SKILL.md
    prepare-outreach/
      SKILL.md
    reply-insights/
      SKILL.md
```

The first package now intentionally omits agents, hooks, and local binaries.
Those remain post-dogfood additions after remote MCP authenticated dogfood and
audit logging are complete.

Private marketplace structure:

```text
integrations/bombsell-claude-code-marketplace/
  .claude-plugin/
    marketplace.json
```

Recommended private marketplace entry while the plugin remains in this
monorepo:

```json
{
  "name": "bombsell",
  "displayName": "Bombsell",
  "description": "Run Bombsell GTM workflows from Claude Code.",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/anirudh5harma/lead-gen.git",
    "path": "integrations/bombsell-claude-code",
    "sha": "<release-commit-sha>"
  },
  "strict": true
}
```

Once the plugin is accepted by design partners, move it to a dedicated public
repo or publish it as a standalone package so marketplace installation does not
depend on the app monorepo remaining public-readable.

The first local catalog now lives at
`integrations/bombsell-claude-code-marketplace/.claude-plugin/marketplace.json`
and pins the plugin to a release commit. Validate it with
`npm run verify:claude-code-plugin`, which runs strict Claude plugin validation
for both the plugin and marketplace, checks the marketplace source shape, and
proves the pinned commit exists.

Current `.mcp.json` target:

```json
{
  "mcpServers": {
    "bombsell": {
      "type": "http",
      "url": "https://www.bombsell.com/api/mcp",
      "oauth": {
        "scopes": "brief:read profile:read signals:read outreach:read outreach:prepare approvals:read approvals:write learning:read"
      }
    }
  }
}
```

First-class remote MCP auth is the public path. Developer testing can still use
bearer headers for smoke tests, but static tokens and `headersHelper` scripts
must stay out of the published plugin.

## Skills

### `/bombsell:brief`

Pulls the operating brief: last-day and last-week qualified signals, signal
types, email sends, LinkedIn DMs/InMail, replies, meetings, channel blockers, and the next
recommended action.

MCP tools needed:

- `bombsell.brief.get`

### `/bombsell:profile-from-repo`

Reads the current repo, landing-page copy, README, docs, and package metadata,
then proposes Profile updates: website positioning, buyer fit, proof, pain
points, integration assumptions, and signal-source recommendations.

MCP tools needed:

- `bombsell.profile.propose_from_context`

Safety:

- Defaults to proposal mode.
- Does not write to Bombsell in v1; it returns a patch, buyer-fit draft, source
  recommendations, missing context, and apply plan.

### `/bombsell:launch-check`

Checks whether Bombsell can move from Profile to signals to verified contacts to
outreach.

MCP tools needed:

- `bombsell.launch.check`
- `bombsell.integrations.list`

### `/bombsell:signal-review`

Lists qualified signals, contact readiness, verified email, LinkedIn-only
contacts, fit review gaps, and draft readiness.

MCP tools needed:

- `bombsell.signals.list_qualified`
- `bombsell.contact_lanes.get`

### `/bombsell:prepare-outreach`

Turns selected qualified signals into judged email or LinkedIn outreach drafts.
For v1, this skill is prepare-and-review: it can create or find drafts and
approval records, but it should not approve sends by itself.

MCP tools needed:

- `bombsell.signals.list_qualified`
- `bombsell.outreach.prepare`
- `bombsell.approvals.list`

Safety:

- Never sends directly from Claude Code in v1.
- Produces drafts and approval records.
- Sending still obeys Bombsell's per-channel readiness, hot-path eval gate,
  approval policy, and daily caps.

### `/bombsell:reply-insights`

Fetches reply and meeting evidence so Claude Code can summarize what messages,
signals, channels, and Agent positioning are working.

MCP tools needed:

- `bombsell.learning.get`
- `bombsell.outreach.list_sent`

## Agents

### `bombsell:gtm-operator` (deferred)

A Claude Code subagent that can read the local project and use Bombsell MCP tools
to keep Profile, signals, and launch readiness current. It should be allowed to
read local files and call Bombsell MCP tools, but should default to read-only
local files and proposal-only Bombsell writes.

### `bombsell:outreach-reviewer` (deferred)

A stricter review subagent for checking drafts against:

- signal evidence
- contact fit
- workspace voice
- eval score
- channel readiness
- approval policy
- hallucinated claims
- compliance concerns

This agent should be read-only against the local repo and should only use
Bombsell review/approval tools when the user explicitly asks.

## Optional Hooks

Hooks should be opt-in because they can surprise users.

Candidate hooks:

- `PostToolUse` after successful git commit: suggest refreshing Bombsell Profile
  or signal sources if product-facing files changed.
- `Stop` after a launch planning session: offer to run `/bombsell:launch-check`.
- `UserPromptSubmit`: detect "launch", "pricing", "new feature", or "release"
  prompts and remind Claude to consider Bombsell if the plugin is enabled.

Hooks must never auto-send outreach or auto-write Profile changes.

## V1 Command Boundaries

Ship the first plugin as a focused GTM workbench:

- Brief: read current last-day and last-week metrics.
- Profile: propose company, buyer-fit, signal-source, and voice updates from the
  repo.
- Signals: list qualified signals by verified email, LinkedIn-ready profile,
  draft-ready, contact-resolution needed, and fit-review needed.
- Outreach: inspect sent email/LinkedIn drafts and prepare new judged drafts
  behind approval gates.
- Learning: summarize replies, meetings, and what Agent positioning is working.

Defer automatic release hooks, profile writes without confirmation, local stdio
servers, and any send/approve automation until design partners trust the
read-only and prepare-only flow.

## Required Bombsell Backend Work

1. Remote MCP auth for Claude Code

   - OAuth discovery metadata has landed at
     `/.well-known/oauth-protected-resource` and
     `/.well-known/oauth-authorization-server`, and `/api/mcp` now advertises
     the protected-resource URL in `WWW-Authenticate`.
   - Browser PKCE consent, token issuance, dynamic client registration, token
     hashing, and revocation controls have landed for Claude Code-style clients.
   - Keep improving workspace selection during auth as multi-workspace dogfood
     expands.
   - Keep bearer token support for power users and CI.
   - Keep Profile as the self-serve revocation surface.
   - Keep `headersHelper`-based bearer auth as a private dogfood escape hatch
     only; do not require users to paste tokens into plugin files.

2. Server instructions for tool search

   - Added concise MCP server instructions under 2KB explaining that Bombsell
     tools handle GTM Profile, qualified signals, verified contacts, judged
     outreach, approvals, replies, and launch readiness.
   - The manifest advertises Brief, Agent, and Profile plus
     `product.brief.get` as the recommended entry tool.

3. Ergonomic MCP aliases

   Existing `product.*` tools are architecture-friendly, but plugin users need a
   smaller task vocabulary. Add wrapper tools that call the existing registry:

   - `bombsell.brief.get` (landed: read-only)
   - `bombsell.profile.propose_from_context` (landed: proposal-only)
   - `bombsell.launch.check` (landed: read-only)
   - `bombsell.signals.list_qualified` (landed: read-only)
   - `bombsell.contact_lanes.get` (landed: read-only)
   - `bombsell.integrations.list` (landed: read-only)
   - `bombsell.outreach.prepare` (landed: prepare-only; never sends directly)
   - `bombsell.outreach.list_sent` (landed: read-only)
   - `bombsell.draft.get` (landed: read-only)
   - `bombsell.approvals.list` (landed: read-only)
   - `bombsell.approvals.decide` (landed: explicit approval-backed write)
   - `bombsell.learning.get` (landed: read-only)

   These wrappers must remain derived views over the five primitives, not a new
   product model.

4. Output shaping

   - Paginate large lists.
   - Return compact summaries by default.
   - Include IDs, URLs back into Bombsell, and provenance.
   - Avoid raw PII unless specifically needed for the task.

5. Audit and observability

   - Record tool calls from Claude Code with client name, workspace, user, tool,
     request id, latency, HTTP status, and outcome through the typed
     `mcp.tool.called` event.
   - Surface recent Claude Code activity in Profile today; add rollups to Health
     or Agent observability after authenticated dogfood produces real traffic.
   - Add tests that MCP manifest and plugin docs stay aligned.

## Security And Trust Rules

- The plugin must not ship secrets.
- Local stdio servers should be avoided for v1; prefer remote HTTP MCP to keep
  credentials and business logic server-side.
- Claude Code should see only workspace-scoped data.
- All state-changing tools must be idempotent or approval-backed.
- Draft generation must keep the hot-path eval gate.
- Sending must remain gated by Bombsell channel readiness and approval policy.
- Contact exports should redact or summarize PII by default.
- Hooks are opt-in and must never perform external side effects automatically.
- Marketplace release must run `claude plugin validate --strict` and a security
  checklist before submission.

## Distribution Plan

### Phase 0: Internal dogfood

- Build the plugin in a separate `bombsell-claude-code` directory.
- Load locally with `claude --plugin-dir ./bombsell-claude-code`.
- Use local dev auth or a non-published `headersHelper` during dogfood.
- Verify the six skills against staging and production workspaces.

Exit criteria:

- `/bombsell:brief` returns the same key numbers as the web Brief.
- `/bombsell:launch-check` correctly routes users to Outlook/LinkedIn/Profile
  blockers.
- `/bombsell:prepare-outreach` creates judged drafts but does not send.

### Phase 1: Private marketplace

- Host a Bombsell plugin marketplace repository.
- Publish `marketplace.json` with the `bombsell` plugin.
- Add install docs:

```text
/plugin marketplace add bombsell/bombsell-claude-code
/plugin install bombsell@bombsell
```

- Added an in-product Profile CTA: "Use Bombsell in Claude Code."
- Add a CLI helper or install snippet for auth.

Exit criteria:

- Three external design partners install from the private marketplace.
- They can connect a workspace, review signals, prepare outreach drafts, and
  inspect replies from Claude Code.

### Phase 2: Public community submission

- Add polished README, screenshots/GIFs, privacy notes, and supported commands.
- Run `claude plugin validate --strict`.
- Submit to the Claude community marketplace through Anthropic's plugin
  submission flow.
- Keep our own marketplace as the fastest update channel.

Exit criteria:

- Plugin is installable by a new user in under five minutes.
- No raw tokens or workspace IDs are copied manually in the normal path.
- Bombsell web app shows Claude Code sessions in audit/health surfaces.

### Phase 3: Workflow integrations

- Add optional hooks for launch/release workflows.
- Add MCP resources for reusable briefs:
  - `bombsell://brief/current`
  - `bombsell://profile/current`
  - `bombsell://signals/qualified`
  - `bombsell://outreach/sent`
- Add prompt commands that can be referenced from Claude Code sessions.
- Explore Claude Code routines for recurring morning Brief review.

## Launch Surface Copy

One-line:

> Run Bombsell from Claude Code: turn product context into qualified signals,
> verified contacts, judged outreach drafts, and reply learning.

Install page bullets:

- Review yesterday's GTM brief without leaving your repo.
- Convert product changes into updated buyer fit and signal sources.
- Prepare email and LinkedIn outreach from qualified signals.
- Keep sends gated by Bombsell approvals, channel readiness, and evals.
- Bring reply evidence back into launch planning.

## Implementation Checklist

- [x] Add remote MCP auth suitable for Claude Code.
- [x] Add OAuth discovery metadata for remote MCP clients.
- [x] Add OAuth browser consent and token issuance for Claude Code.
- [x] Add Profile revocation for Claude Code MCP sessions.
- [x] Add evented audit logging for Claude Code MCP tool calls.
- [x] Add concise MCP server instructions for tool search.
- [x] Finish v1 `bombsell.*` wrapper tools over the existing registry.
  Landed: Brief, launch check, qualified signals, contact lanes, sent outreach,
  Profile proposal from repo context, output destinations, prepare-only outreach,
  draft lookup, approvals, and learning.
- [x] Add product contract tests for wrapper tools and manifest discovery.
- [x] Create `bombsell-claude-code` plugin package under `integrations/`.
- [x] Create a local Bombsell marketplace catalog for internal validation and
  private dogfood.
- [x] Add `npm run verify:claude-code-plugin` as the repeatable release gate
  for the plugin package and private marketplace catalog.
- [x] Add six initial skills.
- [ ] Add two optional agents.
- [x] Add README and install docs.
- [x] Validate plugin manifest locally with `claude plugin validate integrations/bombsell-claude-code`.
- [ ] Dogfood an authenticated session with `claude --plugin-dir ./integrations/bombsell-claude-code`.
- [ ] Confirm OAuth token refresh/expiry behavior from Claude Code in production.
- [ ] Add a private marketplace repository or catalog entry.
- [ ] Publish private marketplace.
- [ ] Dogfood with design partners.
- [ ] Submit to community marketplace.

## Open Decisions

- Should the first public release include Profile write tools, or keep Profile
  updates as proposal-only until users trust the plugin?
- Should Bombsell publish the plugin in this repo under `integrations/`, or a
  separate public repository for cleaner marketplace submission?
- Should authenticated Claude Code sessions appear in Agent activity, Health, or
  both once dogfood generates enough event volume?
- Should the private marketplace live inside the main Bombsell repo initially,
  or in a dedicated lightweight distribution repo pinned by commit SHA?
