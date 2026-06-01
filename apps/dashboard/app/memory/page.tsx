"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { Menu, X } from "lucide-react";
import { MemoryVista } from "@/components/shell/MemoryVista";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { InboxQueue } from "@/components/memory/InboxQueue";
import { GraphCanvas } from "@/components/memory/GraphCanvas";
import type { Metadata } from "next";

export default function MemoryPage() {
  const [selectedPath, setSelectedPath] = useQueryState(
    "page",
    parseAsString.withDefault("")
  );
  const [graphMode, setGraphMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activePath = selectedPath || null;

  function handleSelect(path: string) {
    void setSelectedPath(path);
    setSidebarOpen(false); // close sidebar on mobile after selection
  }

  function handleNavigate(path: string) {
    void setSelectedPath(path);
  }

  function handleGraphSelect(path: string) {
    void setSelectedPath(path);
    setGraphMode(false);
  }

  return (
    <>
      <MemoryVista />
      <div className="memory-layout">
        <div
          className="memory-toolbar"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface)",
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="memory-sidebar-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? (
                <X size={16} aria-hidden="true" />
              ) : (
                <Menu size={16} aria-hidden="true" />
              )}
            </button>
            <h1 className="memory-toolbar__title">Memory</h1>
          </div>
          <MemorySyncIndicator />
        </div>

        <div className="memory-panes">
          {/* Left rail: inbox (human validation queue) on top, wiki below.
              Inbox is the staging gate — captures land here and are reviewed
              before promotion into the curated wiki — so it sits above the
              stable archive. Capped height + scroll keeps a full inbox from
              crowding out the wiki tree. */}
          <div
            className={`memory-sidebar ${sidebarOpen ? "memory-sidebar--open" : ""}`}
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div
              className="shrink-0 max-h-[45%] overflow-auto border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <InboxQueue />
            </div>
            <div className="flex-1 overflow-auto">
              <MemoryTree
                selectedPath={activePath}
                onSelect={handleSelect}
              />
            </div>
          </div>

          {/* Backdrop overlay for mobile sidebar */}
          {sidebarOpen && (
            <div
              className="memory-sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Center: reader or graph */}
          {graphMode ? (
            <GraphCanvas onSelectNode={handleGraphSelect} />
          ) : (
            <MemoryReader
              path={activePath}
              graphMode={graphMode}
              onToggleGraph={() => setGraphMode((g) => !g)}
            />
          )}

          {/* Right rail */}
          <MemoryRail path={activePath} onNavigate={handleNavigate} />
        </div>
      </div>
    </>
  );
}
