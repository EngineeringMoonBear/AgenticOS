# Phase 6 — Polish, Brand Realization & Documentation: Design Brief

> **⚠️ STALE (predates 2026-05-20 foundation v2 pivot):** Written assuming Phase 3 was Hermes-shaped and Phases 4-5 had shipped on top of it. The foundation v2 spec ([`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md)) restructured the runtime + memory layer; the predecessors listed here are now v1 (Curator + observability), v2 (multi-agent fleet), and v3+ (domain connectors). The polish concepts (brand realization, doctor script, launchd supervision, animations) carry forward unchanged. **Don't treat predecessor assumptions here as current.**

**Status**: Brainstorming questionnaire (2026-05-18) — stale; predecessor list needs revision against foundation v2 phase numbering
**Owner**: AgenticOS — single-developer (Josh)
**Predecessors required**: v1 + v2 + v3+ shipped (under foundation v2 phase numbering)
**Asana GIDs**: T1 `1214851299671674` · T2 `1214851272872957` · T3 `1214851152171000` · T4 `1214851272793011` · T5 `1214851152133576`

---

## Proposed Approach

Phase 6 is the deliberate "make it real" pass. `docs/brand.md` was written at project inception and referenced by every prior phase, but nothing has been mechanically audited against the canonical token set. Phase 6 closes that gap, adds keyboard shortcuts and the cost dashboard, and ships documentation.

Recommended order: brand audit first (foundational — everything else reads correctly once tokens are consistent), then loading/empty/error states (risk-reduction), then keyboard shortcuts (additive), then cost dashboard (new data route), then README + setup (unblocks external use).

---

## Deferred-Work Catchall

Phase 6 is the explicit deferred-work destination. Known items accumulated across the project:

| Deferred item | Source |
|---|---|
| launchd integration for scheduler | Phase 3 checkpoint, Decision 9 |
| Auto-cancel-stale-runs toggle (UI) | Phase 3 checkpoint, Decision 10 |
| Brand token sweep (full component audit) | Brand spec v1.0 intent vs. implementation gap |
| Loading / empty / error state primitives | Brand spec §9 — `Skeleton`, `EmptyState`, `ErrorBoundary` inventoried but not enforced |
| Keyboard shortcut full set (beyond ⌘K) | IA spec §1 — defined but not implemented |
| Cost dashboard + per-tag budgets | IA spec §7 cost guardrails — model exists, UI absent |
| `vault=vault` literal in `obsidian://open` URIs | Phase 2 design §10 — flagged as "Drift to fix in next IA revision" |
| README + setup script + demo | T5 always deferred as Phase 6 deliverable |

---

## Q1 — Brand Audit Scope

**Question**: Full component sweep, or high-traffic surfaces + shared primitives only?

- A. Full sweep — every component, every token, every hardcoded hex
- B. High-traffic surfaces only (Memory, Observability, Architecture views + cards)
- C. **High-traffic surfaces + shared primitives** (`Button`, `Badge`, `Input`, `Skeleton`, `Toast`, `Kbd`) — leaves bespoke one-off components for opportunistic cleanup
- D. Tooling-first — grep for hardcoded hex, fix mechanically, then spot-check

**RECOMMENDED: C.** A hex grep (D) misses semantic-but-wrong token choices — using `--text` where `--text-muted` is correct, or Tailwind `violet-*` where `--accent-plum-400` (`#8c6bce`) is required per brand spec §2. Option C catches the highest-leverage surfaces without becoming a month-long audit. Audit checklist: all surfaces on `--bg`/`--surface`/`--surface-elevated`/`--surface-muted`; no `text-gray-*`; plum canonical `#8c6bce`, gold canonical `#c9a227`; lane colors only on RunCard left stripe; motion tokens in all transitions; `rounded-lg` (10px) on all cards; JetBrains Mono only for cost/model/duration/code; Lora only for WikiCard snippets (brand spec §3). Include the `vault=vault` URI fix from Phase 2 §10 — one-line find-and-replace.

---

## Q2 — Loading State Primitive

**Question**: Single `<Skeleton>` component, or per-surface bespoke shimmer?

- A. Single `<Skeleton>` (shadcn default, customized per brand spec §9)
- B. Per-surface bespoke shimmer — maximum fidelity, high maintenance
- C. **`<Skeleton>` + `<SkeletonCard variant="skill|run|wiki">` preset wrappers**
- D. `<Skeleton>` only — no variant presets, consumers compose freely

**RECOMMENDED: C.** Brand spec §9 defines `Skeleton` as `--surface-muted` base, `--surface` shimmer, `border-radius` matches target element, `2s infinite ease-in-out` pulse per motion table §5. A bare `<Skeleton>` (D) produces a blank rectangle where a RunCard's lane stripe and sparkline placeholders should be. Three preset wrappers add ~3 lines each and prevent shimmer fidelity regressions across all three card anatomies.

---

## Q3 — Empty State Primitive

**Question**: Generic `<EmptyState>` component, or per-context custom markup?

- A. Generic `<EmptyState illustration text cta>` — all props driven
- B. Per-context custom — no shared primitive
- C. Generic `<EmptyState>` with enforced copy contract (title + description + optional CTA)
- D. **Generic component; illustration slot only accepts a Lucide icon name**

**RECOMMENDED: D.** Brand spec §10 is explicit: "Use a single `lg` Lucide icon in `--text-muted`. No illustrations of robots." Constraining the illustration slot to a Lucide icon name makes it structurally impossible to violate this brand rule. Copy formula from §10: one factual sentence, one action sentence. Canonical defaults: Architecture → `Boxes`; Observability → `Activity`; Memory inbox → `Library`.

---

## Q4 — Error Boundary Granularity

**Question**: Top-level only, per route, or per async data surface?

- A. One top-level boundary — full-page error on any failure
- B. Per route — one boundary per `/architecture`, `/memory`, `/observability`
- C. Per route + per major `useQuery` consumer
- D. **Per route + per card type** (SkillCard, RunCard, WikiCard)

**RECOMMENDED: D.** Top-level is too coarse — a RunCard SSE error should not blank the Observability view. Per-`useQuery` is too fine — visual noise, and most errors are transient. Per-route + per-card-type keeps grids functional when one card fails. Brand spec §9 defines `ErrorBoundary` as `--error-bg` card, `CircleX` icon `lg`, title + message + "Try again" ghost button. Error copy follows brand spec §10 formula: specific, actionable, never "Something went wrong."

---

## Q5 — Keyboard Shortcuts Full Set

**Question**: What is the canonical shortcut set, and should a `?` help overlay be included?

Proposed canonical 15 shortcuts:

| Shortcut | Action | Category |
|---|---|---|
| `⌘K` | Open command palette | Navigation |
| `⌘1` / `⌘2` / `⌘3` | Go to /architecture / /memory / /observability | Navigation |
| `⌘/` | Focus global filter chip | Navigation |
| `⌘F` | Focus in-view search (scoped) | Navigation |
| `⌘,` | Open settings | Navigation |
| `Esc` | Close any open drawer/modal | Navigation |
| `j` / `k` | Next/prev item in Observability feed | Feed nav |
| `Enter` | Open drawer for selected item | Feed nav |
| `d` | Dispatch selected SkillCard (Architecture) | Actions |
| `r` | Retry selected failed RunCard | Actions |
| `a` | Approve selected awaiting-approval run | Actions |
| `?` | Toggle help overlay | Help |

- A. All 15 as listed; include `?` help overlay
- B. Navigation shortcuts only (7 shortcuts); defer feed nav + action shortcuts
- C. All 15, omit `?` help overlay — discoverable via `<Kbd>` tooltips
- D. **All 15 + help overlay; `j/k` scoped to Observability only**

**RECOMMENDED: D.** `j/k` is natural in Observability's dense linear feed but ambiguous in Architecture's masonry grid (column order unclear) and Memory's tree+reader split (tree already handles arrow-key nav). The `?` help overlay uses the `<Kbd>` primitive from brand spec §9 (`--surface-muted` bg, `--border` border, `code-inline` font, `rounded-sm`) and eliminates the discoverability problem without requiring documentation.

---

## Q6 — Cost Dashboard Scope

**Question**: Dedicated `/observability/costs` route, or extend `/observability/metrics`?

- A. Dedicated `/observability/costs` route — full-page, date picker, breakdowns
- B. In-place expansion of the metrics sidebar
- C. **Fold into `/observability/metrics`** (already in IA spec §4)
- D. Sidebar panel with a popout to full-screen

**RECOMMENDED: C.** IA spec §4 already specifies `/observability/metrics` with "Spend over time (bar chart, grouped by selected breakdown)" as chart #1 and "breakdown by (lane / model / tag / skill)" as a filter. A separate `/observability/costs` route duplicates this surface. Cost dashboard is metrics. Per-tag budget warnings (Q7) surface as inline chart annotations. "View full metrics →" already points to this URL.

---

## Q7 — Per-Tag Budget UX

**Question**: Soft warn (toast at 80%) + hard block (modal at 100%), or only soft warns?

- A. Soft warn only — toast at 80%, no block
- B. Hard block only — modal at 100%
- C. Toast at 80% + modal block at 100%
- D. **Inline banner at 80% + modal block at 100%** — no toast for budget warnings

**RECOMMENDED: D.** IA spec §1 explicitly limits toasts to "skill dispatched, inbox item promoted, run completed" — budget warnings are not in that list. Inline banner in the metrics chart area respects this notification contract. Hard block at 100% is correct: cost transparency is a brand value (brand spec §10: "Cost is visible, never hidden"). Modal copy at 100%: `Budget for #[tag] reached ($X.XX). Increase the budget in Settings → Cost Guardrails to continue.`

---

## Q8 — Per-Tag Budget Storage

**Question**: Separate `~/.agenticos/budgets.json`, or extend `~/.agenticos/config.json`?

- A. Separate `budgets.json`
- B. **Extend `config.json` under `costGuardrails` key**
- C. Extend `config.json` with atomic sub-document write
- D. Separate `budgets.json`; `config.json` references it by path

**RECOMMENDED: B.** Phase 3 established `config.json` as the config store and `cron.json` as the schedule store. A third file adds no structural benefit. IA spec §7 already shows `per-tag budget` alongside `dailySpendCap` as a configurable guardrail — both belong together: `costGuardrails: { dailyCapUsd: 5.00, warnThresholdUsd: 0.50, tagBudgets: { "farm": 2.00 } }`. Atomic write (tmp + rename + chmod 0600) matches the existing Phase 3 scheduler pattern.

---

## Q9 — launchd Integration (Phase 3 Deferral)

**Question**: Auto-generate and load `.plist`, provide template only, or document manual setup?

- A. Full integration — setup script generates plist and `launchctl bootstrap`
- B. **Generate `.plist` template only** — `scripts/launchd/com.agenticos.scheduler.plist.template`, document manual `launchctl load`
- C. Document manual setup only
- D. Defer to v1.1

**RECOMMENDED: B.** Phase 3 Decision 9 accepted the constraint and flagged launchd as Phase 6 work. Full automated loading (A) requires elevated permissions and `launchctl bootstrap` that may prompt for admin password mid-setup. A template solves 90% of the problem (no hand-crafted XML) with zero risk. The setup script (Q12) can offer `launchctl load` as an optional prompted step. Template must be generated from the same port/path constants used in the Node scheduler — never hardcoded literals.

---

## Q10 — Auto-Cancel-Stale Toggle (Phase 3 Deferral)

**Question**: Include in Phase 6? Global or per-skill?

- A. Global toggle + threshold only (default 30 min)
- B. Per-skill only
- C. **Global toggle + global threshold + per-skill `stalenessThresholdMs` override in skill frontmatter**
- D. Not in Phase 6

**RECOMMENDED: C.** Phase 3 Decision 10 designed `stalenessThreshold` as per-skill (Curator: 5 min; generic: 30s) and only deferred the UI. The data model exists in skill YAML. Option C completes the intent: global on/off (default off — conservative) with a global fallback threshold, overridable per-skill. Prevents the Curator's 5-minute threshold being overridden by a global 30-minute setting.

---

## Q11 — README Structure

**Question**: Single README or split docs?

- A. Single `README.md` covering everything
- B. `README.md` + `INSTALL.md` + `CONTRIBUTING.md` + `ARCHITECTURE.md`
- C. **`README.md` (overview + quickstart) + `docs/setup.md` + `docs/architecture.md`**
- D. Single `README.md` + auto-generated API reference

**RECOMMENDED: C.** The project already has a `docs/` directory with `brand.md`, `information-architecture.md`, and phase design specs. Extending this pattern avoids root-level doc sprawl. `README.md` stays under 200 lines: project summary, screenshot, one-command quickstart, links to `docs/`. `docs/setup.md` covers environment requirements, vault path config, connector auth, launchd. `docs/architecture.md` covers the monorepo layout, package relationships, and the Phase 1–6 build sequence.

---

## Q12 — Setup Script

**Question**: Bash, Node, or `pnpm run setup`? What does it do?

- A. Bash only (`scripts/setup.sh`)
- B. Node only (`scripts/setup.mjs`)
- C. `pnpm run setup` invoking a Node script
- D. **Bash for environment checks + `pnpm run setup` for app initialization (two stages, both idempotent)**

**RECOMMENDED: D.** Environment checks (Node ≥ 20? pnpm ≥ 9? Hermes binary on PATH?) are cleanest in Bash — they run before `node_modules` exists. App initialization uses the project's Zod config schemas and belongs in Node. Both stages must be idempotent: re-running never overwrites existing config. Tasks: check dependencies → `pnpm install` if needed → create `~/.agenticos/` (0700) → write default `config.json` if absent → write default `cron.json` if absent → prompt for vault path → generate launchd plist → optional `launchctl load` prompt.

---

## Q13 — Demo Walkthrough Format

**Question**: Written markdown, recorded Loom, or interactive web page?

- A. Written markdown in `docs/demo.md` with annotated screenshots
- B. Recorded Loom — shows real-time agent runs, SSE updates, live cost counter
- C. Interactive web page with a hosted read-only instance
- D. **Written markdown walkthrough + one short Loom clip showing a live Hermes run**

**RECOMMENDED: D.** A written walkthrough misses the kinetic quality of a live run — the lane stripe pulse (brand spec §5: 2s ease-in-out), the live cost counter, the SSE log stream. A full Loom becomes stale with every UI change. Option D gives skimmers a text path and shows the one moment only video can convey. Loom target: under 90 seconds. Script: dispatch a skill → observe RunCard lane stripe pulse teal → watch live log stream → see cost finalize. Everything else (settings, memory, filters) is static enough for screenshots.

---

## Proposed Sequencing — 3 Waves

```
Wave 1 (brand foundation — blocks all visual work):
  T1  Brand audit + token sweep + vault=vault URI fix
  T2  Skeleton/SkeletonCard variants, EmptyState, ErrorBoundary

Wave 2 (functional — T3 and T4 run in parallel, disjoint scopes):
  T3  Keyboard shortcuts full set + help overlay
  T4  Cost dashboard (/observability/metrics) + per-tag budget UX + config.json schema
      └─ ALSO: auto-cancel-stale toggle UI (Q10 — fits alongside cost guardrails)

Wave 3 (documentation — describes the finished system):
  T5  README + docs/setup.md + docs/architecture.md
      + two-stage setup script (Bash + Node, idempotent)
      + launchd plist template
      + Loom demo clip
```

---

## Proposed Testing Targets

| Layer | Tests | Notes |
|---|---|---|
| Brand token audit | Automated AST/grep: fail CI on any `#` hex literal outside `globals.css` and `tailwind.config.ts` | Prevents regression |
| Skeleton / EmptyState / ErrorBoundary | Unit: correct token classes; ErrorBoundary catches thrown child errors | ~10 tests |
| Keyboard shortcuts | Playwright: fire each shortcut, assert route or component state | ~15 tests |
| Cost dashboard | Integration: mock run history → assert chart data + warn annotation at 80% + block modal at 100% | ~8 tests |
| Setup script | `bats`: idempotent run, missing dir creation, no-overwrite on existing config | ~6 tests |
| Visual regression | Playwright screenshot diff: SkillCard, RunCard (running + stale), WikiCard (inbox + archived) | 6 reference snapshots; manual approval first run |

---

## Risks

1. **Brand sweep surfaces compound issues.** Token corrections often reveal layout regressions masked by incorrect colors. Estimate: 20–30% scope creep risk in Wave 1. Mitigation: timebox T1 to one session; log layout issues as separate Asana tasks rather than fixing inline.

2. **`⌘F` overrides browser native find-in-page.** AgenticOS runs as a localhost Next.js app, not Electron. `event.preventDefault()` on `⌘F` suppresses the browser's native find. Mitigation: test on Chrome and Safari; document the override in the help overlay copy.

3. **launchd plist template staleness.** If the scheduler port or daemon path changes, the template silently becomes incorrect. Mitigation: generate the template from constants in `packages/hermes-client/src/constants.ts` — no hardcoded literals in the template file itself.

4. **Per-tag budget dispatch race.** Two near-simultaneous dispatches under the same `#tag` may both pass the budget check before either write completes (TOCTOU). The atomic write pattern prevents corruption but not the race. Mitigation: serialize budget reads and dispatch confirmations through a single async lock (`p-mutex` or equivalent) in the API route.

---

*End of Phase 6 Design Brief — review proposed answers above, tweak any recommended options, then approve to proceed to the implementation plan.*
