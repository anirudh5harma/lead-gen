# GojiBerry Competitive Audit — 2026-06-18

Observed in the authenticated GojiBerry app on June 18, 2026. This is a product-flow audit for Bombsell, not a clone brief.

## What GojiBerry Does Differently

- **Home is an operator brief, not a CRM landing page.** It welcomes the user, exposes active signals, prompts LinkedIn connection, offers time windows, and shows hot opportunities, leads engaged, conversations, latest hot leads, and latest replies.
- **Agents are framed by output.** The Signals Agents page lists each active agent, leads found, next launch timing, edit controls, and plan limits. The product makes lead generation status visible immediately.
- **Signal analytics are concrete.** Insights shows total leads, average leads/day, active signals, a daily agent-by-agent matrix, signal types, lead counts, and weak-signal warnings.
- **Contacts are signal-backed.** The contacts table ties each person to LinkedIn profile, triggering signal, AI score, email enrichment, import timing, list membership, and manual fit feedback.
- **Outreach is gated by channel readiness.** Campaigns show LinkedIn connection as a prerequisite, then agent-level contacted, invited, accepted, and replied counts.
- **Inbox is channel-first.** The unified inbox is explicitly blocked until LinkedIn is connected, making the setup dependency obvious.
- **AI chat is workspace-aware.** Suggested prompts are grounded in lead finding, campaign performance, and ICP refinement rather than generic assistant tasks.
- **Copilot separates review from autopilot.** The surface lets the user inspect AI-recommended leads and understand whether work is waiting on campaign activation.

## Translation To Bombsell

- Keep only **Brief**, **Agent**, and **Profile** as top-level tabs.
- Brief should answer: what happened in the last day and week, which signal types worked, how many emails and LinkedIn DMs went out, and what replies or meetings appeared.
- Profile owns setup: company context, ICP, voice, email, LinkedIn, contact quality, and limits.
- Agent owns execution: live work, sent outreach, qualified signals, verified contacts, readiness gates, source strategy, sequence, learning, and setup summary.
- Do not reintroduce user-facing nouns such as reps, plays, or outcomes. They remain architecture primitives or derived implementation views.
- Make every contact and sent message explain the chain: qualified signal, verified person, channel, judged draft, reply or meeting outcome.

## Current Bombsell Change From This Pass

The Agent page now opens with live system work and the execution evidence users care about first: sent outreach, qualified signals, and verified contacts. Readiness, source strategy, sequence, learning, and setup remain available but no longer block the first scan.

The Brief now carries a compact signal-health readout: active sources, productive sources in the last week, average qualified signals per day, and the source that needs attention. This borrows GojiBerry's concrete signal analytics without adding a separate Insights tab.

The Agent sent-outreach section now separates channel performance into email, LinkedIn connection requests, LinkedIn messages, and replies attributed to the latest prior outbound touch. This mirrors GojiBerry's contacted/invited/replied clarity while keeping outreach under Agent.
