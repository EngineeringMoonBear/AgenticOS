import type { VaultIndex, LintIssue, WikiPath } from "../types.js";

const TODO_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\[\[\?\]\]/,       // [[?]] — unresolved question marker
  /^[ \t]*-[ \t]+\[ \]/, // - [ ] task list checkbox (unchecked)
];

/**
 * Detect TODO / FIXME / [[?]] / unchecked task items in page bodies.
 *
 * Emits one LintIssue per matching line (with line number).
 * Pure function over VaultIndex — no I/O.
 */
export function detectTodos(index: VaultIndex): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const [pagePath, page] of index.pages) {
    const lines = page.body.split("\n");
    lines.forEach((line, idx) => {
      for (const pattern of TODO_PATTERNS) {
        if (pattern.test(line)) {
          issues.push({
            kind: "todo",
            path: pagePath as WikiPath,
            detail: line.trim().slice(0, 120),
            line: idx + 1, // 1-based
          });
          break; // one issue per line
        }
      }
    });
  }

  return issues;
}
