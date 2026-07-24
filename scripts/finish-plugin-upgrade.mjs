// finish-plugin-upgrade.mjs — GOL-733 / GOL-804
//
// Converge ONE Paperclip plugin's stored registry version with the freshly
// deployed dist, then verify the registry reports the deployed version and a
// healthy status.
//
// Two-stage convergence:
//   1. POST /api/plugins/<id>/upgrade — idempotent, zero-downtime, config-safe.
//      This re-reads the registry entry's STORED `packagePath` and reloads the
//      worker from it.
//   2. If (and ONLY if) /upgrade did not reach WANT_VERSION, the stored
//      `packagePath` has DRIFTED to a stale source dir — /upgrade can only ever
//      re-read that path, it cannot repoint it (GOL-804: a drifted packagePath
//      of `/paperclip/staged-plugins/github-sync-plugin-0.11.4`, whose dist was
//      actually 0.11.3, made /upgrade "succeed" while shipping stale code). When
//      REINSTALL_PATH is supplied, recover deterministically by reinstalling
//      from that freshly-built canonical source, which REPOINTS packagePath, and
//      re-assert. Config survives a same-key reinstall; we verify that and fail
//      RED (never silently) if it was dropped, so a human restores it.
//
// Runs ON the droplet (host node, global fetch — Node 18+). Reaches the board
// API over the VPC-bound host port supplied in PAPERCLIP_BASE.
//
// Env (PAPERCLIP_BASE / BOARD_KEY / PLUGIN_KEY required):
//   PAPERCLIP_BASE  e.g. http://10.116.16.2:3100  (board API origin)
//   BOARD_KEY       board bearer key (from 1Password; never logged)
//   PLUGIN_KEY      e.g. agenticos.github-sync-plugin
//   WANT_VERSION    deployed manifest version to assert the registry reaches
//                   (optional; when set, a mismatch after both stages fails)
//   REINSTALL_PATH  container-visible canonical source to reinstall from if
//                   /upgrade cannot converge — e.g. /paperclip/plugins/<plugin>
//                   (the CD-rebuilt bind mount). Optional; without it a
//                   non-convergence fails RED instead of recovering.
//
// Prints a one-line JSON summary. Exits nonzero on any failure (HTTP error,
// plugin not installed, could-not-converge, unhealthy, dropped-config) so the
// CI step goes RED instead of silently leaving a stale worker.

const base = process.env.PAPERCLIP_BASE;
const key = process.env.PLUGIN_KEY;
const want = process.env.WANT_VERSION || "";
const board = process.env.BOARD_KEY || "";
const reinstallPath = process.env.REINSTALL_PATH || "";

if (!base || !key || !board) {
  console.error(
    "finish-plugin-upgrade: PAPERCLIP_BASE, PLUGIN_KEY and BOARD_KEY are required",
  );
  process.exit(64);
}

const H = { Authorization: "Bearer " + board, "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(
      method + " " + path + " -> HTTP " + r.status + " " + text.slice(0, 300),
    );
  }
  return text ? JSON.parse(text) : null;
}

// GET /api/plugins returns either an array or {plugins:[...]}; the serialized
// key is camelCase `pluginKey` (see scripts/paperclip-lib.sh resolve_plugin_id).
// Accept snake_case too, defensively.
function findPlugin(list, k) {
  const arr = Array.isArray(list) ? list : (list && list.plugins) || [];
  return arr.find((p) => p.pluginKey === k || p.plugin_key === k) || null;
}

const converged = (p) => !!p && (!want || p.version === want);
const healthy = (p) =>
  !!p && p.status !== "error" && p.status !== "failed" && !!p.status;

// Best-effort read of the plugin's stored config; returns the configJson object
// (or null). Only used to detect whether a reinstall dropped config — the
// values (secrets) are never logged.
async function readConfig(id) {
  try {
    const c = await api("GET", "/api/plugins/" + id + "/config");
    return (c && c.configJson) || null;
  } catch {
    return null;
  }
}
const hasConfig = (cfg) => !!cfg && Object.keys(cfg).length > 0;

// Recover a drifted packagePath: reinstall from the freshly-built canonical
// source so packagePath points at fresh code, then re-read. Config is preserved
// across a same-key reinstall by the host; we do NOT re-POST it (a masked GET
// could clobber good secrets) — instead we verify it survived and fail loud if
// it did not.
async function reinstallFrom(before, path) {
  const cfgBefore = await readConfig(before.id);
  await api("DELETE", "/api/plugins/" + before.id);
  await api("POST", "/api/plugins/install", {
    packageName: path,
    isLocalPath: true,
  });
  const after = findPlugin(await api("GET", "/api/plugins"), key);
  if (!after) throw new Error("plugin vanished after reinstall from " + path);
  if (hasConfig(cfgBefore) && !hasConfig(await readConfig(after.id))) {
    throw new Error(
      "reinstall from " +
        path +
        " REPOINTED packagePath but DROPPED plugin config — the worker will run unconfigured. Restore config per docs/runbooks/deploy-plugin-manifest-change.md",
    );
  }
  return after;
}

(async () => {
  const before = findPlugin(await api("GET", "/api/plugins"), key);
  if (!before) throw new Error("plugin not installed: " + key);

  // Stage 1 — idempotent, config-safe /upgrade (re-reads stored packagePath).
  await api("POST", "/api/plugins/" + before.id + "/upgrade");
  let after = findPlugin(await api("GET", "/api/plugins"), key);
  if (!after) throw new Error("plugin vanished after upgrade: " + key);
  let recovered = false;

  // Stage 2 — /upgrade could not reach the built version: packagePath is
  // drifted to a stale source. Repoint by reinstalling from fresh canonical
  // source, if one was supplied.
  if (!converged(after) && reinstallPath) {
    after = await reinstallFrom(before, reinstallPath);
    recovered = true;
  }

  console.log(
    JSON.stringify({
      key,
      before: before.version,
      beforePath: before.packagePath || null,
      after: after.version,
      afterPath: after.packagePath || null,
      want: want || null,
      status: after.status,
      recovered,
    }),
  );

  if (!converged(after)) {
    throw new Error(
      "registry version " +
        after.version +
        " != deployed " +
        want +
        (reinstallPath
          ? " even after reinstall from " + reinstallPath
          : " after /upgrade (packagePath '" +
            (after.packagePath || "?") +
            "' serves stale code; set REINSTALL_PATH to auto-repoint)"),
    );
  }
  if (!healthy(after)) {
    throw new Error("plugin unhealthy after upgrade: status=" + after.status);
  }
})().catch((e) => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
