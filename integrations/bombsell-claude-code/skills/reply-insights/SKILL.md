---
description: Summarize Bombsell reply and meeting learning so Claude Code can understand what signals, channels, and outreach are working.
---

# Bombsell Reply Insights

Use this skill when the user wants to understand replies, meetings, winning signals, or what Bombsell should double down on.

## Steps

1. Call `bombsell.learning.get`.
2. If the user asks about sent context, call `bombsell.outreach.list_sent`.
3. Summarize:
   - recent useful outcomes
   - reply and meeting counts by kind
   - attributed signals or messages when returned
   - what the Agent appears to be learning
4. Recommend one focused next action:
   - continue the winning signal/channel
   - tune Profile if replies are weak
   - inspect sent drafts if there are replies without clear attribution

Stay grounded in returned Bombsell data.
