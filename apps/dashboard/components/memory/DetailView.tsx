"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardHead, CardTitle } from "@/components/ui/Card";
import { useMemoryOverview } from "@/lib/hooks/use-memory-overview";
import { useMemoryDetail } from "@/lib/hooks/use-memory-detail";
import { RetrievalTrajectoryGraph } from "./RetrievalTrajectoryGraph";

const DEFAULT_LIMIT = 8192;

type Tab = "detail" | "trace";

interface DetailViewProps {
  uri: string;
}

export function DetailView({ uri }: DetailViewProps) {
  const [tab, setTab] = useState<Tab>("detail");
  const [offset, setOffset] = useState(0);
  const [contentRequested, setContentRequested] = useState(false);

  const overview = useMemoryOverview(uri);
  const detail = useMemoryDetail(
    contentRequested ? uri : "",
    contentRequested ? offset : undefined,
    contentRequested ? DEFAULT_LIMIT : undefined,
  );

  if (!uri) {
    return (
      <Card className="detail-view h-full overflow-hidden flex flex-col">
        <CardHead>
          <CardTitle>Detail</CardTitle>
        </CardHead>
        <p
          className="px-4 py-3 text-[13px]"
          style={{ color: "var(--text-muted)" }}
        >
          Select an abstract to see its detail.
        </p>
      </Card>
    );
  }

  const limit = detail.data?.limit ?? DEFAULT_LIMIT;
  const total = detail.data?.total_offset ?? detail.data?.total ?? 0;
  const currentOffset = detail.data?.offset ?? offset;
  const endByte = Math.min(currentOffset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = total > 0 && currentOffset + limit < total;

  return (
    <Card className="detail-view h-full overflow-hidden flex flex-col">
      <CardHead>
        <CardTitle>Detail</CardTitle>
      </CardHead>

      <div
        role="tablist"
        aria-label="Detail tabs"
        className="flex gap-1 px-3 pb-2"
      >
        {(
          [
            ["detail", "Detail"],
            ["trace", "Trace usage"],
          ] as const
        ).map(([key, label]) => {
          const isActive = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-selected={isActive ? "true" : undefined}
              onClick={() => setTab(key)}
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
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        {tab === "detail" && (
          <div role="tabpanel" aria-label="Detail content">
            <section className="mb-3">
              <h3
                className="text-[11px] font-medium tracking-widest uppercase mb-1"
                style={{ color: "var(--text-muted)" }}
              >
                Overview
              </h3>
              {overview.isLoading && (
                <div
                  className="flex items-center gap-2 py-2"
                  role="status"
                  aria-label="Loading overview"
                >
                  <Loader2
                    size={14}
                    className="animate-spin"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <span
                    className="text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Loading overview…
                  </span>
                </div>
              )}
              {overview.isError && (
                <div className="flex items-center gap-2 py-2" role="alert">
                  <AlertCircle size={14} style={{ color: "var(--error)" }} />
                  <span
                    className="text-[12px]"
                    style={{ color: "var(--error)" }}
                  >
                    Failed to load overview
                  </span>
                </div>
              )}
              {overview.data?.overview && (
                <pre
                  className="text-[13px] whitespace-pre-wrap font-sans"
                  style={{ color: "var(--text-primary)" }}
                >
                  {overview.data.overview}
                </pre>
              )}
            </section>

            <section>
              <h3
                className="text-[11px] font-medium tracking-widest uppercase mb-1"
                style={{ color: "var(--text-muted)" }}
              >
                Content
              </h3>
              {!contentRequested && (
                <button
                  type="button"
                  onClick={() => setContentRequested(true)}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--surface-elevated)",
                    color: "var(--sage)",
                    border: "1px solid var(--sage)",
                  }}
                >
                  Load full content
                </button>
              )}

              {contentRequested && detail.isLoading && (
                <div
                  className="flex items-center gap-2 py-2"
                  role="status"
                  aria-label="Loading detail"
                >
                  <Loader2
                    size={14}
                    className="animate-spin"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <span
                    className="text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Loading content…
                  </span>
                </div>
              )}
              {contentRequested && detail.isError && (
                <div className="flex items-center gap-2 py-2" role="alert">
                  <AlertCircle size={14} style={{ color: "var(--error)" }} />
                  <span
                    className="text-[12px]"
                    style={{ color: "var(--error)" }}
                  >
                    Failed to load content
                  </span>
                </div>
              )}
              {contentRequested && detail.data && (
                <>
                  <pre
                    className="text-[12px] whitespace-pre-wrap font-mono rounded-md p-3 overflow-auto"
                    style={{
                      backgroundColor: "var(--surface-elevated)",
                      color: "var(--text-primary)",
                      maxHeight: "40vh",
                    }}
                  >
                    {detail.data.content ?? ""}
                  </pre>
                  <div
                    className="mt-2 flex items-center justify-between gap-2"
                    aria-label="Pagination"
                  >
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      showing bytes {currentOffset.toLocaleString()}–
                      {endByte.toLocaleString()} of {total.toLocaleString()}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOffset((o) => Math.max(0, o - limit))
                        }
                        disabled={!hasPrev}
                        aria-label="Previous page"
                        className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: "var(--surface-elevated)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setOffset((o) => o + limit)}
                        disabled={!hasNext}
                        aria-label="Next page"
                        className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: "var(--surface-elevated)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {tab === "trace" && (
          <div role="tabpanel" aria-label="Trace usage">
            <RetrievalTrajectoryGraph uri={uri} />
          </div>
        )}
      </div>
    </Card>
  );
}

export default DetailView;
