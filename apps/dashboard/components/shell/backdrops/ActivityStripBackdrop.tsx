"use client";
import { useId, useMemo } from "react";

/**
 * Horizontal swimlane backdrop for the Runs vista. Renders the last
 * 60 minutes of run activity as a CRT scan strip — leftmost edge is
 * 60 min ago, rightmost edge is "now". Hand-rolled SVG, no chart deps.
 *
 *  - `done`    → small pine tick
 *  - `failed`  → russet tick with a downward stem ("fell off")
 *  - `running` → gold tick with a soft pulsing glow (pure CSS, scoped
 *                via `.activity-strip .tick-running`)
 *
 * Faint 10-minute markers run across the lane and the "now" edge has a
 * brighter vertical line + gold dot at baseline to suggest the scan
 * position. Decorative only — no pointer events.
 */
export interface ActivityStripEvent {
  /** ISO timestamp for the event. */
  at: string;
  status: "running" | "done" | "failed";
}

export interface ActivityStripBackdropProps {
  events: ActivityStripEvent[];
  /**
   * Reference timestamp used as the rightmost "now" edge of the strip.
   * Required so the render stays pure — callers should pin this to a
   * mount-time value (see `RunsVista`) rather than re-reading the clock
   * during render.
   */
  now: string;
}

const VB_WIDTH = 1600;
const VB_HEIGHT = 200;
const LEFT_INSET = 110; // mirror EKG baseline insets
const RIGHT_INSET = 110;
const BASELINE_Y = 110;
const WINDOW_MS = 60 * 60 * 1000;

function xForTime(eventMs: number, nowMs: number): number {
  const ageMs = nowMs - eventMs;
  const t = Math.max(0, Math.min(1, 1 - ageMs / WINDOW_MS));
  return LEFT_INSET + t * (VB_WIDTH - LEFT_INSET - RIGHT_INSET);
}

export function ActivityStripBackdrop({
  events,
  now,
}: ActivityStripBackdropProps) {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const runningGlowId = `actRunGlow-${safe}`;
  const nowGlowId = `actNowGlow-${safe}`;

  const nowMs = useMemo(() => new Date(now).getTime(), [now]);

  const ticks = useMemo(() => {
    return events
      .map((e, i) => {
        const ms = new Date(e.at).getTime();
        if (Number.isNaN(ms)) return null;
        const x = xForTime(ms, nowMs);
        return { x, status: e.status, key: `${i}-${e.at}` };
      })
      .filter((v): v is { x: number; status: ActivityStripEvent["status"]; key: string } => v !== null);
  }, [events, nowMs]);

  // Minute markers every 10 minutes (0, 10, 20, ... 60 min ago).
  const minuteMarkers = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m <= 60; m += 10) {
      const t = 1 - m / 60;
      out.push(LEFT_INSET + t * (VB_WIDTH - LEFT_INSET - RIGHT_INSET));
    }
    return out;
  }, []);

  const nowX = VB_WIDTH - RIGHT_INSET;

  return (
    <div className="activity-strip" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter
            id={runningGlowId}
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="2.6" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id={nowGlowId}
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="1.8" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Baseline rule. */}
        <line
          className="activity-baseline"
          x1={LEFT_INSET}
          y1={BASELINE_Y}
          x2={VB_WIDTH - RIGHT_INSET}
          y2={BASELINE_Y}
        />

        {/* Minute markers (10-min spacing). */}
        {minuteMarkers.map((x, i) => (
          <line
            key={`mm-${i}`}
            className="activity-minute"
            x1={x}
            y1={BASELINE_Y - 8}
            x2={x}
            y2={BASELINE_Y + 8}
          />
        ))}

        {/* Event ticks. */}
        {ticks.map((t) => {
          if (t.status === "done") {
            return (
              <line
                key={t.key}
                className="tick-done"
                x1={t.x}
                y1={BASELINE_Y - 6}
                x2={t.x}
                y2={BASELINE_Y - 1}
              />
            );
          }
          if (t.status === "failed") {
            return (
              <g key={t.key} className="tick-failed-group">
                <line
                  className="tick-failed"
                  x1={t.x}
                  y1={BASELINE_Y - 6}
                  x2={t.x}
                  y2={BASELINE_Y - 1}
                />
                <line
                  className="tick-failed-stem"
                  x1={t.x}
                  y1={BASELINE_Y + 1}
                  x2={t.x}
                  y2={BASELINE_Y + 14}
                />
              </g>
            );
          }
          // running
          return (
            <line
              key={t.key}
              className="tick-running"
              x1={t.x}
              y1={BASELINE_Y - 10}
              x2={t.x}
              y2={BASELINE_Y - 1}
              filter={`url(#${runningGlowId})`}
            />
          );
        })}

        {/* "Now" scan edge. */}
        <g filter={`url(#${nowGlowId})`}>
          <line
            className="activity-now-edge"
            x1={nowX}
            y1={BASELINE_Y - 28}
            x2={nowX}
            y2={BASELINE_Y + 28}
          />
          <circle
            className="activity-now-dot"
            cx={nowX}
            cy={BASELINE_Y}
            r="3.2"
          />
        </g>
      </svg>
    </div>
  );
}

export default ActivityStripBackdrop;
