# Information Architecture Doc Rewrite — Design Spec

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Target artifact:** `docs/information-architecture.md` (full rewrite)

## Context

`docs/information-architecture.md` (787 lines) has diverged from the shipped
dashboard. The 2026-06-02 documentation audit flagged it and applied a holding
banner; this is the rewrite that retires the banner.

Key divergences:

- The IA documents **3 views** (`/architecture`, `/memory`, `/observability`).
  The dashboard shipped **5 tabs**: **Runs, Architecture, Cost, Health, Memory**.
  The old single `/observability` view split into Runs + Cost + Health.
- A persistent **KpiVista** banner + per-tab **Vista** hero shells exist now;
  the doc doesn't mention them.
- `/observability` lingers as an **orphaned route** (not in the TabBar).
- Settings document a local **Hermes daemon** + **Sandcastle** (both gone).
- §7 **Model Routing Strategy** is agent-runtime config, not dashboard IA.
- Stale memory model (Honcho/Letta, OpenViking-premise Memory UI, "promote
  writes via API"); the real Memory tab is vault-driven with the
  discard/promote model.

## Goal

Rewrite `docs/information-architecture.md` as a **living, status-badged
reference for the dashboard's information architecture only**, matching the
shipped 5-tab + vista-shell reality and the two-brain memory model.

## Locked decisions (from brainstorming)

1. **Role = living doc.** Every section carries a status badge: **✅ Shipped /
   🚧 WIP / 📋 Planned**. Stub-data panels are badged honestly.
2. **Boundary = dashboard IA only.** Drop §7 Model Routing and deep
   runtime/agent config; point to `docs/plans/spec1-orchestrator.md` (+ its
   spec) for runtime/model/cost-pipeline, and to the
   `2026-05-29-memory-vault-server-corrective-design.md` +
   `2026-06-01-inbox-write-surface-design.md` specs for Memory architecture.
3. **Structure mirrors the shipped tabs** — one section per tab — not the old
   "3 views" grouping and not an abstract concern-grouping.

## Ground truth the rewrite must reflect

- **Hosting:** dashboard on DO App Platform (Next.js 16), behind Cloudflare
  Access (Google SSO). Stateful services on a DO Droplet in `agenticos-vpc`
  (10.116.16.2): Postgres, Ollama, OpenViking (:1933), vault-server (:7779),
  hermes-agent (+ hermes-gateway). Reasoning provider = `openai-codex`.
- **Two-brain memory:** the Obsidian vault (vault-server :7779 → Memory tab via
  `/api/vault/*`) is the human brain; OpenViking (:1933) is the separate agent
  memory/observability brain that feeds the Runs/Cost/Health surfaces — **not**
  the Memory tab.
- **Tabs + composition (verify each in code while writing):**
  - **Runs:** RunsVista, LiveRunsStrip, run feed (LiveRunFeedSection / RunFeed),
    ScheduledRunsPanel, RecentErrorsPanel, VaultIngestPanel.
  - **Architecture:** ArchitectureVista, SkillCard catalog (skills from
    `wiki/Skills` via `/api/vault/skills`).
  - **Cost:** CostVista, CostBurndownChart, CostProjectionPanel, OpenAICodexPanel,
    OllamaPanel, RateLimitsPanel.
  - **Health:** HealthVista, AgentHealthPanel, SystemResourcesPanel, BackupsPanel,
    ExternalServicesPanel.
  - **Memory:** MemoryVista, three-pane (MemoryTree / MemoryReader / MemoryRail /
    InboxQueue), Skills + RecentChanges summary panels.
- **Shell:** persistent **KpiVista** banner (🚧 WIP — 4 readings via
  `use-kpi-data`, `EkgSweep`; currently untracked/not yet landed), **TabBar**
  (5 tabs with live counts), per-tab **Vista** hero via `VistaShell`, filter
  chip (URL/nuqs), ⌘K command palette, keyboard shortcuts, toast notifications,
  **mobile tab dropdown** (✅ shipped, PR #126).
- **Inbox model:** discard = the one sanctioned dashboard write (archive
  `inbox/ → inbox/archived/` via the inbox API; cloud writes only `inbox/`,
  `wiki/` is read-only). Promote = human-applied in Obsidian (dashboard drafts
  the page + hands off via `obsidian://` deep link; no server promote write).
- **Legacy:** `/observability` route is superseded by Runs/Cost/Health (orphaned,
  to be removed — a separate code task). The OpenViking-premise Memory UI
  (CategoryBrowser/AbstractList/DetailView/RetrievalTrajectoryGraph) was deleted.

## Target document structure

Front matter: purpose · audience · **status-badge legend** · out-of-scope
pointers (runtime/model/cost → spec1-orchestrator; Memory architecture →
corrective + inbox specs).

1. **Global Shell & Navigation** — KpiVista banner (🚧), TabBar (5 tabs),
   per-tab Vista hero pattern (`VistaShell`), filter chip, ⌘K palette, keyboard
   shortcuts, notifications, mobile tab dropdown (✅).
2. **Runs** — components + their data sources (Postgres `/api/tasks/*`, Hermes
   cron for schedules), run detail, status badges.
3. **Architecture** — skill catalog from `/api/vault/skills`, skill card +
   detail, empty states, status.
4. **Cost** — burndown/projection, provider panels (Codex/Ollama), rate limits;
   note which read real cost telemetry vs stub; status.
5. **Health** — agent health, system resources, backups, external services;
   status (badge stub panels honestly).
6. **Memory** — two-brain framing; MemoryVista; three-pane via `/api/vault/*`;
   Skills + Recent-Changes panels; **inbox discard (write) + promote (Obsidian
   draft/deep-link)**; backlinks/outgoing/search/graph; "vault vs Obsidian — when
   to use which." Cross-reference the corrective + inbox specs.
7. **Cross-View Patterns** — filter persistence (URL/nuqs), search semantics,
   notification consistency, real-time updates (SSE/polling), and the
   **two-brain separation** (OpenViking feeds Runs/Cost/Health; vault = Memory).
8. **Settings** (UI surface only) — appearance, vault info, provider status
   (link to runtime spec for config), data/backups. **Drops** Hermes Daemon +
   Sandcastle.
9. **Mobile** — shipped tab dropdown + responsive vistas/panels; deferred items.
10. **Wireframes** — ASCII, redrawn for the 5-tab + vista shell.

**Appendix — Legacy / removed:** `/observability` route (superseded by
Runs/Cost/Health, slated for deletion); the OpenViking-premise Memory UI
(removed); §7 Model Routing (relocated to the runtime spec).

## Per-section requirements

- Each tab section lists its **components**, their **real data source / API
  route**, key **interactions**, **empty/error states**, and a **status badge**.
- Badges must be **verified against code** while writing — do not assume.
  Panels that render placeholder/stub data are badged 🚧, with a one-line note.
- Where the old doc had still-accurate content (Memory three-pane, filter chip,
  palette, tags), carry it forward (corrected), don't discard wholesale.
- Keep the doc's existing voice/format conventions (numbered sections, anatomy
  call-outs, ASCII wireframes).

## Non-goals (YAGNI)

- Not rewriting runtime/model-routing content (relocated; pointer only).
- Not building or changing any UI (documentation only).
- Not deleting the orphaned `/observability` route (flagged as a separate code
  cleanup task).

## Acceptance criteria

1. `docs/information-architecture.md` documents all 5 shipped tabs + the
   global shell, each with an accurate status badge.
2. No stale references remain: Hermes-daemon-settings, Sandcastle, Honcho, Letta,
   localhost-only, OpenViking-premise Memory UI, "promote writes via API."
3. The two-brain model + inbox discard/promote model are stated correctly.
4. §7 Model Routing is removed; a pointer to the runtime spec is present.
5. The holding banner is removed (the doc is now current).
6. Cross-references resolve; markdownlint passes.
7. The legacy appendix records `/observability` (for removal) + the deleted
   Viking-premise UI.
