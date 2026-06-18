---
description: Prepare Bombsell outreach drafts from qualified signals without sending. Use when the user asks Claude Code to prepare email or LinkedIn outreach for review.
---

# Bombsell Prepare Outreach

Use this skill when the user wants Bombsell to turn qualified signals into judged email or LinkedIn outreach drafts.

## Steps

1. Call `bombsell.signals.list_qualified` first so the user can see the current signal/contact state.
2. If the user has not explicitly confirmed preparation, ask for confirmation. Explain that preparation can create judged drafts and approval gates, but will not send.
3. After confirmation, call `bombsell.outreach.prepare` with `confirm_prepare=true`.
4. Report:
   - how many workflows were dispatched
   - how many signals now have drafts
   - which signals are review-ready
   - the Agent path for review
5. If drafts are ready, call `bombsell.approvals.list` and point the user to the approval gate.

Never call `bombsell.approvals.decide` unless the user explicitly asks to approve or reject a specific gate. Never imply that preparation sends outreach.
