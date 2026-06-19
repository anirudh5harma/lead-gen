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

Build this as a Claude Code plugin, not a loose `.mcp.json` snippet.

The plugin should ship:

- a bundled remote HTTP MCP configuration pointed at Bombsell's existing
  `/api/mcp` endpoint
- six namespaced skills that guide users through Brief, Profile, launch
  readiness, qualified signals, outreach preparation, and reply learning
- two optional read-mostly subagents for GTM operation and outreach review
- opt-in hooks for release/commit workflows after the core plugin is trusted
- a private marketplace first, then the Claude community marketplace after
  validation and partner dogfood

This gives Claude Code users a native `/bombsell:*` workflow while preserving
Bombsell as the system of record for auth, workspace scope, verified contacts,
approval gates, evals, and channel sending.

## Build Plan

1. Auth and install path

   Ship first-class remote MCP auth for Claude Code. The normal install should
   not ask users to paste bearer tokens or edit local plugin files. Private
   dogfood can keep `headersHelper`, but the published plugin should use a
   Bombsell-hosted authorization flow, workspace selection, and revocation UI.

2. Minimal plugin package

   Create a separate `bombsell-claude-code` package with only the manifest,
   remote MCP config, six skills, README, and privacy notes. Do not ship hooks,
   local stdio servers, or write-heavy agents in the first public build.

3. Read-first skills

   Launch the first three skills as read-only or proposal-only:
   `/bombsell:brief`, `/bombsell:launch-check`, and
   `/bombsell:signal-review`. These prove value quickly and validate auth,
   workspace scoping, tool search, pagination, and links back into Bombsell.

4. Prepare-only outreach

   Add `/bombsell:prepare-outreach` only after the read path is stable. It can
   prepare or find judged drafts and route the user to approval, but it must not
   send directly from Claude Code. Approval remains explicit through Bombsell's
   existing eval, channel readiness, and policy gates.

5. Private marketplace dogfood

   Publish a Bombsell-controlled marketplace for design partners. Measure time
   to install, time to first useful Brief, tool-call errors, and whether users
   naturally ask Claude Code to update Profile from repo context.

6. Community submission

   Submit to Anthropic's community marketplace once auth, audit logging,
   privacy text, plugin validation, and partner feedback are clean. Keep the
   official Bombsell marketplace as the fastest path for updates and enterprise
   users.

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
bombsell-claude-code-marketplace/
  .claude-plugin/
    marketplace.json
  plugins/
    bombsell/ -> ../bombsell-claude-code or pinned source
```

Initial `.mcp.json` target:

```json
{
  "mcpServers": {
    "bombsell": {
      "type": "http",
      "url": "https://www.bombsell.com/api/mcp",
      "oauth": {
        "scopes": ["brief:read", "profile:read", "signals:read", "outreach:read"]
      }
    }
  }
}
```

This requires completing first-class remote MCP auth for Claude Code. Until then,
developer testing can use a local `.mcp.json` with `headersHelper` or static
bearer headers, but that must stay out of the published plugin.

## Skills

### `/bombsell:brief`

Pulls the operating brief: last-day and last-week qualified signals, signal
types, email/LinkedIn sends, replies, meetings, channel blockers, and the next
recommended action.

MCP tools needed:

- `product.brief.get`
- `product.context.get`
- `product.launch.readiness.get`
- `product.agent_observability.summary.get`
- Future ergonomic alias: `bombsell.brief.get`

### `/bombsell:profile-from-repo`

Reads the current repo, landing-page copy, README, docs, and package metadata,
then proposes Profile updates: website positioning, buyer fit, proof, pain
points, integration assumptions, and signal-source recommendations.

MCP tools needed:

- `product.company.profile.configure`
- `product.icp.configure`
- `product.activation.setup.run`
- `product.source.configure`

Safety:

- Defaults to proposal mode.
- Writes to Bombsell only after the user confirms the inferred company profile.

### `/bombsell:launch-check`

Checks whether Bombsell can move from Profile to signals to verified contacts to
outreach.

MCP tools needed:

- `product.launch.readiness.get`
- `product.outlook_account.connect_url.get`
- `product.linkedin_account.connect_url.get`
- `product.signal.ingestion.run`

### `/bombsell:signal-review`

Lists qualified signals, contact readiness, verified email, LinkedIn-only
contacts, fit review gaps, and draft readiness.

MCP tools needed:

- `product.brief.get`
- `product.state.get`
- `product.context.get`
- `product.contact.waterfall.resolve`
- Future ergonomic aliases: `bombsell.signals.list_qualified`,
  `bombsell.contact_lanes.get`

### `/bombsell:prepare-outreach`

Turns selected qualified signals into judged email or LinkedIn outreach drafts.
For v1, this skill is prepare-and-review: it can create or find drafts and
approval records, but it should not approve sends by itself.

MCP tools needed:

- `product.signals.dispatch_plays`
- `product.message.personalize`
- `product.draft.eval.gate`
- `product.approval.decide`
- Future ergonomic alias: `bombsell.outreach.prepare`

Safety:

- Never sends directly from Claude Code in v1.
- Produces drafts and approval records.
- Sending still obeys Bombsell's per-channel readiness, hot-path eval gate,
  approval policy, and daily caps.

### `/bombsell:reply-insights`

Fetches reply and meeting evidence so Claude Code can summarize what messages,
signals, channels, and Agent positioning are working.

MCP tools needed:

- `product.reply.triage`
- `product.campaign.strategy.optimize`
- `product.play.skills.optimize`
- Future ergonomic alias: `bombsell.learning.get`

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
   - Add OAuth/OIDC-style authorization for remote MCP clients, or a secure
     installation token flow that Claude Code can store.
   - Support workspace selection during auth.
   - Keep bearer token support for power users and CI.
   - Document how to revoke plugin sessions.
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

   - Record tool calls from Claude Code with client name, workspace, user,
     action, primitive refs, latency, and outcome.
   - Surface Claude Code activity in Health or Agent observability.
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

- [ ] Add remote MCP auth suitable for Claude Code.
- [x] Add OAuth discovery metadata for remote MCP clients.
- [ ] Add OAuth browser consent and token issuance for Claude Code.
- [x] Add concise MCP server instructions for tool search.
- [x] Finish v1 `bombsell.*` wrapper tools over the existing registry.
  Landed: Brief, launch check, qualified signals, contact lanes, sent outreach,
  Profile proposal from repo context, prepare-only outreach, draft lookup,
  approvals, and learning.
- [x] Add product contract tests for wrapper tools and manifest discovery.
- [x] Create `bombsell-claude-code` plugin package under `integrations/`.
- [x] Add six initial skills.
- [ ] Add two optional agents.
- [x] Add README and install docs.
- [x] Validate plugin manifest locally with `claude plugin validate integrations/bombsell-claude-code`.
- [x] Add OAuth discovery metadata for remote MCP clients.
- [x] Add OAuth browser consent and token issuance for Claude Code.
- [ ] Dogfood an authenticated session with `claude --plugin-dir ./integrations/bombsell-claude-code`.
- [ ] Publish private marketplace.
- [ ] Dogfood with design partners.
- [ ] Submit to community marketplace.

## Open Decisions

- Should the first public release include Profile write tools, or keep Profile
  updates as proposal-only until users trust the plugin?
- Should Bombsell publish the plugin in this repo under `integrations/`, or a
  separate public repository for cleaner marketplace submission?
- Should Claude Code MCP tokens get a self-serve revocation UI in Profile, or
  remain admin/API managed for the first dogfood cohort?
- Should Claude Code sessions show up as their own channel in Agent activity, or
  only in Health/audit logs?
