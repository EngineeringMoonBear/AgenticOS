import type { Root } from "mdast";

// Relative to vault/wiki
export type WikiPath = string;
// Relative to vault/sources
export type SourcePath = string;
// Relative to vault/inbox
export type InboxPath = string;

export interface WikiPage {
  path: WikiPath;
  title: string; // frontmatter `title` || first heading || first non-empty line (max 120 chars)
  tags: string[]; // frontmatter + inline #tags merged + deduped
  created: string; // ISO from frontmatter
  updated: string; // ISO from frontmatter || file mtime
  sources: SourcePath[]; // frontmatter `sources` backref list
  body: string; // raw markdown (post-frontmatter)
  bodyAst: Root; // mdast Root from unified pipeline
  outgoing: WikiPath[]; // resolved [[wikilinks]]
  unresolvedLinks: string[]; // [[wikilinks]] that don't resolve
}

export interface InboxNote {
  path: InboxPath;
  capturedAt: string; // file mtime ISO string
  title: string; // first heading or first non-empty line (max 120 chars)
  body: string;
}

export interface VaultIndex {
  pages: Map<WikiPath, WikiPage>;
  backlinks: Map<WikiPath, WikiPath[]>; // page → who links TO it
  allTags: Set<string>;
  builtAt: number; // Date.now()
}

export interface LintIssue {
  kind: "broken-link" | "orphan" | "todo";
  path: WikiPath;
  detail: string;
  line?: number;
}

export interface TreeNode {
  path: string; // folder or file path under wiki/
  name: string; // display name
  kind: "folder" | "page";
  children?: TreeNode[];
}

export interface TagInfo {
  id: string;
  label: string;
  count: number;
  group?: string;
}

export interface VaultStats {
  pageCount: number;
  builtAt: number;
  ttlExpiresAt: number;
}
