# Runbook: Install local-path plugins into Paperclip

How the three AgenticOS plugins (`vault`, `openviking`, `github`) get registered
and loaded by the Paperclip runtime (`paperclip-server`).

## Background

Paperclip loads a plugin from a **package directory** that must contain:

1. a `package.json` with a `paperclipPlugin` block, and
2. a standalone, host-importable **manifest module** (`dist/manifest.js`).

The trusted server process reads the manifest via `await import(manifest.js)` to
learn the plugin's tools/jobs/capabilities **before** running the worker. The
worker (`dist/worker.js`) is loaded separately in a sandbox at enable time. The
manifest must therefore be its own file — not bundled inside `worker.js`.

Each plugin's `build` script emits both:

- `dist/worker.js`   — bundled worker (sandbox)
- `dist/manifest.js` — standalone manifest (host process; no runtime deps)

The compose mount exposes the **package root** (not `dist/`) so `package.json`
and `dist/` are both visible in the container at `/paperclip/plugins/<name>`.

## Prerequisites

- Plugins built: `pnpm --filter @agenticos/<name>-plugin build` (x3).
- `docker-compose.yml` mounts `./packages/<name>-plugin:/paperclip/plugins/<name>-plugin:ro`.
- An **instance-admin** Paperclip session. `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
  means there is NO `local_implicit` admin bypass — a loopback curl is unauthenticated.
  Use an admin browser session (cookie) or a board API key for an instance-admin user.

## Procedure

1. Build all three (produces `dist/worker.js` + `dist/manifest.js`):

   ```sh
   pnpm --filter @agenticos/vault-plugin \
        --filter @agenticos/openviking-plugin \
        --filter @agenticos/github-plugin build
   ```

2. Redeploy so the live tree (`/opt/agenticos`) gets the rebuilt packages +
   updated compose.

   > Caveat (host drift): the bind mount pins the original inode. If `dist/` was
   > deleted on the host while the container ran, the container keeps serving the
   > stale file and will NOT see new writes until recreated. **Always rebuild
   > `dist/` for all three BEFORE recreating**, or the recreate drops plugins.

3. Recreate `paperclip-server` once to re-bind the mounts:

   ```sh
   docker compose up -d paperclip-server
   ```

4. Install each plugin (instance-admin). From the Paperclip tab's devtools
   console (session cookie is sent automatically):

   ```js
   for (const p of ["github-plugin", "vault-plugin", "openviking-plugin"]) {
     const r = await fetch("/api/plugins/install", {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify({ packageName: `/paperclip/plugins/${p}`, isLocalPath: true }),
     });
     console.log(p, r.status, await r.json());
   }
   ```

   A `200` returns the `PluginRecord` (status `ready`). A `400` names the exact
   manifest validation failure.

5. Verify:

   - `GET /api/plugins` → all three `status: "ready"`.
   - `paperclip-server` logs → `readyPlugins:3`.
   - github's `pr-triage` job is registered (schedule `30 7 * * *`).

## Notes

- The web UI's "install plugin" only accepts published npm packages; local-path
  installs go through the API (`isLocalPath: true`), not the UI.
- To re-pick-up manifest/worker changes during development, the
  `plugin-dev-watcher` restarts the worker on file change for local-path plugins.
