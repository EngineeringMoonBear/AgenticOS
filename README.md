# AgenticOS

Local-first agent conductor — one unified pane of glass for orchestrating AI agents across all your projects.

## Three Views

- **Architecture** — Skill/domain map; clickable cards turn workflows into reusable routines.
- **Memory** — Wiki browser over a shared Obsidian-format vault (Karpathy `sources/` → `inbox/` → `wiki/`, governed by `CLAUDE.md`).
- **Observability** — Unified run feed across every agent execution, every lane, every project.

## Two Execution Lanes

- **Hermes** (Nous Research) — Always-on autonomous loops, cron, messaging gateway, Curator. Best for cowork / non-code tasks.
- **Sandcastle** (Matt Pocock) — Ephemeral parallel coding agents in git worktrees. Best for parallel code tasks.

## Status

**Phase 0 — Scaffolding.** No app code yet. Design docs in [`docs/`](./docs).

## Stack (planned)

Next.js 15 (App Router) · TypeScript · Turborepo + pnpm · shadcn/ui · Hermes (Python sidecar) · Sandcastle (TS orchestrator) · Obsidian vault (filesystem)

## License

MIT — see [LICENSE](./LICENSE).
