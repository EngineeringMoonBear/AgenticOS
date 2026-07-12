# Runbook: finish a plugin manifest-change deploy

## When you need this

You pushed a **manifest change** to a plugin (new capability, config field,
`database:`, or `webhooks:` declaration in `packages/<plugin>/src/manifest.ts`)
and the `Deploy Droplet Plugins` GitHub Actions run posted a ⚠️ warning like:

> **github-sync-plugin** — worker code hot-reloaded, but the stored manifest is
> stale. Finish it (reinstall + config + enable).

CI hot-reloaded the worker **code** but cannot refresh the **stored manifest**
(that needs a reinstall) or reapply config (that needs the service tokens, which
live only in 1Password — never in CI).

A manifest finish is two jobs, and they are separable on purpose:

1. **Re-resolve the plugin bind mount** — force-recreate `paperclip-server` so
   `/paperclip/plugins/<plugin>` points at the current host inode (otherwise
   reinstall reads a stale mount → `Missing package.json`). This used to require
   a Mac (host root / SSH). **It no longer does** — see the primary path below.
2. **Reinstall + config + enable** — refresh the stored manifest and re-apply
   config. An in-runtime agent can do this over the board-key plugin API once
   the mount is resolved; a human does it with `scripts/deploy-plugin.sh`.

## Primary path — self-serve recreate (no Mac, no host root) ✅

Since [GOL-166] the recreate is a first-class GitHub Actions job:
[`.github/workflows/recreate-paperclip-server.yml`]. The CI runner holds droplet
deploy access, so it runs `docker compose up -d --force-recreate paperclip-server`
and verifies **every** plugin bind mount re-resolved inside the fresh container
before reporting success. State survives — plugin/OAuth data lives on the
`paperclip-data` volume, not the container layer. It shares the `deploy-droplet`
concurrency group, so it can never race a deploy or a disk-reclaim.

It has **two triggers**, and neither needs a Mac, `op`, or an SSH tunnel:

### (a) One-click for a human — `workflow_dispatch`

Anyone with repo access opens **Actions → "Recreate paperclip-server" → Run
workflow**. No `op`, no tunnel, no Mac toolchain. Use this if you're a board
member finishing a deploy by hand.

### (b) Fully agent-triggered — `repository_dispatch` (NO `actions: write`)

An in-container Paperclip agent (e.g. DevOps) fires it directly. The
gh-token-broker App deliberately does **not** carry `actions: write`, so the
`workflow_dispatch` REST API 403s for agents. `repository_dispatch` does **not**
need `actions: write` — only `contents: write`, which the broker already mints.
Same pattern as `disk-reclaim.yml` (GOL-141). No new standing credential, no key
injected:

```sh
# Mint a short-lived, repo-scoped broker token (contents: write) and fire the
# recreate. No actions:write needed.
TOKEN="$(node /paperclip/agent-git/github-app-token.mjs token EngineeringMoonBear/AgenticOS)"
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/EngineeringMoonBear/AgenticOS/dispatches \
  -d '{"event_type":"recreate-paperclip-server"}'
# 204 No Content = accepted. Watch the run in Actions; it self-verifies mounts.
```

### Then finish the reinstall (agent, over the board-key API)

Once the recreate run is green (mounts re-resolved), an agent completes the
manifest finish **from the Paperclip runtime** — no Mac — using the board-key
plugin API (the same calls `deploy-plugin.sh` makes, minus the host SSH):

1. **reinstall** — snapshot config first (`GET /api/plugins/{id}/config`), then
   `DELETE /api/plugins/{id}` + `POST /api/plugins/install` to refresh the stored
   manifest (install is create-only; it won't update in place). **Do not blind-
   `DELETE` a live connector plugin** — a failed reinstall on a stale mount took
   github-sync down in [GOL-296]. Only delete after the recreate run confirmed
   the mount, and restore the snapshotted config after.
2. **config** — re-apply via `POST /api/plugins/{id}/config`. `github-plugin`
   and `openviking-plugin` take config; `vault-plugin` takes none;
   `github-sync-plugin` is configured via [github-issue-sync.md].
3. **disable → enable** — `POST /api/plugins/{id}/disable` then `…/enable` to
   force the worker `setup()` to re-run with the fresh config.

> **Why CI does not run `deploy-plugin.sh` end-to-end:** the reinstall+config
> step needs the Paperclip **board key** and plugin **service tokens**, which
> flow only from 1Password and are deliberately never placed in CI. Chaining the
> full script into the workflow would push the board key into the runner — a
> least-privilege regression. So the split is intentional: **CI resolves the
> mount; the agent finishes over the board API.** The workflow keeps zero
> Paperclip credentials.

## Fallback path — from a Mac (`scripts/deploy-plugin.sh`)

Use this only if the Actions path is unavailable (e.g. the runner can't reach
the droplet) or you want the one-shot script to do recreate-guard + reinstall +
config + enable in a single idempotent run.

### Prerequisites

- `op` (1Password CLI) signed in: `op signin`
- SSH tunnel to Paperclip open:
  ```sh
  ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
  ```
- SSH access to the droplet as `deploy@agenticos-droplet` (for the recreate-guard).

### Do it

```sh
cd /path/to/AgenticOS
scripts/deploy-plugin.sh <plugin>        # e.g. github-sync-plugin
# multiple at once:
scripts/deploy-plugin.sh github-plugin openviking-plugin
```

The script is idempotent — re-run it freely. Per plugin it:

1. **recreate-guard** — force-recreates `paperclip-server` only if the plugin
   dir isn't yet visible in the container (a newly-added bind mount; the
   inode-pinning `"Missing package.json"` fix). Skips otherwise. This is the
   same recreate the primary path does — the workflow just does it without a Mac.
2. **reinstall** — `DELETE` + `POST /api/plugins/install` to refresh the stored
   manifest (install won't update in place).
3. **config** — pushes config from 1Password: `github-plugin` and
   `openviking-plugin` only. `vault-plugin` takes none. `github-sync-plugin` is
   configured via [github-issue-sync.md](github-issue-sync.md) (write-scoped
   token + synced project id) — this script reinstalls + enables it but does
   NOT set its config.
4. **disable → enable** — forces the worker `setup()` to re-run so it
   re-subscribes with the fresh config (saving config alone doesn't restart it).
5. **assert** — prints each plugin's status; exits non-zero on an error state.

## Verify

The recreate workflow self-verifies mounts; `deploy-plugin.sh` prints each
target's status at the end. This curl is an independent re-check.

```sh
BK="$(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key')"
curl -fsS -H "Authorization: Bearer $BK" \
  http://localhost:3100/api/plugins | jq '(if type=="object" then .plugins else . end)[] | {pluginKey, status}'
```

All target plugins should be present and NOT `error`/`failed`.

## Why each step is necessary

See `memory/paperclip-plugin-db-and-activation-contract.md` (the install/
activation lifecycle + bind-mount inode pinning sections). The short version:
manifest is read by the host before worker init, so a code hot-reload can't
touch it; install is create-only; config save doesn't restart the worker.

## Related

- [`.github/workflows/recreate-paperclip-server.yml`] — the primary,
  self-serve recreate (one-click + agent `repository_dispatch`).
- `.github/workflows/deploy-droplet-plugins.yml` — emits the warning that sends
  you here (and hot-reloads worker code on every plugin push).
- `.github/workflows/disk-reclaim.yml` — the sibling `repository_dispatch`
  agent-trigger pattern the recreate workflow mirrors.
- `scripts/deploy-plugin.sh` / `scripts/paperclip-lib.sh` — the fallback
  implementation.
- `scripts/sync-paperclip-secrets.sh` — the "sync ALL plugins from 1Password"
  entrypoint (same lib); use it after a full rebuild rather than per-plugin.

[GOL-166]: https://github.com/EngineeringMoonBear/AgenticOS/pull/281
[GOL-296]: https://github.com/EngineeringMoonBear/AgenticOS/pull/255
[`.github/workflows/recreate-paperclip-server.yml`]: ../../.github/workflows/recreate-paperclip-server.yml
[github-issue-sync.md]: github-issue-sync.md
