"use client";

import { useQueryState } from "nuqs";
import { WIKI_PAGES, getPageByPath } from "@/lib/fixtures/wiki";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";

const DEFAULT_PAGE = WIKI_PAGES[0]?.path ?? "";

export default function MemoryPage() {
  const [pagePath, setPagePath] = useQueryState("page", {
    defaultValue: DEFAULT_PAGE,
    history: "push",
    shallow: false,
  });

  const currentPage = getPageByPath(pagePath ?? DEFAULT_PAGE) ?? WIKI_PAGES[0];

  function handleSelect(path: string) {
    setPagePath(path);
  }

  function handleNavigate(path: string) {
    // Wikilinks use relative page paths — resolve and navigate
    const target = getPageByPath(path);
    if (target) {
      setPagePath(target.path);
    }
  }

  if (!currentPage) return null;

  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>
      <MemoryTree selectedPath={pagePath} onSelect={handleSelect} />
      <MemoryReader page={currentPage} onNavigate={handleNavigate} />
      <MemoryRail page={currentPage} onNavigate={handleNavigate} />
    </div>
  );
}
