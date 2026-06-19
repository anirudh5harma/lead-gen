---
description: Check whether Bombsell is ready to move from Profile to qualified signals, verified contacts, judged outreach, and replies.
---

# Bombsell Launch Check

Use this skill when the user asks whether Bombsell is ready to launch, send outreach, connect channels, or unblock the Agent.

## Steps

1. Call `bombsell.launch.check`.
2. If the user asks about integrations, output destinations, CRM sync, or where qualified work can go next, call `bombsell.integrations.list`.
3. Report:
   - launch status
   - blockers
   - warnings
   - required checks
   - connected or blocked native output paths
   - planned CRM, outreach-tool, and team-alert destinations if requested
   - next action
4. If a check or destination has a Profile or Agent surface, include that path.

Keep this operational. Do not turn it into a marketing summary.
