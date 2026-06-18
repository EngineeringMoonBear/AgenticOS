"use client";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { PillVariant } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";
import { useAgents } from "@/lib/hooks/use-agents";
import type { AgentRow } from "@/lib/hooks/use-agents";

// ── Icon ─────────────────────────────────────────────────────────────────────

const AgentsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a Paperclip agent status string to a Pill variant.
 * Unknown statuses fall back to "warn" so they are always visible.
 */
function statusToPillVariant(status: string): PillVariant {
  switch (status) {
    case "active":
      return "ok";
    case "paused":
    case "inactive":
      return "warn";
    case "error":
    case "disabled":
      return "err";
    default:
      return "warn";
  }
}

/**
 * Formats an ISO timestamp as a short relative string.
 * Returns "—" when the timestamp is null or unparseable.
 */
function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffSec = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  const mins = diffSec / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  return `${Math.floor(days)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

function AgentRowItem({ agent }: { agent: AgentRow }) {
  const pillVariant = statusToPillVariant(agent.status);
  const lastActivity = formatRelative(agent.lastActivityAt);

  return (
    <Row style={{ gridTemplateColumns: "auto 1fr auto auto", gap: 10 }}>
      <Pill variant={pillVariant}>{agent.status}</Pill>
      <div>
        <div className="label-strong" style={{ fontSize: 12.5 }}>
          {agent.name}
        </div>
        {agent.adapter !== null && (
          <div
            className="meta"
            style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
          >
            {agent.adapter}
          </div>
        )}
      </div>
      <span
        className="num"
        style={{ fontSize: 12, color: "var(--parchment-muted)" }}
      >
        {lastActivity}
      </span>
    </Row>
  );
}

export function AgentsPanel() {
  const { data, isLoading, isError } = useAgents();
  const agents = data?.agents ?? [];
  const summary = isLoading
    ? "loading…"
    : `${agents.length} agent${agents.length === 1 ? "" : "s"}`;

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={AgentsIcon}>Agents</CardTitle>
        <CardAction>{summary}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="text-sm" style={{ color: "var(--russet)" }}>
          Failed to load agents.
        </div>
      ) : agents.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No agents registered.
        </div>
      ) : (
        <RowList>
          {agents.map((agent) => (
            <AgentRowItem key={agent.id} agent={agent} />
          ))}
        </RowList>
      )}
    </Card>
  );
}
