# Ploy.ai Design System Audit

## Overview
Ploy.ai is a light-themed, high-contrast marketing automation platform. The aesthetic is clean, confident, and product-forward. It uses a near-monochrome base with vivid brand accents (pink, yellow, green, blue) for energy and differentiation.

## Color Tokens

### Backgrounds
| Token | Light Value | Usage |
|-------|-------------|-------|
| --ploy-background-primary | `#f4f4f4` | Page canvas |
| --ploy-background-secondary | `#ffffff` | Cards, panels, nav |
| --ploy-background-hover | `#2121210a` | Hover states |
| --ploy-background-inverse | `#000000` | Inverse sections |
| --ploy-surface-dark | `#3c3c3c` | Dark overlays |

### Text
| Token | Light Value | Usage |
|-------|-------------|-------|
| --ploy-text-primary | `#212121` | Headlines, body |
| --ploy-text-secondary | `#555555` | Subheadings, descriptions |
| --ploy-text-tertiary | `#21212199` | Meta, captions, placeholders |
| --ploy-text-inverse | `#ffffff` | On dark backgrounds |
| --ploy-text-placeholder | `#21212180` | Input placeholders |
| --ploy-text-faded | `#2121211f` | Disabled, very subtle |

### Borders
| Token | Light Value | Usage |
|-------|-------------|-------|
| --ploy-border-primary | `#e3e3e3` | Cards, dividers |
| --ploy-border-subtle | `#21212114` | Hairlines, separators |
| --ploy-border-inverse | `#00000033` | On dark backgrounds |

### Brand Accents
| Token | Value | Usage |
|-------|-------|-------|
| --ploy-brand-pink | `#ffb8fc` | Illustrations, highlights |
| --ploy-brand-yellow | `#fffa64` | Badges, energy moments |
| --ploy-brand-yellow-warm | `#f4ef4c` | Variants |
| --ploy-brand-green | `#d1f48c` | Success, positive |
| --ploy-brand-green-bright | `#d1f864` | Strong success |
| --ploy-brand-blue | `#c3dbff` | Info, calm |
| --ploy-brand-blue-light | `#e7f1ff` | Subtle info bg |
| --ploy-ink-pink | `#9a0103` | Text on pink bg |
| --ploy-ink-yellow | `#441f16` | Text on yellow bg |
| --ploy-ink-green | `#273416` | Text on green bg |
| --ploy-ink-blue | `#0a0d27` | Text on blue bg |

### Buttons
| Token | Light Value | Usage |
|-------|-------------|-------|
| --ploy-button-primary-background | `#212121` | Primary CTA bg |
| --ploy-button-primary-text | `#ffffff` | Primary CTA text |
| --ploy-button-primary-border | `#000000` | Primary CTA border |
| --ploy-button-secondary-background | `#ffffff` | Secondary CTA bg |
| --ploy-button-secondary-text | `#000000` | Secondary CTA text |
| --ploy-button-secondary-border | `#b3b3b3` | Secondary CTA border |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| --ploy-data-green | `#7cb518` | Charts, metrics |
| --ploy-data-blue | `#5b8def` | Charts, metrics |

### Neutral Scale
| Shade | Value |
|-------|-------|
| 50 | `#fafafa` |
| 100 | `#ededed` |
| 200 | `#d9d9d9` |
| 300 | `#bfbfbf` |
| 400 | `#a3a3a3` |
| 500 | `#838383` |
| 600 | `#636363` |
| 700 | `#444444` |
| 800 | `#282828` |
| 900 | `#121212` |
| 950 | `#000000` |

## Typography

### Font Families
- **Display / Headings**: FK Screamer (bold, condensed, uppercase-friendly) or fallback: Bricolage Grotesque
- **Body / UI**: Geist Variable (clean, modern sans)
- **Mono**: Geist Mono (labels, data)

### Scale
| Role | Size | Weight | Line Height | Tracking |
|------|------|--------|-------------|----------|
| Display | 64-84px | 600 | 1.02 | -0.02em |
| H1 | 42-56px | 600 | 1.08 | -0.01em |
| H2 | 30-36px | 600 | 1.12 | 0 |
| H3 | 20-24px | 600 | 1.25 | 0 |
| Body | 15-16px | 400 | 1.6 | 0 |
| Caption | 13px | 400 | 1.5 | 0 |
| Label / Mono | 11px | 500 | 1 | 0.1em |

## Spacing
- Page gutter: 16px (mobile), 24px (tablet), 40px (desktop)
- Section gap: 64-96px
- Card padding: 24px
- Card radius: 12-16px
- Button radius: 10-12px (not fully pill)
- Button height: 44-48px

## Shadows
- Very subtle, almost flat
- Card: `0 1px 3px rgba(0,0,0,0.04)`
- Elevated: `0 4px 20px rgba(0,0,0,0.06)`

## Components

### Buttons
- **Primary**: `#212121` bg, white text, 10px radius, 44px height, no shadow
- **Secondary**: White bg, `#212121` text, `#e3e3e3` border, 10px radius
- Hover: slight darken or bg shift
- Active: translateY(0.5px)

### Cards / Panels
- White background
- `#e3e3e3` border
- 12-16px radius
- No heavy shadow

### Inputs
- White bg
- `#c4c4c4` border
- 10px radius
- Focus: border darkens to `#212121`

### Navigation
- Fixed top
- White or transparent bg with blur
- Single row, height ~64px
- Links: 13-14px, medium weight

## Layout Principles
- Generous whitespace
- Max content width: 1200-1280px
- Clear hierarchy through size and weight, not color
- One strong accent moment per section
- No gradients on text by default
- Real product screenshots, not div-based mockups
