# Ploy.ai Design System Audit (v2 — fresh crawl 2026-06-19)

Crawled from `https://www.ploy.ai/_ploy_static/_astro/_slug_.iMQGmD2t.css`. Values quoted verbatim where surfaced.

## Theme structure

Ploy ships **light** + **dark** theme variants. Selector pattern:

- `:root` / `[theme=light]` → light tokens
- `[theme=dark]` → dark tokens

Light is the default. Both share the `--ploy-brand-*` accents.

## Color Tokens (LIGHT)

### Neutrals
| Token | Value |
|-------|-------|
| `--ploy-neutral-primary` | `#fff` |
| `--ploy-neutral-secondary` | `#f7f7f7` |
| `--ploy-neutral-inverse` | `#000` |
| `--ploy-neutral-light` | `#fff` |
| `--ploy-neutral-dark` | `#000` |

### Accent (button + emphasis surfaces)
| Token | Value |
|-------|-------|
| `--ploy-accent-primary` | `#000` |
| `--ploy-accent-secondary` | `#fff` |
| `--ploy-accent-tertiary` | `#000` |

### Backgrounds
| Token | Value | Use |
|-------|-------|-----|
| `--ploy-background-primary` | `#f4f4f4` | Page canvas |
| `--ploy-background-secondary` | `#fff` | Cards, panels, nav pills |
| `--ploy-background-accent-primary` | `#000` | Inverse hero, footer panel |
| `--ploy-background-accent-secondary` | `#fff` | |
| `--ploy-background-accent-tertiary` | `#000` | |
| `--ploy-background-inverse` | `#000` | |
| `--ploy-background-hover` | `#2121210a` | Hover wash |
| `--ploy-surface-dark` | `#3c3c3c` | Dark overlay |

### Text
| Token | Value |
|-------|-------|
| `--ploy-text-primary` | `#212121` |
| `--ploy-text-secondary` | `#555` |
| `--ploy-text-tertiary` | `#21212199` (60% black) |
| `--ploy-text-placeholder` | `#21212180` (50% black) |
| `--ploy-text-faded` | `#2121211f` (12% black) |
| `--ploy-text-inverse` | `#fff` |
| `--ploy-text-inverse-secondary` | `#fff9` (60% white) |
| `--ploy-text-on-accent-primary` | `#fff` |
| `--ploy-text-on-accent-secondary` | `#fff` |
| `--ploy-text-on-accent-tertiary` | `#000` |

### Borders
| Token | Value |
|-------|-------|
| `--ploy-border-primary` | `#e3e3e3` |
| `--ploy-border-subtle` | `#21212114` (8% black) |
| `--ploy-border-inverse` | `#0003` |

### Inputs
| Token | Value |
|-------|-------|
| `--ploy-input-background` | `#fff` |
| `--ploy-input-border` | `#c4c4c4` |

### Buttons
| Token | Value |
|-------|-------|
| `--ploy-button-primary-background` | `#212121` |
| `--ploy-button-primary-text` | `#fff` |
| `--ploy-button-primary-border` | `#000` |
| `--ploy-button-secondary-background` | `#fff` |
| `--ploy-button-secondary-text` | `#000` |
| `--ploy-button-secondary-border` | `#b3b3b3` |

### Brand accents (illustrations, badges)
| Token | Value |
|-------|-------|
| `--ploy-brand-pink` | `#ffb8fc` |
| `--ploy-brand-yellow` | `#fffa64` |
| `--ploy-brand-yellow-warm` | `#f4ef4c` |
| `--ploy-brand-green` | `#d1f48c` |
| `--ploy-brand-green-bright` | `#d1f864` |
| `--ploy-brand-blue` | `#c3dbff` |
| `--ploy-brand-blue-light` | `#e7f1ff` |

### Ink-on-brand (text on brand accent bg)
| Token | Value |
|-------|-------|
| `--ploy-ink-pink` | `#9a0103` |
| `--ploy-ink-yellow` | `#441f16` |
| `--ploy-ink-green` | `#273416` |
| `--ploy-ink-blue` | `#0a0d27` |

### Data viz
| Token | Value |
|-------|-------|
| `--ploy-data-blue` | `#5b8def` |
| `--ploy-data-green` | `#7cb518` |

## Typography

### Families
- `--font-heading: FK Screamer` (display / hero)
- `--font-body: Geist` (body, UI)
- `--font-button: system-ui, sans-serif, -apple-system`
- `--font-eyebrow: system-ui, sans-serif, -apple-system`
- `--font-mono: ui-monospace, monospace`

### Weights
- `--font-weight-normal: 400`
- `--font-weight-medium: 500`
- `--font-weight-semibold: 600`
- `--font-weight-bold: 700`
- `--font-body-weight: 400` / `--font-body-bold-weight: 600`
- `--font-heading-weight: 700` / `--font-heading-bold-weight: 800`
- `--font-button-weight: 500`

### Tracking (letter-spacing)
- `--font-body-letter-spacing: -0.02em` (TIGHT — applies to all body)
- `--font-heading-letter-spacing: -0.02em` (display)
- `--font-button-letter-spacing: normal`
- Component-level overrides: `tracking-[-0.04em]` (giant display), `tracking-[-0.015em]`, `tracking-[-0.01em]`, `tracking-[-0.005em]`, `tracking-[0.04em]`, `tracking-[0.08em]` (eyebrow)

### Line-heights
- `--font-body-line-height: 1.5`
- `--font-heading-line-height: 1.2`
- `--font-button-line-height: 1`
- Component overrides: `leading-[0.86]` (huge display), `leading-[1.08]`, `leading-[1.12]`, `leading-[1.25]`, `leading-[1.4286]`, `leading-[1.4]`, `leading-[1.5]`

### Base scale
- `--font-size-xs: 0.76rem` (~12px)
- `--font-size-sm: 0.875rem` (~14px)
- `--font-size-base: 1rem` (16px)
- `--font-size-lg: 1.125rem` (~18px)
- `--font-size-xl: 1.25rem` (~20px)

### Display ramp (observed in markup)
| Role | Sizes observed |
|------|---------------|
| Mega display | 118px, 144px |
| Display | 64px, 80px, 96px |
| H1 hero | 48px, 52px, 56px, 58px |
| H1 default | 40px, 42px, 44px, 46px |
| H2 | 32px, 34px, 36px |
| H3 | 24px, 26px, 28px, 30px |
| Title | 20px, 22px |
| Body large | 18px, 19px |
| Body | 15px, 16px |
| Caption | 13px, 13.5px, 14px |
| Label/mono | 10px, 10.5px, 11px, 11.5px, 12px |

## Radii (CRITICAL — pill buttons)

| Token | Value |
|-------|-------|
| `--radius` | `0.625rem` (10px — base) |
| `--radius-xs` | `0.125rem` (2px) |
| `--radius-sm` | `0.25rem` (4px) |
| `--radius-md` | `0.375rem` (6px) |
| `--radius-lg` | `0.5rem` (8px) |
| `--radius-button` | **`100rem`** (full pill) |
| `--radius-card` | `0.75rem` (12px) |
| `--radius-input` | `0.375rem` (6px) |

Observed component radii: `2px`, `3px`, `4px`, `5px`, `6px`, `8px`, `10px`, `12px`, `14px`, `16px`, `18px`, `20px`, `22px`, `24px`, `44px`. Footer hero panel uses `20px`. Hero CTA panel uses `pill`. Cards use `12-16px`. Inputs `6px`.

## Spacing

- Base unit: `--spacing: 0.25rem` (4px) — Tailwind v4 default
- Page max widths observed: `1020px` (content), `1400px` (wide rail), `2400px` (edge)
- Smaller content max widths: `258px`, `312px`, `540px`, `567px`, `588px`, `672px`, `986px`
- Mobile clamp: `calc(100vw - 1.5rem)` / `calc(100vw - 3rem)`

## Buttons (concrete)

### Primary CTA (filled)
```
display: inline-flex; justify-content: center; align-items: center;
gap: 6px;
padding: 16px 24px;
border-radius: var(--radius-button); /* 100rem = pill */
background: var(--ploy-button-primary-background); /* #212121 */
color: var(--ploy-background-secondary); /* #fff */
font-family: var(--font-button); /* system-ui */
font-size: 0.875rem;
font-weight: 600;
line-height: 1; /* leading-button */
letter-spacing: -0.01em;
border: none;
transition: transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.2s ease;
```

### Secondary CTA (white on dark hero)
```
background: var(--ploy-background-secondary); /* #fff */
color: var(--ploy-text-primary); /* #212121 */
+ same shape/padding as primary
```

### Outline on dark (hero)
```
background: rgba(255,255,255,0.10);
color: #fff;
ring: 1px inset white;
hover: bg rgba(255,255,255,0.15);
focus-visible: ring-4 rgba(255,255,255,0.5);
active: scale(0.98);
```

### Small inline pill (badge-like CTA)
```
display: inline-flex; gap: 6px;
height: 32px; padding: 0 12px;
border-radius: var(--radius-button); /* pill */
background: var(--ploy-button-primary-background);
color: var(--ploy-brand-pink) | var(--ploy-brand-yellow) | var(--ploy-brand-green-bright) | var(--ploy-brand-blue);
font-size: sm; font-weight: 600;
line-height: 1.4286;
letter-spacing: -0.01em;
```
The brand-colored text on black pill is a signature Ploy move.

### Mobile responsive padding
`max-lg:p-[16px_22px] max-[540px]:p-[14px_18px] max-[360px]:p-[13px_16px]`

## Navigation

- Desktop nav: `h-12` (48px), `rounded-button` (pill), `bg-ploy-background-primary` (#f4f4f4), `pl-[22px] pr-5`, hidden under 960px
- Login button: `h-12`, `bg-ploy-background-secondary` (#fff), `px-6`, sm semibold, `tracking-[-0.01em]`, `hover:bg-white`
- Hidden under 540px

## Hero / footer panel

- Big inverse panel: `bg-ploy-button-primary-background` (#212121 = near-black), `rounded-[20px]`, `p-[48px_32px]`, `gap-11` (44px)
- Mobile collapse: `p-[40px_28px]` (lg), `p-[32px_20px]` (540px)

## Layout & rhythm

- Primary content max-width: 1020px
- Wide rail max-width: 1400px
- Generous vertical rhythm — observed gaps `gap-8` to `gap-11` between major sections inside panels

## Shadows

Shadows are NEARLY absent. Surfaced shadow tokens:
- Kbd: `0 0 0 1px var(--tw-prose-kbd-shadows), 0 3px 0 var(--tw-prose-kbd-shadows)`
- Subtle accent: `0 1px #14141414, inset 0 -1px #1414140f` (1px hairline with inset)
- Most cards use border, not shadow

Ploy is a **flat / hairline** aesthetic. No drop shadow culture.

## Motion

Default transitions:
- Button: `transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.2s ease`
- Nav buttons: `background 0.2s ease, transform 0.2s ease`
- Hover: subtle scale or color shift
- Active: `scale(0.98)` (CTA pill)

## Component patterns

- **Brand-colored chip on black** — primary pill bg with brand-pink/blue/green/yellow text. Energy moment.
- **Pill nav rail** — full-height pill containing nav links, light gray bg
- **Inverse footer panel** — rounded-20px black panel, white text, brand accents
- **No heavy cards** — hairline borders + white bg dominate

## Recap vs v1 doc

What v1 had wrong / partial:
- ✗ Buttons rated as `10-12px radius` → actually **pill (`100rem`)** is the dominant CTA shape, square 10px is rare
- ✗ Body letter-spacing not noted → actually **`-0.02em` body-wide** (tight)
- ✗ Heading family fallback was Bricolage Grotesque → real heading is **FK Screamer** (proprietary). Fall back to `Geist` or `Bricolage` for licensed alt
- ✗ Card radius listed `12-16px` → confirmed **`--radius-card: 12px`** as token; 16-20px reserved for hero/footer panels
- ✗ Input radius unset → **`--radius-input: 6px`** (not 10px)
- ✗ Button font listed `Geist` → real button font is **system-ui** stack, not Geist
- ✗ Shadow `0 1px 3px rgba(0,0,0,0.04)` listed as card → real Ploy cards have **no shadow**, just hairline border
- ✓ Color palette substantially correct
- ✓ Theme is light-default
- ✓ `1200-1280px` max-width → close (real is 1020-1400px)

## Layout Principles (confirmed)

- Generous whitespace
- Hairline borders dominate over shadows
- Brand color appears as one strong moment per section
- Tight letter-spacing across body and headlines (-0.02em)
- Pill CTAs are signature
- Real product UI screenshots inside rounded-20px panels
- Inverse (#212121) sections punctuate the light flow
