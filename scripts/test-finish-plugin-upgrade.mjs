// test-finish-plugin-upgrade.mjs — GOL-733 / GOL-804 dry-run / unit test
//
// Proves, against a local mock of the board API, that finish-plugin-upgrade.mjs:
//   1. calls POST /api/plugins/<id>/upgrade and CONFIRMS the registry converged
//      to the deployed value (WANT_VERSION),
//   2. FAILS (nonzero) when it cannot reach WANT_VERSION and no repoint is set,
//   3. FAILS when the plugin is not installed,
//   4. FAILS when the plugin is unhealthy after upgrade,
//   5. passes with no WANT_VERSION on a healthy plugin,
//   6. GOL-804 RECOVERY: when /upgrade cannot converge (packagePath drifted to a
//      stale source) and REINSTALL_PATH is set, it reinstalls from that source,
//      repoints, and converges — exactly once,
//   7. GOL-804 SAFETY: if that reinstall drops plugin config, it fails RED
//      instead of leaving the worker unconfigured,
//   8. GOL-804: if the reinstall still doesn't reach the built version, RED.
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

// Stateful mock of the board plugin API. scenario fields:
//   installed, startVersion, startPath
//   afterVersion            version after POST /upgrade (models re-reading the
//                           stored packagePath — stale when == startVersion)
//   afterStatus             status after /upgrade
//   installVersion          version a reinstall (POST /install) yields
//   reinstallDropsConfig    when true, config is lost on reinstall
function makeServer(scenario) {
  let upgrades = 0;
  let reinstalls = 0;
  let installed = scenario.installed;
  let version = scenario.startVersion;
  let packagePath = scenario.startPath || "/paperclip/staged-plugins/x";
  let status = "ready";
  let config = scenario.installed ? { paperclipApiToken: "secret", bridges: [1] } : {};

  const srv = createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const plugin = () => ({ id: "id-1", pluginKey: KEY, version, status, packagePath });

    if (req.method === "GET" && req.url === "/api/plugins") {
      return send(200, { plugins: installed ? [plugin()] : [] });
    }
    if (req.method === "GET" && req.url === "/api/plugins/id-1/config") {
      return send(200, { configJson: config });
    }
    if (req.method === "POST" && req.url === "/api/plugins/id-1/upgrade") {
      upgrades += 1;
      version = scenario.afterVersion; // re-read of the (possibly stale) path
      if (scenario.afterStatus) status = scenario.afterStatus;
      return send(200, { ok: true });
    }
    if (req.method === "DELETE" && req.url === "/api/plugins/id-1") {
      installed = false;
      return send(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/plugins/install") {
      let body = "";
      req.on("data", (d) => (body += d));
      return req.on("end", () => {
        const { packageName } = JSON.parse(body || "{}");
        reinstalls += 1;
        installed = true;
        version = scenario.installVersion;
        packagePath = packageName;
        if (scenario.reinstallDropsConfig) config = {};
        return send(200, plugin());
      });
    }
    send(404, { error: "not found: " + req.method + " " + req.url });
  });
  return { srv, upgrades: () => upgrades, reinstalls: () => reinstalls };
}

function run(base, want, reinstallPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TARGET], {
      env: {
        ...process.env,
        PAPERCLIP_BASE: base,
        BOARD_KEY: "test-board-key",
        PLUGIN_KEY: KEY,
        WANT_VERSION: want,
        ...(reinstallPath ? { REINSTALL_PATH: reinstallPath } : {}),
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
  const mock = makeServer(scenario);
  await new Promise((r) => mock.srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + mock.srv.address().port;
  try {
    return await fn(base, mock);
  } finally {
    mock.srv.close();
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
  async (base, m) => {
    const r = await run(base, "0.11.2");
    check("converges old->new version, exit 0", r.code === 0, r.err || r.out);
    check("called /upgrade exactly once", m.upgrades() === 1, "count=" + m.upgrades());
    check("no reinstall on happy path", m.reinstalls() === 0, "count=" + m.reinstalls());
    check("summary reports before/after", /"before":"0.11.1"/.test(r.out) && /"after":"0.11.2"/.test(r.out), r.out.trim());
  },
);

// 2) upgrade fired, did NOT reach the deployed version, NO repoint => FAIL
await withServer(
  { installed: true, startVersion: "0.11.1", afterVersion: "0.11.1" },
  async (base) => {
    const r = await run(base, "0.11.2");
    check("mismatch (no repoint) fails nonzero", r.code !== 0, "code=" + r.code);
    check("mismatch error names the deployed version", /!= deployed 0\.11\.2/.test(r.err), r.err.trim());
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
  async (base, m) => {
    const r = await run(base, "");
    check("no-want still upgrades + passes", r.code === 0 && m.upgrades() === 1, r.err || r.out);
  },
);

// 6) GOL-804 recovery: /upgrade stuck on a stale packagePath (0.11.3), REINSTALL_PATH
//    set, reinstall yields 0.11.6 => converges, exit 0, recovered:true, 1 reinstall
await withServer(
  {
    installed: true,
    startVersion: "0.11.3",
    startPath: "/paperclip/staged-plugins/github-sync-plugin-0.11.4",
    afterVersion: "0.11.3", // /upgrade re-reads the stale path, no change
    installVersion: "0.11.6",
  },
  async (base, m) => {
    const r = await run(base, "0.11.6", "/paperclip/plugins/github-sync-plugin");
    check("stale /upgrade -> reinstall recovers, exit 0", r.code === 0, r.err || r.out);
    check("reinstalled exactly once", m.reinstalls() === 1, "count=" + m.reinstalls());
    check("summary marks recovered:true", /"recovered":true/.test(r.out), r.out.trim());
    check("summary shows repointed afterPath", /"afterPath":"\/paperclip\/plugins\/github-sync-plugin"/.test(r.out), r.out.trim());
  },
);

// 7) GOL-804 safety: recovery reinstall drops config => FAIL loud (don't ship
//    an unconfigured worker)
await withServer(
  {
    installed: true,
    startVersion: "0.11.3",
    afterVersion: "0.11.3",
    installVersion: "0.11.6",
    reinstallDropsConfig: true,
  },
  async (base) => {
    const r = await run(base, "0.11.6", "/paperclip/plugins/github-sync-plugin");
    check("dropped-config reinstall fails nonzero", r.code !== 0, "code=" + r.code);
    check("dropped-config error is explicit", /DROPPED plugin config/.test(r.err), r.err.trim());
  },
);

// 8) GOL-804: reinstall still doesn't reach the built version => FAIL
await withServer(
  {
    installed: true,
    startVersion: "0.11.3",
    afterVersion: "0.11.3",
    installVersion: "0.11.5", // still not the deployed 0.11.6
  },
  async (base) => {
    const r = await run(base, "0.11.6", "/paperclip/plugins/github-sync-plugin");
    check("reinstall-still-stale fails nonzero", r.code !== 0, "code=" + r.code);
    check("error notes reinstall was tried", /even after reinstall from/.test(r.err), r.err.trim());
  },
);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
