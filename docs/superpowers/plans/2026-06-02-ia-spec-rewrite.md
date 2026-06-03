# Information Architecture Doc Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `docs/information-architecture.md` into a living, status-badged, dashboard-IA-only reference that matches the shipped 5-tab + vista-shell dashboard.

**Architecture:** In-place rewrite of one Markdown file, section by section. Each tab/shell section is written ONLY after reading the actual components + their data sources in `apps/dashboard`, so every status badge (✅ Shipped / 🚧 WIP / 📋 Planned) is verified, not assumed. Agent-runtime/model-routing content is dropped (pointer to the runtime spec). Verification is markdownlint + a stale-reference grep + a spec-acceptance read-through.

**Tech Stack:** Markdown; `markdownlint-cli2` (CI check); the doc describes a Next.js 16 dashboard (App Platform) + vault-server/OpenViking backend.

**Spec:** `docs/superpowers/specs/2026-06-02-ia-spec-rewrite-design.md`
**Branch:** `docs/ia-spec-rewrite` (already created; has the committed spec).

**Standing constraints:**
- Commits: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "…"`, message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never push to main; stay on `docs/ia-spec-rewrite`. Docs-only — change **no app code**.
- Do NOT stage the untracked WIP files (KpiVista/CostBurnChip/etc.) or the deleted test fixtures — `git add docs/information-architecture.md` only.
- **Badge accuracy is the core quality bar:** before writing any section, READ the components it covers and their data source (real API route vs hardcoded/stub) and badge accordingly. A panel rendering placeholder data is 🚧, not ✅.
- Status-badge legend: **✅ Shipped** (real data, in use) / **🚧 WIP** (exists but stubbed/untracked/not-landed) / **📋 Planned** (described, not built).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `docs/information-architecture.md` | The rewritten living IA reference (replaces the 787-line stale doc) | all |

The rewrite is one file. Tasks build it top-down; commit after each logical group so progress is reviewable.

---

## Task 1: Skeleton + front matter

**Files:** Modify `docs/information-architecture.md` (replace lines 1–~10 header/banner; lay down section skeleton).

- [ ] **Step 1: Read the current top + banner** — `sed -n '1,12p' docs/information-architecture.md` to see the holding banner being replaced.

- [ ] **Step 2: Write the new front matter**, replacing the title + holding banner with:
  - Title `# AgenticOS Information Architecture`.
  - One-paragraph purpose: living reference for the dashboard's information architecture (navigation, tabs, views, cross-view patterns); updated to the shipped 5-tab + vista-shell reality.
  - **Status-badge legend:** ✅ Shipped / 🚧 WIP / 📋 Planned.
  - **Out-of-scope pointers** (bulleted): agent runtime / model routing / cost-telemetry pipeline → `docs/plans/spec1-orchestrator.md`; Memory architecture → `docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md` + `docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`.
  - A one-line "Last verified: 2026-06-02 against shipped `main`."

- [ ] **Step 3: Lay down the section skeleton** (empty `##` headings to be filled by later tasks): `## 1. Global Shell & Navigation`, `## 2. Runs`, `## 3. Architecture`, `## 4. Cost`, `## 5. Health`, `## 6. Memory`, `## 7. Cross-View Patterns`, `## 8. Settings`, `## 9. Mobile`, `## 10. ASCII Wireframes`, `## Appendix: Legacy / Removed`.

- [ ] **Step 4: Commit** — `git add docs/information-architecture.md && PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "docs(ia): new front matter + skeleton for the IA rewrite\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`.

---

## Task 2: §1 Global Shell & Navigation

**Read first (mandatory):** `apps/dashboard/app/layout.tsx`, `components/shell/SharedHeader.tsx`, `components/shell/TabBar.tsx`, `components/shell/VistaShell.tsx`, `components/shell/KpiVista.tsx` (note: untracked WIP → badge 🚧) + `lib/hooks/use-kpi-data.ts`, `components/layout/header-tabs.tsx` (mobile dropdown, PR #126), `components/filter/filter-chip.tsx` + `lib/filter/use-filter.ts`, `components/layout/palette-trigger.tsx`.

- [ ] **Step 1:** From those files, document: the **persistent KpiVista banner** (its 4 readings + `EkgSweep`; badge **🚧 WIP** — it is untracked/not yet landed, confirm via `git ls-files`), the **TabBar** (5 tabs Runs/Architecture/Cost/Health/Memory with live counts, real `<Link>` nav), the **per-tab Vista hero** pattern (`VistaShell`), the **filter chip** (URL/nuqs-persisted), the **⌘K command palette**, **keyboard shortcuts**, **notifications** (toast), and the **mobile tab dropdown** (✅ Shipped, PR #126). Carry forward still-accurate prose from the old §1 (filter-chip anatomy, palette) corrected to current.

- [ ] **Step 2:** Badge each sub-element. Confirm KpiVista's tracked/untracked status (`git ls-files apps/dashboard/components/shell/KpiVista.tsx` → empty = untracked = 🚧).

- [ ] **Step 3: Commit** (`docs(ia): §1 global shell & navigation`).

---

## Task 3: §2 Runs

**Read first:** `app/runs/page.tsx` and each component it composes — `RunsVista`, `components/observability/live-runs-strip`, `run-feed`, `LiveRunFeedSection`, `LiveRunsPanel`, `ScheduledRunsPanel`, `RecentErrorsPanel`, `VaultIngestPanel` — and trace each to its data source (`/api/tasks/*` → Postgres; schedules → Hermes cron; `/api/tasks/recent-errors`).

- [ ] **Step 1:** Document the Runs tab: RunsVista hero, the live-runs strip, the run feed + run-card/detail anatomy (carry forward the old §4 run-card/detail anatomy, corrected), scheduled runs, recent errors, vault-ingest panel. For each, name the **real data source** and badge status (✅ if wired to Postgres/Hermes; 🚧 if stub).
- [ ] **Step 2:** Note this tab absorbs the old single `/observability` "live runs + schedules" content.
- [ ] **Step 3: Commit** (`docs(ia): §2 Runs tab`).

---

## Task 4: §3 Architecture

**Read first:** `app/architecture/page.tsx`, `ArchitectureVista`, `SkillCard`, and the skills data path (`/api/vault/skills` → vault-server `wiki/Skills`).

- [ ] **Step 1:** Document the Architecture tab: ArchitectureVista hero, the **skill catalog** (SkillCard) sourced from `/api/vault/skills`, skill detail/empty states (carry forward old §2 skill-card/detail anatomy, corrected to the vault-skills source). Badge status. Note any "New Skill creation flow" from the old §2 only if it still exists in code — otherwise mark 📋 Planned or drop.
- [ ] **Step 2: Commit** (`docs(ia): §3 Architecture tab`).

---

## Task 5: §4 Cost

**Read first:** `app/cost/page.tsx`, `CostVista`, `CostBurndownChart`, `CostProjectionPanel`, `OpenAICodexPanel`, `OllamaPanel`, `RateLimitsPanel` + their data sources (cost telemetry in Postgres vs stub).

- [ ] **Step 1:** Document the Cost tab: CostVista hero, burndown + projection charts, provider panels (OpenAI Codex / Ollama), rate-limits. For each, badge ✅/🚧 based on whether it reads real cost telemetry or placeholder data (verify in code). Note the reasoning provider is `openai-codex` (the cost the Codex panel reflects); point to the runtime spec for model/cost-pipeline detail rather than describing routing here.
- [ ] **Step 2: Commit** (`docs(ia): §4 Cost tab`).

---

## Task 6: §5 Health

**Read first:** `app/health/page.tsx`, `HealthVista`, `AgentHealthPanel`, `SystemResourcesPanel`, `BackupsPanel`, `ExternalServicesPanel` + data sources.

- [ ] **Step 1:** Document the Health tab (a tab the old IA didn't have): HealthVista hero + agent health, system resources, backups, external services. Badge each (likely several 🚧 if stub). Name real data sources where wired.
- [ ] **Step 2: Commit** (`docs(ia): §5 Health tab`).

---

## Task 7: §6 Memory

**Read first:** `app/memory/page.tsx`, `MemoryVista`, `components/memory/MemoryTree`, `MemoryReader`, `MemoryRail`, `InboxQueue`, `PromoteReviewDrawer`, `SkillsCatalogPanel`, `RecentVaultChangesPanel` + the `/api/vault/*` routes.

- [ ] **Step 1:** Document the Memory tab with the **two-brain framing** up front (this vault via vault-server :7779 = Memory tab; OpenViking :1933 = separate agent obs, not here). Cover: MemoryVista hero; the three-pane (Tree / Reader / Rail-backlinks+outgoing / InboxQueue); Skills + Recent-Changes summary panels; **inbox model — discard = the one sanctioned dashboard write (archive `inbox/→inbox/archived/`), promote = human-applied in Obsidian (dashboard drafts + `obsidian://` deep link, no server write); cloud writes only `inbox/`, `wiki/` is read-only**; full-text search; graph view; and a "vault vs Obsidian — when to use which" subsection (carry forward the old §3, corrected). Cross-reference the corrective + inbox specs. Badge ✅ where wired.
- [ ] **Step 2:** Ensure NO "promote writes via API route" or OpenViking-premise (CategoryBrowser/AbstractList/DetailView) language remains.
- [ ] **Step 3: Commit** (`docs(ia): §6 Memory tab (two-brain + discard/promote)`).

---

## Task 8: §7 Cross-View Patterns + §8 Settings

**Read first:** `lib/filter/use-filter.ts` (filter persistence), the palette + notification components (re-use Task 2 reads), and `app/settings/page.tsx` (current settings UI).

- [ ] **Step 1: §7 Cross-View Patterns** — filter persistence (URL/nuqs), search semantics, notification consistency, real-time updates (SSE/polling — verify which the app uses), and a **two-brain separation** note (OpenViking feeds Runs/Cost/Health KPIs; the vault is the Memory tab). Carry forward old §5, corrected.
- [ ] **Step 2: §8 Settings (UI surface only)** — document what `app/settings/page.tsx` actually exposes: appearance, vault info, provider status (link to the runtime spec for config), data/backups. **DROP** the old "Hermes Daemon Settings" and "Sandcastle Defaults" subsections entirely. Badge per real UI.
- [ ] **Step 3: Commit** (`docs(ia): §7 cross-view patterns + §8 settings`).

---

## Task 9: §9 Mobile + §10 Wireframes + Legacy appendix; remove banner

**Read first:** `components/layout/header-tabs.tsx` (the shipped mobile tab dropdown, PR #126).

- [ ] **Step 1: §9 Mobile** — the shipped tab dropdown (✅), responsive vista/panels behavior, deferred-for-mobile items (carry forward old §8, corrected).
- [ ] **Step 2: §10 ASCII Wireframes** — redraw the wireframes for the **5-tab + KpiVista + per-tab Vista** shell (replace the old 3-view wireframes). One compact wireframe for the global shell + one representative tab (e.g. Runs) + the Memory three-pane.
- [ ] **Step 3: Appendix — Legacy / Removed** — record: `/observability` route is superseded by Runs/Cost/Health and slated for code deletion (a separate task — NOT removed here); the OpenViking-premise Memory UI (CategoryBrowser/AbstractList/DetailView/RetrievalTrajectoryGraph) was deleted; §7 Model Routing relocated to the runtime spec.
- [ ] **Step 4:** Confirm the holding banner from the original top is gone (replaced by Task 1's front matter).
- [ ] **Step 5: Commit** (`docs(ia): §9 mobile, §10 wireframes, legacy appendix`).

---

## Task 10: Verification + PR

- [ ] **Step 1: Stale-reference grep** — must return NOTHING (each is a failure to fix):

```bash
grep -nE "Hermes Daemon|hermes\.pid|Sandcastle|Honcho|Letta|localhost-only|CategoryBrowser|AbstractList|DetailView|RetrievalTrajectoryGraph|writes via API route|7600|7610|8765" docs/information-architecture.md
```

Expected: no matches (any `/observability` / `OpenViking` mentions must be in the two-brain or legacy-appendix context only — eyeball those).

- [ ] **Step 2: markdownlint** — `npx markdownlint-cli2 docs/information-architecture.md` (or rely on CI). Fix any MD0xx violations (watch MD028 blank-line-in-blockquote on any banners/callouts).

- [ ] **Step 3: Acceptance read-through** — verify against the spec's acceptance criteria: all 5 tabs + shell documented with accurate badges; two-brain + discard/promote stated; §7 dropped with pointer; banner removed; cross-refs resolve; legacy appendix present.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin docs/ia-spec-rewrite
gh pr create --title "docs: rewrite information-architecture.md to current 5-tab reality" --body "Implements docs/superpowers/specs/2026-06-02-ia-spec-rewrite-design.md. Living, status-badged, dashboard-IA-only rewrite matching the shipped 5-tab + vista shell; drops model-routing (pointer to runtime spec); documents /observability as legacy. Retires the holding banner."
```

- [ ] **Step 5: Watch CI** — `gh pr checks <n> --watch`. Only markdownlint is meaningfully exercised by a docs change; the tab-isolation Playwright test was hardened recently (retry-click) and CodeQL meta-check is non-blocking (UNSTABLE is fine). Merge when green.

---

## Verification (whole-plan)

- [ ] `docs/information-architecture.md` documents the 5 shipped tabs + global shell, each badged accurately (verified against code, not assumed).
- [ ] Stale-ref grep (Task 10 Step 1) returns nothing.
- [ ] Two-brain model + inbox discard/promote model are stated correctly; §7 Model Routing removed with a runtime-spec pointer; holding banner gone.
- [ ] markdownlint passes; cross-references resolve; legacy appendix records `/observability` + the removed Viking-premise UI.
