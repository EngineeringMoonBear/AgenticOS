// assert-plugin-versions.mjs — GOL-804
//
// Post-deploy invariant: for EVERY plugin this deploy rebuilt, the LIVE registry
// version must equal the version in the freshly-built dist, and the plugin must
// be healthy. Runs unconditionally after a plugin deploy — NOT gated on a
// manifest bump — so it catches a stale registry from ANY cause:
//   - a drifted packagePath serving old code (GOL-804),
//   - a manual/out-of-band install that pinned a stale source,
//   - a forgotten manifest version bump,
//   - a bad staged dir whose manifest and dist disagree.
//
// The GOL-733 finish step only asserts convergence for plugins whose
// src/manifest.ts changed AND only when it runs inside the CD workflow; the
// 0.11.x staging incident was deployed out-of-band and slipped straight past it.
// This assertion is the backstop that would have caught it.
//
// Runs ON the droplet (host node, global fetch — Node 18+).
//
// Env:
//   PAPERCLIP_BASE  board API origin, e.g. http://10.116.16.2:3100
//   BOARD_KEY       board bearer key (from 1Password; never logged)
//   EXPECT          space/comma-separated <pluginKey>=<version> pairs, e.g.
//                   "agenticos.github-sync-plugin=0.11.6 agenticos.vault-plugin=0.4.2"
//
// Exits 0 only when every expected plugin is installed, at the expected version,
// and healthy. Exits nonzero (CI RED) listing every plugin that drifted.

const base = process.env.PAPERCLIP_BASE;
const board = process.env.BOARD_KEY || "";
const expectRaw = process.env.EXPECT || "";

if (!base || !board) {
  console.error("assert-plugin-versions: PAPERCLIP_BASE and BOARD_KEY are required");
  process.exit(64);
}

const expect = expectRaw
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((pair) => {
    const i = pair.lastIndexOf("=");
    return { key: pair.slice(0, i), version: pair.slice(i + 1) };
  })
  .filter((e) => e.key && e.version);

if (expect.length === 0) {
  console.log("assert-plugin-versions: nothing to assert (EXPECT empty)");
  process.exit(0);
}

const H = { Authorization: "Bearer " + board, "Content-Type": "application/json" };

function findPlugin(list, k) {
  const arr = Array.isArray(list) ? list : (list && list.plugins) || [];
  return arr.find((p) => p.pluginKey === k || p.plugin_key === k) || null;
}
const healthy = (p) =>
  !!p && p.status !== "error" && p.status !== "failed" && !!p.status;

(async () => {
  const r = await fetch(base + "/api/plugins", { headers: H });
  const text = await r.text();
  if (!r.ok) throw new Error("GET /api/plugins -> HTTP " + r.status + " " + text.slice(0, 200));
  const list = text ? JSON.parse(text) : [];

  const drift = [];
  for (const e of expect) {
    const p = findPlugin(list, e.key);
    if (!p) {
      drift.push(`${e.key}: NOT INSTALLED (expected ${e.version})`);
      continue;
    }
    if (p.version !== e.version) {
      drift.push(
        `${e.key}: registry ${p.version} != built ${e.version}` +
          ` (packagePath=${p.packagePath || "?"}) — deploy shipped STALE code`,
      );
    } else if (!healthy(p)) {
      drift.push(`${e.key}: version ok (${p.version}) but UNHEALTHY status=${p.status}`);
    } else {
      console.log(`  ok  ${e.key} @ ${p.version} (${p.status})`);
    }
  }

  if (drift.length) {
    for (const d of drift) console.error("  DRIFT " + d);
    throw new Error(
      drift.length + " plugin(s) did not converge to the built version — see above",
    );
  }
  console.log("assert-plugin-versions: all " + expect.length + " converged");
})().catch((e) => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
