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
} from "./types.js";

// Store interface
export type { VaultStore } from "./store/vault-store.js";

// Errors
export { VaultPathError, VaultParseError, VaultLockedError } from "./store/errors.js";

// Parse utilities (browser-safe)
export { parseFrontmatter } from "./parse/frontmatter.js";
export type { FrontmatterResult } from "./parse/frontmatter.js";
export { extractWikilinks, resolveWikilinks } from "./parse/wikilinks.js";
export type { WikilinkRef } from "./parse/wikilinks.js";
export { extractTags, mergeTags } from "./parse/tags.js";
export { parseMarkdown, processMarkdown } from "./parse/pipeline.js";
export { default as remarkCallouts } from "./parse/callouts.js";

// Path safety (browser-safe)
export { safeResolve, isSafePath } from "./path/safe-resolve.js";

// Lint detectors (pure functions)
export { detectBrokenLinks } from "./lint/broken-links.js";
export { detectOrphans } from "./lint/orphans.js";
export { detectTodos } from "./lint/todos.js";

// NOTE: InMemoryVaultStore is NOT re-exported here because it carries
// `import "server-only"` and must only be imported in server contexts.
// Import it directly:
//   import { InMemoryVaultStore } from "@agenticos/vault-core/src/store/in-memory.js"
