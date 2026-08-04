// test-automerge-gate.mjs — unit test for the auto-merge gate decision.
// Run: node scripts/test-automerge-gate.mjs
import assert from "node:assert/strict";
import { evaluateGate, sensitiveGateFromEnv, classifyDependabotTitle } from "./automerge-gate.mjs";

const base = {
  authorLogin: "agenticos-developer[bot]",
  changedFiles: ["src/a.ts"],
  additions: 10,
  deletions: 2,
  sensitiveGate: false,
  maxLines: 800,
  maxFiles: 25,
};

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.error(`NOT OK - ${name}\n  ${e.message}`); }
};

check("allows a small agent PR", () => {
  assert.equal(evaluateGate(base).allow, true);
});

check("rejects a non-agent author", () => {
  const r = evaluateGate({ ...base, authorLogin: "somehuman" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /not the agent App bot/);
});

check("accepts the bare app slug too", () => {
  assert.equal(evaluateGate({ ...base, authorLogin: "app/agenticos-developer" }).allow, true);
});

check("rejects when total changed lines exceed maxLines", () => {
  const r = evaluateGate({ ...base, additions: 900, deletions: 0 });
  assert.equal(r.allow, false);
  assert.match(r.reason, /900 changed lines/);
});

check("counts deletions toward the line cap", () => {
  const r = evaluateGate({ ...base, additions: 500, deletions: 400 });
  assert.equal(r.allow, false);
});

check("rejects when changed-file count exceeds maxFiles", () => {
  const files = Array.from({ length: 26 }, (_, i) => `src/f${i}.ts`);
  const r = evaluateGate({ ...base, changedFiles: files });
  assert.equal(r.allow, false);
  assert.match(r.reason, /26 changed files/);
});

check("allows exactly at the caps (bounds are inclusive)", () => {
  const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
  assert.equal(evaluateGate({ ...base, changedFiles: files, additions: 800, deletions: 0 }).allow, true);
});

check("sensitive gate env default is ON when unset (secure-by-default)", () => {
  assert.equal(sensitiveGateFromEnv({}), true);
});

check("sensitive gate env: only explicit off disables; junk stays ON (fail-closed)", () => {
  assert.equal(sensitiveGateFromEnv({ AUTOMERGE_SENSITIVE_GATE: "off" }), false);
  assert.equal(sensitiveGateFromEnv({ AUTOMERGE_SENSITIVE_GATE: "OFF " }), false);
  assert.equal(sensitiveGateFromEnv({ AUTOMERGE_SENSITIVE_GATE: "on" }), true);
  assert.equal(sensitiveGateFromEnv({ AUTOMERGE_SENSITIVE_GATE: "banana" }), true);
});

check("sensitive gate OFF permits a workflow edit", () => {
  assert.equal(evaluateGate({ ...base, changedFiles: [".github/workflows/ci.yml"] }).allow, true);
});

check("sensitive gate ON blocks a workflow edit", () => {
  const r = evaluateGate({ ...base, sensitiveGate: true, changedFiles: [".github/workflows/ci.yml"] });
  assert.equal(r.allow, false);
  assert.match(r.reason, /sensitive path/);
});

check("sensitive gate ON blocks infra, compose, broker and Dockerfiles", () => {
  for (const f of [
    "infra/terraform/main.tf",
    "docker-compose.yml",
    "scripts/agent-git/helper.sh",
    "packages/credential-broker/src/index.ts",
    "apps/dashboard/Dockerfile",
    ".gitleaks.toml",
  ]) {
    const r = evaluateGate({ ...base, sensitiveGate: true, changedFiles: [f] });
    assert.equal(r.allow, false, `expected ${f} to be blocked`);
  }
});

check("sensitive gate ON still allows ordinary paths", () => {
  assert.equal(evaluateGate({ ...base, sensitiveGate: true, changedFiles: ["src/a.ts"] }).allow, true);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");

// ── Dependabot eligibility (2026-08-03) ──────────────────────────────────────
// Real titles taken verbatim from open PRs on this repo.
const dbot = { ...base, authorLogin: "app/dependabot" };

check("dependabot title parsing handles single, grouped and bare-major forms", () => {
  assert.deepEqual(classifyDependabotTitle("chore(deps)(deps-dev): bump jsdom from 29.1.1 to 30.0.1"), { isDev: true, major: true });
  assert.deepEqual(classifyDependabotTitle("chore(deps)(deps-dev): bump postcss from 8.5.20 to 8.5.23"), { isDev: true, major: false });
  assert.deepEqual(classifyDependabotTitle("chore(deps)(deps): bump actions/checkout from 5 to 7"), { isDev: false, major: true });
  assert.deepEqual(classifyDependabotTitle("chore(deps)(deps): bump the production-dependencies group with 18 updates"), { isDev: false, major: null });
});

check("dependabot patch bump of a dev dependency auto-merges", () => {
  const r = evaluateGate({ ...dbot, prTitle: "chore(deps)(deps-dev): bump postcss from 8.5.20 to 8.5.23" });
  assert.equal(r.allow, true);
});

check("dependabot MAJOR bump of a dev dependency auto-merges (cannot reach prod; CI must be green)", () => {
  const r = evaluateGate({ ...dbot, prTitle: "chore(deps)(deps-dev): bump jsdom from 29.1.1 to 30.0.1" });
  assert.equal(r.allow, true);
});

check("dependabot MAJOR bump of a production dependency keeps a human", () => {
  const r = evaluateGate({ ...dbot, prTitle: "chore(deps)(deps): bump left-pad from 1.2.3 to 2.0.0" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /major version bump of a production dependency/);
});

check("dependabot GROUPED production update keeps a human (no single version pair)", () => {
  const r = evaluateGate({ ...dbot, prTitle: "chore(deps)(deps): bump the production-dependencies group with 18 updates" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /grouped production-dependency update/);
});

check("dependabot grouped DEV update auto-merges", () => {
  const r = evaluateGate({ ...dbot, prTitle: "chore(deps)(deps-dev): bump the dev-dependencies group with 6 updates" });
  assert.equal(r.allow, true);
});

check("dependabot still cannot touch sensitive paths (actions bumps live in .github/)", () => {
  const r = evaluateGate({ ...dbot, sensitiveGate: true, changedFiles: [".github/workflows/ci.yml"], prTitle: "chore(deps)(deps): bump actions/checkout from 5 to 7" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /sensitive path/);
});

check("dependabot is still bound by the blast-radius caps", () => {
  const r = evaluateGate({ ...dbot, additions: 5000, deletions: 0, prTitle: "chore(deps)(deps-dev): bump x from 1.0.0 to 1.0.1" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /exceeds AUTOMERGE_MAX_LINES/);
});

check("a random human author is still rejected", () => {
  const r = evaluateGate({ ...base, authorLogin: "some-human", prTitle: "fix: thing" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /not the agent App bot or dependabot/);
});
