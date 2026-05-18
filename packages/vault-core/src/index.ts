// Types
export type {
  WikiPath,
  SourcePath,
  InboxPath,
  WikiPage,
  InboxNote,
  VaultIndex,
  LintIssue,
  TreeNode,
  TagInfo,
  VaultStats,
} from "./types";

// Store interface
export type { VaultStore } from "./store/vault-store";

// Errors
export { VaultPathError, VaultParseError, VaultLockedError } from "./store/errors";

// Parse utilities (browser-safe)
export { parseFrontmatter } from "./parse/frontmatter";
export type { FrontmatterResult } from "./parse/frontmatter";
export { extractWikilinks, resolveWikilinks } from "./parse/wikilinks";
export type { WikilinkRef } from "./parse/wikilinks";
export { extractTags, mergeTags } from "./parse/tags";
export { parseMarkdown, processMarkdown } from "./parse/pipeline";
export { default as remarkCallouts } from "./parse/callouts";

// Path safety (browser-safe)
export { safeResolve, isSafePath } from "./path/safe-resolve";

// Lint detectors (pure functions)
export { detectBrokenLinks } from "./lint/broken-links";
export { detectOrphans } from "./lint/orphans";
export { detectTodos } from "./lint/todos";

// NOTE: InMemoryVaultStore is NOT re-exported here because it carries
// `import "server-only"` and must only be imported in server contexts.
// Import it directly:
//   import { InMemoryVaultStore } from "@agenticos/vault-core/src/store/in-memory.js"
