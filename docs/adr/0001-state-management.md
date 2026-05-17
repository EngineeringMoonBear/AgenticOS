# ADR-0001: State Management Approach

**Status:** Accepted
**Date:** 2026-05-17 (retroactively documented — decision encoded in Phase 1 production code)

---

## Context

AgenticOS is a single-user, localhost-only Next.js 15 App Router dashboard. Three problems needed a state management answer before any UI code could be written:

1. **Filter state must survive the URL.** The global filter chip drives all three views simultaneously. The IA spec requires `?filter=goldberry,code` to be deep-linkable, back-button-correct, and refresh-survivable. This is a hard product requirement, not a preference.

2. **Overlay state is ephemeral and tab-local.** The command palette (⌘K), settings modal, and drawer open/closed flags live and die within a single browser tab. They have no reason to touch a URL or be persisted.

3. **Server data needs a managed cache.** Future API routes (`/api/vault`, `/api/runs`, `/api/skills`) will require deduplication, background refetch, optimistic updates, and stale-while-revalidate semantics. Bespoke `useEffect` fetch logic would have to reinvent all of that.

Constraints that shaped the decision: App Router with React Server Components (RSC) makes Redux-style global state architecturally awkward; serialized URL state causes SSR/client hydration mismatches if not handled carefully; dev velocity was weighted over theoretical purity for Phase 1.

---

## Decision

State is split into three stores by responsibility. The rule is simple: the *authority* for a piece of state determines which store owns it.

### 1. URL-authoritative state — nuqs v2

Filter tags (`?filter=`) and the memory view's open page (`?page=`) are owned exclusively by the URL. nuqs v2 (`useQueryState`) acts as the typed adapter between the URL string and React state. The URL is the single source of truth; there is no secondary in-memory copy.

```ts
// apps/dashboard/lib/filter/use-filter.ts
const filterParser = createParser<string[]>({ parse, serialize })
  .withDefault([])
  .withOptions({ history: "push", shallow: false });

export function useFilter() {
  const [tags, setTags] = useQueryState("filter", filterParser);
  // ...
}
```

`NuqsAdapter` is mounted once in `app/layout.tsx`, wrapping all children.

**Rule:** use nuqs for any state that must be shareable, refresh-survivable, or back-button-correct.

### 2. Ephemeral overlay state — Zustand v5

Client-only UI flags — command palette open/closed, settings modal, active drawer — live in Zustand stores. These are tab-local singletons; they reset on page load, which is the correct behavior. The initial store is `usePaletteStore` with three actions: `open`, `close`, `toggle`.

```ts
// apps/dashboard/lib/palette/use-palette-store.ts
export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,
  open:   () => set({ isOpen: true }),
  close:  () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
```

Zustand is chosen over React context because it does not require a Provider and avoids the re-render cascade that context causes on high-frequency updates (e.g., palette search input).

**Rule:** use Zustand for any boolean or transient value that is purely client-side and does not need to survive a page reload or be shared via URL.

### 3. Server data and cache — TanStack Query v5

TanStack Query v5 is installed as the designated layer for all server-state: fetching, caching, background refetch, and mutation. In Phase 1 there are no real API consumers (views are backed by mock routes or RSC direct reads), so no QueryProvider is mounted in `layout.tsx` yet. TanStack Query will be wired in Phase 2 when `/api/vault`, `/api/runs`, and `/api/skills` become live.

**Rule:** use TanStack Query for any data that comes from an API route — skills list, run history, vault index, settings.

---

## Consequences

### Positive

- **URL-shareable filters** work out of the box. Copying a URL with `?filter=farm,code` opens the exact filtered state in a new tab.
- **Surgical client islands.** RSC handles most rendering; Zustand and nuqs each add a tiny, scoped `"use client"` boundary only where needed.
- **Phase 2 data layer has a clear landing zone.** Adding a TanStack Query consumer is a one-file change; nothing about the current layout resists it.
- **No hydration mismatches.** nuqs handles the URL-to-state synchronization in a way that is compatible with Next.js App Router SSR.

### Negative

- **Three paradigms to learn.** A developer new to the codebase must understand which store is correct for a given piece of state. The decision tree below addresses this, but it is still cognitive load.
- **TanStack Query is a declared dependency with zero current consumers.** Until Phase 2 lands, it adds install weight without benefit. This is an accepted trade-off to avoid a later architectural migration.

### Neutral

- The IA spec's Section 5 filter-flow diagram shows `useFilterStore (Zustand)` as an intermediary between the URL and view components. The actual implementation skips that intermediary — nuqs is consumed directly in components via `useFilter()`. The behavior is identical; the diagram was an early sketch, not a specification.

---

## Decision Tree

When adding new state, ask in order:

1. **Does it need to survive a page refresh or be shareable via URL?**
   Yes → nuqs (`useQueryState`). Stop.

2. **Does it come from an API route and need caching, deduplication, or background refetch?**
   Yes → TanStack Query (`useQuery` / `useMutation`). Stop.

3. **Is it ephemeral client-only state (open/closed, active selection, hover) that resets on navigation?**
   Yes → Zustand store. Stop.

4. **Is it local to a single component with no siblings that need it?**
   Yes → `useState`. No store needed. Stop.

If none of the above apply, re-examine whether the state is real — it may be derived from one of the above.

---

## References

- Information Architecture spec: [`docs/information-architecture.md`](../information-architecture.md) — Section 5 (Cross-View Patterns) for filter URL semantics and SSE choice
- Phase 1 implementation plan: [`docs/plans/phase-1-mvp-foundation.md`](../plans/phase-1-mvp-foundation.md) — explicit tech stack declaration
- nuqs v2 docs: https://nuqs.47ng.com
- Zustand docs: https://zustand.docs.pmnd.rs
- TanStack Query v5 docs: https://tanstack.com/query/v5/docs
