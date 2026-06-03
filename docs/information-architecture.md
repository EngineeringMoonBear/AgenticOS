# AgenticOS Information Architecture

A living reference for the **dashboard's** information architecture — the global
shell, the five tabs, their components and data sources, and the cross-view
patterns that hold them together. It is kept current with the shipped 5-tab +
vista-shell dashboard, and every section carries a status badge so you can tell
at a glance what is real, what is half-built, and what is only sketched.

> **Status-badge legend**
>
> - **✅ Shipped** — wired to a real data source (Postgres, vault-server,
>   OpenViking, the runs log, or a real config file) and in use.
> - **🚧 WIP** — the component exists but renders placeholder/stub data, is not
>   yet wired to its real source, or is untracked / not-yet-landed.
> - **📋 Planned** — described here but not built (no component, or a button that
>   only fires a "coming in Phase N" toast).

**Out of scope for this doc** (pointers, not duplicated here):

- **Agent runtime, model routing, and the cost-telemetry pipeline** →
  [`docs/plans/spec1-orchestrator.md`](plans/spec1-orchestrator.md). The dashboard
  *displays* cost/health/runs; how runs are routed to models and how cost is
  metered lives there.
- **Memory architecture (vault-server + the inbox write surface)** →
  [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md)
  and
  [`docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md).

**Last verified:** 2026-06-02 against shipped `main`.

---

## 1. Global Shell & Navigation

The shell is mounted once in `app/layout.tsx`: a persistent `SharedHeader`
(`components/shell/SharedHeader.tsx`) wraps every tab, with the `<main>` slot
rendering the active route. The `CommandPalette`, `PaletteHotkey`, and toast
`Toaster` are siblings of `<main>`, so they survive tab navigation.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS                          [Filter: All ▾]  [⌘K]  ⚙            │  SharedHeader row 1
│ Runs 3 │ Architecture 11 │ Cost $2.41 │ Health 2 warn │ Memory 1,652      │  TabBar
└──────────────────────────────────────────────────────────────────────────┘
   (per-tab Vista hero renders below, inside the routed page)
```

### Header row — brand, filter, palette, settings · ✅ Shipped

`SharedHeader` renders a left-anchored brand mark (`LanternMushroom`, links to
`/`) and a right-anchored utility cluster: the **FilterChip**, the **⌘K palette
trigger**, and a **settings cog** linking to `/settings`. Status chips that used
to live here have moved out to the (still-unlanded) KpiVista banner; the header
itself is shipped and stable.

### TabBar — five tabs · ✅ Shipped (nav) / 🚧 WIP (count badges)

`components/shell/TabBar.tsx` is the real navigation. Five tabs, each a real
Next.js `<Link>`, active state derived from `usePathname()`:

| Tab | Route | Count badge |
|---|---|---|
| Runs | `/runs` | `3` |
| Architecture | `/architecture` | `11` |
| Cost | `/cost` | `$2.41` |
| Health | `/health` | `2 warn` |
| Memory | `/memory` | `1,652` |

- **Navigation is ✅ Shipped** — links and active-tab highlighting work.
- **Count badges are 🚧 WIP** — every count is a hardcoded string in the `TABS`
  array (`count: "3"`, etc.), annotated in-code as "Phase 3.5.3 — wired to live
  data in Task 3.5.4." They are not yet reading live data.

### Mobile tab dropdown · ✅ Shipped (PR #126)

The same `TabBar.tsx` ships the responsive behavior: at `<768px` the horizontal
tab row is replaced by a dropdown selector that shows the active tab and expands
to a popover list (closes on outside-click and `Esc`). This is the shipped
mobile nav — note it lives in `shell/TabBar.tsx`, **not** the orphaned
`components/layout/header-tabs.tsx` (an old, untracked 3-tab nav — see the
Legacy appendix).

### KpiVista persistent banner · 🚧 WIP (untracked, not yet mounted)

`components/shell/KpiVista.tsx` is the intended "dusk navigator's console" — a
persistent banner above every tab with four readings (today's spend, active
runs, vault files, memories indexed), gold horizon rules, an `EkgSweep`
background, and a live-data indicator. It is **🚧 WIP** for three independent
reasons:

- It is **untracked** (`git ls-files components/shell/KpiVista.tsx` → empty);
  `EkgSweep.tsx`, `CostBurnChip.tsx`, and `MaxQuotaChip.tsx` are likewise
  untracked.
- It is **not mounted** — `app/layout.tsx` renders `SharedHeader` but not
  `KpiVista`. The header comment "those moved to KpiVista" describes the intent,
  not the wiring.
- Its data hook `lib/hooks/use-kpi-data.ts` is a **stub** — `queryFn` returns
  hardcoded mockup values (`todaySpend: { cents: 241 }`, etc.) with an explicit
  `TODO(v2): wire these to real endpoints`.

### Per-tab Vista hero — `VistaShell` · ✅ Shipped (chrome) / mixed data

Every tab renders its own hero at the top via `components/shell/VistaShell.tsx`:
a dusk-indigo console panel with a tinted accent, a "Live · as of HH:MM:SS"
indicator, gold horizon rules, an animated topic backdrop, and a 4-tile KPI
grid (`KpiTile`). The chrome is shipped; whether a given hero's tiles are real
depends on the tab:

| Vista | Tile data source | Status |
|---|---|---|
| `RunsVista` | `/api/tasks/stats`, `/api/tasks/recent-events`, next-cron (Postgres) | ✅ Shipped |
| `CostVista` | `buildStubBurndown()` — synthetic series | 🚧 WIP |
| `ArchitectureVista` | hardcoded tile literals ("11", "25 +8", …) | 🚧 WIP |
| `HealthVista` | hardcoded tile literals ("4 / 4", "5ms", "99.94%") | 🚧 WIP |
| `MemoryVista` | hardcoded tile literals | 🚧 WIP |

### Global filter chip · ✅ Shipped (persistence) / 🚧 WIP (tag source)

`components/filter/filter-chip.tsx` is a multi-select popover: a tag search
box, tags grouped by Projects / Lanes / Domains, a "Clear all", and a "+ New
tag" affordance.

- **Persistence is ✅ Shipped** — `lib/filter/use-filter.ts` syncs the selection
  to the URL `?filter=` param via `nuqs` (`history: "push"`, `shallow: false`),
  comma-encoded by `lib/filter/codec.ts`. URL is the single source of truth;
  back/forward and deep links restore state. No localStorage.
- **Tag source is 🚧 WIP** — the tag list is a hardcoded `TAGS` array, not
  derived from the vault; **"+ New tag" is disabled** (`title="Available in
  Phase 2"`).

### Command palette (⌘K) · ✅ Shipped (shell) / mixed data

`components/palette/command-palette.tsx` opens via the header trigger or the
`⌘K`/`Ctrl+K` hotkey (`palette-hotkey.tsx`; `Esc` closes). Four groups, with
cmdk fuzzy-matching and auto-hidden empty groups:

| Group | Source | Status |
|---|---|---|
| **Skills** | `SKILL_FIXTURES` (stub); selecting fires a "wires up in Phase 4" toast | 🚧 WIP |
| **Wiki Pages** | `useVaultTree()` → `/api/vault/tree` (real); navigates to `/memory?page=…` | ✅ Shipped |
| **Recent Runs** | `useRunFeed()` → `/api/agent/runs` (real); navigates to a run detail route | ✅ Shipped |
| **Quick Actions** | Open Settings ✅, Clear filter ✅; **Toggle theme** is a "Phase 6" toast 🚧 | mixed |

### Keyboard shortcuts · ✅ Shipped (limited)

Only **`⌘K` / `Ctrl+K`** (toggle palette) and **`Esc`** (close palette) are
actually bound, in `palette-hotkey.tsx`. The wider shortcut map from the old IA
(`⌘1`/`⌘2`/`⌘3` tab jumps, `⌘/`, `⌘F`, `⌘.`) is **📋 Planned** — not implemented.

### Notifications · ✅ Shipped

Toasts via `sonner` (`<Toaster position="bottom-right" />` in the layout).
Components fire `toast.info` / `toast.success` / `toast.error` directly (e.g.
settings save, palette stub actions). There is no notification bell or
tab-badge notification surface today.

## 2. Runs

## 3. Architecture

## 4. Cost

## 5. Health

## 6. Memory

## 7. Cross-View Patterns

## 8. Settings

## 9. Mobile

## 10. ASCII Wireframes

## Appendix: Legacy / Removed
