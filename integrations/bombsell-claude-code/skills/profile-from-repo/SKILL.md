---
description: Inspect the current repo or product context and propose Bombsell Profile, buyer-fit, and source updates without writing them.
---

# Bombsell Profile From Repo

Use this skill when the user wants Bombsell to learn from the current repository, landing page copy, README, docs, package metadata, changelog, or launch notes.

## Steps

1. Inspect relevant local context before calling Bombsell:
   - README and product docs
   - landing-page or pricing copy
   - package metadata and integrations
   - changelog or launch notes
2. Build a concise `repo_context` with evidence-backed facts only.
3. Call `bombsell.profile.propose_from_context` with any fields you can infer:
   - `company_name`
   - `website_url`
   - `industry`
   - `description`
   - `value_proposition`
   - `customer_pain_points`
   - `target_titles`
   - `target_markets`
   - `key_features`
   - `social_proof`
   - `signal_keywords`
   - `competitor_watchlist`
   - `exclusion_rules`
   - `preferred_language`
   - `outreach_goal`
   - `message_tone`
   - `integrations`
   - `source_urls`
4. Present the proposal as a review:
   - Profile patch
   - buyer-fit draft
   - source recommendations
   - missing context
   - apply plan

Do not apply the Profile update unless the user explicitly asks for a write path. This skill is proposal-only.
