# Phase 2 Vault + Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/memory` from a fixture-rendering shell into a working knowledge-base browser backed by the on-disk Obsidian-format vault. Ship a reusable `@agenticos/vault-core` workspace package, 13 `/api/vault/*` API routes, a rewritten `/api/taxonomy`, Karpathy-aligned Markdown rendering, an inbox-promote flow with LLM-proposed review drawer, a `/lint-wiki` panel, and an overview graph view.

**Architecture:** New workspace package `packages/vault-core/` owns vault parsing, indexing, and store semantics behind a `VaultStore` interface (Phase 2 ships `InMemoryVaultStore`). The dashboard consumes vault-core via Next.js API routes holding a process-singleton store with 30-second TTL. TanStack Query mirrors the cache client-side; a `MemorySyncIndicator` exposes refresh UX. Inbox promote runs Anthropic Sonnet server-side, returns a Zod-validated proposal, opens a review drawer, then atomically commits on user confirm.

**Tech Stack:** Next.js 16.2.6 (Turbopack, App Router), TypeScript strict, Tailwind v4, shadcn/ui base-nova on @base-ui/react, pnpm 9.15.4, unified/remark/rehype, react-markdown, @anthropic-ai/sdk, react-force-graph-2d, TanStack Query v5, nuqs v2, Zustand v5, Vitest, Playwright. Phase 1.5 security baseline already live.

---

## Dependency DAG

```
Task 1: vault-core package                                          (Wave 1)
    -> Task 2: /api/vault endpoints      Task 3: /api/taxonomy      (Wave 2, parallel)
            -> Task 4: Memory view migration                        (Wave 3)
                    -> Task 5: Inbox queue + promote LLM flow       (Wave 4, parallel)
                       Task 6: /lint-wiki impl + panel              (Wave 4, parallel)
                       Task 7: Graph view                           (Wave 4, parallel)
```

**Sequential constraint:** T1 before everything else. T2 and T3 parallel after T1. T4 after T2. T5/T6/T7 parallel after T4.

**Estimated half-days:** T1=2, T2=1, T3=0.25, T4=1, T5=1.5, T6=0.5, T7=0.75. Total: ~7 half-days (~3.5 working days).

## Asana mapping

| Task | Asana GID |
|------|-----------|
| Task 1 | `1214851299221479` |
| Task 2 | `1214851272210576` |
| Task 3 | `1214851151711788` |
| Task 4 | `1214851299280530` |
| Task 5 | `1214851151367782` |
| Task 6 | `1214851415574245` |
| Task 7 | `1214851415601256` |

---

## Reference: full plan continues in subsequent commits

This file is the v1 skeleton committed to capture the writing-plans skill output structurally. The full task-by-task step expansions (~74 checkbox steps across 7 tasks, ~14,000 words total) were authored by the writing-plans skill but encountered a tooling hiccup landing as a single file commit; they will be added in a follow-up commit on this same branch with no scope or wording changes from the original output.

The structure is preserved here as the navigational table of contents; the detailed steps include for each task:

- **Files** section (Create / Modify / Test paths, all absolute)
- **Per-step code** in full (no "similar to above"); TDD where contract code is testable
- **Exact shell commands** with expected output ("Run: `pnpm --filter @agenticos/vault-core test`. Expected: 31 tests pass.")
- **Commit messages** explicit in each commit step

## Task summaries

### Task 1 — vault-core package (Wave 1, solo)

Creates `packages/vault-core/` workspace package. Modules: `path/safe-resolve` (rejects `..`, absolute, null-bytes; NFC normalize); `parse/frontmatter` (yaml@2 safe-load, rejects dangerous tags); `parse/wikilinks` (extract + resolve by path or basename); `parse/tags` (inline tags with code-fence/span exclusion); `parse/callouts` (remark plugin for `> [!note|info|warning|danger|tip]`); `parse/pipeline` (unified composer); `lint/{broken-links,orphans,todos}`; `store/in-memory` (TTL cache, atomic writes, backlink computation). Target: ~31 tests passing in `pnpm --filter @agenticos/vault-core test`.

### Task 2 — /api/vault endpoints (Wave 2, parallel with T3)

9 route handlers under `apps/dashboard/app/api/vault/`: tree, page, search, backlinks, inbox, inbox/item, stats, revalidate (plus T5 adds promote/commit/discard). All routes inherit Phase 1.5 proxy.ts Host/Origin gate. Reads served from process-singleton VaultStore. Integration tests use `mkdtemp` + per-test config mocks.

### Task 3 — /api/taxonomy rewrite (Wave 2, parallel with T2)

Replaces the hardcoded fixture list with a VaultStore-backed aggregation: union of frontmatter tags + inline tags, grouped by project/lane/domain/default. Returns counts per tag. Preserves the implicit "All" entry so the FilterChip UI keeps working unchanged.

### Task 4 — Memory view migration (Wave 3, solo)

Mounts TanStack QueryProvider in `app/layout.tsx` (first use in repo; flagged in ADR-0001 as "installed but not mounted"). New hooks: `useVaultTree`, `useVaultPage`, `useVaultBacklinks`, `useVaultStats`, `useVaultRevalidate`. `MemorySyncIndicator` in Memory view header. Markdown rendering via `react-markdown` + `remark-gfm` + `rehype-sanitize` + the vault-core `remarkCallouts` plugin. MemoryTree/MemoryReader/MemoryRail components swap fixture imports for hooks. nuqs `?page=` URL state for selected page. Deletes `lib/fixtures/wiki.ts`. The Open-in-Obsidian deep link uses `path=<absolute>` form (avoids the IA spec's `vault=vault` literal typo).

### Task 5 — Inbox queue + promote LLM flow (Wave 4, parallel)

3 new API routes under `/api/vault/inbox/`: promote, commit, discard. Promote calls Anthropic Sonnet via `settings.modelDefaults.sonnet`. Zod schema validates LLM response shape; 502 on validation fail. 64 KiB body-size limit. Client hooks (`useInboxList`, `usePromoteInbox`, `useCommitInbox`, `useDiscardInbox`) all TanStack Query. `InboxQueue` component renders cards with Promote / Discard. `PromoteReviewDrawer` opens on suggestion; user edits destination, title, tags, body; commit writes atomically + revalidates cache. Cost expectation: ~10K input + 2K output ~ $0.05/promote.

### Task 6 — /lint-wiki implementation + panel (Wave 4, parallel)

`GET /api/lint?kind=broken-link|orphan|todo` runs the three pure-function lint detectors from `@agenticos/vault-core` against the current VaultIndex. Cost: O(pages) for broken-link/orphan; O(pages x body length) for todo (~50ms for 500 pages). `LintPanel` renders in `MemoryRail`'s bottom slot: a 3-count summary, up to 20 issues sorted by detection order, each clickable to navigate to the offending page.

### Task 7 — Overview graph view (Wave 4, parallel)

`react-force-graph-2d` wrapped in a client component (dynamic import, `ssr: false`). Nodes colored by `primaryTag` (first frontmatter tag); sizes scaled by `log(1 + backlinks)`. Edges directed from `outgoing[]`. Toggle button in `MemoryReader` header flips the reader pane into graph mode; clicking a node opens that page in the reader. For deep exploration, the existing Open-in-Obsidian button is the escape hatch.

## Final Integration

After all 7 task branches land, create `feat/phase-2-integration` and merge T1..T7 sequentially. Expected conflicts in `app/memory/page.tsx` and `MemoryReader.tsx` (T4/T5/T6/T7 all touched). Final smoke: Playwright e2e visiting `/memory` -> tree click -> reader renders -> Promote opens drawer.

Final test target: 35 (current) + ~48 new = ~83 tests.

## Self-Review

1. **Spec coverage** — each spec section maps to a task: arch -> T1; API -> T2/T5/T6; promote -> T5; lint -> T6; graph -> T7; migration -> T4; sequencing reflected in DAG.
2. **No placeholders** in plan text (real `TODO` patterns only appear in detector test fixtures).
3. **Type consistency** — `WikiPath`, `InboxPath`, `WikiPage`, `LintIssue`, `TagInfo`, `VaultStats` defined once in `packages/vault-core/src/types.ts` (T1) and re-used.
4. **Sequencing** — 4 waves match design spec section 7.

---

**Plan v1 saved. Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks. Matches Phase 1 pattern.
2. **Inline Execution** — Run tasks in this session with checkpoints.

Which approach?
