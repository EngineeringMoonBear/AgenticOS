# Sandcastle Spike

Throwaway evaluation of `mattpocock/sandcastle` — published on npm as
**`@ai-hero/sandcastle`**. See the spec:
`docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md` and the plan:
`docs/superpowers/plans/2026-06-06-sandcastle-spike.md`.

> ⚠️ **Package-name gotcha:** the bare npm name `sandcastle` is an *unrelated*
> "sandbox for untrusted JavaScript" library. The Matt Pocock coding-agent
> orchestrator is **`@ai-hero/sandcastle`** (homepage points at
> `github.com/mattpocock/sandcastle`). Always install the scoped name.

## How to run (operator)

```bash
# 1. Docker must be running (OrbStack)
docker info >/dev/null && echo "docker ok"
# 2. Export Codex creds (from 1Password "Goldberry Grove - Admin"); never commit
export OPENAI_API_KEY=...    # exact var per API Notes below
# 3. Run the spike
cd experiments/sandcastle-spike && pnpm install && pnpm spike
```

## API Notes (filled by Task 2)

Package: `@ai-hero/sandcastle` v0.7.0 — `main: dist/index.js`,
`types: dist/index.d.ts`, also ships a `sandcastle` CLI (`bin`).

_Remaining API surface (run() options, Docker provider, branch strategy, agent
selection, structured output, env injection, repo input) recorded in Task 2._

## Run Log (filled by Task 5)

_Recorded in Task 5._

## Verdict (filled by Task 7)

_adopt / reshape / drop — recorded in Task 7._
