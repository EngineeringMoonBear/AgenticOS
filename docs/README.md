# AgenticOS Documentation Index

A status map of the design docs so readers land on the live ones. The project
has evolved through several pivots (Hermes → Letta → composed stack → Paperclip;
Honcho → OpenViking; Claude Max → Codex → multi-model adapters), so most older
docs carry a **SUPERSEDED** banner. Start here.

## Current authoritative docs — read these

| Doc | Purpose |
|---|---|
| [`superpowers/specs/2026-06-09-paperclip-integration-design.md`](superpowers/specs/2026-06-09-paperclip-integration-design.md) | **CURRENT.** Paperclip integration — full architecture, deployment, plugins, agents, adapters, UI migration, migration sequence. |
| [`adr/0006-hermes-to-paperclip-runtime.md`](adr/0006-hermes-to-paperclip-runtime.md) | **CURRENT.** ADR: Replace Hermes with Paperclip runtime. Supersedes ADR 0005. |
| [`superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) | **CURRENT.** vault-server + the vault-driven Memory model. vault-server survives the Paperclip migration as the read-only enforcement boundary. |
| [`superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md) | **CURRENT.** Inbox promote/discard write model. Discard archives `inbox/ → inbox/archived/` (only sanctioned cloud write); promote is human-applied in Obsidian. Unchanged by Paperclip migration. |

## Specs

| Doc | Status | Purpose |
|---|---|---|
| [`superpowers/specs/2026-06-09-paperclip-integration-design.md`](superpowers/specs/2026-06-09-paperclip-integration-design.md) | **Current** | Paperclip integration — the active architecture. |
| [`superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) | Current | vault-server + vault-driven Memory model. |
| [`superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md) | Current | Inbox promote/discard write surface. |
| [`superpowers/specs/2026-06-08-dev-github-pr-triage-connector-design.md`](superpowers/specs/2026-06-08-dev-github-pr-triage-connector-design.md) | Current (porting) | PR-triage connector — architecture valid, ports to Paperclip scheduled routine. |
| [`superpowers/specs/2026-06-03-kpivista-wire-and-land-design.md`](superpowers/specs/2026-06-03-kpivista-wire-and-land-design.md) | Current (porting) | KPI Vista — visual design valid, ports to Paperclip plugin UI contribution. |
| [`superpowers/specs/2026-06-02-ia-spec-rewrite-design.md`](superpowers/specs/2026-06-02-ia-spec-rewrite-design.md) | Superseded | IA spec rewrite — superseded. Current dashboard direction: the Next.js dashboard repoint ([ADR 0006 amendment](adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed)), not Paperclip's native UI. |
| [`superpowers/specs/2026-05-25-v2-unified-dashboard-design.md`](superpowers/specs/2026-05-25-v2-unified-dashboard-design.md) | Superseded | Unified dashboard shell — superseded. (The interim "adopt Paperclip's React UI" direction was itself reversed: the Next.js "Vista" dashboard is kept + repointed — [ADR 0006 amendment](adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed).) |
| [`superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`](superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md) | Superseded | Spec 1 — Hermes orchestrator + cost observability. Replaced by Paperclip runtime. |
| [`superpowers/specs/spec1-verified-api-shapes.md`](superpowers/specs/spec1-verified-api-shapes.md) | Superseded | Verified API shapes for Spec 1 (Hermes-era). |
| [`superpowers/specs/2026-06-06-sandcastle-spike-design.md`](superpowers/specs/2026-06-06-sandcastle-spike-design.md) | Superseded | Sandcastle spike — replaced by Paperclip execution workspaces. |
| [`superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md) | Superseded | Architectural ancestor (Honcho + Claude Max era). |

## Plans

| Doc | Status | Purpose |
|---|---|---|
| [`plans/spec1-orchestrator.md`](plans/spec1-orchestrator.md) | Superseded | Runtime build plan (Hermes/OpenViking/Codex) — replaced by Paperclip. |
| [`plans/v2-unified-dashboard.md`](plans/v2-unified-dashboard.md) | Superseded | Dashboard build plan — superseded. Current direction: the Next.js dashboard repoint onto Paperclip's API ([ADR 0006 amendment](adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed)), not Paperclip's own UI. |
| [`plans/phase-2-vault-memory.md`](plans/phase-2-vault-memory.md) | Partially current | vault-core / Memory lineage valid; promotion model unchanged. |
| [`plans/phase-1-mvp-foundation.md`](plans/phase-1-mvp-foundation.md) | Superseded | Early all-mock dashboard scaffold. |
| [`plans/phase-3-hermes-integration.md`](plans/phase-3-hermes-integration.md) | Superseded | Hermes integration — replaced by Paperclip. |
| [`plans/foundation-v2-mvp.md`](plans/foundation-v2-mvp.md) | Historical | foundation-v2 MVP plan (Honcho/Claude-Max era). |

## Architecture Decision Records

ADRs live in [`adr/`](adr/) in sequence. The current decision is **0006**.

| ADR | Status | Purpose |
|---|---|---|
| [`adr/0001-state-management.md`](adr/0001-state-management.md) | Accepted | Client state management choice. |
| [`adr/0002-ui-library.md`](adr/0002-ui-library.md) | Accepted | UI library choice (shadcn/ui — carries into Paperclip theme). |
| [`adr/0003-scheduler-ownership.md`](adr/0003-scheduler-ownership.md) | Superseded | Scheduler ownership — superseded by Paperclip heartbeat scheduler. |
| [`archive/0004-pivot-hermes-to-letta.md`](archive/0004-pivot-hermes-to-letta.md) | Superseded (archived) | Hermes → Letta pivot. Letta never adopted. |
| [`adr/0005-letta-to-composed-stack.md`](adr/0005-letta-to-composed-stack.md) | Superseded | Letta → composed stack (Hermes + OpenViking + Codex). Superseded by 0006. |
| [`adr/0006-hermes-to-paperclip-runtime.md`](adr/0006-hermes-to-paperclip-runtime.md) | **Accepted (current)** | Hermes → Paperclip runtime. Supersedes 0005. |

## Archive

[`archive/`](archive/) holds superseded designs preserved as decision trail —
the Hermes-shaped, Letta-shaped, and Sandcastle-shaped docs. See
[`archive/README.md`](archive/README.md). Do not use them as current spec.

## Other docs

- [`information-architecture.md`](information-architecture.md) — IA spec (superseded by Paperclip native UI; retained for vault-server API reference).
- [`brand.md`](brand.md) — brand voice + visual identity (carries into Paperclip theme override).
- `phase-{4,5,6}-design-brief.md` — forward-looking briefs, to be re-scoped under Paperclip.
