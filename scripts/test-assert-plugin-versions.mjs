// test-assert-plugin-versions.mjs — GOL-804 unit test
//
// Proves assert-plugin-versions.mjs, against a mock board API:
//   1. passes when every expected plugin is installed at the built version + healthy,
//   2. FAILS (nonzero) when any plugin's registry version != built version
//      (the GOL-804 stale-deploy signal), and names the drift,
//   3. FAILS when an expected plugin is not installed,
//   4. FAILS when a plugin is at the right version but unhealthy (a crash),
//   4b. PASSES (soft WARN, GOL-1276) when the only unhealthy plugin is
//       installed-but-unconfigured (lastError = "…config missing…"),
//   4c. FAILS that same case under STRICT_HEALTH=1,
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
            lastError: p.lastError ?? null,
            packagePath: "/paperclip/staged-plugins/" + p.key,
          })),
        }),
      );
    }
    res.writeHead(404).end();
  });
  return srv;
}

function run(base, expect, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TARGET], {
      env: { ...process.env, PAPERCLIP_BASE: base, BOARD_KEY: "k", EXPECT: expect, ...extraEnv },
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

// 4) right version, unhealthy (a real crash, no config-missing lastError) => FAIL
await withServer(
  [{ key: "agenticos.github-sync-plugin", version: "0.11.6", status: "error",
     lastError: "TypeError: Cannot read properties of undefined" }],
  async (base) => {
    const r = await run(base, "agenticos.github-sync-plugin=0.11.6");
    check("crash unhealthy fails nonzero", r.code !== 0, "code=" + r.code);
    check("crash unhealthy named", /UNHEALTHY/.test(r.err), r.err.trim());
  },
);

// 4b) right version, unhealthy ONLY because config isn't wired => soft WARN, exit 0
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "Activation failed: Worker initialize failed: discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.2.0");
    check("unconfigured soft-warns, exit 0", r.code === 0, "code=" + r.code + " " + r.err);
    check("unconfigured emits WARN not DRIFT", /WARN/.test(r.err) && !/DRIFT/.test(r.err), r.err.trim());
    check("unconfigured reports soft-warned count", /1 installed-but-unconfigured, soft-warned/.test(r.out), r.out.trim());
  },
);

// 4c) same unconfigured case under STRICT_HEALTH=1 => hard FAIL
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.2.0", { STRICT_HEALTH: "1" });
    check("STRICT_HEALTH re-hardens unconfigured to nonzero", r.code !== 0, "code=" + r.code);
    check("STRICT_HEALTH names UNHEALTHY", /UNHEALTHY/.test(r.err), r.err.trim());
  },
);

// 4d) version drift on an unconfigured plugin is still hard FAIL (not soft-warned)
await withServer(
  [{ key: "agenticos.discord-plugin", version: "0.2.0", status: "error",
     lastError: "discord-plugin config missing: discordBotToken" }],
  async (base) => {
    const r = await run(base, "agenticos.discord-plugin=0.3.0");
    check("unconfigured + drift still fails nonzero", r.code !== 0, "code=" + r.code);
    check("unconfigured + drift named as STALE", /registry 0\.2\.0 != built 0\.3\.0/.test(r.err), r.err.trim());
  },
);

// 5) empty EXPECT => no-op exit 0
await withServer(REG, async (base) => {
  const r = await run(base, "");
  check("empty EXPECT no-ops exit 0", r.code === 0, r.err || r.out);
});

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
