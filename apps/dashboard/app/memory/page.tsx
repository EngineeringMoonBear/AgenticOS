"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { InboxQueue } from "@/components/memory/InboxQueue";
import { GraphCanvas } from "@/components/memory/GraphCanvas";
import { OpenVikingSummaryPanel } from "@/components/memory/OpenVikingSummaryPanel";
import { RecentVaultChangesPanel } from "@/components/memory/RecentVaultChangesPanel";
import { SkillsCatalogPanel } from "@/components/memory/SkillsCatalogPanel";

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
    <div className="flex flex-col flex-1 overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>
      {/* Summary strip — OpenViking scopes, skills, vault changes */}
      <div className="grid grid-cols-12 gap-4 p-4 shrink-0">
        <div className="col-span-12 md:col-span-6 lg:col-span-4">
          <OpenVikingSummaryPanel />
        </div>
        <div className="col-span-12 md:col-span-6 lg:col-span-4">
          <SkillsCatalogPanel />
        </div>
        <div className="col-span-12 md:col-span-6 lg:col-span-4">
          <RecentVaultChangesPanel />
        </div>
      </div>

      {/* Memory view header */}
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

      {/* Three-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail: tree + inbox queue */}
        <div className="flex flex-col w-64 border-r overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex-1 overflow-auto">
            <MemoryTree selectedPath={activePath} onSelect={handleSelect} />
          </div>
          <InboxQueue />
        </div>

        {/* Center: reader OR graph */}
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
  );
}
