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
   - needs contact resolution
   - needs fit review
   - blocked by fit
4. Recommend the next Bombsell action:
   - prepare outreach when signals have verified contacts or LinkedIn profiles
   - review drafts when draft-ready signals exist
   - resolve contact quality when signals have no reachable person
   - tune Profile/source setup when fit is weak

Do not expose raw email addresses unless the user explicitly asks and Bombsell returns them.
