"use client";

import { parseAsString, useQueryState } from "nuqs";
import { CategoryBrowser } from "@/components/memory/CategoryBrowser";
import { AbstractList } from "@/components/memory/AbstractList";
import { DetailView } from "@/components/memory/DetailView";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { OpenVikingSummaryPanel } from "@/components/memory/OpenVikingSummaryPanel";
import { RecentVaultChangesPanel } from "@/components/memory/RecentVaultChangesPanel";
import { SkillsCatalogPanel } from "@/components/memory/SkillsCatalogPanel";
import { MemoryVista } from "@/components/shell/MemoryVista";

export default function MemoryPage() {
  const [parentUri, setParentUri] = useQueryState(
    "uri",
    parseAsString.withDefault("")
  );
  const [selectedUri, setSelectedUri] = useQueryState(
    "item",
    parseAsString.withDefault("")
  );

  function handleCategorySelect(uri: string) {
    void setParentUri(uri);
    void setSelectedUri("");
  }

  function handleAbstractSelect(uri: string) {
    void setSelectedUri(uri);
  }

  return (
    <>
      <MemoryVista />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ height: "calc(100vh - 56px)" }}
      >
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

        {/* Three-column URI-driven browser */}
        <div className="flex-1 overflow-hidden p-4">
          <div className="grid grid-cols-12 gap-4 h-full">
            <div className="col-span-3 h-full overflow-hidden">
              <CategoryBrowser
                selectedUri={parentUri || null}
                onSelect={handleCategorySelect}
              />
            </div>
            <div className="col-span-4 h-full overflow-hidden">
              <AbstractList
                parentUri={parentUri ?? ""}
                selectedUri={selectedUri || null}
                onSelect={handleAbstractSelect}
              />
            </div>
            <div className="col-span-5 h-full overflow-hidden">
              <DetailView uri={selectedUri ?? ""} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
