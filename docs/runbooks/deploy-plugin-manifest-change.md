# Runbook: finish a plugin manifest-change deploy

## When you need this

You pushed a **manifest change** to a plugin (new capability, config field,
`database:`, or `webhooks:` declaration in `packages/<plugin>/src/manifest.ts`)
and the `Deploy Droplet Plugins` GitHub Actions run posted a ⚠️ warning like:

> **github-sync-plugin** — run `scripts/deploy-plugin.sh github-sync-plugin`
> from a Mac to finish (reinstall + config + enable).

CI hot-reloaded the worker **code** but cannot refresh the **stored manifest**
(that needs a reinstall) or reapply config (that needs the service tokens, which
live only in 1Password — never in CI). You finish it from your Mac.

## Prerequisites

- `op` (1Password CLI) signed in: `op signin`
- SSH tunnel to Paperclip open:
  ```sh
  ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
  ```
- SSH access to the droplet as `deploy@agenticos-droplet` (for the recreate-guard).

## Do it

```sh
cd /path/to/AgenticOS
scripts/deploy-plugin.sh <plugin>        # e.g. github-sync-plugin
# multiple at once:
scripts/deploy-plugin.sh github-plugin openviking-plugin
```

The script is idempotent — re-run it freely. Per plugin it:

1. **recreate-guard** — force-recreates `paperclip-server` only if the plugin
   dir isn't yet visible in the container (a newly-added bind mount; the
   inode-pinning `"Missing package.json"` fix). Skips otherwise.
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

`deploy-plugin.sh` already prints each target's status at the end; this curl is an independent re-check.

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

- `.github/workflows/deploy-droplet-plugins.yml` — emits the warning that sends
  you here.
- `scripts/deploy-plugin.sh` / `scripts/paperclip-lib.sh` — the implementation.
- `scripts/sync-paperclip-secrets.sh` — the "sync ALL plugins from 1Password"
  entrypoint (same lib); use it after a full rebuild rather than per-plugin.
