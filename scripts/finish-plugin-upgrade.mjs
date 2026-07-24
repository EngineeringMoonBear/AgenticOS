// finish-plugin-upgrade.mjs — GOL-733
//
// Converge ONE Paperclip plugin's stored registry version with the freshly
// deployed dist by calling the idempotent POST /api/plugins/<id>/upgrade, then
// verifying the registry reports the deployed version and a healthy status.
//
// Runs ON the droplet (host node, global fetch — Node 18+). Reaches the board
// API over the VPC-bound host port supplied in PAPERCLIP_BASE.
//
// Env (all but WANT_VERSION required):
//   PAPERCLIP_BASE  e.g. http://10.116.16.2:3100  (board API origin)
//   BOARD_KEY       board bearer key (from 1Password; never logged)
//   PLUGIN_KEY      e.g. agenticos.github-sync-plugin
//   WANT_VERSION    deployed manifest version to assert the registry reaches
//                   (optional; when set, a mismatch fails the process)
//
// Prints a one-line JSON summary {key,before,after,want,status}. Exits nonzero
// on any failure (HTTP error, plugin not installed, version mismatch, unhealthy)
// so the CI step goes RED instead of silently leaving a stale worker.

const base = process.env.PAPERCLIP_BASE;
const key = process.env.PLUGIN_KEY;
const want = process.env.WANT_VERSION || "";
const board = process.env.BOARD_KEY || "";

if (!base || !key || !board) {
  console.error(
    "finish-plugin-upgrade: PAPERCLIP_BASE, PLUGIN_KEY and BOARD_KEY are required",
  );
  process.exit(64);
}

const H = { Authorization: "Bearer " + board, "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(base + path, { method, headers: H, body });
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

(async () => {
  const before = findPlugin(await api("GET", "/api/plugins"), key);
  if (!before) throw new Error("plugin not installed: " + key);

  // Idempotent + safe from `ready` (GOL-727): bumps the stored registry version
  // and hot-reloads the worker. A no-op when already at the deployed version.
  await api("POST", "/api/plugins/" + before.id + "/upgrade");

  const after = findPlugin(await api("GET", "/api/plugins"), key);
  if (!after) throw new Error("plugin vanished after upgrade: " + key);

  console.log(
    JSON.stringify({
      key,
      before: before.version,
      after: after.version,
      want: want || null,
      status: after.status,
    }),
  );

  if (want && after.version !== want) {
    throw new Error(
      "registry version " + after.version + " != deployed " + want + " after /upgrade",
    );
  }
  if (after.status === "error" || after.status === "failed" || !after.status) {
    throw new Error("plugin unhealthy after upgrade: status=" + after.status);
  }
})().catch((e) => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
