---
description: Read the Bombsell operating Brief from Claude Code, including last-day and last-week qualified signals, emails, LinkedIn DMs, replies, meetings, blockers, and next action.
---

# Bombsell Brief

Use this skill when the user wants the current GTM status, morning brief, last-day/last-week performance, or the next Bombsell action.

## Steps

1. Call `bombsell_brief_get`.
2. Summarize:
   - qualified signals over the last day and week
   - signal types and whether they have contacts or drafts
   - emails and LinkedIn DMs sent
   - replies, meetings, pending reviews, and unhealthy channels
   - the recommended next action
3. If the next action points to Agent or Profile, include the Bombsell dashboard path returned by the tool.

Do not invent metrics that are not returned by Bombsell.
