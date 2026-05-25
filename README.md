# AgenticOS

One pane of glass for an autonomous AI agent fleet — observability, memory, cost, scheduling — built for the agent-runtime ecosystem of 2026.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/status-implementing--v1-blue)
![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%C2%B7%20pnpm%20%C2%B7%20Turborepo-black)

## What it is

AgenticOS is the orchestration dashboard for a single-developer agent fleet. It surfaces what your agents are doing, what they've learned about you, how much they're costing, and when they'll next run.

The architecture is intentionally a composition of best-in-class components rather than a monolith:

- **Knowledge layer** — an Obsidian-format vault on disk. Markdown files, wiki links, taxonomies. The vault is canonical knowledge; Obsidian on the Mac is a read/write view of it via Syncthing — the Droplet never runs Obsidian itself.
- **Memory layer** — [OpenViking](https://github.com/volcengine/OpenViking) (open-source context database) with filesystem-paradigm URIs (`viking://resources/…`, `viking://user/memories`, `viking://agent/skills`), L0/L1/L2 tiered loading, hybrid directory + semantic retrieval, and automatic session compression. Hermes has a first-class built-in Viking provider, so memory tools (`viking_remember`, `viking_recall`, `find`, `abstract`, …) are native to every agent. Viking runs on the Droplet alongside Hermes.
- **Agent runtime** — [Hermes Agent](https://github.com/NousResearch/hermes-agent) (headless orchestrator) + [Codex CLI](https://github.com/openai/codex) + local Ollama SLMs, all driven by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) authenticated via a Claude Max subscription — Anthropic's intended channel for programmatic use of Max.
- **Vault tools** — an MCP-to-vault server (in this repo, `apps/dashboard/lib/mcp-vault/`) exposing the vault to any MCP-capable agent.
- **Dashboard** — Next.js 16 + shadcn/ui, deployed on DigitalOcean App Platform with auto-deploy on `push to main`.
- **Auth** — Cloudflare Access (Google SSO) in front of the public dashboard URL.
- **Private network** — Tailscale connects the Droplet, your Mac, and future LAN-resident devices for SSH, vault sync, and connectors.

## Architecture (v1)

```
                  Browser (anywhere)
                         │
                         │ HTTPS → agenticos.gatheringatthegrove.com
                         ▼
                ┌──────────────────────────────┐
                │  Cloudflare Access           │
                │  (Google SSO gate)           │
                └────────────┬─────────────────┘
                             ▼
                ┌──────────────────────────────┐
                │  DO App Platform             │ ← auto-deploy on push to main
                │  AgenticOS dashboard         │
                └────────────┬─────────────────┘
                             │ DO VPC private network
                             ▼
                ┌──────────────────────────────────────┐
                │  DO Droplet                          │
                │  - Claude Code (Max OAuth)           │
                │  - Hermes Agent (cron + orchestrator)│
                │  - OpenViking (context database)     │
                │  - Codex CLI + Ollama SLMs (workers) │
                │  - Postgres (tasks + cost ledger)    │
                │  - Vault filesystem (/opt/vault)     │
                │  - Tailscale + Syncthing daemons     │
                └──────────────────────┬───────────────┘
                                       │ Tailscale mesh
                          ┌────────────┴────────────┐
                          ▼                         ▼
                  Mac (Obsidian,           Future Pi-on-LAN
                  browser, Syncthing)      (Phase 4+ connectors)
```

The full design lives in
[`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md).

## Status

**Foundation v2 spec approved. v1 implementation in planning.**

Phases 1–2 (vault editor, lint, taxonomy, MCP-to-vault server) are merged. Phase 3 originally targeted Hermes Agent as runtime, then pivoted to Letta, then pivoted to the current composed stack. The full decision trail is preserved in [`docs/archive/`](docs/archive/) and [`docs/adr/`](docs/adr/).

**v1 (MVP) scope:**

- One Curator agent — nightly vault inbox triage, accumulating user model as markdown in the Viking-backed vault
- Dashboard observability — runs, costs, memory inspection, Max quota
- GitHub Actions CI/CD — push to `main` deploys both App Platform and Droplet

**Deferred to v2 and beyond:**

- Multi-agent fleet
- Domain connectors (smart home / farm / networking / dev workflow)
- UI customization pass
- Local-burst Ollama for cheap parallel work on Mac

## Repository

```
apps/
└── dashboard/                  # Next.js 16 dashboard (App Platform target)

packages/
├── vault-core/                 # markdown parse, frontmatter, lint, taxonomy
└── config/                     # shared eslint + tsconfig

docs/
├── superpowers/specs/          # current design specs (start here)
├── adr/                        # architecture decision records
├── archive/                    # superseded designs preserved for history
├── brand.md                    # brand voice + visual identity
├── information-architecture.md # IA spec for the dashboard
└── phase-{4,5,6}-design-brief.md  # forward-looking briefs (to be re-scoped per v2+)
```

`packages/hermes-client/` exists in the current main branch and will be deleted during v1 implementation — see the foundation v2 spec for the migration plan.

## Documentation

- **Current canonical spec**: [`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md)
- **ADR 0003**: [Scheduler ownership](docs/adr/0003-scheduler-ownership.md) — affirmed (executor changed)
- **ADR 0004**: [Hermes → Letta pivot](docs/adr/0004-pivot-hermes-to-letta.md) — superseded same-day; preserved as decision trail
- **Archive**: [`docs/archive/`](docs/archive/) — Hermes-shaped and Letta-shaped Phase 3 designs

## Prerequisites for running v1

Once v1 is implemented, you'll need:

- DigitalOcean account (Droplet + App Platform — ~$29/mo marginal)
- Claude Max subscription ($100/mo, used for in-policy programmatic agent execution)
- Tailscale account (free tier)
- Cloudflare account (free tier; Access requires only the free plan)
- A Mac with Obsidian for vault editing
- A custom domain for the dashboard

**No LLM API spend** — *modulo OpenViking's LLM dependencies.* Claude Code runs against the existing Max subscription; local SLMs run via Ollama on the Droplet for cheap parallel work. OpenViking's background pipelines (TreeBuilder, Compressor, IntentAnalyzer) need an LLM; the plan is to point those at local Ollama so no external API spend accrues. Verified configuration TBD — see open question in `docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`.

## Development

```bash
pnpm install
pnpm dev          # dashboard at http://localhost:3000
pnpm test         # vitest across all packages
pnpm typecheck
pnpm lint
```

Requires Node ≥20 and pnpm ≥9.

⚠️ Next.js 16 has breaking changes from earlier versions. See `apps/dashboard/AGENTS.md` and `node_modules/next/dist/docs/` before assuming v15 patterns apply.

## Contributing

This is a single-developer project. Issues and discussion are welcome; PRs are not yet supported with review SLAs.

## License

MIT — see [LICENSE](LICENSE).

---

*Built with care by [Goldberry Grove](https://goldberrygrove.farm).*
