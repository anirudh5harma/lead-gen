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
- **Agent setup is an ICP plus signal scanner.** Editing a Signals Agent exposes target job titles, industries, company sizes, markets, company types, excluded competitors, high-precision matching, mandatory keywords, and quality filters such as excluding service providers and open-to-work profiles.
- **Signals are concrete LinkedIn behaviors.** Their signal categories include company/team engagement, engagement with keyworded LinkedIn content, relevant LinkedIn profiles, trigger events, and competitor/company engagement. Keyword signals link directly to LinkedIn search and can track posts, likes, comments, or all engagement.
- **Lead management is a list handoff.** Found leads automatically enter a named list, and if that list is not attached to a campaign the product tells the user the next step is outreach campaign creation.
- **Profile content feeds message quality.** Company settings collect website, industry, value proposition, pain points, features, social proof, LinkedIn company page, auto-enrichment, and team-level duplicate prevention.
- **Integrations are positioned as output pipes.** CRM, outreach, and automation integrations are described in terms of where qualified leads should sync next: HubSpot, Pipedrive, Instantly, SmartLead, HeyReach, Slack, Clay, webhooks, and Zapier.

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

The Agent verified-contact workbench now separates contact trust from raw reachability: verified email, LinkedIn readiness, fit review, and outreach participation are counted before the contact list. This mirrors GojiBerry's contact table trust cues while keeping Bombsell focused on signal-backed people who can become email or LinkedIn outreach.

The Brief now uses the same contact-trust distinction before it recommends the next move: fresh signal-backed contacts are counted by verified email, LinkedIn profile, fit review, and email handles that still need verification. Hot-contact rows no longer call every found email "verified"; they show Verified email, Email found, or Email pending from graph verification metadata.

Onboarding and Agent empty states now avoid old implementation nouns such as plays and outcomes. The launch flow stays in simple user language: website context creates sources, outreach paths, verified contacts, messages, replies, and meetings.

The Brief priority rail is now channel-aware. It asks users to connect Outlook or LinkedIn before preparing outreach, and it keeps a LinkedIn connect move visible until LinkedIn is ready, matching GojiBerry's habit of making the next unblocker obvious from the home surface.

Profile now includes an activation flow that connects website profile, signal sources, verified contacts, channels, and outreach in one scan. It uses existing launch-readiness blockers and Profile contact/channel state, so users can see how setup becomes qualified email or LinkedIn outreach without learning extra product tabs.

Connected Outlook or LinkedIn accounts now wake the durable channel-readiness workflow from the `channel.account.connected` event. This makes the backend match the UI promise: integrations immediately refresh launch blockers and can unblock the Brief/Profile/Agent flow without waiting for a separate settings action.

LinkedIn provider webhooks can now record accepted connection requests as `linkedin.connection.accepted`, and Agent channel performance shows accepted connections between sent invites and replies. This brings over GojiBerry's contacted/invited/accepted/replied clarity without adding another Campaigns tab.

Accepted LinkedIn connections now carry optional person, conversation, and message IDs from the provider webhook, and the Agent verified-contact workbench promotes matched contacts to `Accepted connection`. This turns GojiBerry's campaign-state clarity into a Bombsell contact trust signal: a user can scan qualified people and see whether email or LinkedIn outreach has progressed from draft/contacted to accepted/replied.

The Brief weekly learning panel now derives the strongest recent signal type and outbound channel from attributed replies and meetings. This borrows GojiBerry's "agent gets better every week" promise in a launch-focused way: Bombsell can tell the user what outcome-backed path to scale without adding another analytics tab.

Accepted LinkedIn connections now wake a targeted product event dispatcher that resolves the accepted person/conversation back to a qualified Signal and starts the existing Signal -> LinkedIn DM workflow with an accepted-event idempotency key when no later DM, InMail, or comment exists. This makes the GojiBerry-style invited -> accepted -> next touch loop operational in Bombsell's backend instead of leaving accepted connections as a passive dashboard count.

The Agent sent-outreach surface now lists accepted LinkedIn connections that have no later DM, InMail, or comment in the same person/conversation trace. This makes the invited -> accepted -> follow-up gap visible as a concrete Agent task while keeping outreach under Agent rather than adding a Campaigns tab.

Profile now includes a signal setup panel that mirrors GojiBerry's concrete agent editor without adding another tab: buyer filters, intent signals, source categories, qualified signals this week, email enrichment, duplicate protection, verified email, and LinkedIn profile readiness are visible in one scan. The panel reads backend source counts and recent qualified-signal counts, then routes users to Profile tuning, source checks, or Agent execution.

The Agent page now includes a setup snapshot directly under the command strip. It reads the seven-day signal mix from the backend, groups signal types by seen, qualified, contact-ready, and draft-ready counts, and pairs that with buyer/source tuning plus outreach gates for verified emails, LinkedIn profiles, outreach paths, and sent volume. This translates GojiBerry's "one agent replaces the outreach stack" positioning into Bombsell's execution surface without adding a new tab.
