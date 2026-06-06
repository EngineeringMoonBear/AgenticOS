# Sandcastle Spike — Design Spec

**Date:** 2026-06-06
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Topic:** Evaluate `mattpocock/sandcastle` as the foundation for sandboxed,
code-producing agent dispatch (the capability the dropped "Phase 4 — Sandcastle
Integration" once scoped).

## Context

`mattpocock/sandcastle` is a TypeScript library — *"Orchestrate sandboxed coding
agents in TypeScript with `sandcastle.run()`"* — providing Docker/Podman/Vercel
sandbox providers, branch strategies (head / merge-to-head / named), prompt
templating, session capture/resume, multi-iteration workflows with structured
output extraction, and lifecycle hooks. It supports Claude Code, Codex, and Pi
as agents.

Two findings from exploring the current system shaped this spike:

1. **There is no `run-curator.sh`.** The shipped autonomous agents are **Hermes
   Python tasks** (`daily_brief`, `cost_report`, `vault_ingest`) that call
   `run_codex()` *inside the hermes container* and write `Task/Session/Call`
   rows to Postgres. The `lib/agent/spawn.ts` + `RunRecord` bash-curator path
   from the original foundation-v2 plan is **dead code**.
2. **Those tasks don't produce code** — `daily_brief` uses gpt-5-codex to
   synthesize *prose* into `/opt/vault/daily-briefs/*.md`. Sandcastle's
   value-add (branch/commit/merge) is built for agents that produce **code
   commits**. So Sandcastle's sweet spot is the *dropped Phase-4 dispatch
   capability* (a dev agent that edits a repo → branch/PR), **not** the curator.

This spike therefore evaluates Sandcastle at its actual strength, as a
**buy-vs-build** check: the deferred parallel-dev-dispatch capability may now
cost a dependency instead of a subsystem.

## Goal

Prove — locally, with zero production or Hermes/Postgres entanglement — that
`sandcastle.run()` can take a checkout of AgenticOS, run a **Codex** agent in an
isolated **Docker** sandbox, have it make a **real, verifiable code change**, and
return a **branch + structured result**.

This spike answers exactly one question: *does this tool work for us, on a real
task, on our box?* It deliberately refuses to answer scheduling, telemetry,
parallelism, or deployment questions.

## Locked decisions (from brainstorming)

1. **Target = code-producing PR-bot** (Sandcastle's strength), not the
   vault-writing curator.
2. **Environment = local Mac, by hand.** OrbStack provides Docker. No Droplet,
   no systemd, no CI.
3. **Task = add a focused unit test for one currently-untested pure helper, and
   make it pass.** Exercises the full loop including running the toolchain
   (`vitest`) *inside* the sandbox. Fallback if in-sandbox dependency install is
   too heavy: a no-build doc/JSDoc change verified by inspection.
4. **Branch + manual draft PR.** Sandcastle produces a named branch
   (`spike/sandcastle-<timestamp>`); the human inspects it and optionally runs
   `gh pr create --draft`. **No auto-PR, no auto-merge.**
5. **Docker provider** (not Podman — OrbStack speaks Docker; not Vercel — costs
   money, violates the $0 envelope).

## Architecture

A single self-contained throwaway entry point, isolated from app code:

```
experiments/sandcastle-spike/
  run.ts          # calls sandcastle.run(), prints the structured result
  README.md       # how to run it + how to read the result + how to clean up
  package.json    # declares the `sandcastle` dependency for the experiment
```

- The `experiments/` directory signals "delete-me-if-no" — the spike can fail
  and be removed cleanly without touching `apps/` or `packages/`.
- Run by hand via `tsx` (e.g. `pnpm dlx tsx
  experiments/sandcastle-spike/run.ts`); the exact invocation is pinned in the
  plan against the repo's pnpm-workspace conventions.

### `run.ts` responsibilities (the only integration surface)

- Configure `sandcastle.run()` with:
  - **provider:** Docker (OrbStack).
  - **agent:** Codex.
  - **source:** a checkout/working-tree of this repo (Sandcastle clones it into
    the sandbox; the host tree is never mutated).
  - **branch strategy:** named — `spike/sandcastle-<timestamp>`.
  - **prompt:** templated task instruction (the test-adding task), written so
    the agent knows the test framework is `vitest` and to run it before
    finishing.
  - **structured output schema:** capture `{ completed: boolean, summary:
    string, filesChanged: string[], testResult?: string }` (exact field names
    pinned in the plan against Sandcastle's structured-output API).
- Print the structured result to stdout as JSON.

> **API-shape caveat:** the exact `sandcastle.run()` option names, the provider
> constructor, and the structured-output mechanism must be **pinned against the
> library's README/types during implementation** — this spec fixes the *intent*,
> the plan fixes the *exact calls*. The first plan task is "read the Sandcastle
> README + types and record the real API."

## Credentials

Codex auth is passed **into the sandbox via environment variable**
(`OPENAI_API_KEY` / Codex creds) sourced from the operator's shell or 1Password
("Goldberry Grove - Admin") at run time. Never committed, never written to a
tracked file. `run.ts` reads it from `process.env` and hands it to Sandcastle's
sandbox env injection; the `README.md` documents the `export …` the operator
runs first.

## Verification — success requires ALL of the following

1. A local branch `spike/sandcastle-*` exists with a sensible diff (a new test
   file + any minimal supporting change).
2. The structured result prints cleanly with `completed: true` and a
   `filesChanged` list — proving the structured-output extraction path that a
   future telemetry integration would map to `Task/Session/Call`.
3. If the test-adding task was used: the new test **passes inside the sandbox**
   (the agent ran `vitest` and reported green), proving the sandbox can run the
   project toolchain.
4. The host working tree is **unmodified** (the change lives only on the
   sandbox-produced branch) — proving isolation.
5. The operator can inspect the branch and, optionally, open a draft PR by hand.

A spike "fails informatively" too: if Codex auth can't reach the sandbox, or the
sandbox can't run `vitest`, or the structured output can't be extracted — those
are *findings*, recorded in the experiment README, that decide against (or
reshape) adoption.

## Out of scope (YAGNI — explicitly NOT in this spike)

- Parallel / multi-agent dispatch.
- Postgres `Task/Session/Call` telemetry wiring (the structured result is only
  printed, not persisted).
- Scheduling, systemd timers, cron.
- Droplet deployment / running it anywhere but the Mac.
- Replacing Hermes or the `run_codex` worker.
- Auto-PR creation or auto-merge.
- The Vercel sandbox provider.

Each is a follow-up *only if* the spike proves out.

## Acceptance criteria

1. `experiments/sandcastle-spike/{run.ts,README.md,package.json}` exist; nothing
   under `apps/` or `packages/` is modified.
2. Running `run.ts` on the Mac (with Docker up + Codex creds exported) produces a
   `spike/sandcastle-*` branch and prints a structured JSON result.
3. The change is real and verifiable (a passing test, or an inspectable doc
   diff) and lives only on the branch — host tree clean.
4. The experiment README records: the exact run command, the observed result,
   and a one-paragraph **verdict** (adopt / reshape / drop) with reasoning —
   this is the spike's actual deliverable.
5. No secrets committed; no production systems touched.

## Decision the spike informs (the point of it all)

If it proves out: a follow-up phase can wire Sandcastle as the
**parallel-dev-dispatch** layer the original Phase 4 wanted — multiple agents
across project roots in sandboxes, structured results feeding the Postgres run
feed. If it doesn't: we delete `experiments/sandcastle-spike/` and the verdict
explains why, at the cost of one evening, not a subsystem.
