# AgenticOS Dashboard

The web UI for AgenticOS — one self-hosted pane of glass for observability,
memory, and cost monitoring of agentic work across Goldberry Grove and related
projects. Built with **Next.js 16** (App Router, server components) +
shadcn/ui, deployed to **DigitalOcean App Platform** (auto-deploys on push to
`main` — _not_ Vercel).

> ⚠️ **This is not the Next.js you know.** Next.js 16 has breaking changes from
> earlier versions. Read [`AGENTS.md`](./AGENTS.md) and the bundled guides in
> `node_modules/next/dist/docs/` before assuming v15 (or earlier) patterns
> apply.

## Tabs

- **Live-Ops / Observability** — agent runs, cron schedule, system health, cost
  burndown + projection, and agent-memory telemetry from **OpenViking**
  (`:1933`), the agent-native memory/context store on the Droplet. This is the
  agent half of the two-brain memory model and is _separate_ from the Memory
  tab below.
- **Memory** — a vault-driven three-pane browser (tree / reader / rail + inbox
  queue) over the human Obsidian vault. Components: `MemoryTree`,
  `MemoryReader`, `MemoryRail`, `InboxQueue`. The dashboard reads the vault
  through `/api/vault/*`, which proxy to **vault-server** (Fastify, on the
  Droplet at `10.116.16.2:7779 → 7777`) over the DO VPC.
- **Architecture / Settings** — system topology and configuration surfaces.

## Memory tab — vault-driven

The Memory tab renders the human knowledge brain: an Obsidian-format vault
(`wiki/`, `+inbox/`, `+sources/`) that is Syncthing-paired between the Mac and
the Droplet's `/opt/vault`. vault-server serves it; the dashboard's
`/api/vault/*` routes are a thin read proxy.

**Writes are deliberately constrained:**

- **Discard** — the dashboard archives an inbox item (`inbox/ → inbox/archived/`).
  This is the _only_ sanctioned cloud write, on an inbox-only mount; `wiki/` is
  mounted read-only.
- **Promote** — human-applied in Obsidian. The dashboard drafts the merge and
  hands off via an `obsidian://` deep link; there is no server-side `/promote`
  write.

The earlier OpenViking-premise Memory UI (`CategoryBrowser`, `AbstractList`,
`DetailView`, `RetrievalTrajectoryGraph`, `/api/memory/*`) was reverted and
deleted by the 2026-05-29 corrective spec. The Memory tab is now vault-driven.

## Deploy

App Platform auto-deploys this app on every push to `main`. Stateful services
(vault-server, OpenViking, Postgres, Ollama, Hermes) run on the Droplet and are
reached over the private DO VPC.

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test
pnpm typecheck
pnpm lint
```

## Authoritative docs

- Memory tab: [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](../../docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md)
- Inbox writes: [`docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`](../../docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md)
- Doc index: [`docs/README.md`](../../docs/README.md)
