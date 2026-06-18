# GojiBerry Competitive Audit — 2026-06-18

Observed in the authenticated GojiBerry app on June 18, 2026. This is a product-flow audit for Bombsell, not a clone brief.

## What GojiBerry Does Differently

- **Public positioning is brutally simple.** The website sells one flow: enter your website, the agent learns the business, finds high-intent prospects, reaches out across email and socials, drafts replies, and learns from what converts.
- **Onboarding starts with a website and an outreach agent.** The authenticated onboarding frames step one as creating the first Outreach Agent from the company website, not configuring a stack of sales objects.
- **Home is an operator brief, not a CRM landing page.** It welcomes the user, exposes active signals, prompts LinkedIn connection, offers time windows, and shows hot opportunities, leads engaged, conversations, latest hot leads, and latest replies.
- **Agents are framed by output.** The Signals Agents page lists each active agent, leads found, next launch timing, edit controls, and plan limits. The product makes lead generation status visible immediately.
- **Signal analytics are concrete.** Insights shows total leads, average leads/day, active signals, a daily agent-by-agent matrix, signal types, lead counts, and weak-signal warnings.
- **Contacts are signal-backed.** The contacts table ties each person to LinkedIn profile, triggering signal, AI score, email enrichment, import timing, list membership, and manual fit feedback.
- **Outreach is gated by channel readiness.** Campaigns show LinkedIn connection as a prerequisite, then agent-level contacted, invited, accepted, and replied counts.
- **Inbox is channel-first.** The unified inbox is explicitly blocked until LinkedIn is connected, making the setup dependency obvious.
- **AI chat is workspace-aware.** Suggested prompts are grounded in lead finding, campaign performance, and ICP refinement rather than generic assistant tasks.
- **Copilot separates review from autopilot.** The surface lets the user inspect AI-recommended leads and understand whether work is waiting on campaign activation.
- **The app keeps suggesting the next operational move.** Home, Copilot, Inbox, and Insights all route the user toward the next unblocker: connect LinkedIn, start a campaign, review contacts, inspect signal output, or tune the agent.

## Translation To Bombsell

- Keep only **Brief**, **Agent**, and **Profile** as top-level tabs.
- Brief should answer: what happened in the last day and week, which signal types worked, how many emails and LinkedIn DMs went out, and what replies or meetings appeared.
- Profile owns setup: company context, ICP, voice, email, LinkedIn, contact quality, and limits.
- Agent owns execution: live work, sent outreach, qualified signals, verified contacts, readiness gates, source strategy, sequence, learning, and setup summary.
- Saving Profile or Agent guidance should wake the signal-ingestion workflow so the product feels alive after every meaningful setup change.
- Do not reintroduce user-facing nouns such as reps, plays, or outcomes. They remain architecture primitives or derived implementation views.
- Make every contact and sent message explain the chain: qualified signal, verified person, channel, judged draft, reply or meeting outcome.
- Translate AI-chat prompts into status-derived next moves inside Brief and Agent rather than adding another assistant tab.

## Current Bombsell Change From This Pass

The Agent page now opens with live system work and the execution evidence users care about first: sent outreach, qualified signals, and verified contacts. Readiness, source strategy, sequence, learning, and setup remain available but no longer block the first scan.

The Brief now carries a compact signal-health readout: active sources, productive sources in the last week, average qualified signals per day, and the source that needs attention. This borrows GojiBerry's concrete signal analytics without adding a separate Insights tab.

The Agent sent-outreach section now separates channel performance into email, LinkedIn connection requests, LinkedIn messages, and replies attributed to the latest prior outbound touch. This mirrors GojiBerry's contacted/invited/replied clarity while keeping outreach under Agent.

The Brief now includes a compact next-move rail. It chooses between reviewing drafted outreach, preparing outreach from qualified signals, inspecting hot contacts, resolving contact quality, tuning sources, applying learning, or refreshing Profile setup. This borrows GojiBerry's workspace-aware prompts while preserving Bombsell's three-surface product model.

The Agent contact workbench and contact profile now expose when a contact first entered the graph and when it was last updated. This brings over GojiBerry's import-timing trust signal while keeping the contact story tied to Bombsell's graph, signals, channel handles, outreach threads, and fit feedback.

The Profile page now has a launch-model summary under the setup hub. It makes the learned buyer fit, watched signal terms, email path, LinkedIn path, contact coverage, match gate, duplicate protection, and review mode visible before the detailed forms. This translates GojiBerry's "enter your website and the agent takes it from there" clarity into Bombsell's Profile and integrations surface.

Saving the Profile or Agent setup now starts the durable signal-ingestion workflow in the background, and the Profile launch model includes a direct Check sources action. This keeps Bombsell's architecture intact while making the GojiBerry-style "agent starts working from setup" loop visible and directly accessible.

Sent outreach rows now carry the graph contact handles behind each message: verified email availability and LinkedIn profile availability appear next to the signal and judged draft. This keeps GojiBerry's contact-table trust signal inside Bombsell's Agent execution trace instead of adding another Contacts tab.

The Brief priority action now starts the existing qualified-signal preparation workflow when signals are waiting but no outreach has gone out. This makes the morning brief an operational command surface: users can move from "qualified signals are ready" to verified contacts and judged email/LinkedIn outreach without first navigating to Agent.

The Agent live-work panel now labels the busiest last-hour stage and emphasizes it in the animated workline. This makes the "what is the Agent doing right now?" answer easier to read while preserving the signal -> contact -> draft -> outreach -> reply operating loop.
