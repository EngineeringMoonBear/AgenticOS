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

The default landing tab and the live-ops surface. It absorbs the "live runs +
schedules + recent activity" content that the old single `/observability` view
used to carry. `app/runs/page.tsx` composes a `RunsVista` hero over a 12-column
grid of panels. Most run/task panels read **Postgres** through `/api/tasks/*`
and `/api/agent/runs`; a couple of supporting panels are still stubbed.

```text
┌──────────────────────────── RunsVista (hero) ───────────────────────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ [ Live runs strip — running tasks, live elapsed ]                         │
│ ┌ Vault ingest ┐  ┌ Live runs ┐  ┌ Scheduled runs ┐                       │
│ ┌ Recent errors ─────────────┐                                            │
│ ┌ Run feed (full history) ──────────────────────────────────────────────┐│
└──────────────────────────────────────────────────────────────────────────┘
```

### RunsVista hero · ✅ Shipped

`components/shell/RunsVista.tsx` over `VistaShell`. Its activity-strip backdrop
and four KPI tiles read real data: `useRecentRunEvents(60)` →
`/api/tasks/recent-events`, `useRunsStats()` → `/api/tasks/stats`, and
`useNextCron()`. Both task routes query Postgres.

### Live runs strip · ✅ Shipped

`components/observability/live-runs-strip.tsx` — `useRunFeed({ status:
"running" })` → `/api/agent/runs`, ticking a live elapsed counter every second.
The run feed source is the `runs.jsonl` log (`AGENTICOS_RUNS_PATH`, default
`/var/log/agenticos/runs.jsonl`); it returns `[]` cleanly when the log is
absent.

### Run feed · ✅ Shipped

`LiveRunFeedSection` (`app/runs/live-run-feed-section.tsx`) wraps
`components/observability/run-feed.tsx`, which calls `useRunFeed({ limit: 50 })`
→ `/api/agent/runs`. The feed renders run cards (agent, status, timing).
**Note:** the section currently passes `filterActive={false}` and empty filter
tags — i.e. the global filter chip does **not** yet shape the run feed (a known
gap, not a regression).

### Live runs panel · ✅ Shipped

`components/observability/LiveRunsPanel.tsx` — `/api/tasks/active` (Postgres),
refetched every 5s. Surfaces currently-running tasks with a live elapsed
counter and a "stuck" heuristic (>5m runtime or >60s without a heartbeat). The
cancel button issues `DELETE /api/tasks/{id}`.

### Recent errors panel · ✅ Shipped

`components/observability/RecentErrorsPanel.tsx` — `/api/tasks/recent-errors`
(Postgres: `SELECT … FROM tasks WHERE status = 'failed' … LIMIT 20`). Each row
has a retry button → `POST /api/tasks/{id}/retry`.

### Scheduled runs panel · 🚧 WIP

`components/observability/ScheduledRunsPanel.tsx` reads `/api/tasks/scheduled`,
but that route returns a **hardcoded** job list (`vault-ingest`, `cost-report`,
`daily-brief`) with a `TODO: wire to real scheduler (crontab / queue)`. The
"trigger now" button posts to a stub endpoint that returns `501`. The intended
real source is the Hermes cron schedule.

### Vault ingest panel · 🚧 WIP

`components/observability/VaultIngestPanel.tsx` reads `/api/ingest/recent`,
which returns **hardcoded** sample ingest runs (`TODO: wire to vault-ingest run
history`). (The sibling `/api/ingest/status` *is* Postgres-backed, but this
panel does not use it.)

### Run detail · ✅ Shipped (route) 

Runs link to a detail route (`/observability/run/{id}` today; the command
palette and panels navigate there). The single-task API `/api/tasks/{id}` is
Postgres-backed. The richer logs/timeline/usage drawer described in the old IA
is not fully built out — treat the multi-tab drawer anatomy as **📋 Planned**.

## 3. Architecture

The skill catalog — "buttonize your workflows." `app/architecture/page.tsx`
renders an `ArchitectureVista` hero, a page header with a "+ New Skill" button,
a domain filter rail, and a responsive grid of `SkillCard`s.

```text
┌─────────────────────── ArchitectureVista (hero) ────────────────────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ Architecture                                              [ + New Skill ] │
│ [All] [Farm] [Software] [Marketing] [Video] [Personal]                    │
│ ┌ SkillCard ┐ ┌ SkillCard ┐ ┌ SkillCard ┐                                 │
│ ┌ SkillCard ┐ ┌ SkillCard ┐ …                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### ArchitectureVista hero · 🚧 WIP

`components/shell/ArchitectureVista.tsx` over `VistaShell`, with a
`SkillGalaxyBackdrop`. All four KPI tiles are **hardcoded literals**
("11 registered skills", "25 dispatched today", "Farm (5) top domain", …) — no
data hook. 🚧.

### Skill catalog (SkillCard grid) · 🚧 WIP

The grid maps over `SKILL_FIXTURES` (`lib/fixtures/skills.ts`), **not**
`/api/vault/skills`. So although a real, vault-server-backed skills endpoint
exists (and the **Memory** tab's Skills panel uses it — see §6), the
Architecture grid still renders static fixture data. Each `SkillCard` shows
icon/title, description, tags, "Last run · NN% success", and a Run button — but
the **Run button only fires a `toast.info("Dispatching wires up in Phase 4")`**.
So: card rendering 🚧 (fixtures), dispatch 📋 Planned.

> When this grid is repointed at `/api/vault/skills` (the
> `SkillEntry { name, description, triggers, usedBy, path }` shape from
> vault-server's `wiki/Skills`), it becomes ✅.

### Domain filter rail · ✅ Shipped (interaction) / 🚧 WIP (counts)

The `[All] [Farm] [Software] …` rail toggles the global `?filter=` tags via
`useFilter()`, and the grid filters fixtures by tag intersection in-memory —
that interaction works. The rail does not show real per-domain counts (the
fixture set is static).

### Empty state · ✅ Shipped

When the active filter matches no skills, the grid shows a centered "No skills
match this filter" with a "Clear filter" action. The richer "create your first
skill" onboarding empty state from the old IA is **📋 Planned**.

### New Skill creation · 📋 Planned

"+ New Skill" fires `toast.info("Skill creation available in Phase 2")`. The
three-step template/metadata/prompt flow from the old IA is not built.

## 4. Cost

Spend visibility. `app/cost/page.tsx` renders a `CostVista` hero over a grid of
panels: burndown, projection, rate limits, and the two provider panels (OpenAI
Codex, Ollama). The reasoning provider is **`openai-codex`** — the Codex panel
reflects that spend. **Only the burndown reads real cost telemetry today; the
rest are stubbed.** For how cost is actually metered and how runs are routed to
models, see the runtime spec (`docs/plans/spec1-orchestrator.md`) — that
pipeline is out of scope here.

### CostVista hero · 🚧 WIP

`components/shell/CostVista.tsx` uses a `BurndownProjectionBackdrop` driven by
`buildStubBurndown()` — a synthetic in-component series, not real spend. 🚧.

### Cost burndown chart · ✅ Shipped

`components/observability/CostBurndownChart.tsx` → `/api/cost/burndown`, which
runs a real Postgres aggregation over the `calls` table
(`SUM(cost_cents)` bucketed by hour/day for a `24h`/`30d` range). This is the
one Cost panel wired to real telemetry.

### Cost projection panel · 🚧 WIP

`components/observability/CostProjectionPanel.tsx` → `/api/cost/projection`,
which returns **hardcoded** figures (`spend_usd: 47.74`, `cap_usd: 200`, …) with
a `TODO: derive from real spend history + cap config`.

### OpenAI Codex panel · 🚧 WIP

`OpenAICodexPanel.tsx` → `/api/cost/models/openai` — **hardcoded** model usage
rows (`gpt-5-codex`, `gpt-4o-mini`) with a `TODO: wire to real OpenAI usage
telemetry`.

### Ollama panel · 🚧 WIP

`OllamaPanel.tsx` → `/api/cost/models/ollama` — **hardcoded** local-model rows
(`nomic-embed-text`, `qwen2.5:3b`) with a `TODO: wire to real Ollama metrics
endpoint`.

### Rate limits panel · 🚧 WIP

`RateLimitsPanel.tsx` → `/api/cost/rate-limits` — **hardcoded** TPM/RPM lines
with a `TODO: wire to real upstream rate-limit telemetry (OpenAI usage
headers)`.

## 5. Health

## 6. Memory

## 7. Cross-View Patterns

## 8. Settings

## 9. Mobile

## 10. ASCII Wireframes

## Appendix: Legacy / Removed
