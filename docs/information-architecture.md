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
