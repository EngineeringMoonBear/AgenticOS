import type { VaultIndex, LintIssue, WikiPath } from "../types";

/**
 * Detect broken wikilinks: pages that reference paths which don't exist in the index.
 *
 * Pure function over VaultIndex — no I/O.
 * Emits one LintIssue per unresolved link reference.
 */
export function detectBrokenLinks(index: VaultIndex): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const [pagePath, page] of index.pages) {
    for (const ref of page.unresolvedLinks) {
      issues.push({
        kind: "broken-link",
        path: pagePath as WikiPath,
        detail: `Unresolved wikilink: [[${ref}]]`,
      });
    }
  }

  return issues;
}
