"use client";

import { ArrowLeft, ArrowRight, Tag } from "lucide-react";
import { getPageByPath } from "@/lib/fixtures/wiki";
import type { WikiPage } from "@/lib/fixtures/wiki";
import { useFilter } from "@/lib/filter/use-filter";

interface MemoryRailProps {
  page: WikiPage;
  onNavigate: (path: string) => void;
}

export function MemoryRail({ page, onNavigate }: MemoryRailProps) {
  const { tags: activeTags, toggleTag } = useFilter();

  // For Phase 1, backlinks and outgoing come from the fixture data directly
  const backlinkPages = page.backlinks
    .map((p) => getPageByPath(p))
    .filter((p): p is WikiPage => p !== undefined);

  const outgoingPages = page.outgoing
    .map((p) => getPageByPath(p))
    .filter((p): p is WikiPage => p !== undefined);

  // Outgoing paths that don't resolve to a known page (broken links)
  const brokenOutgoing = page.outgoing.filter((p) => !getPageByPath(p));

  return (
    <aside
      className="flex flex-col shrink-0 overflow-y-auto border-l"
      style={{
        width: "240px",
        backgroundColor: "var(--surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Backlinks */}
      <section className="px-4 pt-5 pb-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-1.5 mb-3">
          <ArrowLeft size={12} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Backlinks
          </p>
        </div>
        {backlinkPages.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            No backlinks.
          </p>
        ) : (
          <ul className="space-y-1">
            {backlinkPages.map((bp) => (
              <li key={bp.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(bp.path)}
                  className="text-left text-[13px] w-full rounded-md px-2 py-1 transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "var(--surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  {bp.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Outgoing links */}
      <section className="px-4 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-1.5 mb-3">
          <ArrowRight size={12} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Outgoing links
          </p>
        </div>
        {page.outgoing.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            No outgoing links.
          </p>
        ) : (
          <ul className="space-y-1">
            {outgoingPages.map((op) => (
              <li key={op.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(op.path)}
                  className="text-left text-[13px] w-full rounded-md px-2 py-1 transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "var(--surface-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  {op.title}
                </button>
              </li>
            ))}
            {brokenOutgoing.map((path) => (
              <li key={path}>
                <span
                  className="block text-[13px] px-2 py-1"
                  style={{ color: "var(--error)" }}
                  title="Broken link — page not found in fixtures"
                >
                  {path.split("/").pop() ?? path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tags */}
      <section className="px-4 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-1.5 mb-3">
          <Tag size={12} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <p
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Tags
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {page.tags.map((tag) => {
            const isActive = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className="text-[11px] px-1.5 py-0.5 rounded-sm font-medium border transition-colors"
                style={{
                  color: isActive ? "var(--accent-plum-300)" : "var(--text-muted)",
                  backgroundColor: isActive ? "var(--accent-plum-800)" : "var(--surface-muted)",
                  borderColor: isActive ? "var(--accent-plum-600)" : "transparent",
                }}
                title={isActive ? "Remove filter" : "Filter by #" + tag}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      </section>

      {/* Lint panel stub */}
      <section className="px-4 py-4 mt-auto">
        <p
          className="text-[11px] font-medium tracking-widest uppercase mb-2"
          style={{ color: "var(--text-muted)" }}
        >
          Lint
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          0 broken links · 0 orphans · 0 contradictions
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
          Phase 2 makes this real.
        </p>
      </section>
    </aside>
  );
}
