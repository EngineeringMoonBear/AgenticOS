import type {
  WikiPath,
  InboxPath,
  WikiPage,
  InboxNote,
  LintIssue,
  TreeNode,
  TagInfo,
  VaultStats,
} from "../types";

/**
 * The single contract consumers depend on.
 *
 * All read methods are served from a cached `VaultIndex`.
 * Write methods are atomic (tmp + rename) and call `revalidate()` on success.
 */
export interface VaultStore {
  // --- Reads (served from cache) ---

  list(): Promise<{ tree: TreeNode; flat: WikiPath[] }>;
  read(path: WikiPath): Promise<WikiPage | null>;
  search(
    query: string,
    opts?: { tags?: string[]; limit?: number }
  ): Promise<WikiPage[]>;
  getBacklinks(path: WikiPath): Promise<WikiPath[]>;
  getOutgoing(path: WikiPath): Promise<WikiPath[]>;
  getAllTags(): Promise<TagInfo[]>;
  listInbox(): Promise<InboxNote[]>;
  readInbox(path: InboxPath): Promise<InboxNote | null>;

  // --- Lint ---

  lint(): Promise<LintIssue[]>;

  // --- Writes (atomic, path-safe) ---

  promoteInbox(
    inboxPath: InboxPath,
    page: Omit<WikiPage, "bodyAst" | "outgoing" | "unresolvedLinks">
  ): Promise<WikiPage>;
  discardInbox(inboxPath: InboxPath): Promise<void>;

  // --- Cache control ---

  revalidate(): Promise<void>;
  stats(): VaultStats;
}
