import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ActivityStripBackdrop,
  type ActivityStripEvent,
} from "./ActivityStripBackdrop";

const NOW_ISO = "2026-05-29T12:00:00.000Z";
const NOW_MS = new Date(NOW_ISO).getTime();

function isoMinutesAgo(min: number): string {
  return new Date(NOW_MS - min * 60_000).toISOString();
}

describe("ActivityStripBackdrop", () => {
  it("renders the chart chrome (y-axis title, x-axis labels, baseline)", () => {
    const { container } = render(
      <ActivityStripBackdrop events={[]} now={NOW_ISO} />,
    );

    // Y-axis title (rotated mono label)
    expect(container.querySelector(".activity-y-title")?.textContent).toMatch(
      /runs \/ 5m/i,
    );

    // X-axis labels: -60m at left, now at right, plus interior stops.
    const xLabels = Array.from(
      container.querySelectorAll(".activity-x-label"),
    ).map((n) => n.textContent);
    expect(xLabels).toEqual(["-60m", "-45m", "-30m", "-15m", "now"]);

    // Baseline rule + sweep line present (decorative chart vocabulary).
    expect(container.querySelector(".activity-baseline")).not.toBeNull();
    expect(container.querySelector(".activity-sweep")).not.toBeNull();
  });

  it("buckets events into stacked bars by status", () => {
    const events: ActivityStripEvent[] = [
      // Bucket 11 (rightmost, 0–5 min ago): 1 running
      { at: isoMinutesAgo(1), status: "running" },
      // Bucket 8 (15–20 min ago): 2 done, 1 failed
      { at: isoMinutesAgo(16), status: "done" },
      { at: isoMinutesAgo(17), status: "done" },
      { at: isoMinutesAgo(18), status: "failed" },
      // Bucket 0 (leftmost, 55–60 min ago): 1 done
      { at: isoMinutesAgo(59), status: "done" },
    ];

    const { container } = render(
      <ActivityStripBackdrop events={events} now={NOW_ISO} />,
    );

    // One rect per (bucket × status) — height encodes the count.
    // Done events live in 2 buckets (bucket 8 with 2; bucket 0 with 1) → 2 rects.
    expect(container.querySelectorAll(".activity-bar-done")).toHaveLength(2);
    // 1 failed rect in bucket 8.
    expect(container.querySelectorAll(".activity-bar-failed")).toHaveLength(1);
    // 1 running rect in bucket 11 (the latest).
    const runningRects = container.querySelectorAll(".activity-bar-running");
    expect(runningRects).toHaveLength(1);
    expect(
      runningRects[0].classList.contains("activity-bar-running--latest"),
    ).toBe(true);

    // Latest-dot only appears on the rightmost bucket when running > 0.
    expect(container.querySelectorAll(".activity-latest-dot")).toHaveLength(1);
  });

  it("ignores events outside the 60-minute window", () => {
    const events: ActivityStripEvent[] = [
      { at: isoMinutesAgo(75), status: "done" }, // too old
      { at: new Date(NOW_MS + 5_000).toISOString(), status: "running" }, // future
      { at: isoMinutesAgo(30), status: "done" }, // in window
    ];

    const { container } = render(
      <ActivityStripBackdrop events={events} now={NOW_ISO} />,
    );

    // Only the one in-window event contributes a bar.
    expect(container.querySelectorAll(".activity-bar-done")).toHaveLength(1);
    expect(container.querySelectorAll(".activity-bar-failed")).toHaveLength(0);
    expect(container.querySelectorAll(".activity-bar-running")).toHaveLength(0);
  });

  it("skips events with unparseable timestamps without throwing", () => {
    const events: ActivityStripEvent[] = [
      { at: "not-a-date", status: "done" },
      { at: isoMinutesAgo(10), status: "running" },
    ];

    const { container } = render(
      <ActivityStripBackdrop events={events} now={NOW_ISO} />,
    );

    expect(container.querySelectorAll(".activity-bar-done")).toHaveLength(0);
    expect(container.querySelectorAll(".activity-bar-running")).toHaveLength(1);
  });
});
