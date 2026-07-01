# Plugin manifest deploy: CI detects, Mac finishes

**Date:** 2026-07-01
**Repo:** EngineeringMoonBear/AgenticOS
**Status:** Design — awaiting review

## Problem

`.github/workflows/deploy-droplet-plugins.yml` git-pulls the repo and rebuilds
the plugin dists in place. Paperclip's `plugin-dev-watcher` hot-reloads a
worker whenever its `dist/` changes — so a **worker-code** change deploys with
no restart and no manual step. Good.

But a **manifest** change (new capability, new config field, a `database:` or
`webhooks:` declaration) is invisible to the hot-reload: the watcher refreshes
worker *code*, not the *stored* manifest. Shipping a manifest change today means
hand-running a sequence of `curl` calls on the droplet:

1. force-recreate `paperclip-server` (bind-mount inode pinning →
   `"Missing package.json"` for a newly-added plugin dir)
2. `DELETE` the plugin + reinstall (install won't update in place)
3. re-`POST` the plugin config (delete wiped it)
4. `disable` then `enable` (saving config doesn't reliably restart the worker,
   so `setup()` never re-subscribes with the new config)

This is error-prone and undocumented in an actionable form. See
`memory/paperclip-plugin-db-and-activation-contract.md` for the underlying
contract that makes each step necessary.

## Hard constraint

**Service tokens flow only from 1Password, never through CI.** The GitHub
token and OpenViking key live in 1Password and are pushed to Paperclip by
`scripts/sync-paperclip-secrets.sh`, run from Josh's Mac (where `op` lives) over
an SSH tunnel. GitHub Actions must never gain those tokens — nor the Paperclip
board API key that authenticates the management API.

### Consequence: full CI automation is impossible

The four steps have different auth needs:

| Step | Auth needed |
|---|---|
| force-recreate `paperclip-server` | none (SSH `docker compose`) |
| delete + reinstall | board key |
| re-POST config | board key **+ service tokens** |
| disable / enable | board key |

Because the config step needs the service tokens, and tokens must never reach
CI, the manifest dance **cannot** run entirely in GitHub Actions. The best
achievable design splits the work by whether secrets are required.

## Design

Two layers, plus a shared lib and docs.

### Layer 1 — CI detects and warns (no secrets)

`deploy-droplet-plugins.yml` keeps its current behavior (pull + build +
hot-reload) and gains **manifest-change detection**. The droplet step already
runs `git reset --hard origin/main`; we capture the pre-reset SHA and diff each
plugin's manifest source across the update:

```bash
OLD=$(git rev-parse HEAD)              # before reset
git fetch --quiet origin main
git reset --hard --quiet origin/main
for p in vault-plugin openviking-plugin github-plugin github-sync-plugin; do
  if ! git diff --quiet "$OLD" HEAD -- "packages/$p/src/manifest.ts"; then
    echo "MANIFEST_BUMP: $p"          # machine-readable marker on stdout
  fi
done
```

**Detection rule: any diff to `packages/<p>/src/manifest.ts`.** A comment-only
edit will false-positive (harmless — it just suggests running an idempotent
script); a real manifest change with no version bump will NOT be missed. That
false-negative avoidance is why we diff the whole file rather than key on the
`version:` line. Convention remains "bump `version:` on every manifest change,"
but correctness does not depend on the author remembering to.

> **Decision to confirm at review:** diff the whole `manifest.ts` (safer, may
> warn on comment-only edits) vs. key on the `version:` line only (quieter, but
> silently misses a real change that forgot to bump). This spec chooses the
> whole-file diff.

The GitHub Actions runner greps `MANIFEST_BUMP:` markers out of the SSH output
and, for each, emits a `::warning::` and appends to `$GITHUB_STEP_SUMMARY`:

> ⚠️ Manifest changed for `github-sync-plugin`. Worker code hot-reloaded, but
> the **stored manifest is stale**. Run `scripts/deploy-plugin.sh
> github-sync-plugin` from a Mac (op signed in + SSH tunnel open) to reinstall,
> reapply config, and enable.

**The job still succeeds** — the code half genuinely deployed. No marker → no
warning → unchanged cheap hot-reload path (this is the no-op case we verify).

Detection runs on the droplet (inside the existing SSH step) so we don't add an
`actions/checkout` to the runner or need the board key anywhere.

### Layer 2 — `scripts/deploy-plugin.sh <plugin…>` (Mac, 1Password)

New idempotent script, run from the Mac exactly like
`sync-paperclip-secrets.sh` (tunnel open, `op signin`). For each named plugin:

1. **Recreate-guard** (SSH): test `-s /paperclip/plugins/<p>/package.json`
   *inside the container* (`docker compose exec -T paperclip-server test …`).
   Missing → `docker compose up -d --force-recreate paperclip-server` and wait
   for health. Present → skip. Recreate only fires for a genuinely unresolved
   mount (a newly-added plugin dir), so re-runs don't needlessly restart the
   runtime.
2. **Reinstall** (board key): resolve the plugin id by `pluginKey`; `DELETE
   /api/plugins/:id` if present; `POST /api/plugins/install` with
   `{packageName:"/paperclip/plugins/<p>", isLocalPath:true}`. Refreshes the
   stored manifest.
3. **Config** (tokens from 1Password): dispatch by plugin —
   - `github-plugin` → `configure_github`
   - `openviking-plugin` → `configure_openviking`
   - `vault-plugin` → no config
   - `github-sync-plugin` → **no config here**; it needs a write-scoped token +
     synced project id per `docs/runbooks/github-issue-sync.md`. The script
     reinstalls + enables it and prints a note pointing at that runbook.
4. **disable → enable** (board key): `POST …/disable` then `…/enable` to force
   `setup()` to re-run so subscriptions/webhooks re-register with fresh config.
   Also recovers an error-state install.
5. **Assert**: re-fetch `/api/plugins`, print each target's `status`, exit
   non-zero if any target is in an error state (healthy = not `error`/`failed`).

Accepts one or more plugin names; with no args, prints usage. Reuses the SSH
tunnel convention (`PAPERCLIP_BASE` default `http://localhost:3100`).

### Layer 3 — `scripts/paperclip-lib.sh` (shared, sourced)

Extract the duplicated machinery so `sync-paperclip-secrets.sh` and
`deploy-plugin.sh` share one implementation:

- `op_read <field>` — read from 1Password (values stay in memory, never printed)
- `api <method> <path> [json]` — board-authed `curl` wrapper
- `resolve_plugin_id <pluginKey>` — id lookup from `/api/plugins`
- `configure_github` / `configure_openviking` — the per-plugin config POSTs
  (moved verbatim from `sync-paperclip-secrets.sh`)
- env defaults (`PAPERCLIP_BASE`, `OP_ITEM`, `OP_VAULT`, field-name overrides)

`sync-paperclip-secrets.sh` is refactored to source the lib; its observable
behavior (sync all three, optional pr-triage trigger) is unchanged.

### Layer 4 — Docs

- **Rewrite the `deploy-droplet-plugins.yml` header comment** to describe the
  detect-and-warn behavior and the manifest-change convention, replacing the
  current "run scripts/sync-paperclip-secrets.sh for those — rare" caveat with
  a pointer to `deploy-plugin.sh` and the runbook.
- **New `docs/runbooks/deploy-plugin-manifest-change.md`**: the one-command Mac
  flow (open tunnel, `op signin`, `scripts/deploy-plugin.sh <plugin>`), what
  each step fixes and why (cross-referencing the contract memory), and the CI
  warning it responds to.

## Rejected alternatives

- **Do everything in CI (prompt option a).** Requires the board key + service
  tokens in GitHub Actions — violates the 1Password-only rule. Rejected.
- **Auto force-recreate in CI on a bump.** A recreate re-resolves the mount and
  restarts workers but does **not** refresh the stored manifest, so it would
  restart the whole runtime for no manifest benefit. Rejected.
- **Extend `sync-paperclip-secrets.sh` in place / standalone copy with
  duplicated helpers.** Both considered; chose a shared `paperclip-lib.sh` +
  separate `deploy-plugin.sh` entrypoint to avoid one overloaded script and
  avoid helper drift between two copies.

## Verification plan

- **No-op (cheap path intact):** worker-only change → CI shows no
  `MANIFEST_BUMP`, workers hot-reload, no warning emitted.
- **Bump path:** change a manifest → CI emits the `::warning::` + step-summary
  line naming the plugin; running `deploy-plugin.sh <p>` on the Mac leaves the
  plugin healthy (not `error`/`failed`).
- **Idempotency:** re-run `deploy-plugin.sh <p>` → recreate-guard skips (mount
  already resolved), reinstall + config + enable are safe to repeat, still ends
  healthy (not in an error state).
- **Static checks:** `bash -n` on all three scripts; `shellcheck` if available.

## Out of scope

- Provisioning the board key / tunnel (already documented in
  `sync-paperclip-secrets.sh` prereqs).
- `github-sync-plugin`'s own config path (its runbook owns that).
- Any change to how tokens are stored in 1Password.
