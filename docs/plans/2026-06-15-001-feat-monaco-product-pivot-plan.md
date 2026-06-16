---
title: "feat: Monaco-inspired product operating loop"
type: "feat"
date: "2026-06-15"
---

# feat: Monaco-inspired product operating loop

## Summary

This plan translates Monaco's product approach into Bombsell's pivot-v2 architecture: one operating surface that moves from prospect graph, to Signals, to Play execution, to Conversations, to Outcomes. The first shipped slice updates the dashboard IA, Brief surface, retired routes, and product-surface tests without inventing user-facing nouns outside Rep, Signal, Play, Conversation, and Outcome.

---

## Problem Frame

Monaco's product page presents GTM as a self-maintaining revenue system: build TAM, overlay signals, execute sequences, capture activity, track pipeline, and ask for prioritized sales judgment. Bombsell already has much of this machinery in the architecture and codebase, but the authenticated surface still exposes some implementation language (`setup`, `ingestion`) and the Brief page undersells the operating loop.

---

## Monaco Product Read

- Monaco's product sequence is fluently causal: market definition precedes signal priority, signal priority precedes outreach, and captured activity feeds pipeline judgment.
- The page sells "maintains itself" rather than "more AI tools." Product proof comes from screenshots of account scoring, signal reasoning, automated outreach, meeting notes, pipeline risk, and AI coaching.
- The design system is dark, high-contrast, image-led, and very restrained: large product screenshots, small numbered steps, few top-level claims, and copy that names user outcomes instead of implementation details.
- Bombsell should borrow the operating-loop clarity and dark operating posture while keeping the current Bombsell logo asset and logo colors unchanged.

---

## Monaco Frontend Theme Notes

- Source inspected: `https://www.monaco.com/product` on 2026-06-16.
- Product flow: Build TAM -> Overlay signals -> Execute sequences -> Capture Activity -> Track Pipeline -> Ask Monaco. Bombsell maps this to Prospecting/Profile/ICP -> Signals -> Plays -> Conversations -> Outcomes -> Brief/Rep judgment.
- Palette: black base (`#000`, `oklch(14.5% 0 0)`), white/high-contrast foreground, light grey (`#f6f6f6`) for text, dark grey cards/chrome (`oklch(20.5% 0 0)`, `oklch(26.9% 0 0)`), low-alpha grey borders, and glass nav treatment (`#3a3a3a66`).
- Typography: Monaco uses Inter for body, nav, buttons, and product labels; Season Serif Regular/Medium for large display headings and quotes. The feel is editorial headline plus precise SaaS body copy.
- Style: fixed glass navigation, centered hero, numbered horizontal stepper, full-width product screenshots, restrained rounded corners, pill buttons, subtle reveal motion, and product-proof-first sections.
- Bombsell adaptation: `app/globals.css` uses a Monaco-inspired dark operator surface (`#070806`, `#15130f`, warm hairlines, amber action `#c9a35b`, warm text `#f5ead7`) with Geist/Bricolage/Geist Mono already wired. This intentionally keeps Bombsell identity and the canonical `/logo.svg` fills intact instead of copying Monaco's brand.

---

## Similar Features Already Present

- Prospect graph: `graph_persons`, `graph_companies`, graph edges, `ProfileIntelligence`, and prospecting setup.
- Signals: typed Signal primitive, source configuration, workspace polling, novelty checks, qualified-signal workbench.
- Sequences / Plays: Signal-to-email and Signal-to-LinkedIn durable Plays with research, draft, judge, approval, and send steps.
- Activity capture: Conversation and Message primitives, Outlook/LinkedIn webhooks, reply lifecycle, conversation trust trace.
- Pipeline / outcomes: Outcome primitive, campaign outcome recording, procedural memory learning projections.
- Copilot-like guidance: Brief, MCP tools, workspace context, conversation proof trace, and review/approval surfaces.

---

## Requirements

**Product Surface**

- R1. The authenticated IA uses active product language: Brief, Prospecting, Signals, Outreach, Campaigns.
- R2. Legacy Content and AEO surfaces redirect to Campaigns because they are retired from the active product surface.
- R3. Brief presents the GTM operating loop as derived views over the five primitives, not as disconnected dashboard tiles.
- R4. Brief surfaces prioritized next actions from existing product state: missing profile, fresh Signals, pending approvals, channel health, active Conversations, and Outcome learning.

**Architecture**

- R5. The implementation must not bypass the typed event bus, Restate workflow runtime, graph model, hot-path eval gate, or per-Play autonomy rules.
- R6. New UI copy must not introduce new user-facing nouns outside the five primitives or derived views named in the product focus doc.

**Verification**

- R7. Tests must assert the product-surface contract for canonical routes and retired surfaces.
- R8. The app must pass lint/build checks for the touched Next.js App Router files.

---

## Key Technical Decisions

- KTD1. Use canonical route aliases, not a large file move: add `/dashboard/prospecting` and `/dashboard/signals` as canonical routes while leaving `/dashboard/setup` and `/dashboard/ingestion` compatible for existing links.
- KTD2. Improve Brief before deeper backend changes: the backend already has the Monaco-adjacent primitives, so the highest-leverage first slice is surfacing the operating loop and priority actions.
- KTD3. Redirect retired product surfaces in page code: `redirect("/dashboard/campaigns")` keeps old URLs compatible without keeping Content/AEO active in navigation.
- KTD4. Add static product-surface tests: route and copy contracts are easy to regress during UI work, so a focused file-level test protects the product focus decision.

---

## Implementation Units

### U1. Canonicalize Dashboard IA

- **Goal:** Make Prospecting and Signals the canonical navigation paths while keeping old paths functional.
- **Requirements:** R1, R6.
- **Dependencies:** None.
- **Files:** `components/dashboard/Shell.tsx`, `app/dashboard/prospecting/page.tsx`, `app/dashboard/signals/page.tsx`, `app/dashboard/actions.ts`, `app/dashboard/setup/page.tsx`, `app/dashboard/ingestion/page.tsx`.
- **Approach:** Point nav and action return paths to `/dashboard/prospecting` and `/dashboard/signals`; add route aliases that reuse the existing page implementations.
- **Patterns to follow:** App Router page files in `app/dashboard/plays/page.tsx`; Next.js redirect/page conventions from local `node_modules/next/dist/docs/`.
- **Test scenarios:** Static test confirms canonical nav uses `/dashboard/prospecting` and `/dashboard/signals`; static test confirms action revalidation covers those paths.
- **Verification:** Navigation and form redirects use active product language without breaking old routes.

### U2. Retire Content and AEO Routes

- **Goal:** Make retired product surfaces redirect to Campaigns.
- **Requirements:** R2, R6.
- **Dependencies:** None.
- **Files:** `app/dashboard/content/page.tsx`, `app/dashboard/aeo/page.tsx`.
- **Approach:** Replace page bodies with App Router `redirect("/dashboard/campaigns")`.
- **Patterns to follow:** `app/dashboard/plays/page.tsx`.
- **Test scenarios:** Static test confirms both retired pages contain the Campaigns redirect.
- **Verification:** Visiting either retired route lands on Campaigns.

### U3. Reshape Brief Around the Operating Loop

- **Goal:** Make the first authenticated surface read as the daily GTM operating loop.
- **Requirements:** R3, R4, R5, R6.
- **Dependencies:** U1.
- **Files:** `app/dashboard/page.tsx`, `app/globals.css`.
- **Approach:** Add server-side state for pending approvals, channel health, and recent outcomes; replace disconnected tiles with an ordered loop; add priority actions derived from the existing state.
- **Patterns to follow:** Existing server component data loaders in `app/dashboard/page.tsx`; canvas styling in `app/globals.css`; product language in `PRODUCT.md`.
- **Test scenarios:** Static test confirms Brief includes operating-loop labels and priority-action routes; lint/build confirms the server component compiles.
- **Verification:** Brief communicates who to target, why now, what will send, what needs judgment, and what outcomes taught the system.

### U4. Protect the Product-Surface Contract

- **Goal:** Add focused regression coverage for the pivot.
- **Requirements:** R7, R8.
- **Dependencies:** U1, U2, U3.
- **Files:** `test/product-surface-contract.test.ts`.
- **Approach:** Use Node's test runner to inspect route files and dashboard shell source for canonical IA and retired-route behavior.
- **Patterns to follow:** Existing Node test style under `test/*.test.ts`.
- **Test scenarios:** Canonical nav routes, old active-surface route avoidance in nav, retired route redirects, Brief operating-loop copy.
- **Verification:** `npm test -- test/product-surface-contract.test.ts` passes.

---

## Scope Boundaries

- This slice does not add a new chat route or new "Ask" primitive. Copilot behavior is expressed as Brief priority actions and existing MCP/context/trust surfaces.
- This slice does not add new workflow types. It makes the current Signal-to-email and Signal-to-LinkedIn Plays more legible.
- This slice does not alter migrations, event schemas, or channel adapters.

---

## Sources & Research

- Monaco product page: `https://www.monaco.com/product`
- Architecture source of truth: `ARCHITECTURE.md`
- Active product focus: `docs/product-focus-prospecting-outbound-2026-06-12.md`
- Product/design language: `PRODUCT.md`, `DESIGN.md`
- Existing implementation: `app/dashboard/*`, `core/product/app.ts`, `core/product/qualified-signals.ts`, `core/product/conversation-trust.ts`, `core/agents/eval/gate.ts`, `core/plays/autonomy.ts`
