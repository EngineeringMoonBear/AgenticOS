# ADR 0006: Replace Hermes with Paperclip's runtime

**Status**: Accepted
**Date**: 2026-06-09
**Supersedes**: [ADR 0005 — Letta to composed stack](0005-letta-to-composed-stack.md)

## Context

ADR 0005 established Hermes Agent as the single agent runtime — a Docker
container on the Droplet handling orchestration, cron scheduling, cost tracking,
and reasoning via the `openai-codex` provider. OpenViking served as the agent
memory provider; the Obsidian vault (via vault-server) served as the human
memory brain.

Scaling AgenticOS from a single-operator system to 4 humans (near-term) and
10–50 humans (eventual) exposed limits in the Hermes-centered architecture:

- **No multi-human model.** Hermes has no concept of org charts, role-based
  assignment, approvals, or per-human budgets.
- **No multi-model orchestration.** Switching between Claude, Codex, and
  DeepSeek required manual config changes — there was no adapter registry or
  per-task model selection.
- **No governance layer.** Budget policies, approval gates, and agent reviews
  were absent.

[Paperclip](https://github.com/paperclipai/paperclip) (MIT, 70k stars) is an
open-source multi-agent company simulator with: a mutable adapter registry
(13+ built-in adapters including `claude_local`, `codex_local`,
`opencode_local`), heartbeat-driven scheduling, issue-to-agent assignment,
org charts, budget policies, approval workflows, a plugin SDK, and a skills
catalog — all backed by an 80+ table Postgres schema.

Running Paperclip alongside Hermes would create a two-orchestrator problem
where neither has the full picture of agent state, cost, or assignment.

## Decision

**Replace Hermes entirely with Paperclip's runtime.** Specifically:

- **Orchestration** — Paperclip's heartbeat scheduler and issue-assignment loop
  replace `hermes-gateway` cron and the `daily_brief`/`cost_report`/`vault_ingest`
  Python tasks.
- **Model switching** — Paperclip's adapter registry (`claude_local`,
  `codex_local`, `opencode_local` for DeepSeek, plus others) replaces Hermes'
  single `model.provider` config.
- **Cost tracking** — Paperclip's `cost_events` table and budget policies
  replace the Hermes cost telemetry + dashboard Cost tab queries.
- **Agent memory** — OpenViking becomes a Paperclip plugin (not a Hermes memory
  provider).
- **Human memory** — The Obsidian vault becomes a Paperclip plugin
  (`@agenticos/vault-plugin`) that syncs vault content, skills, and taxonomy
  into Paperclip's data model while preserving all vault governance invariants.
- **Sandbox coding** — Paperclip's execution workspaces and GitHub integration
  replace the Sandcastle spike path.

## What survives

- **The Obsidian vault** and all its governance (read-only `wiki/`/`sources/`
  mount, inbox-only cloud write, human-applied promotion via `obsidian://`
  deep link).
- **The two-brain memory model** — vault = human brain, OpenViking = agent brain.
  Both become Paperclip plugins rather than Hermes providers.
- **The brand identity** — forester's almanac palette, custom CSS, KPI Vista
  backdrops. These port as a Paperclip theme override.
- **The DO infrastructure** — Droplet + App Platform + Cloudflare Access + VPC.
  Paperclip runs where Hermes ran.
- **vault-core** package — markdown parsing, frontmatter, lint, taxonomy. Reused
  by the vault plugin.

## What is retired

- `agenticos-hermes` package (Hermes wrapper)
- `hermes-client` package (already slated for deletion)
- `hermes-gateway` cron scheduler
- Hermes Python tasks (`daily_brief`, `cost_report`, `vault_ingest`, `pr_triage`)
- The `Task/Session/Call` Postgres schema (replaced by Paperclip's tables)
- ADR 0003 scheduler-ownership (superseded — Paperclip owns scheduling)
- The Sandcastle spike design (superseded — Paperclip execution workspaces)

## Consequences

- ~~The Next.js dashboard is replaced by Paperclip's React (Vite) UI, with a
  theme override file preserving the AgenticOS brand palette and custom CSS.~~
  **Amended 2026-06-17 — see [Amendment: Dashboard kept + repointed](#amendment-2026-06-17--dashboard-kept--repointed) below.**
- Vault governance invariants must be enforced at the plugin level — the vault
  plugin's write paths are strictly scoped to `inbox/` archival.
- The PR-triage connector design (2026-06-08) ports as a Paperclip scheduled
  routine rather than a Hermes cron task.
- OpenViking integration moves from a native Hermes memory provider to a
  Paperclip plugin exposing `viking://` URIs through Paperclip's data feed
  or tool system.

## Amendment (2026-06-17) — Dashboard kept + repointed

**Status**: Accepted · amends (does not supersede) ADR 0006.

The original Consequences said the Next.js dashboard would be **replaced** by
Paperclip's own React (Vite) UI with only a theme override. That is no longer
the plan. **AgenticOS keeps its existing Next.js "Vista" dashboard and repoints
its API routes onto Paperclip's REST API** (the
[Dashboard Paperclip Repoint plan](../superpowers/plans/2026-06-17-dashboard-paperclip-repoint.md)).

**Why the change:**

- The Vista dashboard is a bespoke, branded observability surface (KPI Vistas,
  forester's-almanac palette, custom layouts) — substantially more than a theme
  override on top of Paperclip's generic operator UI. Re-skinning Paperclip's UI
  would lose that and still require rebuilding the panels.
- Repointing is decoupled from the runtime cutover: the dashboard moves onto
  Paperclip's API behind a `DASHBOARD_DATA_SOURCE` flag while Hermes is retired
  underneath it, with no UI rewrite on the critical path.
- The repoint also adds **Paperclip-native panels** (agents roster, issues /
  work-queue, routines, org + approvals) that Paperclip exposes and Hermes never
  did — capturing the same capability surface a UI swap would have, inside the
  dashboard we already own.

**What this changes vs. the original ADR:** only the dashboard-UI consequence.
Everything else in ADR 0006 (replace Hermes orchestration/cost/memory/scheduling
with Paperclip; retire the Task/Session/Call schema; OpenViking + vault as
plugins) stands unchanged.

**Open question deferred to the repoint plan (not this ADR):** the dashboard is
**read-only** against Paperclip — run write-actions (cancel / retry) that
currently call Hermes endpoints are out of scope for the repoint and resolved
per-panel there.
