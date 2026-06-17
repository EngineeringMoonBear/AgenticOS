"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { IconBtn } from "@/components/ui/IconBtn";
import { Row, RowList } from "@/components/ui/Row";

interface ScheduledJob {
  name: string;
  cron: string;
  last_run_label: string;
  next_in: string;
}

interface ScheduledJobsData {
  jobs: ScheduledJob[];
}

const CalIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
);

const PlayIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
  >
    <polygon points="7 5 19 12 7 19" />
  </svg>
);

function useScheduledJobs() {
  return useQuery<ScheduledJobsData>({
    queryKey: ["tasks", "scheduled"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/scheduled");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

interface ScheduledRunsPanelProps {
  /** When false, the "trigger now" play button is hidden.
   *  Set to false on the Paperclip path — it POSTs a Hermes-only endpoint
   *  that does not exist on Paperclip. Default: true (Hermes path). */
  showTriggerButton?: boolean;
}

export function ScheduledRunsPanel({ showTriggerButton = true }: ScheduledRunsPanelProps) {
  const { data, isLoading } = useScheduledJobs();
  const [busy, setBusy] = useState<string | null>(null);

  async function trigger(name: string) {
    setBusy(name);
    try {
      await fetch(`/api/tasks/scheduled/${encodeURIComponent(name)}/trigger`, {
        method: "POST",
      });
    } catch {
      // swallow — stub endpoint returns 501.
    } finally {
      setBusy(null);
    }
  }

  const jobs = data?.jobs ?? [];

  return (
    <Card>
      <CardHead>
        <CardTitle icon={CalIcon}>Scheduled runs</CardTitle>
        <CardAction>{jobs.length} jobs</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No scheduled jobs.
        </div>
      ) : (
        <RowList>
          {jobs.map((j) => (
            <Row
              key={j.name}
              style={{
                gridTemplateColumns: showTriggerButton ? "1fr auto auto" : "1fr auto",
                gap: 10,
              }}
            >
              <div>
                <div className="label-strong" style={{ fontSize: 12.5 }}>
                  {j.name}
                </div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  {j.cron} · {j.last_run_label}
                </div>
              </div>
              <span className="num" style={{ fontSize: 12 }}>
                {j.next_in}
              </span>
              {showTriggerButton && (
                <IconBtn
                  variant="go"
                  ariaLabel={`Trigger ${j.name} now`}
                  onClick={() => trigger(j.name)}
                  disabled={busy === j.name}
                >
                  {PlayIcon}
                </IconBtn>
              )}
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
