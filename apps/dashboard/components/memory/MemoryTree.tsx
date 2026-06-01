"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Folder,
  Inbox,
  ChevronUp,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import { useFilter } from "@/lib/filter/use-filter";
import { toast } from "sonner";
import type { TreeNode } from "@agenticos/vault-core";

interface MemoryTreeProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

interface TreeFolderNodeProps {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  activeTags: string[];
  depth: number;
}

function TreeFolderNode({
  node,
  selectedPath,
  onSelect,
  activeTags,
  depth,
}: TreeFolderNodeProps) {
  const [isOpen, setIsOpen] = useState(depth === 0);

  if (node.kind === "page") {
    const isSelected = selectedPath === node.path;
    return (
      <li role="treeitem" aria-selected={isSelected}>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-left transition-colors"
          style={{
            fontSize: "13px",
            backgroundColor: isSelected ? "var(--accent-plum-950)" : "transparent",
            color: isSelected ? "var(--accent-plum-300)" : "var(--text-secondary)",
            borderLeft: isSelected
              ? "2px solid var(--accent-plum-400)"
              : "2px solid transparent",
          }}
          onMouseEnter={(e) => {
            if (!isSelected)
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--surface-elevated)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected)
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
          }}
        >
          <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </button>
      </li>
    );
  }

  // Folder node
  const children = node.children ?? [];

  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-left transition-colors"
        style={{
          color: "var(--text-secondary)",
          fontSize: "13px",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-elevated)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
        }}
      >
        {isOpen ? (
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
        )}
        {isOpen ? (
          <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Folder size={14} strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="flex-1 font-medium">{node.name}</span>
      </button>

      {isOpen && (
        <ul role="group" className="ml-3 border-l pl-2" style={{ borderColor: "var(--border-subtle)" }}>
          {children.map((child) => (
            <TreeFolderNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              activeTags={activeTags}
              depth={depth + 1}
            />
          ))}
          {children.length === 0 && (
            <li role="treeitem" className="px-2 py-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Empty folder
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function MemoryTree({ selectedPath, onSelect }: MemoryTreeProps) {
  const { tags: activeTags } = useFilter();
  const { data, isLoading, isError } = useVaultTree();
  const [inboxOpen, setInboxOpen] = useState(false);

  const rootChildren = data?.tree.children ?? [];

  return (
    <aside
      className="flex flex-col shrink-0 overflow-y-auto border-r"
      style={{
        width: "260px",
        backgroundColor: "var(--surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Wiki tree section */}
      <div className="px-2 pt-3 pb-1">
        <p
          className="px-2 py-1 text-[11px] font-medium tracking-widest uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Wiki
        </p>
      </div>

      <nav className="flex-1 px-2 pb-2" aria-label="Wiki pages">
        <ul role="tree" aria-label="Wiki page tree">
        {isLoading && (
          <div className="flex items-center gap-2 px-2 py-3">
            <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              Loading…
            </span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 px-2 py-3">
            <AlertCircle size={14} style={{ color: "var(--error)" }} />
            <span className="text-[12px]" style={{ color: "var(--error)" }}>
              Failed to load vault
            </span>
          </div>
        )}

        {!isLoading &&
          !isError &&
          rootChildren.map((child) => (
            <TreeFolderNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              activeTags={activeTags}
              depth={0}
            />
          ))}

        {!isLoading && !isError && rootChildren.length === 0 && (
          <li role="treeitem" className="px-2 py-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
            No pages found.
          </li>
        )}
        </ul>
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Inbox section */}
      <div className="px-2 py-2">
        <button
          type="button"
          onClick={() => setInboxOpen((v) => !v)}
          aria-expanded={inboxOpen}
          className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-left transition-colors"
          style={{
            color: "var(--text-secondary)",
            fontSize: "13px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-elevated)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
          }}
        >
          <Inbox size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="flex-1 font-medium">Inbox</span>
          {inboxOpen ? (
            <ChevronUp size={12} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={12} strokeWidth={1.5} />
          )}
        </button>

        {inboxOpen && (
          <div className="mt-1 px-2 py-2">
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              Inbox processing wires up in Phase 2 T5.
            </p>
            <button
              type="button"
              className="mt-1 text-[11px] font-medium transition-colors"
              style={{ color: "var(--accent-plum-400)" }}
              onClick={() =>
                toast.info("Inbox queue coming in Phase 2 T5.", {
                  description: "Promote and discard will be wired up.",
                })
              }
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color = "var(--accent-plum-300)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color = "var(--accent-plum-400)")
              }
            >
              Browse inbox →
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
