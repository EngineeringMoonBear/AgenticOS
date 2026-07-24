// test-assert-plugin-versions.mjs — GOL-804 unit test
//
// Proves assert-plugin-versions.mjs, against a mock board API:
//   1. passes when every expected plugin is installed at the built version + healthy,
//   2. FAILS (nonzero) when any plugin's registry version != built version
//      (the GOL-804 stale-deploy signal), and names the drift,
//   3. FAILS when an expected plugin is not installed,
//   4. FAILS when a plugin is at the right version but unhealthy,
//   5. no-ops (exit 0) when EXPECT is empty.
//
// Run: node scripts/test-assert-plugin-versions.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "assert-plugin-versions.mjs");

// registry: array of {key, version, status}
function makeServer(registry) {
  const srv = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/plugins") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          plugins: registry.map((p) => ({
            id: p.key,
            pluginKey: p.key,
            version: p.version,
            status: p.status || "ready",
            packagePath: "/paperclip/staged-plugins/" + p.key,
          })),
        }),
      );
    }
    res.writeHead(404).end();
  });
  return srv;
}

function run(base, expect) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TARGET], {
      env: { ...process.env, PAPERCLIP_BASE: base, BOARD_KEY: "k", EXPECT: expect },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function withServer(registry, fn) {
  const srv = makeServer(registry);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  try {
    return await fn(base);
  } finally {
    srv.close();
  }
}

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log("  ok  - " + name);
  else { failures += 1; console.log("  FAIL- " + name + (detail ? " :: " + detail : "")); }
};

const REG = [
  { key: "agenticos.github-sync-plugin", version: "0.11.6" },
  { key: "agenticos.vault-plugin", version: "0.4.2" },
];

// 1) all converged => exit 0
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-sync-plugin=0.11.6 agenticos.vault-plugin=0.4.2");
  check("all converged, exit 0", r.code === 0, r.err || r.out);
  check("reports all converged", /all 2 converged/.test(r.out), r.out.trim());
});

// 2) one drifted (registry 0.11.6, built 0.11.7) => FAIL, names drift
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-sync-plugin=0.11.7 agenticos.vault-plugin=0.4.2");
  check("drift fails nonzero", r.code !== 0, "code=" + r.code);
  check("drift error names registry vs built", /registry 0\.11\.6 != built 0\.11\.7/.test(r.err), r.err.trim());
});

// 3) expected plugin not installed => FAIL
await withServer(REG, async (base) => {
  const r = await run(base, "agenticos.github-plugin=1.0.0");
  check("not-installed fails nonzero", r.code !== 0, "code=" + r.code);
  check("not-installed named", /NOT INSTALLED/.test(r.err), r.err.trim());
});

// 4) right version, unhealthy => FAIL
await withServer(
  [{ key: "agenticos.github-sync-plugin", version: "0.11.6", status: "error" }],
  async (base) => {
    const r = await run(base, "agenticos.github-sync-plugin=0.11.6");
    check("unhealthy fails nonzero", r.code !== 0, "code=" + r.code);
    check("unhealthy named", /UNHEALTHY/.test(r.err), r.err.trim());
  },
);

// 5) empty EXPECT => no-op exit 0
await withServer(REG, async (base) => {
  const r = await run(base, "");
  check("empty EXPECT no-ops exit 0", r.code === 0, r.err || r.out);
});

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
