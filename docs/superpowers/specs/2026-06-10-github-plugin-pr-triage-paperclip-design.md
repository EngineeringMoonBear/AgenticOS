# GitHub Plugin — PR-Triage (Paperclip-native) — Design

**Date:** 2026-06-10
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** Josh + Claude
**Supersedes:** `2026-06-08-dev-github-pr-triage-connector-design.md` (the
Hermes-cron version) and its plan
`docs/superpowers/plans/2026-06-08-dev-github-pr-triage-connector.md`. Hermes is
being retired per [ADR 0006](../../adr/0006-hermes-to-paperclip-runtime.md); this
re-grounds the same connector on the Paperclip runtime.
**Fleshes out:** §5.2 / step 8 of the
[Paperclip integration design](./2026-06-09-paperclip-integration-design.md)
("Port PR-triage as Dev Agent scheduled routine").

---

## 1. Goal

A read-only daily triage of open pull requests across the GitHub org that
produces a "what needs your attention" digest — implemented as a **Paperclip
plugin with a deterministic internal scheduled job**, mirroring the
already-built `vault-plugin` and `openviking-plugin`.

## 2. What carries over vs what changes

**Carries over (approved decisions):** read-only; all `EngineeringMoonBear` org
repos with open PRs; daily 07:30 ET; the six buckets (`ci-failing`,
`needs-review`, `ready-to-merge`, `has-conflicts`, `stale`, `draft`); a living
digest the human reads; per-repo error isolation; ~$0 cost.

**Changes (runtime port):**

| Hermes version | Paperclip version |
| --- | --- |
| `tasks/pr_triage.py` (Python) | `@agenticos/github-plugin` (TypeScript plugin) |
| `register-cron-jobs.sh` + gateway scheduler | `manifest.jobs` + `ctx.jobs.register` (Paperclip heartbeat scheduler) |
| writes `/opt/vault/...` on disk | writes via vault-server HTTP (plugins don't touch the FS) |
| records a Postgres `tasks` row | the job run is recorded natively by Paperclip (Runs view) |
| local SLM prose intro | **dropped** — deterministic job, no LLM (the prose intro was the only LLM use; a future agentic routine can add it) |

## 3. Why a deterministic plugin job (not a Dev Agent routine)

§5.2 lists PR-triage under the Dev Agent / `codex_local`. We deliberately
implement it as a **deterministic plugin job** instead:

- The triage is fully mechanical (CI status, review state, mergeability, age) —
  no reasoning needed.
- Keeps the original **~$0** cost profile (no Codex tokens per daily run).
- Mirrors how `vault_ingest` was "absorbed" into the vault plugin as an internal
  job (Paperclip design §5.2).
- An agentic Dev Agent layer (smarter prioritization, light actions) can be
  added later on top of the same read-only tools — this is the safe first cut.

## 4. Architecture

A new Paperclip plugin `@agenticos/github-plugin` (TS, esbuild-bundled worker,
same shape as the existing two plugins). It exposes:

- **An internal scheduled job** `pr-triage` (daily 07:30) that runs the
  five-step pipeline in code: **fetch → classify → render → write → done.**
- **Read-only tools** (so a Dev Agent can also query PRs on demand later):
  `github_list_prs`, `github_pr_detail`, `github_pr_checks`.

```
Paperclip heartbeat (cron 30 7 * * *)
  → ctx.jobs.register("pr-triage", fn)
      → fetch    GitHubClient: org open PRs (Search API) + per-PR detail/checks/reviews
      → classify pure function → buckets per PR
      → render   deterministic markdown digest
      → write    PUT digest to vault-server → wiki/_meta/dev-pr-digest.md
      → done     (job run + output recorded natively by Paperclip)
```

Downstream, for free: the vault-plugin's ingest job picks the digest into
OpenViking (agent memory); the dashboard Memory tab shows the note; Paperclip's
native Runs view shows the job run.

## 5. Components

Mirrors the existing plugins (`src/worker.ts` + `src/<client>.ts` +
`src/tools/*` + `tests/*`), esbuild bundling, `@paperclipai/plugin-sdk`
pinned to `2026.609.0`.

### 5.1 `src/github-client.ts` — read-only GitHub REST client

Ports the Hermes-spec GitHub logic to TS (`fetch`-based, the vault-plugin
client style):

- `searchOpenPrs(org)` → open PRs across the org via `GET /search/issues?q=org:{org}+is:pr+is:open+archived:false`.
- `prDetail(repo, number)` → `mergeable_state` + head SHA.
- `prChecksState(repo, sha)` → roll up `GET /commits/{sha}/check-runs` to `success|failure|pending|none`.
- `prReviewState(repo, number)` → latest decisive review per author → `approved|changes_requested|none`.
- Bearer auth via `GITHUB_TOKEN`. **No write calls.** Returns a `Result<T>`
  discriminated union (same `{ ok, data } | { ok:false, error }` pattern as
  vault-client) so failures are typed, not thrown.

### 5.2 `src/classify.ts` — pure bucket classifier

`classifyPr(facts, now, staleDays): string[]` — deterministic, no I/O (the
`assess_pr` logic from the Hermes spec): draft, ci-failing, has-conflicts,
needs-review, ready-to-merge, stale. The primary unit-test target.

### 5.3 `src/render.ts` — deterministic digest markdown

`renderDigest(assessed, generatedAt): string` — a "🔔 Needs your attention"
section (priority-ordered) + an all-PRs table + an errors footer. No LLM.

### 5.4 `src/tools/*.ts` — read-only tool handlers

Thin wrappers exposing the client methods as Paperclip tools (for on-demand
Dev Agent use), returning `ToolResult` via the `toToolResult` pattern already
used in the other plugins.

### 5.5 `src/worker.ts` — plugin entry

`definePlugin({ setup })` that: constructs the `GitHubClient`; registers the
read-only tools; and registers the `pr-triage` job via `ctx.jobs.register`. The
job calls fetch → classify → render → write.

### 5.6 vault-server write endpoint (dependency — new)

The digest must land in the vault, but vault-server today only exposes read
endpoints + `POST /discard`. **This spec requires a minimal vault-server write
endpoint** — `PUT /page` (body `{ path, content }`, restricted to a safe
subtree such as `wiki/_meta/`) — and a `writePage(path, content)` method on the
github-plugin's vault HTTP client. The job calls it to upsert
`wiki/_meta/dev-pr-digest.md` (world-readable, per the soak's permission
lesson). If the endpoint is judged out of scope, the fallback is to store the
digest as an OpenViking memory via the openviking client instead (noted in §11).

## 6. Configuration & auth

- `GITHUB_TOKEN` — fine-grained read-only PAT (Contents, Pull requests, Checks,
  Metadata). Josh provisions it; injected into the Paperclip plugin worker env.
- `GITHUB_ORG` (default `EngineeringMoonBear`).
- `PR_TRIAGE_STALE_DAYS` (default 7), `PR_TRIAGE_VAULT_PATH`
  (default `wiki/_meta/dev-pr-digest.md`).
- **Capabilities** (manifest): `jobs.schedule` (the scheduled job),
  `http.outbound` (GitHub API). Categories: `["connector"]`.
- **Schedule:** `manifest.jobs` entry `{ jobKey: "pr-triage", displayName: "PR
  Triage", schedule: "30 7 * * *" }`.

## 7. Cost

Pure code + GitHub REST (5000/hr authenticated limit, far above a daily poll) +
one vault-server write. **No LLM. ~$0**, within the Max + DigitalOcean budget.

## 8. Error handling

- Per-repo failures collected, not fatal; the run completes with an `errors`
  list in the digest footer (the "don't swallow errors" lesson).
- Missing/invalid `GITHUB_TOKEN` → the job fails loud (Paperclip records the
  failed run); no partial digest written.
- vault-server write failure → the job fails loud; the prior digest stays.

## 9. Testing (TDD, vitest — same harness as the other plugins)

- **`classify`** — unit tests over fixture PR facts (each bucket + combinations
  + stale boundary).
- **`render`** — snapshot/segment test from fixed assessed input.
- **`github-client`** — mocked `fetch` (the vault-client test style) asserting
  read-only calls, pagination, and fact extraction; never hits the network.
- **job** — the registered `pr-triage` fn with client/writer mocked, asserting
  fetch→classify→render→write wiring + error isolation.

## 10. Surfacing

- **Digest note** in the vault (Memory tab + OpenViking via the vault ingest
  job).
- **Job run** in Paperclip's native Runs view (no custom dashboard code).

## 11. Out of scope (YAGNI)

- Writing/acting on GitHub (labels, comments, merges) — read-only v1.
- The agentic Dev Agent routine (codex_local reasoning over PRs) — a later layer
  on the same read-only tools.
- Multi-org; issue triage; webhooks.
- **Fallback if the vault-server write endpoint is deferred:** store the digest
  as an OpenViking memory instead of a vault page (loses the Obsidian-readable
  copy but keeps memory + a Paperclip run record).

## 12. Acceptance criteria

- The `github-plugin` builds (esbuild) and `pnpm -w typecheck` stays green.
- Running the `pr-triage` job (locally or on the Droplet) writes a digest
  listing real open PRs across `EngineeringMoonBear`, with a "needs attention"
  section, and records a Paperclip job run.
- The digest note is picked into OpenViking by the vault ingest job.
- All unit tests pass; the plugin adds **$0** recurring cost.
- `@paperclipai/plugin-sdk` is pinned (no `latest`).
