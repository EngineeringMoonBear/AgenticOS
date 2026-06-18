"use client";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { PillVariant } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";
import { useRoutines } from "@/lib/hooks/use-routines";
import type { RoutineRow } from "@/lib/hooks/use-routines";

// ── Icon ─────────────────────────────────────────────────────────────────────

const RoutinesIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a routine enabled flag to a Pill variant.
 */
function enabledToPillVariant(enabled: boolean): PillVariant {
  return enabled ? "ok" : "warn";
}

/**
 * Maps a lastResult string to a Pill variant.
 * Returns null when lastResult is null (no pill rendered).
 */
function lastResultToPillVariant(lastResult: string | null): PillVariant | null {
  if (lastResult === null) return null;
  switch (lastResult) {
    case "success":
      return "ok";
    case "error":
    case "failed":
      return "err";
    default:
      return "warn";
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RoutineRowItem({ routine }: { routine: RoutineRow }) {
  const enabledVariant = enabledToPillVariant(routine.enabled);
  const resultVariant = lastResultToPillVariant(routine.lastResult);

  return (
    <Row style={{ gridTemplateColumns: "auto 1fr auto", gap: 10 }}>
      <Pill variant={enabledVariant}>{routine.enabled ? "enabled" : "disabled"}</Pill>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span className="label-strong" style={{ fontSize: 12.5 }}>
            {routine.name}
          </span>
          {routine.managedByPlugin !== null && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                padding: "1px 5px",
                borderRadius: 3,
                background: "var(--pine-dim, rgba(0,80,60,0.15))",
                color: "var(--pine, #005c40)",
              }}
            >
              {routine.managedByPlugin}
            </span>
          )}
        </div>
        <div
          className="meta"
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--parchment-muted)" }}
        >
          {routine.cron ?? "—"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {resultVariant !== null ? (
          <Pill variant={resultVariant}>{routine.lastResult}</Pill>
        ) : (
          <span
            className="num"
            style={{ fontSize: 12, color: "var(--parchment-muted)" }}
          >
            —
          </span>
        )}
      </div>
    </Row>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoutinesPanel() {
  const { data, isLoading, isError } = useRoutines();
  const routines = data?.routines ?? [];
  const summary = isLoading
    ? "loading…"
    : `${routines.length} routine${routines.length === 1 ? "" : "s"}`;

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={RoutinesIcon}>Routines</CardTitle>
        <CardAction>{summary}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="text-sm" style={{ color: "var(--russet)" }}>
          Failed to load routines.
        </div>
      ) : routines.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No routines configured.
        </div>
      ) : (
        <RowList>
          {routines.map((routine) => (
            <RoutineRowItem key={routine.id} routine={routine} />
          ))}
        </RowList>
      )}
    </Card>
  );
}
