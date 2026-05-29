"use client";

import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { Card, CardHead, CardTitle } from "@/components/ui/Card";
import { useMemoryAbstracts } from "@/lib/hooks/use-memory-abstracts";

interface AbstractListProps {
  parentUri: string;
  selectedUri: string | null;
  onSelect: (uri: string) => void;
}

export function AbstractList({
  parentUri,
  selectedUri,
  onSelect,
}: AbstractListProps) {
  const { data, isLoading, isError } = useMemoryAbstracts(parentUri);

  return (
    <Card className="abstract-list h-full overflow-hidden flex flex-col">
      <CardHead>
        <CardTitle>Abstracts</CardTitle>
      </CardHead>

      <div
        className="flex-1 overflow-auto px-2 pb-2 flex flex-col gap-2"
        aria-label="Memory abstracts"
        role="list"
      >
        {!parentUri && (
          <p
            className="px-2 py-2 text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Select a category to see its abstracts.
          </p>
        )}

        {parentUri && isLoading && (
          <div
            className="flex items-center gap-2 px-2 py-3"
            role="status"
            aria-label="Loading abstracts"
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

        {parentUri && isError && (
          <div className="flex items-center gap-2 px-2 py-3" role="alert">
            <AlertCircle size={14} style={{ color: "var(--error)" }} />
            <span className="text-[12px]" style={{ color: "var(--error)" }}>
              Failed to load abstracts
            </span>
          </div>
        )}

        {parentUri &&
          !isLoading &&
          !isError &&
          (data?.items?.length ?? 0) === 0 && (
            <p
              className="px-2 py-2 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              No abstracts for this category.
            </p>
          )}

        {parentUri &&
          !isLoading &&
          !isError &&
          data?.items?.map((item) => {
            const isSelected = selectedUri === item.uri;
            return (
              <button
                key={item.uri}
                type="button"
                role="listitem"
                aria-current={isSelected ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                onClick={() => onSelect(item.uri)}
                className="text-left rounded-md px-3 py-2 transition-colors"
                style={{
                  backgroundColor: isSelected
                    ? "var(--surface-elevated)"
                    : "var(--surface)",
                  borderLeft: isSelected
                    ? "2px solid var(--sage)"
                    : "2px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
                  <span
                    className="text-[13px] font-medium truncate"
                    style={{
                      color: isSelected ? "var(--sage)" : "var(--text-primary)",
                    }}
                    title={item.uri}
                  >
                    {item.name}
                  </span>
                </div>
                <p
                  className="mt-1 text-[12px] line-clamp-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.abstract}
                </p>
              </button>
            );
          })}
      </div>
    </Card>
  );
}

export default AbstractList;
