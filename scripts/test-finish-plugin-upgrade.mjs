// test-finish-plugin-upgrade.mjs — GOL-733 dry-run / unit test
//
// Proves, against a local mock of the board API, that finish-plugin-upgrade.mjs:
//   1. calls POST /api/plugins/<id>/upgrade exactly once,
//   2. re-reads the registry and CONFIRMS the version converged to the deployed
//      value (WANT_VERSION) — succeeds only when the version actually changed,
//   3. FAILS (nonzero) when the registry does NOT reach WANT_VERSION,
//   4. FAILS when the plugin is not installed,
//   5. FAILS when the plugin is unhealthy after upgrade.
//
// No droplet, no secrets — a self-contained http server plays the API. Run:
//   node scripts/test-finish-plugin-upgrade.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "finish-plugin-upgrade.mjs");
const KEY = "agenticos.github-sync-plugin";

// scenario: how the mock behaves. Each returns the plugins list for GET, and
// mutates on POST /upgrade.
function makeServer(scenario) {
  let upgrades = 0;
  let version = scenario.startVersion;
  let status = "ready";
  const srv = createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && req.url === "/api/plugins") {
      if (!scenario.installed) return send(200, { plugins: [] });
      return send(200, { plugins: [{ id: "id-1", pluginKey: KEY, version, status }] });
    }
    if (req.method === "POST" && req.url === "/api/plugins/id-1/upgrade") {
      upgrades += 1;
      version = scenario.afterVersion;
      if (scenario.afterStatus) status = scenario.afterStatus;
      return send(200, { ok: true });
    }
    send(404, { error: "not found: " + req.method + " " + req.url });
  });
  return { srv, upgrades: () => upgrades };
}

function run(base, want) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TARGET], {
      env: {
        ...process.env,
        PAPERCLIP_BASE: base,
        BOARD_KEY: "test-board-key",
        PLUGIN_KEY: KEY,
        WANT_VERSION: want,
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function withServer(scenario, fn) {
  const { srv, upgrades } = makeServer(scenario);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    return await fn(base, upgrades);
  } finally {
    srv.close();
  }
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ok  - " + name);
  } else {
    failures += 1;
    console.log("  FAIL- " + name + (detail ? " :: " + detail : ""));
  }
}

// 1) happy path: 0.11.1 -> 0.11.2, want 0.11.2 => success, exactly one /upgrade
await withServer(
  { installed: true, startVersion: "0.11.1", afterVersion: "0.11.2" },
  async (base, upgrades) => {
    const r = await run(base, "0.11.2");
    check("converges old->new version, exit 0", r.code === 0, r.err || r.out);
    check("called /upgrade exactly once", upgrades() === 1, "count=" + upgrades());
    check("summary reports before/after", /"before":"0.11.1"/.test(r.out) && /"after":"0.11.2"/.test(r.out), r.out.trim());
  },
);

// 2) upgrade fired but registry did NOT reach the deployed version => FAIL
await withServer(
  { installed: true, startVersion: "0.11.1", afterVersion: "0.11.1" },
  async (base) => {
    const r = await run(base, "0.11.2");
    check("mismatch after /upgrade fails nonzero", r.code !== 0, "code=" + r.code);
    check("mismatch error mentions versions", /!= deployed 0\.11\.2/.test(r.err), r.err.trim());
  },
);

// 3) plugin not installed => FAIL
await withServer(
  { installed: false, startVersion: "x", afterVersion: "x" },
  async (base) => {
    const r = await run(base, "0.11.2");
    check("not-installed fails nonzero", r.code !== 0, "code=" + r.code);
    check("not-installed error is explicit", /not installed/.test(r.err), r.err.trim());
  },
);

// 4) unhealthy after upgrade => FAIL (even if version matches)
await withServer(
  { installed: true, startVersion: "0.11.1", afterVersion: "0.11.2", afterStatus: "error" },
  async (base) => {
    const r = await run(base, "0.11.2");
    check("unhealthy-after-upgrade fails nonzero", r.code !== 0, "code=" + r.code);
    check("unhealthy error is explicit", /unhealthy/.test(r.err), r.err.trim());
  },
);

// 5) no WANT_VERSION (unknown deployed version) still upgrades + passes on ready
await withServer(
  { installed: true, startVersion: "0.11.1", afterVersion: "0.11.2" },
  async (base, upgrades) => {
    const r = await run(base, "");
    check("no-want still upgrades + passes", r.code === 0 && upgrades() === 1, r.err || r.out);
  },
);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
