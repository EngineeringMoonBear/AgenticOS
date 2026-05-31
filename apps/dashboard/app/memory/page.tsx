"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { MemoryVista } from "@/components/shell/MemoryVista";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { InboxQueue } from "@/components/memory/InboxQueue";
import { GraphCanvas } from "@/components/memory/GraphCanvas";

export default function MemoryPage() {
  const [selectedPath, setSelectedPath] = useQueryState(
    "page",
    parseAsString.withDefault("")
  );
  const [graphMode, setGraphMode] = useState(false);

  const activePath = selectedPath || null;

  function handleSelect(path: string) {
    void setSelectedPath(path);
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
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ height: "calc(100vh - 56px)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b shrink-0"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface)",
          }}
        >
          <p
            className="text-[12px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Memory
          </p>
          <MemorySyncIndicator />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left rail: tree + inbox */}
          <div
            className="flex flex-col w-64 border-r overflow-hidden"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex-1 overflow-auto">
              <MemoryTree selectedPath={activePath} onSelect={handleSelect} />
            </div>
            <InboxQueue />
          </div>

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
