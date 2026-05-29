---
name: Bombsell
description: Calm workspace canvas inspired by Notion pages and Obsidian connected maps.
colors:
  canvas: "#f7f7f4"
  canvas-soft: "#fbfbf8"
  page: "#ffffff"
  sidebar: "#eeeeea"
  surface-muted: "#e5e4de"
  line-soft: "#20201c12"
  line-strong: "#20201c20"
  ink: "#242421"
  ink-muted: "#5f6059"
  ink-subtle: "#85867e"
  ink-faint: "#a8a9a1"
  accent: "#6f5bd5"
  accent-soft: "#eeebff"
  accent-strong: "#5947bd"
  positive: "#2f8f6b"
  warning: "#9a6a15"
  negative: "#c44e44"
typography:
  display:
    fontFamily: "Manrope, Geist, ui-sans-serif, system-ui"
    fontSize: "58px"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "0"
  headline:
    fontFamily: "Manrope, Geist, ui-sans-serif, system-ui"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "0"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui"
    fontSize: "20px"
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
  lg: "14px"
  canvas: "16px"
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
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: Bombsell

## 1. Overview

**Creative North Star: "The Autonomous Canvas"**

Bombsell should feel like a canvas first: one continuous work surface where the user sees only the current brief, review moments, and outcome notes. The inspiration is Notion's simple navigation, Obsidian's freeform connected notes, and whiteboard products that keep chrome floating around the work instead of boxing the work inside dashboard panels.

The product should not feel like analytics software, a CRM table, or an AI control room. The main UI is for thinking and steering. Detail exists, but it sits inside pages, linked cards, and review surfaces rather than shouting from the first screen.

**Key Characteristics:**
- Full-screen neutral canvas with subtle grain and grid across the entire app.
- Floating left rail, not a fixed dashboard sidebar.
- The first authenticated surface is Brief: sparse notes for today's work, recent outcomes, and review needs.
- Connected canvas notes for profile, outreach, content, campaigns, AEO, and outcomes.
- Minimal top-level nouns: Brief, Outreach, Content, Campaigns, AEO, Profile.
- One quiet violet accent for links, focus, and graph connections.

## 2. Colors

The palette is neutral and readable: graphite text, white pages, soft gray canvas, and restrained Obsidian violet.

### Primary
- **Graphite Ink** (#242421): Primary text and command buttons.
- **Quiet Violet** (#6f5bd5): Graph links, focus, active route, and rare emphasis.

### Neutral
- **Workspace Canvas** (#f7f7f4): Main application background.
- **Page White** (#ffffff): Document and panel surfaces.
- **Sidebar Gray** (#eeeeea): Persistent navigation surface.
- **Soft Rule** (#20201c12): Borders and dividers.
- **Muted Ink** (#5f6059): Secondary copy and metadata.

### Status
- **Outcome Green** (#2f8f6b): Healthy, ready, completed.
- **Review Amber** (#9a6a15): Needs setup or review.
- **Exception Red** (#c44e44): Errors and blocked work.

### Named Rules

**The Whole Canvas Rule.** The canvas is the app background, not a card inside the app. Content can float on it, but the surface should feel continuous behind navigation and work.

**The Brief First Rule.** The first screen should feel like a living daily brief, not a report. Reach for counts only when they answer what needs attention.

**The Connection Rule.** Use the violet accent for relationships and focus, not decoration.

## 3. Typography

**Display Font:** Manrope with Geist fallback  
**Body Font:** Geist with system fallback  
**Label/Mono Font:** Geist Mono with SFMono fallback

**Character:** Manrope gives the workspace a composed product voice. Geist keeps page text readable and operational surfaces clean.

### Hierarchy

- **Display** (600, 58px, 1.02): Landing and major workspace statements.
- **Headline** (600, 42px, 1.08): Page titles and primary workspace prompts.
- **Title** (600, 20px, 1.25): Panels and connected cards.
- **Body** (400, 15px, 1.6): Page content, prompts, and review detail.
- **Label** (500, 10px, 0.12em tracking): Short metadata only.

### Named Rules

**The Readable Page Rule.** Top-level workspace text should read like a note, not a dashboard report.

## 4. Elevation

Elevation is subtle. Pages sit on the canvas through hairline borders and soft ambient shadows. The canvas itself is mostly flat, with connection lines and cards creating spatial meaning.

### Shadow Vocabulary

- **Page Rest** (`0 24px 60px -48px rgba(32, 32, 28, 0.3)`): Large page containers and workspace previews.
- **Card Rest** (`0 14px 32px -28px rgba(32, 32, 28, 0.35)`): Connected cards and small panels.

### Named Rules

**The No Floating Dashboard Rule.** Do not turn every module into a lifted card. Use page sections, rows, and canvas cards deliberately.

## 5. Components

Components should feel like workspace objects: pages, rows, cards, command fields, and connected notes.

### Buttons

- **Shape:** 8px radius, not pills by default.
- **Primary:** Graphite ink background, white text, 44px height.
- **Hover / Focus:** Violet background or violet focus border.
- **Secondary / Ghost:** White background, soft rule border.

### Chips

- **Style:** Small pill, neutral fill, muted text.
- **State:** Status chips pair color with text or icon.

### Cards / Containers

- **Corner Style:** 10px for cards, 14px for pages, 16px for canvases.
- **Background:** White page surfaces on a soft canvas.
- **Shadow Strategy:** Ambient and shallow.
- **Border:** Soft graphite hairline.
- **Internal Padding:** 16px for cards, 24px to 32px for pages.

### Inputs / Fields

- **Style:** Soft gray fill, 8px radius, hairline border.
- **Focus:** Violet border.
- **Error / Disabled:** Error states use Exception Red with text.

### Navigation

- **Style:** Notion-like page list in the sidebar.
- **State:** Active page is white with violet icon.
- **Language:** Use outcome-facing nouns: Brief, Outreach, Content, Campaigns, AEO, Profile.

## 6. Do's and Don'ts

Do make the app feel like a workspace the user can think inside.  
Do show autonomy as connected notes and page state, not noisy metrics.  
Do make the whole app feel like a grainy work canvas that calmly moves.  
Do keep the start simple: website, intent, sources, review exceptions.  
Do make details available inside linked pages.

Don't return to neon, dark control-room, CRM table, or report-dashboard UI.  
Don't overuse violet. It marks links, focus, and relationships.  
Don't show five metrics just because they exist.  
Don't make users configure internals before they can describe what they want.
