"use client";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { PillVariant } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";
import { useIssues } from "@/lib/hooks/use-issues";
import type { IssueRow } from "@/lib/hooks/use-issues";

// ── Icon ─────────────────────────────────────────────────────────────────────

const IssuesIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps an issue status string to a Pill variant.
 * Issue statuses (from constants.ts line 177):
 *   "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled"
 */
function statusToPillVariant(status: string): PillVariant {
  switch (status) {
    case "done":
      return "ok";
    case "in_progress":
    case "in_review":
      return "run";
    case "blocked":
      return "err";
    case "cancelled":
      return "stuck";
    case "backlog":
    case "todo":
    default:
      return "warn";
  }
}

/**
 * Maps a priority string to a human-readable label.
 * Returns null for null priority (no badge rendered).
 */
function formatPriority(priority: string | null): string | null {
  if (priority === null) return null;
  // Capitalise first letter; replace underscores with spaces.
  return priority.charAt(0).toUpperCase() + priority.slice(1).replace(/_/g, " ");
}

/**
 * Human-readable label for a status group heading.
 * Converts snake_case status to title case.
 */
function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Canonical order for status groups.
 * Statuses not in this list are sorted after.
 */
const STATUS_ORDER: string[] = [
  "in_progress",
  "in_review",
  "blocked",
  "todo",
  "backlog",
  "done",
  "cancelled",
];

function statusSortKey(status: string): number {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

/**
 * Groups an array of IssueRow by status, returning ordered entries.
 */
function groupByStatus(issues: IssueRow[]): Array<{ status: string; items: IssueRow[] }> {
  const map = new Map<string, IssueRow[]>();
  for (const issue of issues) {
    const bucket = map.get(issue.status) ?? [];
    bucket.push(issue);
    map.set(issue.status, bucket);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => statusSortKey(a) - statusSortKey(b))
    .map(([status, items]) => ({ status, items }));
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function IssueRowItem({ issue }: { issue: IssueRow }) {
  const pillVariant = statusToPillVariant(issue.status);
  const assigneeLabel = issue.assignee ?? "unassigned";
  const priorityLabel = formatPriority(issue.priority);

  return (
    <Row style={{ gridTemplateColumns: "auto 1fr auto", gap: 10 }}>
      <Pill variant={pillVariant}>{issue.status}</Pill>
      <div>
        <div className="label-strong" style={{ fontSize: 12.5 }}>
          {issue.title}
        </div>
        <div
          className="meta"
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--parchment-muted)" }}
        >
          {assigneeLabel}
        </div>
      </div>
      {priorityLabel !== null && (
        <span
          className="num"
          style={{ fontSize: 11, color: "var(--parchment-muted)" }}
        >
          {priorityLabel}
        </span>
      )}
    </Row>
  );
}

function StatusGroup({ status, items }: { status: string; items: IssueRow[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--parchment-muted)",
          padding: "6px 0 2px",
        }}
      >
        {formatStatusLabel(status)}
      </div>
      <RowList>
        {items.map((issue) => (
          <IssueRowItem key={issue.id} issue={issue} />
        ))}
      </RowList>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IssuesPanel() {
  const { data, isLoading, isError } = useIssues();
  const issues = data?.issues ?? [];
  const groups = groupByStatus(issues);
  const summary = isLoading
    ? "loading…"
    : `${issues.length} issue${issues.length === 1 ? "" : "s"}`;

  return (
    <Card lane="amber">
      <CardHead>
        <CardTitle icon={IssuesIcon}>Issues</CardTitle>
        <CardAction>{summary}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="text-sm" style={{ color: "var(--russet)" }}>
          Failed to load issues.
        </div>
      ) : issues.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No issues found.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map(({ status, items }) => (
            <StatusGroup key={status} status={status} items={items} />
          ))}
        </div>
      )}
    </Card>
  );
}
