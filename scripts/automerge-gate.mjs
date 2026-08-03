// automerge-gate.mjs — decides whether an agent PR may auto-merge.
//
// Extracted from inline bash in .github/workflows/auto-approve.yml so the
// decision is unit-testable (scripts/test-automerge-gate.mjs). The workflow
// still owns "are all checks green"; this owns author, size, and path policy.
//
// CLI: node scripts/automerge-gate.mjs
//   env: PR_AUTHOR, PR_FILES (newline-separated), PR_ADDITIONS, PR_DELETIONS,
//        AUTOMERGE_SENSITIVE_GATE (on|off), AUTOMERGE_MAX_LINES, AUTOMERGE_MAX_FILES
//   exit 0 = allow, exit 1 = skip (reason on stdout)
import { pathToFileURL } from "node:url";

/** Authors permitted to auto-merge: the Paperclip agent App bot, both spellings. */
const AGENT_AUTHORS = new Set(["agenticos-developer", "app/agenticos-developer", "agenticos-developer[bot]"]);

/**
 * Security finding M2 (PR #359): CI is not an adversarial-code gate. A
 * prompt-injected agent editing these paths could self-ship. Mirrors
 * .github/CODEOWNERS — keep both in sync.
 */
const SENSITIVE = [
  /^\.github\//,
  /^infra\//,
  /^docker-compose/,
  /^scripts\/agent-git\//,
  /^packages\/credential-broker\//,
  /^\.gitleaks\.toml$/,
  /(^|\/)Dockerfile/,
];

export function evaluateGate(input) {
  const { authorLogin, changedFiles, additions, deletions, sensitiveGate, maxLines, maxFiles } = input;

  if (!AGENT_AUTHORS.has(authorLogin)) {
    return { allow: false, reason: `author '${authorLogin}' is not the agent App bot; human and external PRs keep human review` };
  }

  if (changedFiles.length > maxFiles) {
    return { allow: false, reason: `${changedFiles.length} changed files exceeds AUTOMERGE_MAX_FILES=${maxFiles}` };
  }

  const lines = additions + deletions;
  if (lines > maxLines) {
    return { allow: false, reason: `${lines} changed lines exceeds AUTOMERGE_MAX_LINES=${maxLines}` };
  }

  if (sensitiveGate) {
    const hit = changedFiles.find((f) => SENSITIVE.some((re) => re.test(f)));
    if (hit) {
      return { allow: false, reason: `sensitive path '${hit}' — AUTOMERGE_SENSITIVE_GATE is on` };
    }
  }

  return { allow: true, reason: `${changedFiles.length} files / ${lines} lines within caps` };
}

// CLI entrypoint — only when executed directly, not when imported by the test.
// Uses pathToFileURL (not a naive `file://${path}` string) because a naive
// comparison silently mismatches whenever the script path needs URL-encoding
// (e.g. a space, as in this repo's iCloud-synced checkout path) — that would
// make this whole guard false, so the gate never actually runs and `node
// automerge-gate.mjs` exits 0 with no output, which the workflow reads as an
// (incorrect) "allow".
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const result = evaluateGate({
    authorLogin: (process.env.PR_AUTHOR ?? "").trim(),
    changedFiles: (process.env.PR_FILES ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    additions: num(process.env.PR_ADDITIONS, 0),
    deletions: num(process.env.PR_DELETIONS, 0),
    sensitiveGate: (process.env.AUTOMERGE_SENSITIVE_GATE ?? "off").toLowerCase() === "on",
    maxLines: num(process.env.AUTOMERGE_MAX_LINES, 800),
    maxFiles: num(process.env.AUTOMERGE_MAX_FILES, 25),
  });
  console.log(result.reason);
  process.exit(result.allow ? 0 : 1);
}
