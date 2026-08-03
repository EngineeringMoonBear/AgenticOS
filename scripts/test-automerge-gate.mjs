// test-automerge-gate.mjs — unit test for the auto-merge gate decision.
// Run: node scripts/test-automerge-gate.mjs
import assert from "node:assert/strict";
import { evaluateGate, sensitiveGateFromEnv } from "./automerge-gate.mjs";

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
