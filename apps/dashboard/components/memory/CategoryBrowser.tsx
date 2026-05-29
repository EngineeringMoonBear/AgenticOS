"use client";

import { useMemo } from "react";
import { parseAsString, useQueryState } from "nuqs";
import {
  AlertCircle,
  File as FileIcon,
  Folder as FolderIcon,
  Layers,
  Loader2,
} from "lucide-react";
import { Card, CardHead, CardTitle } from "@/components/ui/Card";
import { useMemoryTree } from "@/lib/hooks/use-memory-tree";
import type { TreeNode } from "@/lib/api/viking";

const SCOPES = ["resources", "user", "agent", "session"] as const;
type Scope = (typeof SCOPES)[number];

interface CategoryBrowserProps {
  selectedUri: string | null;
  onSelect: (uri: string) => void;
}

interface FlatNode {
  uri: string;
  name: string;
  kind: "file" | "dir" | "scope";
}

function flatten(nodes: TreeNode[] | undefined): FlatNode[] {
  if (!nodes) return [];
  const out: FlatNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      const uri = (n.uri as string) ?? "";
      const name = (n.name as string) ?? uri;
      const rawKind = (n.type as string) ?? "file";
      const kind: FlatNode["kind"] =
        rawKind === "dir" || rawKind === "scope" || rawKind === "file"
          ? rawKind
          : "file";
      if (uri) out.push({ uri, name, kind });
      if (Array.isArray(n.children) && n.children.length > 0) {
        walk(n.children as TreeNode[]);
      }
    }
  };
  walk(nodes);
  return out;
}

function KindGlyph({ kind }: { kind: FlatNode["kind"] }) {
  const props = { size: 14, strokeWidth: 1.5, "aria-hidden": true as const };
  if (kind === "dir") return <FolderIcon {...props} />;
  if (kind === "scope") return <Layers {...props} />;
  return <FileIcon {...props} />;
}

export function CategoryBrowser({ selectedUri, onSelect }: CategoryBrowserProps) {
  const [scope, setScope] = useQueryState(
    "scope",
    parseAsString.withDefault("resources"),
  );
  const activeScope = (SCOPES as readonly string[]).includes(scope)
    ? (scope as Scope)
    : "resources";

  const { data, isLoading, isError } = useMemoryTree(activeScope);
  const nodes = useMemo(() => flatten(data?.nodes), [data]);

  return (
    <Card className="category-browser h-full overflow-hidden flex flex-col">
      <CardHead>
        <CardTitle>Categories</CardTitle>
      </CardHead>
      <div
        role="tablist"
        aria-label="Memory scope"
        className="flex gap-1 px-3 pb-2"
      >
        {SCOPES.map((s) => {
          const isActive = s === activeScope;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-selected={isActive ? "true" : undefined}
              onClick={() => void setScope(s)}
              className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
              style={{
                color: isActive ? "var(--sage)" : "var(--text-muted)",
                backgroundColor: isActive
                  ? "var(--surface-elevated)"
                  : "transparent",
                borderBottom: isActive
                  ? "1px solid var(--sage)"
                  : "1px solid transparent",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div
        className="flex-1 overflow-auto px-2 pb-2"
        aria-label="Memory tree"
        role="tree"
      >
        {isLoading && (
          <div
            className="flex items-center gap-2 px-2 py-3"
            role="status"
            aria-label="Loading memory tree"
          >
            <Loader2
              size={14}
              className="animate-spin"
              style={{ color: "var(--text-muted)" }}
            />
            <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              Loading…
            </span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 px-2 py-3" role="alert">
            <AlertCircle size={14} style={{ color: "var(--error)" }} />
            <span className="text-[12px]" style={{ color: "var(--error)" }}>
              Failed to load tree
            </span>
          </div>
        )}

        {!isLoading && !isError && nodes.length === 0 && (
          <p className="px-2 py-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
            No memories in this scope.
          </p>
        )}

        {!isLoading &&
          !isError &&
          nodes.map((n) => {
            const isSelected = selectedUri === n.uri;
            return (
              <button
                key={n.uri}
                type="button"
                role="treeitem"
                aria-selected={isSelected}
                aria-current={isSelected ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                onClick={() => onSelect(n.uri)}
                className="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-left transition-colors"
                style={{
                  fontSize: "13px",
                  backgroundColor: isSelected
                    ? "var(--surface-elevated)"
                    : "transparent",
                  color: isSelected ? "var(--sage)" : "var(--text-secondary)",
                  borderLeft: isSelected
                    ? "2px solid var(--sage)"
                    : "2px solid transparent",
                }}
              >
                <KindGlyph kind={n.kind} />
                <span className="truncate" title={n.uri}>
                  {n.name}
                </span>
              </button>
            );
          })}
      </div>
    </Card>
  );
}

export default CategoryBrowser;
