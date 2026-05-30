# AgenticOS — Brand & Visual Design System Spec

**Product:** AgenticOS
**Brand Owner:** Goldberry Grove
**Primary Mode:** Dark (light mode secondary)
**Stack:** Next.js 15 App Router · TypeScript · Tailwind CSS · shadcn/ui · Radix primitives
**Version:** 1.0 — May 2026

---

## 1. Design Principles

### 1. Patina Over Polish
Every surface has subtle warmth — not sterile, not glossy. Backgrounds are near-black with a brown undertone, not pure dark gray. Cards have a faint inner glow along the top edge (1px `--border-subtle` gradient) to suggest depth, like lacquered wood in candlelight. *Example: `--bg` is `#0f0d0c`, not `#111111`.*

### 2. Silence Enables Signal
Ambient chrome is hushed. The majority of the interface sits in warm grayscale; color only speaks when something meaningful happens — a run is active, approval is needed, an error fires. The plum accent governs identity; gold fires for emphasis. Nothing else adds color. *Example: secondary nav items use `--text-muted`, not a colored icon set.*

### 3. Craft Shows in Density
Information is presented at the density of a craftsperson's logbook — not sparse/consumer, not enterprise-cramped. Cards breathe. Type is legible at a glance. A skilled user can read a RunCard in under two seconds. *Example: RunCard uses a 56px row height in compact mode, 80px in default, never expanding to accommodate decorative whitespace.*

### 4. Controls Have Grain
Interactive elements have perceptible texture — borders that are slightly warm, hover states that shift brightness rather than just color, focus rings that pulse once. The interface should feel like touching something made rather than rendered. *Example: primary button uses a 1px `--accent-plum-400` border on hover rather than a flat fill change.*

### 5. The Machine Is Present, Not Intrusive
AgenticOS is an orchestration tool. The running state — agents doing work — is constant. The interface acknowledges this without dramatizing it. Subtle pulse animations on active runs; no confetti, no modals for routine completions. *Example: a running RunCard has a 2px left stripe in `--lane-hermes` that pulses at 2s intervals, not a full card highlight.*

---

## 2. Color Tokens

### Dark Mode (Primary)

Paste into the `:root` block of `globals.css`. These are the canonical dark-mode tokens.

```css
:root {
  /* ── Surfaces ───────────────────────────────── */
  --bg:                  #0f0d0c;   /* page background — near-black, warm-brown tint */
  --surface:             #1a1714;   /* cards, panels */
  --surface-elevated:    #221e1b;   /* drawers, modals, popovers */
  --surface-muted:       #141210;   /* inset zones, code blocks, recessed areas */

  /* ── Borders ────────────────────────────────── */
  --border:              #2e2925;   /* standard card border */
  --border-subtle:       #201d1a;   /* hairline separators, dividers */
  --border-strong:       #453e38;   /* focused inputs, emphasized edges */

  /* ── Text ───────────────────────────────────── */
  --text:                #f0ebe4;   /* primary readable text */
  --text-secondary:      #b5aa9e;   /* supporting copy, metadata */
  --text-muted:          #6b6157;   /* timestamps, placeholders, disabled */
  --text-inverse:        #0f0d0c;   /* text on light/gold surfaces */

  /* ── Accent: Plum ───────────────────────────── */
  /* ★ Canonical brand plum: --accent-plum-400 (#8b5cf6 shifted warm) = #7c5cbf */
  --accent-plum-50:      #f3f0fb;
  --accent-plum-100:     #e3dcf6;
  --accent-plum-200:     #c8baed;
  --accent-plum-300:     #a990df;
  --accent-plum-400:     #8c6bce;   /* ★ CANONICAL BRAND PLUM — logo / header mark */
  --accent-plum-500:     #7452b8;
  --accent-plum-600:     #5e3e9a;
  --accent-plum-700:     #4a2f7d;
  --accent-plum-800:     #362063;
  --accent-plum-900:     #25144a;
  --accent-plum-950:     #160b30;

  /* ── Accent: Gold ───────────────────────────── */
  /* ★ Canonical brand gold: --accent-gold-400 = #c9a227 */
  --accent-gold-50:      #fdfbf0;
  --accent-gold-100:     #f9f3d0;
  --accent-gold-200:     #f2e49f;
  --accent-gold-300:     #e6ce6a;
  --accent-gold-400:     #c9a227;   /* ★ CANONICAL BRAND GOLD — active CTA, highlights */
  --accent-gold-500:     #a8831a;
  --accent-gold-600:     #876411;
  --accent-gold-700:     #66490c;
  --accent-gold-800:     #4a3208;
  --accent-gold-900:     #2e1e04;
  --accent-gold-950:     #1a1002;

  /* ── Semantic ───────────────────────────────── */
  --success:             #4ade80;
  --success-bg:          #0d2218;
  --success-border:      #1a4a2e;

  --warning:             #fbbf24;
  --warning-bg:          #221800;
  --warning-border:      #4a3500;

  --error:               #f87171;
  --error-bg:            #2a0f0f;
  --error-border:        #5a1e1e;

  --info:                #60a5fa;
  --info-bg:             #0d1a2e;
  --info-border:         #1a3358;

  /* ── Lane Accents ───────────────────────────── */
  --lane-hermes:         #4db6ac;   /* autonomous agents — teal, no plum/gold conflict */
  --lane-sandcastle:     #7986cb;   /* code agents — slate-indigo, distinct from plum */

  /* ── Motion (defined here for global access) ── */
  --motion-instant:      80ms;
  --motion-fast:         140ms;
  --motion-base:         240ms;
  --motion-slow:         400ms;

  --ease-standard:       cubic-bezier(0.4, 0.0, 0.2, 1);
  --ease-emphasized:     cubic-bezier(0.2, 0.0, 0.0, 1.0);
  --ease-decelerate:     cubic-bezier(0.0, 0.0, 0.2, 1);
}
```

### Light Mode (Override)

Applied via `.light` class on `<html>`. Only override — no scales repeated.

```css
.light {
  --bg:                  #f7f4f0;
  --surface:             #ffffff;
  --surface-elevated:    #f0ece6;
  --surface-muted:       #e8e3dc;

  --border:              #d6cfc6;
  --border-subtle:       #e8e2da;
  --border-strong:       #b5a898;

  --text:                #1a1512;
  --text-secondary:      #5c5148;
  --text-muted:          #9e9088;
  --text-inverse:        #f0ebe4;

  /* plum and gold anchor at same hex; scale not repeated */
  --success-bg:          #e8f9ef;
  --success-border:      #b8e8cb;
  --warning-bg:          #fef9e6;
  --warning-border:      #f0d678;
  --error-bg:            #fef0f0;
  --error-border:        #f8c4c4;
  --info-bg:             #eef5ff;
  --info-border:         #b8d4f8;
}
```

---

## 3. Typography

### Font Stack Decision

**UI sans: Inter** — the engineered neutral that disappears at small sizes. Its optical metrics at 13–14px (label, body-sm) are unmatched among free sans-serifs. It's already the shadcn default; no friction.

**Mono: JetBrains Mono** — slightly wider apertures than JetBrains' peers, ligatures disabled by default, designed for dense code display. Use for `code-inline`, `code-block`, model badges, cost figures, and duration timestamps.

**Serif accent: Lora (Google Fonts)** — used exclusively in WikiCard body snippets and the Memory inbox reading view. Lora's calligraphic warmth reinforces the hand-bound-notebook feeling without being decorative. Nowhere else.

```css
--font-sans:  'Inter', 'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono:  'JetBrains Mono', 'JetBrains Mono Variable', ui-monospace, 'Cascadia Code',
               'Fira Code', Menlo, monospace;
--font-serif: 'Lora', 'Lora Variable', Georgia, 'Times New Roman', serif;
```

### Type Scale

| Token        | px   | rem    | Line-height | Weight | Tracking         |
|--------------|------|--------|-------------|--------|------------------|
| `display`    | 36   | 2.25   | 1.1         | 500    | −0.03em          |
| `h1`         | 28   | 1.75   | 1.2         | 500    | −0.02em          |
| `h2`         | 22   | 1.375  | 1.25        | 500    | −0.01em          |
| `h3`         | 18   | 1.125  | 1.3         | 500    | 0                |
| `title`      | 15   | 0.9375 | 1.35        | 600    | 0                |
| `body-lg`    | 16   | 1.0    | 1.6         | 400    | 0                |
| `body`       | 14   | 0.875  | 1.55        | 400    | 0                |
| `body-sm`    | 13   | 0.8125 | 1.5         | 400    | 0                |
| `label`      | 12   | 0.75   | 1.4         | 500    | +0.04em          |
| `caption`    | 11   | 0.6875 | 1.4         | 400    | +0.02em          |
| `code-inline`| 13   | 0.8125 | 1.5         | 400    | 0 (JetBrains)    |
| `code-block` | 13   | 0.8125 | 1.6         | 400    | 0 (JetBrains)    |

### Uppercase Usage

Uppercase is reserved for exactly three contexts:

1. **Section labels / nav group headers** — e.g., "ARCHITECTURE", "MEMORY", "OBSERVABILITY" in the sidebar. Set in `label` token, +0.08em tracking.
2. **Status pills** — "RUNNING", "FAILED", "AWAITING APPROVAL". `caption` token, +0.06em tracking.
3. **Lane badges** — "HERMES", "SANDCASTLE". `caption` token, +0.06em tracking.

Everywhere else: sentence case. No uppercase buttons. No uppercase headings.

---

## 4. Spacing & Sizing

### Spacing Scale

Extend Tailwind's defaults — do not replace. Add the following custom values in `tailwind.config.ts` under `theme.extend.spacing`:

```
0.5 → 2px    (hairline gap, icon-to-text)
18  → 72px   (card header height)
22  → 88px   (sidebar collapsed icon zone)
```

The base-4 scale (4, 8, 12, 16, 24, 32, 40, 48, 64) covers the rest.

### Border Radius Scale

| Token           | Value  | Use                                      |
|-----------------|--------|------------------------------------------|
| `rounded-sm`    | 4px    | badges, chips, status pills              |
| `rounded-md`    | 6px    | inputs, buttons, small controls          |
| `rounded-lg`    | 10px   | **canonical card radius**                |
| `rounded-xl`    | 14px   | drawers, modals (inner content area)     |
| `rounded-full`  | 9999px | avatars, toggle switches                 |

**Canonical card radius: 10px (`rounded-lg`).** All three card variants use this.

### Border Widths

| Use                         | Width |
|-----------------------------|-------|
| Standard card / panel       | 1px   |
| Focused input / active card | 1px   |
| Left lane stripe (RunCard)  | 2px   |
| Dividers / separators       | 1px   |

No 2px borders except the lane indicator stripe.

### Standard Control Heights

| Control       | Height |
|---------------|--------|
| Input (sm)    | 32px   |
| Input (md)    | 36px   |
| Button (sm)   | 28px   |
| Button (md)   | 36px   |
| Button (lg)   | 44px   |
| Chip / Badge  | 22px   |
| Card header   | 48px   |
| Tab bar       | 40px   |
| Command input | 48px   |

---

## 5. Motion

Duration and easing tokens are declared in the color section above. Usage rules follow.

| Interaction                     | Duration          | Easing              |
|---------------------------------|-------------------|---------------------|
| Hover color/brightness shift    | `--motion-fast`   | `--ease-standard`   |
| Focus ring appear               | `--motion-instant`| `--ease-standard`   |
| Tooltip show/hide               | `--motion-fast`   | `--ease-decelerate` |
| Dropdown open                   | `--motion-base`   | `--ease-decelerate` |
| Drawer enter                    | `--motion-base`   | `--ease-decelerate` |
| Drawer exit                     | `--motion-fast`   | `--ease-emphasized` |
| List reorder (drag-and-drop)    | `--motion-base`   | `--ease-standard`   |
| Skeleton pulse                  | `2s` infinite     | `ease-in-out`       |
| Lane stripe pulse (active run)  | `2s` infinite     | `ease-in-out`       |
| Toast enter                     | `--motion-base`   | `--ease-decelerate` |
| Toast exit                      | `--motion-fast`   | `--ease-emphasized` |
| Page-level route transition     | none              | —                   |

**Do not animate:** Transform scale (no pop/bounce), spring physics (no overshoot), staggered cascades on card grids, progress bars on quick operations (<500ms). This is a tool, not a demo reel. If motion isn't communicating state change or directing attention, it's decoration — omit it.

---

## 6. Iconography

**Library: Lucide** (the shadcn-aligned set). Stroke-based, consistent 24-unit grid.

### Size Scale

| Token | px  | stroke-width | Use context                        |
|-------|-----|--------------|------------------------------------|
| `xs`  | 12  | 1.5          | inline with caption text, badges   |
| `sm`  | 16  | 1.5          | sidebar nav items, table cells     |
| `md`  | 20  | 1.75         | card icons, toolbar actions        |
| `lg`  | 24  | 2.0          | empty state illustrations, headers |

Always use the `sm` size (16px, stroke 1.5) in dense UI. Default stroke-width of 2 reads too heavy at 16px against dark backgrounds.

### Canonical AgenticOS Icon Assignments

| Surface / Concept         | Lucide Icon       | Notes                                              |
|---------------------------|-------------------|----------------------------------------------------|
| Architecture view         | `Boxes`           | Top nav, sidebar label                             |
| Memory / Wiki             | `Library`         | Sidebar; also used in WikiCard source badge        |
| Observability / Runs      | `Activity`        | Sidebar; evokes a waveform / logbook               |
| Hermes lane (autonomous)  | `RefreshCw`       | Left stripe icon in RunCard; implies loop          |
| Sandcastle lane (code)    | `Container`       | Left stripe icon in RunCard; implies sandbox       |
| Dispatch action           | `Send`            | Primary SkillCard CTA icon                        |
| Awaiting Approval status  | `CirclePause`     | Status pill icon; not a warning triangle           |
| Settings / Config         | `SlidersHorizontal` | Not a gear — more precise, craft-like            |
| Command palette trigger   | `Command`         | Kbd hint display                                   |

---

## 7. The Card System

All cards share: `--surface` background, 1px `--border` edge, `rounded-lg` (10px), default padding `16px`, hover state `--surface-elevated` background + `--border-strong` edge, transition `background-color var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard)`.

---

### 7.1 SkillCard — Architecture View

**When to use:** Grid layout, Architecture tab. One per registered skill/workflow. Default density.

**Anatomy:**

```
┌──────────────────────────────────────────────────────┐
│  [icon 20px]  Skill Name                  [⋯ kebab]  │  ← header 48px; --text title token
│  Short description, 1–2 lines max.                   │  ← --text-secondary body-sm
│                                                       │
│  [tag] [tag] [tag]                                    │  ← chips, rounded-sm, --surface-muted bg
│                                                       │
│  Last run: 4h ago        Success: 94%  [sparkline——] │  ← --text-muted caption; sparkline 48×16px
│─────────────────────────────────────────────────────│
│  [Dispatch ↗]                                        │  ← primary button, gold outline variant
└──────────────────────────────────────────────────────┘
```

- **Surface:** `--surface`
- **Header background:** `--surface` (no separate zone)
- **Footer separator:** 1px `--border-subtle`
- **Hover:** `--surface-elevated` bg + `--border-strong` border
- **Active (running):** top edge 2px `--accent-plum-400` highlight (not full card shift)
- **Dispatch button:** `variant="outline"`, border `--accent-gold-400`, text `--accent-gold-400`. On hover: filled `--accent-gold-400`, text `--text-inverse`.
- **Kebab:** visible on card hover only (`opacity: 0` → `opacity: 1` on hover)
- **Sparkline:** 48×16px, line color `--success` for healthy, `--error` for degraded
- **Density:** Fixed card height is not enforced; description wraps; minimum card height 160px.

---

### 7.2 RunCard — Observability Feed

**When to use:** Observability tab, chronological feed. Dense rows. Two density modes: default (80px) and compact (56px — toggled by user preference).

**Anatomy (default):**

```
┌─┬──────────────────────────────────────────────────────┐
│ │  [icon 16] Skill Name / Run Title        [RUNNING]   │  ← title token; status pill right
│▌│  project-slug                [hermes]  2m 14s  $0.03 │  ← --text-muted caption; lane badge
│ │                                           [Cancel ×]  │  ← right-aligned action
└─┴──────────────────────────────────────────────────────┘
  ▲
  2px left stripe in lane color (--lane-hermes or --lane-sandcastle)
  Pulses opacity 1.0→0.5 at 2s if status = RUNNING
```

**Anatomy (compact — 56px):**

```
┌─┬────────────────────────────────────────────────────┐
│▌│  [icon] Run Title             [DONE] 4m 02s  $0.07 │
└─┴────────────────────────────────────────────────────┘
```

- **Surface:** `--surface`
- **Lane stripe:** 2px left border, color `--lane-hermes` or `--lane-sandcastle`
- **Status pills:**
  - RUNNING → background `--info-bg`, border `--info-border`, text `--info`
  - DONE → background `--success-bg`, border `--success-border`, text `--success`
  - FAILED → background `--error-bg`, border `--error-border`, text `--error`
  - AWAITING APPROVAL → background `--warning-bg`, border `--warning-border`, text `--warning`
- **Model badge:** `code-inline` font, `--surface-muted` bg, `--text-muted` text — e.g., `gpt-5-codex` or `qwen2.5:3b`
- **Primary action:** appears on row hover (`[View]`, `[Cancel]`, or `[Approve]`). Approve uses `--accent-gold-400` outlined.
- **Hover:** row bg shifts to `--surface-elevated`

---

### 7.3 WikiCard — Memory Inbox & Search

**When to use:** Memory tab, both inbox queue and search results. Two variants: **Inbox** (promote/discard actions visible) and **Archived** (read-only with source badge).

**Anatomy (Inbox variant):**

```
┌──────────────────────────────────────────────────────┐
│  Note Title or Auto-extracted Heading      [inbox ●] │  ← source badge: inbox dot in --warning
│                                                       │
│  Snippet of content up to three lines, truncated     │  ← Lora serif, body-sm, --text-secondary
│  with ellipsis after the third line at max.          │
│                                                       │
│  [tag] [tag]                    Promote ↑  Discard × │  ← actions right-aligned, text buttons
└──────────────────────────────────────────────────────┘
```

**Anatomy (Archived / Search variant):**

```
┌──────────────────────────────────────────────────────┐
│  Note Title                               [wiki 📖]  │  ← source: wiki / sources
│                                                       │
│  Snippet text in Lora serif, 2 lines max.            │
│                                                       │
│  [tag] [tag]                          Last edited 3d │  ← --text-muted caption
└──────────────────────────────────────────────────────┘
```

- **Surface:** `--surface`
- **Snippet text:** `font-serif` (Lora), `body-sm`, `--text-secondary`
- **Source badges:**
  - `inbox` → `--warning-bg` bg, `--warning` dot
  - `wiki` → `--surface-muted` bg, `--text-muted` text
  - `sources` → `--info-bg` bg, `--info` text
- **Promote action:** text button, `--accent-plum-400` color. On hover: `--accent-plum-300`.
- **Discard action:** text button, `--text-muted`. On hover: `--error`.
- **Hover:** `--surface-elevated` bg + `--border-strong`
- **Density:** Variable height; minimum 96px.

---

## 8. Layout Primitives

| Element                  | Value                                      |
|--------------------------|--------------------------------------------|
| Header height            | 56px                                       |
| Sidebar — collapsed      | 56px (icons only)                          |
| Sidebar — expanded       | 220px                                      |
| Content max-width        | Full-bleed within content zone; no max-width cap |
| Page gutter (horizontal) | 24px (desktop), 16px (mobile — read-only) |
| Page padding (vertical)  | 24px top, 16px bottom                      |
| Card grid gap            | 16px                                       |
| Detail drawer width      | 480px                                      |
| Command palette width    | 640px, max-height 480px                    |
| Command palette position | Centered, 15vh from top                    |
| Breakpoints              | sm: 640px / md: 1024px / lg: 1280px       |

**Mobile stance:** Mobile breakpoints below `md` are read-only. No edit actions, no dispatch, no drawer. Sidebar collapses to bottom tab bar with 4 icons. This is not a mobile-first build.

---

## 9. Component Primitives Inventory

| Our Name          | shadcn/ui Primitive     | Customizations Needed                                                                 |
|-------------------|-------------------------|--------------------------------------------------------------------------------------|
| `Button` (sm/md/lg) | `Button`              | 3 size variants via `size` prop; 4 variants: `default` (plum filled), `outline` (plum border), `gold` (gold border/fill on hover), `ghost` (no border) |
| `Badge`           | `Badge`                 | Inherit semantic color tokens; uppercase caption font; `xs` Lucide icon slot          |
| `FilterChip`      | `Toggle` (multi)        | Multi-select; `--surface-muted` default, `--accent-plum-800` bg + `--accent-plum-300` text + `--accent-plum-600` border when selected; no icon by default; horizontal scroll on overflow |
| `SkillCard`       | `Card`                  | Custom anatomy per §7.1; sparkline slot; footer action zone                          |
| `RunCard`         | `Card`                  | Lane stripe via `border-left`; lane + status prop; dual-density modes                |
| `WikiCard`        | `Card`                  | Lora serif snippet; variant prop (inbox/archived); source badge slot                 |
| `Drawer`          | `Sheet` (right)         | Width 480px; `--surface-elevated` bg; close button top-right                        |
| `CommandPalette`  | `CommandDialog`         | 640×480px max; JetBrains Mono input; result groups with `label` uppercase headers    |
| `Tabs`            | `Tabs`                  | Underline variant (2px active bottom border in `--accent-plum-400`); `body` font; 40px height |
| `Input`           | `Input`                 | 36px default, 32px sm; `--border` default, `--border-strong` focus; `--surface-muted` bg |
| `Select`          | `Select`                | Same surface/border treatment as Input; dropdown uses `--surface-elevated`           |
| `SidebarTree`     | `Accordion` or custom   | Collapsible project tree; `sm` Lucide icons; indented children 16px                  |
| `Toast`           | `Sonner` (shadcn)       | 4 variants map to semantic tokens; position bottom-right; no auto-dismiss on error   |
| `Tooltip`         | `Tooltip`               | `--surface-elevated` bg; `body-sm` font; max 240px width; `--motion-fast` delay     |
| `Skeleton`        | `Skeleton`              | `--surface-muted` base, `--surface` shimmer; `border-radius` matches target element  |
| `Spinner`         | Custom SVG              | 20px, stroke `--accent-plum-400`; 1s linear infinite rotation; no shadcn equivalent  |
| `EmptyState`      | Custom                  | Centered: illustration slot (48px Lucide `lg` icon in `--text-muted`), `h3` title, `body-sm` description, optional CTA button |
| `ErrorBoundary`   | Custom                  | `--error-bg` card; `CircleX` icon `lg`; title + message + "Try again" ghost button   |
| `Avatar`          | `Avatar`                | `rounded-full`; fallback: 2-char initials, `--accent-plum-700` bg, `--accent-plum-200` text |
| `Kbd`             | Custom `<kbd>`          | `--surface-muted` bg; `--border` border; `code-inline` font; 1px border; `rounded-sm` |
| `StatusPill`      | `Badge` (variant)       | Uppercase caption; semantic bg/border/text per §7.2 status map                       |
| `ModelBadge`      | `Badge` (variant)       | JetBrains Mono; `--surface-muted` bg; `--text-muted` text; `body-sm` size            |

**FilterChip specifics (global filter bar):** Horizontal scrolling row pinned below the tab bar. Chips are 22px tall, `rounded-sm`, multi-select. Active chips use `--accent-plum-800` background, `--accent-plum-300` text, `--accent-plum-600` border — no filled-solid plum (too heavy). A clear-all ghost link appears at far right when any chip is active.

---

## 10. Brand Voice in UI Copy

### Rules

1. **Dispatch, not Run.** The primary action on a SkillCard is "Dispatch". Use "run" only as a noun (a run record, run history).
2. **Skill, not Action or Workflow.** A registered capability is a Skill. Use "workflow" only in documentation, never in UI labels.
3. **Memory, not Notes.** The wiki/knowledge system is Memory. Individual items are Notes (lowercase, as common noun).
4. **Title-case for headings, sentence-case for everything else.** "Architecture", "Memory Inbox" — title case. Button labels, descriptions, tooltips, error messages — sentence case.
5. **Concrete counts, not vague qualifiers.** "4 skills" not "several skills". "14m 32s" not "about 15 minutes". "Failed — 3 errors" not "Some errors occurred".
6. **Approvals are explicit.** The awaiting-approval state copy is "Awaiting your approval" — never "Pending" or "On hold". The action is "Approve" not "Continue" or "Allow".
7. **Cost is visible, never hidden.** Show `$0.04` on every RunCard. No opt-in. Transparency is a brand value.
8. **Confirmations are factual, not cheerful.** After dispatch: "Dispatched." (past tense, period). Not "Great! Your skill is running!" or "Success!".

### Empty State Copy Guidelines

**Formula:** One factual sentence describing what goes here. One action sentence with the CTA.

- Architecture (no skills): `No skills registered yet. Add your first skill to start orchestrating.`
- Observability (no runs): `No runs in this project. Dispatch a skill from Architecture to see activity here.`
- Memory (inbox empty): `Inbox is clear. Promoted notes appear in your wiki.`

No illustrations of robots. No celebratory language. Use a single `lg` Lucide icon in `--text-muted`.

### Error Copy Guidelines

**Formula:** What happened (specific). What to do (actionable). Never "Something went wrong."

- Dispatch failed: `Dispatch failed — the model returned an error. Check the run log for details, then try again.`
- Auth expired: `Session expired. Sign in again to continue.`
- Network: `AgenticOS can't reach the local agent process. Check that the daemon is running on port 3001.`

### Voice Cheat Sheet

| ❌ Wrong                     | ✅ Right                         |
|------------------------------|----------------------------------|
| Run the action               | Dispatch the skill               |
| Something went wrong         | Dispatch failed — model timeout  |
| Your workflow is pending     | Awaiting your approval           |
| Successfully completed!      | Done.                            |
| Notes / Knowledge base       | Memory                           |
| Several tasks                | 7 skills                         |
| Processing…                  | Running — 2m 14s                 |
| Add Action                   | Register Skill                   |
| Are you sure?                | Delete "Scout Web" — no undo.    |
| Great job!                   | (say nothing)                    |

---

## 11. Logo & Header Mark

### Wordmark Direction

**Letterform:** "AgenticOS" set in Inter Display, weight 500 (Medium). The "A" is unmodified — no ligature trickery. The distinction lives in the "O" at the end of "AgenticOS".

**The O Treatment:** The final "O" is replaced by a custom glyph: a thin open ring (stroke only, matching the Inter "O" weight and cap-height exactly) with a small filled circle — 18% of the ring's inner diameter — positioned at the 2-o'clock position within the ring interior. The ring stroke color is `--accent-plum-400` (#8c6bce). The inner dot is `--accent-gold-400` (#c9a227). The rest of the wordmark is `--text` (#f0ebe4) on dark, or `#1a1512` on light.

This reads as: conductor, orbit, seed. It references the orchestration metaphor (the O as a dial or ring terminal) without being literal about AI.

**Sizing:** The wordmark appears at 22px (`body-lg` scale) in the header. The header mark is the wordmark only — no separate logomark in Phase 1. At 22px, the custom O is legible but not precious.

**Favicon / single-glyph fallback:** Use 🌿 (seedling/fern). It's the Goldberry Grove botanical emblem, already in use, and reads well at 16–32px. It does not conflict with the plum/gold palette because emoji are rendered in context. Alternative if emoji is not appropriate for the app context: a 16×16 SVG of the ring+dot mark in plum and gold on `--bg`.

**Header layout:** `[🌿 wordmark] ··· [global search] [cmd K kbd] [avatar]` — left to right. No full top nav. Navigation lives in the sidebar.

---

*End of AgenticOS Brand & Visual Design System Spec v1.0*
