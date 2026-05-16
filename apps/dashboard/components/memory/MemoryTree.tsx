"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Folder, Inbox, ChevronUp } from "lucide-react";
import { WIKI_PAGES, WIKI_FOLDERS, INBOX_NOTES, groupPagesByFolder } from "@/lib/fixtures/wiki";
import { useFilter } from "@/lib/filter/use-filter";
import { toast } from "sonner";

interface MemoryTreeProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function MemoryTree({ selectedPath, onSelect }: MemoryTreeProps) {
  const { tags: activeTags } = useFilter();
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    new Set(WIKI_FOLDERS as unknown as string[])
  );
  const [inboxOpen, setInboxOpen] = useState(false);

  const grouped = groupPagesByFolder(WIKI_PAGES);

  function toggleFolder(folder: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  }

  function pageMatchesFilter(pageTags: string[]): boolean {
    if (activeTags.length === 0) return true;
    return activeTags.some((t) => pageTags.includes(t));
  }

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

      <nav className="flex-1 px-2 pb-2">
        {WIKI_FOLDERS.map((folder) => {
          const pages = grouped[folder] ?? [];
          const visiblePages = pages.filter((p) => pageMatchesFilter(p.tags));
          const isOpen = openFolders.has(folder);

          // If filter is active and no pages match, dim or skip the folder
          const hasVisiblePages = visiblePages.length > 0;
          const folderDimmed = activeTags.length > 0 && !hasVisiblePages;

          return (
            <div key={folder} className={folderDimmed ? "opacity-30" : ""}>
              <button
                type="button"
                onClick={() => toggleFolder(folder)}
                className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-left transition-colors"
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "var(--surface-elevated)";
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
                <span className="flex-1 font-medium">{folder}</span>
                {activeTags.length > 0 && hasVisiblePages && (
                  <span
                    className="text-[11px] tabular-nums rounded-sm px-1"
                    style={{
                      color: "var(--accent-plum-400)",
                      backgroundColor: "var(--accent-plum-950)",
                    }}
                  >
                    {visiblePages.length}
                  </span>
                )}
              </button>

              {isOpen && (
                <ul className="ml-3 border-l pl-2" style={{ borderColor: "var(--border-subtle)" }}>
                  {visiblePages.map((page) => {
                    const isSelected = selectedPath === page.path;
                    return (
                      <li key={page.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(page.path)}
                          className="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-left transition-colors"
                          style={{
                            fontSize: "13px",
                            backgroundColor: isSelected
                              ? "var(--accent-plum-950)"
                              : "transparent",
                            color: isSelected
                              ? "var(--accent-plum-300)"
                              : "var(--text-secondary)",
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
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                "transparent";
                          }}
                        >
                          <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
                          <span className="truncate">{page.title}</span>
                        </button>
                      </li>
                    );
                  })}
                  {/* Empty folder message when filter hides all pages */}
                  {isOpen && visiblePages.length === 0 && activeTags.length === 0 && (
                    <li
                      className="px-2 py-1 text-[12px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Empty folder
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Inbox section */}
      <div className="px-2 py-2">
        <button
          type="button"
          onClick={() => setInboxOpen((v) => !v)}
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
          <span
            className="text-[11px] tabular-nums rounded-sm px-1 mr-1"
            style={{
              color: "var(--warning)",
              backgroundColor: "var(--warning-bg)",
            }}
          >
            {INBOX_NOTES.length}
          </span>
          {inboxOpen ? (
            <ChevronUp size={12} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={12} strokeWidth={1.5} />
          )}
        </button>

        {inboxOpen && (
          <ul className="mt-1 space-y-2">
            {INBOX_NOTES.map((note) => (
              <li
                key={note.id}
                className="rounded-lg p-2.5 border"
                style={{
                  backgroundColor: "var(--surface-muted)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <p
                  className="text-[12px] font-medium mb-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  📝 {note.title}
                </p>
                <p
                  className="text-[12px] mb-2 line-clamp-2"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-serif, Georgia, serif)",
                    lineHeight: 1.5,
                  }}
                >
                  {note.snippet}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] font-medium transition-colors"
                    style={{ color: "var(--accent-plum-400)" }}
                    onClick={() =>
                      toast.info("Inbox processing wires up in Phase 2.", {
                        description: `"${note.title}" queued for promotion.`,
                      })
                    }
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color =
                        "var(--accent-plum-300)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color =
                        "var(--accent-plum-400)")
                    }
                  >
                    Promote ↑
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-medium transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() =>
                      toast.info("Inbox processing wires up in Phase 2.", {
                        description: `"${note.title}" marked for discard.`,
                      })
                    }
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")
                    }
                  >
                    Discard ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
