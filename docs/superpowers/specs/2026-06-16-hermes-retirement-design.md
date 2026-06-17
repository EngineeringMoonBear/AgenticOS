# Hermes Retirement — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** Josh + Claude
**Implements:** [ADR 0006 — Replace Hermes with Paperclip's runtime](../../adr/0006-hermes-to-paperclip-runtime.md)
**Method note:** Decisions below were pressure-tested via a function-parity deep-read
of both codebases, an LLM-council review, and a grilling pass. The headline
findings: Paperclip natively covers 6 of ~9 Hermes capabilities (often richer);
two were ritual the operator rarely consumes (dropped); one ($0 deterministic)
is worth porting.

---

## 1. Goal

Retire Hermes **entirely** — its three Droplet services, two packages, hook
plugin, cron jobs, and Task/Session/Call schema — losing **zero value the
operator actually consumes**, with the dashboard repointed onto Paperclip's
native data, at **~$0** added cost (Claude Max + DigitalOcean only).

"Zero lost value" — not "zero lost function." Hermes features the operator
rarely touches and can do on-demand via Claude are dropped, not ported. Porting
unmeasured ritual is where maintenance burden hides.

## 2. Disposition of every Hermes function

| Hermes function | Decision | Rationale |
| --- | --- | --- |
| `daily-brief` (Codex morning digest) | **Drop** | Rarely read; Claude on-demand covers it. |
| `cost-report` (nightly spend markdown) | **Drop** | Redundant — Paperclip has native `cost_events` + the repointed Cost tab. |
| `inbox-triage` + `inbox-watcher` (fs-watch → SLM classify → move) | **Drop** | Rarely used; Claude on-demand covers it. No Paperclip analog, not worth rebuilding. |
| `vault_ingest` (vault markdown → OpenViking semantic memory) | **Port** as a $0 deterministic plugin job | Gives agents semantic recall over the whole vault — the "smart curated memory" North Star. Local-embedding only (no reasoning LLM), so **exempt from the cost-blindness constraint** (§6). |
| Cron scheduling (`hermes-gateway`) | **Retire** → Paperclip plugin jobs + routines | Native, richer (deterministic jobs *and* agentic routines). |
| Cost telemetry (`cost-recorder` hook, Task/Session/Call) | **Retire** → Paperclip `cost_events` + cost API | Native, richer (per-agent/model/provider breakdowns). |
| Budget enforcement (`routing.py` MTD block) | **Retire** → Paperclip budget policies | Native (hard-stop 100% / soft 80%, per-company + per-agent). |
| Model routing (SLM↔Codex) | **Retire** → adapter registry + per-agent/per-issue override | Native, more flexible. |
| Agent runs/sessions | **Retire** → `heartbeat_runs` + `activity` log | Native, richer. |
| Dashboard Cost/Runs/agent-health | **Repoint** onto Paperclip REST API | §4. |

## 3. What is deleted (code & infra)

- **Compose services:** `hermes-agent`, `hermes-gateway`, `inbox-watcher` (+ the
  `hermes-data` volume).
- **Packages:** `packages/agenticos-hermes/`, `packages/hermes-client/`.
- **Hook plugin:** `packages/agenticos-hermes/plugins/cost-recorder/`.
- **Cloud-init:** the hermes-agent image build, `register-cron-jobs.sh`
  invocation, and the hermes-config copy block in
  `infra/cloud-init/droplet-bootstrap.yaml.tpl`.
- **Cron wrappers:** `packages/agenticos-hermes/wrappers/cron-scripts/`.

## 4. Dashboard repoint (the centerpiece)

The dashboard (Next.js on DO App Platform) currently reads the Hermes
Task/Session/Call schema **directly from Postgres**. It moves to Paperclip's
**REST API** (board-key auth, reached over the VPC — the same path it already
uses for `agenticos-db` / `openviking` / `vault-server`).

**Why the API, not direct reads of the `paperclip` DB:** the API is Paperclip's
stable, versioned contract; its 80+ internal tables are not. We will bump
Paperclip; direct table reads would silently break on schema drift.

Tab-by-tab source mapping:

- **Cost tab** → `GET /api/companies/{id}/costs/{summary,by-agent,by-agent-model,by-provider}`
  (date-range params). Replaces the `calls`-table aggregation.
- **Runs feed** → `GET /api/companies/{id}/heartbeat-runs` + `GET /api/companies/{id}/activity`.
  Replaces the `tasks`/`sessions` queries.
- **Agent-health tile** → **synthesized** (no single endpoint): `agent.status`
  plus the latest `heartbeat_run` (`status`, `livenessState`, `lastOutputAt`)
  plus pending routines. This synthesis is the one piece of net-new dashboard logic
  and the riskiest read; it is verified on the preview before cutover (§5).

A board key is added to the dashboard's App Platform env (the same key the
`sync-paperclip-secrets.sh` flow uses).

## 5. Sequencing — gated, parallel-run (NOT clean cutover)

The council split 3–2 for parallel-run over clean cutover; the deciding factor
is that the agent-health synthesis and the schema-reads→API change are unproven
against real data, so we prove before we tear out.

1. **Dashboard preview on Paperclip API**, Hermes untouched. Stand the dashboard
   up against Paperclip on a preview/branch URL; verify the Cost tab and the
   synthesized agent-health tile render correctly against real Paperclip data.
2. **Port `vault_ingest`** as a plugin job; run it alongside Hermes's hourly job;
   diff outputs for 2–3 cycles; then disable Hermes's `vault-ingest` cron.
3. **Cut** the live dashboard's data source from the Hermes schema to Paperclip.
4. **Retire Hermes services** one at a time (`gateway` → `inbox-watcher` →
   `agent`), watching for silent scheduling gaps after each.
5. **Delete** the packages, hook plugin, and cloud-init Hermes blocks.

**Gating preconditions before step 3:** plugin config/secrets proven working
(the existing plain-config `sync-paperclip-secrets.sh` path); `vault_ingest`
port verified against Hermes output (step 2).

## 6. The cost-blindness constraint (and why `vault_ingest` is exempt)

Paperclip records LLM cost only when an **agent reports it via an adapter**. An
LLM call made *outside* a Paperclip agent — e.g. a deterministic plugin job that
calls Ollama/Codex directly — is **not** cost-tracked. This is why the dropped
rituals, *if* they had been ported, would have had to be **agentic routines**
(adapter-reported), not plugin jobs, to stay tracked.

`vault_ingest` is exempt: it computes **embeddings on local Ollama** (zero
marginal cost) and does no reasoning-LLM work, so there is nothing to track. It
is safe as a deterministic plugin job.

## 7. `vault_ingest` port (component detail)

Ports `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py` to
a TypeScript Paperclip plugin job. Behaviour preserved:

- Walk the vault markdown (exclude `inbox/` and dotfiles), compute SHA256 per
  file, reconcile against prior state, push new/changed files to OpenViking
  (`temp_upload` → `add_resource`), remove stale resources, all per the existing
  `HttpxVikingClient` flow.

Open design choices for the implementation plan:

- **Host plugin:** the **openviking-plugin** (it owns the Viking write client and
  already has `http.outbound`; it reaches vault-server over HTTP for content).
  A scheduled `jobs[]` entry (`vault-ingest`, hourly) mirrors the `pr-triage`
  pattern.
- **Reconciliation state** (was the `vault_ingest_state` Postgres table, now
  archived): store in a plugin DB namespace (`database.namespace.write`) keyed
  by path→sha. Alternative: derive state from OpenViking resource listing.
- **Vault read:** via vault-server's list + read endpoints (the plugin worker is
  sandboxed from the host FS), not a direct `/opt/vault` walk.

## 8. Data handling

Keep the Hermes Postgres tables (`tasks`, `sessions`, `calls`, `budget`,
`vault_ingest_state`) as a **read-only archive** in the `agenticos` database.
**No cost-history migration** — `cost_events` starts fresh; mapping legacy rows
into Paperclip's schema is fiddly work for data that is never queried
operationally. If pre-cutover cost history is ever needed, it remains queryable
in the archive.

## 9. What survives (unchanged)

Per ADR 0006: the Obsidian vault + its governance, the two-brain memory model
(vault = human brain via vault-plugin; OpenViking = agent brain), the brand
identity, the DO infrastructure, and the `vault-core` package.

## 10. Testing & verification

- **`vault_ingest` port:** unit tests over fixture vault trees (new/changed/
  removed reconciliation), mirroring `test_vault_ingest.py`; a live diff against
  Hermes's job output for 2–3 cycles (step 2) is the acceptance gate.
- **Dashboard repoint:** the preview URL (step 1) renders Cost + agent-health
  against real Paperclip data before any cutover; existing dashboard e2e
  (Playwright) updated to the new data source.
- **Retirement safety:** after each Hermes service is removed (step 4), confirm
  no scheduled work silently stopped (the only remaining scheduled work is the
  Paperclip plugin jobs, which the deploy workflow + `plugin list` cover).

## 11. Out of scope (YAGNI)

- Re-implementing `daily-brief` / `inbox-triage` in any form (dropped; Claude
  on-demand). If `daily-brief` is ever wanted back, it must be an **agentic
  routine** (cost-tracked), not a plugin job — noted, not built.
- Cost-history migration (archive only).
- Any Paperclip version bump (separate effort; this spec targets the pinned
  `2026.609.0`).

## 12. Acceptance criteria

- All three Hermes services, both packages, the hook plugin, and the cloud-init
  Hermes blocks are removed; `pnpm -w typecheck` + builds stay green.
- The dashboard's Cost tab, Runs feed, and agent-health tile render from
  Paperclip's API with no Hermes dependency.
- `vault_ingest` runs as a $0 Paperclip plugin job, verified against Hermes
  output, keeping vault content semantically searchable in OpenViking.
- The Hermes Postgres archive remains readable; no cost-history is lost, none is
  migrated.
- No scheduled work is silently dropped during or after the cutover.
- ~$0 recurring cost is unchanged.
