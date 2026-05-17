# Phase 2 — Vault + Memory: Design

**Status**: Proposed (2026-05-17)
**Owner**: AgenticOS — single-developer (Josh)
**Supersedes**: Phase 1 fixture-backed `/memory` view (see `docs/plans/phase-1-mvp-foundation.md`)
**Predecessors required**: Phase 1.5 security baseline (PR #23, merged) — Phase 2 reuses the path-safety validators and proxy Host gate.

---

## 1. Goals

Phase 2 turns `/memory` from a fixture-rendering shell into a working knowledge-base browser backed by the on-disk Obsidian-format vault at `~/Documents/Dev Projects/vault/`. By the end of Phase 2:

- The Memory view reads real markdown from the vault and renders Karpathy-aligned content (CommonMark + wikilinks + frontmatter + callouts + inline `#tags`).
- The global filter chip's taxonomy comes from the vault (folders + frontmatter) rather than a hardcoded list.
- An inbox queue surfaces fleeting notes; "Promote" invokes Claude to propose a refined wiki page; user reviews + commits.
- A `/lint-wiki` panel surfaces broken links, orphans, and TODO markers.
- An overview graph view visualizes the link structure.
- A reusable `@agenticos/vault-core` workspace package owns all vault parsing, indexing, and store semantics — Hermes (Phase 3) and Sandcastle (Phase 4) will import from it.

**Non-goals**:
- No in-app vault editing (the IA spec is explicit: edits flow through Obsidian, AgenticOS is read + triage).
- No real-time file watching (`chokidar` deferred; TTL + manual refresh covers the use case).
- No SQLite/FlexSearch index (deferred behind interface; in-memory store sufficient for current scale).
- No agent dispatch (Phase 3+).

---

## 2. Resolved Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Vault scale strategy | Abstract `VaultStore` interface; Phase 2 ships `InMemoryVaultStore` | "Design for flexibility" — boring impl now, swap to indexed store when vault outgrows ~500 pages |
| 2 | Freshness model | Hybrid: TTL 30s + manual refresh button | Stale-while-revalidate by default; explicit override available |
| 3 | Markdown scope | CommonMark + wikilinks + frontmatter + Obsidian callouts + inline `#tags` | Karpathy-aligned. Covers the visually-distinct features users notice; defers `![[embed]]` / math / mermaid |
| 4 | Inbox promote UX | Suggest → review → commit | LLM proposes destination/title/tags/refined body; user reviews in drawer; explicit commit step |
| 5 | Architecture | Approach A — `@agenticos/vault-core` workspace package | Reusable by Hermes/Sandcastle; clean test boundary; ~5% setup overhead vs inlined |
| 6 | Search strategy | Naive substring scan in `InMemoryVaultStore` behind `VaultStore.search()` | Adequate ≤ 500 pages; swap for FlexSearch/Minisearch later via interface |
| 7 | Graph view library | `react-force-graph-2d` (canvas, ~30 KB gzipped) | IA spec already scoped this as "overview-only"; deep exploration links to Obsidian |
| 8 | Lint timing | On-demand (server-side, ~200 ms for 500 pages) | Background scheduling deferred to Phase 3 via Hermes cron |
| 9 | LLM for promote | `settings.modelDefaults.sonnet` (configurable per-task tier) | Honors the model-routing strategy from IA spec Section 7; not hardcoded |

---

## 3. Architecture

### 3.1 Package structure

A new workspace package at `packages/vault-core/`. Pure TypeScript, no React, no Next dependencies. The package boundary is intentional: Phase 3 Hermes and Phase 4 Sandcastle can either re-parse markdown in their own runtime or import this package directly.

```
packages/vault-core/
├── package.json              "name": "@agenticos/vault-core"
├── tsconfig.json             extends @agenticos/tsconfig/base
├── src/
│   ├── index.ts              public API surface
│   ├── types.ts              WikiPage, InboxNote, SourceFile, VaultIndex,
│   │                         Backlink, LintIssue, TreeNode
│   ├── store/
│   │   ├── vault-store.ts    interface VaultStore { ... }
│   │   ├── in-memory.ts      class InMemoryVaultStore implements VaultStore
│   │   └── errors.ts         VaultPathError, VaultParseError, VaultLockedError
│   ├── parse/
│   │   ├── frontmatter.ts    safe YAML parse → { meta, body }
│   │   ├── wikilinks.ts      extract & resolve [[Path/Note]] / [[Note|Alias]]
│   │   ├── tags.ts           inline #tag extraction
│   │   ├── callouts.ts       remark plugin for > [!note]
│   │   └── pipeline.ts       unified → remark → rehype → consumable output
│   ├── lint/
│   │   ├── broken-links.ts
│   │   ├── orphans.ts
│   │   └── todos.ts
│   └── path/
│       └── safe-resolve.ts   path safety (no `..`, rejects absolute)
└── test/                     mirrors src/ — Vitest
```

`apps/dashboard/package.json` adds `"@agenticos/vault-core": "workspace:*"`.

**Server-only split inside the package**: `vault-core/store` is server-only (uses `fs/promises`); `vault-core/parse` is browser-safe (pure string transforms). The package's `index.ts` re-exports both, but consumers should import from sub-paths when they care about the bundle boundary. The `InMemoryVaultStore` itself carries an `import 'server-only'` so accidental client imports fail at build time.

### 3.2 Data model

```ts
type WikiPath = string;     // relative to vault/wiki, e.g. "Farm/Syntropic Plot A12"
type SourcePath = string;   // relative to vault/sources
type InboxPath = string;    // relative to vault/inbox

interface WikiPage {
  path: WikiPath;
  title: string;            // frontmatter `title` || filename
  tags: string[];           // frontmatter + inline #tags merged + deduped
  created: string;          // ISO from frontmatter
  updated: string;          // ISO from frontmatter || file mtime
  sources: SourcePath[];    // frontmatter `sources` backref list
  body: string;             // raw markdown (post-frontmatter)
  bodyAst: Root;            // mdast Root from unified pipeline
  outgoing: WikiPath[];     // resolved [[wikilinks]]
  unresolvedLinks: string[];// [[wikilinks]] that don't resolve
}

interface InboxNote {
  path: InboxPath;
  capturedAt: string;       // file mtime
  title: string;            // first heading or first line
  body: string;
}

interface VaultIndex {
  pages: Map<WikiPath, WikiPage>;
  backlinks: Map<WikiPath, WikiPath[]>;   // page → who links TO it
  allTags: Set<string>;
  builtAt: number;                        // Date.now()
}

interface LintIssue {
  kind: 'broken-link' | 'orphan' | 'todo';
  path: WikiPath;
  detail: string;
  line?: number;
}

interface TreeNode {
  path: string;             // folder or file path under wiki/
  name: string;             // display name
  kind: 'folder' | 'page';
  children?: TreeNode[];
}
```

### 3.3 `VaultStore` interface

The single contract consumers depend on.

```ts
interface VaultStore {
  // Reads — cached against current VaultIndex
  list(): Promise<{ tree: TreeNode; flat: WikiPath[] }>;
  read(path: WikiPath): Promise<WikiPage | null>;
  search(query: string, opts?: { tags?: string[]; limit?: number }): Promise<WikiPage[]>;
  getBacklinks(path: WikiPath): Promise<WikiPath[]>;
  getOutgoing(path: WikiPath): Promise<WikiPath[]>;
  getAllTags(): Promise<{ id: string; label: string; count: number; group?: string }[]>;
  listInbox(): Promise<InboxNote[]>;
  readInbox(path: InboxPath): Promise<InboxNote | null>;

  // Lint
  lint(): Promise<LintIssue[]>;

  // Writes — atomic (tmp + rename), enforce path safety
  promoteInbox(
    inboxPath: InboxPath,
    page: Omit<WikiPage, 'bodyAst' | 'outgoing' | 'unresolvedLinks'>
  ): Promise<WikiPage>;
  discardInbox(inboxPath: InboxPath): Promise<void>;

  // Cache control
  revalidate(): Promise<void>;
  stats(): { pageCount: number; builtAt: number; ttlExpiresAt: number };
}
```

**Path safety constraint**: every `WikiPath` / `InboxPath` is relative. Only `path/safe-resolve.ts` joins with the vault root, where `..` and absolute paths are rejected. Even buggy callers cannot path-traverse.

---

## 4. API Surface + Caching

### 4.1 Routes

All under `apps/dashboard/app/api/`. Every state-changing route inherits Phase 1.5's `proxy.ts` Host/Origin gate, body-size limit (64 KiB), and Zod body validation.

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| `GET`  | `/api/vault/tree` | Sidebar tree | — | `{ tree, flatPaths }` |
| `GET`  | `/api/vault/page` | Read page | `?path=` | `WikiPage \| 404` |
| `GET`  | `/api/vault/search` | Full-text search | `?q=&tags=&limit=` | `{ results, total }` |
| `GET`  | `/api/vault/backlinks` | Backlinks | `?path=` | `{ backlinks }` |
| `GET`  | `/api/vault/inbox` | Inbox list | — | `{ items }` |
| `GET`  | `/api/vault/inbox/item` | One inbox note | `?path=` | `InboxNote \| 404` |
| `POST` | `/api/vault/inbox/promote` | LLM proposal | `{ inboxPath }` | `{ proposed, confidence, reasoning }` |
| `POST` | `/api/vault/inbox/commit` | Write proposal | `{ inboxPath, page }` | `{ written: WikiPage }` |
| `POST` | `/api/vault/inbox/discard` | Delete inbox | `{ inboxPath }` | `204` |
| `POST` | `/api/vault/revalidate` | Force rebuild | — | `{ builtAt, pageCount }` |
| `GET`  | `/api/vault/stats` | Cache state | — | `{ pageCount, builtAt, ttlExpiresAt }` |
| `GET`  | `/api/lint` | Run lint | `?kind=` (optional) | `{ issues }` |
| `GET`  | `/api/taxonomy` | **REWRITE** to read vault | — | `{ tags: [{ id, label, group, count }] }` |

### 4.2 Caching shape

```
React component → useQuery (TanStack Query, staleTime 30s, gcTime 60s)
    ↓
fetch('/api/vault/...')
    ↓
Next.js API route
    ↓
process singleton: vaultStore (InMemoryVaultStore)
    ├── VaultIndex { pages, backlinks, tags, builtAt }
    ├── ttlExpiresAt = builtAt + 30_000
    └── if Date.now() > ttlExpiresAt: rebuild from FS (~50-200ms for 100 pages)
```

Two cache layers aligned on the 30-second window. Server-side index is the canonical state; TanStack Query mirrors it client-side and avoids re-requesting within staleTime.

### 4.3 Revalidation triggers (in order of frequency)

1. **TTL expiry** — passive; next request rebuilds.
2. **Refresh button** — UI POSTs `/api/vault/revalidate`, then invalidates the TanStack Query cache for all `/api/vault/*` keys.
3. **Post-write** — every successful `commit` / `discard` returns `{ ..., builtAt }`; client invalidates dependent queries (tree, backlinks for touched pages, inbox list).

### 4.4 `MemorySyncIndicator`

Memory view header shows `"Synced 12s ago · ⟳"`. Updates every second using `useQuery('/api/vault/stats')`. After 25 s, dims; after 30 s+, shows a faint orange dot. Click → fires refresh flow, spinner for ~300 ms. Memory-view-local; not in the global AgenticOS header.

---

## 5. The Three Active Flows

### 5.1 Inbox promote (LLM)

The only Phase 2 surface that calls Anthropic. Propose → review → commit.

```
1. User clicks "Promote" on an inbox card
2. POST /api/vault/inbox/promote { inboxPath }
   Server:
     a. Read inbox note from disk
     b. Read full vault index (titles + tags only, NOT bodies — keeps prompt small)
     c. Build prompt (see § 5.1.2)
     d. Anthropic call — model = settings.modelDefaults.sonnet
     e. Validate response with Zod
     f. Return { proposed, confidence, reasoning }
3. Review drawer opens (right-side, ~480 px wide)
     - Editable: destination path, title, tags, body
     - Side-by-side: original inbox markdown ↔ refined wiki body
     - Reasoning collapsed by default
     - Actions: Commit · Edit body · Re-propose (with feedback) · Discard · Cancel
4. User clicks Commit
5. POST /api/vault/inbox/commit { inboxPath, page }
   Server:
     a. Validate page shape + path safety
     b. Atomic write: tmp + rename to vault/wiki/<path>.md
     c. Delete inbox file
     d. vaultStore.revalidate()
     e. Return { written }
6. Toast "Promoted to wiki/<path>.md"
7. Memory refreshes; new page selected; inbox card removed
```

#### 5.1.1 LLM prompt contract

System prompt loaded from `apps/dashboard/lib/llm/prompts/promote-system.txt`:

> You are the curator for an Obsidian-format knowledge vault. Your job is to promote a fleeting inbox note into a wiki page. Read the inbox content and the existing wiki index. Propose:
>
> - The best destination folder under `wiki/` based on existing organization
> - A concise human title (≤ 60 chars)
> - 1–5 tags, from the existing tag set unless the note genuinely introduces a new concept
> - A refined wiki page body that preserves the original meaning but improves clarity, resolves `[[wikilinks]]` to real existing pages where applicable, and trims throat-clearing
> - A confidence score 0.0–1.0
> - One sentence of reasoning
>
> Do NOT invent facts not in the inbox note. Do NOT promote if the note is purely a reminder, todo, or single-link bookmark with no thought attached (return `confidence < 0.3` in that case).

User prompt template (`apps/dashboard/lib/llm/prompts/promote-user.template.txt`):

```
<inbox note>
{{inbox_body}}
</inbox note>

<existing wiki index>
{{flat_index}}
</existing wiki index>

<existing tags>
{{all_tags}}
</existing tags>

Output strict JSON matching this schema:
{ "destination": "Farm/...", "title": "...", "tags": [...], "body": "...", "confidence": 0.0-1.0, "reasoning": "..." }
```

#### 5.1.2 Zod response schema

```ts
const PromoteResponseSchema = z.object({
  destination: wikiPath,                  // path safety refinement
  title: z.string().min(1).max(120),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(8),
  body: z.string().min(1).max(50_000),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
```

If validation fails, return `502 Bad Gateway` with retry option in UI.

#### 5.1.3 Cost expectations

Sonnet @ 10 K input + 2 K output ≈ **$0.05 per promote**. Acceptable for typical use (< 10 promotes/day). The Observability cost dashboard should surface this from Phase 3 onward.

### 5.2 Lint

`GET /api/lint?kind=…` runs three checks against the current `VaultIndex`. Pure functions, no I/O beyond what the store already has.

| Kind | Detection | Cost |
|------|-----------|------|
| `broken-link` | Iterate `WikiPage.unresolvedLinks`, emit one issue per | O(pages) |
| `orphan` | Pages with empty `backlinks` and not under `wiki/_meta/` | O(pages) |
| `todo` | Body scan for `TODO`, `FIXME`, `[[?]]`, `[ ]` checkbox patterns | O(pages × body length) |

UI: the lint panel in the right rail (Memory view). Click an issue → opens the offending page, scrolled to `line` if present. "Contradiction" detection (LLM-driven) is deferred; the IA spec mentions it but it's a Phase 3 enhancement.

### 5.3 Graph view

Library: **`react-force-graph-2d`**. Canvas-based, ~30 KB gzipped.

```ts
type GraphNode = { id: WikiPath; label: string; primaryTag: string; size: number };
type GraphEdge = { source: WikiPath; target: WikiPath };
```

- **Node color** = brand-token from `primaryTag` (first tag in frontmatter). Table at `lib/graph/tag-colors.ts`: `farm → green-ish`, `software → plum-tinted`, `marketing → gold-tinted`, etc.
- **Node size** = `1 + log(1 + backlinkCount)`.
- **Edge** = directed, opacity 0.4.
- **Toggle** (per IA spec): "Graph view" button in the page reader header flips the reader panel to graph mode. Tree + right rail stay.
- **Click a node** → graph closes, page opens in reader.
- **No physics tuning UI** — overview only. For deep exploration, the existing "Open in Obsidian" button in the page reader header takes the user to Obsidian; from there they can open the graph view via Obsidian's UI. Obsidian's URI scheme has no `action=graph` parameter — graph view is UI-only.

---

## 6. Migration: Phase 1 fixtures → Phase 2 real data

Component-by-component, one import swap each. No rewrites.

| Component | Before | After |
|-----------|--------|-------|
| `MemoryTree.tsx` | `WIKI_PAGES` from fixtures | `useVaultTree()` hook |
| `MemoryReader.tsx` | `getPageByPath()` from fixtures | `useVaultPage(path)` hook |
| `MemoryRail.tsx` (backlinks) | computed inline | `useVaultBacklinks(path)` |
| `MemoryRail.tsx` (tags) | derived from fixture | derived from `useVaultPage` |
| Inbox queue (stub) | 2–3 fake items | `useInboxList()` + promote drawer |
| Lint panel | static text | `useLintIssues({ kind })` |
| Graph view | does not exist | new `GraphCanvas` component |

Three one-time setup items alongside:

1. **Mount TanStack Query provider** in `app/layout.tsx` (installed today but never mounted; flagged in ADR-0001). Single `<QueryProvider>` wrapping `{children}`. ~5 lines.
2. **`MemorySyncIndicator`** in Memory view header (see § 4.4).
3. **Delete `apps/dashboard/lib/fixtures/wiki.ts`** once all consumers migrated. `skills.ts` and `runs.ts` stay (later phases).

---

## 7. Sequencing (the 7 Asana tasks)

```
                                                              wave
T1  vault-core package                                          1   (solo)
                       ↓
T2  /api/vault endpoints      T3  /api/taxonomy rewrite          2   (parallel)
              ↓
T4  Memory page reader migration                                 3   (solo)
              ↓
T5  Inbox queue + promote     T6  /lint-wiki impl + panel     T7  Graph view    4   (parallel)
```

- **Wave 1**: 1 Sonnet agent, worktree-isolated. T1 — `vault-core` package with heavy unit tests.
- **Wave 2**: 2 parallel Sonnet agents, worktree-isolated. T2 + T3 — disjoint file scopes inside `apps/dashboard/app/api/`.
- **Wave 3**: 1 Sonnet agent, worktree-isolated. T4 — migration. Adds TanStack Query provider + sync indicator. Smoke test: tree click → real page renders.
- **Wave 4**: 3 parallel agents — T5 (Sonnet — LLM flow), T6 (Haiku — mechanical), T7 (Sonnet — graph aesthetics).

**Estimated wall-clock**: 3–4 sessions of comparable size to Phase 1.

---

## 8. Testing strategy

Heavy at the package layer; light at the integration layer.

| Where | Tests | Target |
|-------|-------|--------|
| `packages/vault-core/test/` | Frontmatter parser, wikilink resolver, path safety, callout/tag plugins, `InMemoryVaultStore` with mock fs, lint detectors | ~30 |
| `apps/dashboard/app/api/vault/*/route.test.ts` | Integration with `mkdtemp` + fixture vault written to disk | ~12 |
| `apps/dashboard/components/memory/__tests__/` | Smoke tests — renders + calls right hook | ~5 |
| Playwright | One end-to-end: `/memory` → click tree node → reader shows content → "Promote" → drawer → commit → file appears in `wiki/` | 1 |

**Phase 2 target**: current 35 tests + ~48 new ≈ **83 tests**.

Performance benchmark in CI (vault-core test): index rebuild < 500 ms for 500 fixture pages. Fails CI if regressed.

---

## 9. Risks + unknowns

1. **LLM cost per promote** — Sonnet @ ~10 K in + ~2 K out ≈ $0.05. Comfortable at low volume, but the Observability cost dashboard (Phase 6) should surface this from day one. No action needed in Phase 2 beyond cost tagging.
2. **Vault index rebuild at scale** — the "design for flexibility" answer covers this with the interface; the CI benchmark catches regressions early.
3. **Unicode + long paths** — paths with emojis or non-ASCII in Obsidian work fine on macOS APFS. The path-safety validator permits Unicode but normalizes NFC ↔ NFD (macOS uses NFD by default).
4. **`server-only` boundary** — `vault-core/store` carries `import 'server-only'`. `vault-core/parse` is browser-safe. Consumers must import from sub-paths if they care about the bundle.
5. **TanStack Query SSR boundary** — first mount in the app. Documented pattern for Next 16 + TanStack Query 5 should hold; verify in Wave 3.

---

## 10. References

- Information Architecture spec: [`docs/information-architecture.md`](./information-architecture.md) — Sections 3 (`/memory` view), 5 (cross-view patterns), 6 (settings model defaults). **Drift to fix in next IA revision**: Section 3 shows `obsidian://open?vault=vault&file=[path]` with `vault=vault` literal. Real Obsidian URIs need either `vault=<vaultName>` or — preferred — `obsidian://open?path=<encoded-absolute-path>` which auto-detects the vault. Phase 2 uses the `path=` form.
- Brand & visual design system: [`docs/brand.md`](./brand.md) — Section 9 (component primitives inventory)
- Phase 1 plan: [`docs/plans/phase-1-mvp-foundation.md`](./plans/phase-1-mvp-foundation.md) — fixture-backed predecessors
- ADR-0001 — State Management: [`docs/adr/0001-state-management.md`](./adr/0001-state-management.md) — TanStack Query mount, nuqs filter integration
- ADR-0002 — UI Library: [`docs/adr/0002-ui-library.md`](./adr/0002-ui-library.md) — shadcn `base-nova`, drawer / dialog primitives for the review drawer
- Vault governance schema: `~/Documents/Dev Projects/vault/CLAUDE.md` (outside repo) — page format, promotion rules, tag taxonomy
- Karpathy methodology: <https://aimaker.substack.com/p/llm-wiki-obsidian-knowledge-base-andrej-karphaty>
- Phase 1.5 security baseline: PR #23 — `proxy.ts` Host/Origin gate, schema path validators, body limits
