---
description: Review Bombsell qualified signals by verified email, LinkedIn-ready profile, draft readiness, contact-resolution gaps, and fit-review gaps.
---

# Bombsell Signal Review

Use this skill when the user wants to know which qualified signals can become email or LinkedIn outreach.

## Steps

1. Call `bombsell.signals.list_qualified`.
2. Call `bombsell.contact_lanes.get`.
3. Summarize:
   - qualified signal count
   - verified-email lane
   - LinkedIn-ready lane
   - draft-ready lane
   - each signal's `next_handoff`
   - needs contact resolution
   - needs fit review
   - blocked by fit
4. Recommend the next Bombsell action:
   - use `next_handoff.label`, `next_handoff.detail`, and `next_handoff.href` as the primary routing hint
   - prepare outreach when the handoff is email or LinkedIn outreach
   - review drafts when the handoff is review prepared outreach
   - resolve contact quality when the handoff is resolve contact or verify email
   - tune Profile/source setup when fit is weak or blocked

Do not expose raw email addresses unless the user explicitly asks and Bombsell returns them.
