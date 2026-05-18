import type { VaultIndex, LintIssue, WikiPath } from "../types.js";

/**
 * Detect orphan pages: pages with no incoming links AND no outgoing links.
 * Pages under `_meta/` (or any path containing `/_meta/` prefix) are skipped.
 *
 * Pure function over VaultIndex — no I/O.
 */
export function detectOrphans(index: VaultIndex): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const [pagePath, page] of index.pages) {
    // Skip _meta/ pages
    if (isMetaPath(pagePath)) continue;

    const incoming = index.backlinks.get(pagePath) ?? [];
    const outgoing = page.outgoing;

    if (incoming.length === 0 && outgoing.length === 0) {
      issues.push({
        kind: "orphan",
        path: pagePath as WikiPath,
        detail: `Orphan page: no incoming or outgoing links`,
      });
    }
  }

  return issues;
}

function isMetaPath(p: string): boolean {
  return p === "_meta" || p.startsWith("_meta/") || p.includes("/_meta/");
}
