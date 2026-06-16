---
name: Bombsell
description: Monaco-inspired dark product operating surface for signal-led GTM.
colors:
  canvas: "#070806"
  canvas-soft: "#0d0c09"
  page: "#15130f"
  panel: "#1d1a13"
  panel-strong: "#282319"
  line-soft: "#f7ddb814"
  line-strong: "#f7ddb82b"
  ink: "#f5ead7"
  ink-muted: "#c8bea7"
  ink-subtle: "#918774"
  ink-faint: "#635947"
  accent: "#c9a35b"
  accent-soft: "#2a2114"
  accent-strong: "#f0c66a"
  positive: "#67d19a"
  warning: "#f0c66a"
  negative: "#ff8b78"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Geist, ui-sans-serif, system-ui"
    fontSize: "64px"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "0"
  headline:
    fontFamily: "Bricolage Grotesque, Geist, ui-sans-serif, system-ui"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "0"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "42px"
  panel:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: Bombsell

## 1. Overview

**Creative North Star: "The Signal Operating Surface"**

Bombsell now borrows Monaco's product fluency: dark product proof, numbered progression, crisp screenshots or real product panes, and a clear loop from market definition to outcome learning. It should feel like a composed revenue operating system, not a generic CRM dashboard.

The app still honors Bombsell's architecture. Every surface maps to Rep, Signal, Play, Conversation, or Outcome. UI can present derived views such as Brief, Prospecting, Outreach, and Campaigns, but should not invent new product nouns.

## 2. Visual Language

- Locked dark theme across marketing, onboarding, and dashboard.
- Warm amber is the single action and focus accent.
- Product panes are sharp, bordered, and high contrast.
- Large copy is restrained and operational, not motivational.
- Numbered steps show causal progression only when they describe a real loop.
- Empty and loading states use the same product-pane material as loaded screens.

## 3. Product IA

Primary navigation stays:

- Brief
- Prospecting
- Signals
- Outreach
- Campaigns

Retired Content and AEO surfaces redirect to Campaigns until the product focus changes.

## 4. Component Rules

- Prefer bordered panes, rows, and hairlines over soft floating cards.
- Use 8-12px radius for product panes and 8px for buttons and controls.
- Use amber only for action, focus, and active states.
- Use green, amber, and red only for semantic status.
- Keep labels short. A user scanning headings and numbers should understand the page.
- Never show infrastructure terms unless the user is in a proof, health, or recovery surface.

## 5. Accessibility

The dark theme must meet WCAG AA contrast. Focus states must be visible on all links, buttons, inputs, and selects. Motion must be subtle and safe under reduced-motion preferences.
