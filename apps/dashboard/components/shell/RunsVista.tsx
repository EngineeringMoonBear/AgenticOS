"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import {
  ActivityStripBackdrop,
  type ActivityStripEvent,
} from "./backdrops/ActivityStripBackdrop";

/**
 * Runs tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link ActivityStripBackdrop} swimlane and the four Runs-specific KPI
 * tiles. Stub data lives here until Dispatch 2 wires it to the live
 * runs query.
 */

function buildStubEvents(nowMs: number): ActivityStripEvent[] {
  const events: ActivityStripEvent[] = [];

  // ~3 running in the last 5 min.
  for (let i = 0; i < 3; i++) {
    const ageMin = 0.5 + i * 1.4; // 0.5, 1.9, 3.3 min ago
    events.push({
      at: new Date(nowMs - ageMin * 60_000).toISOString(),
      status: "running",
    });
  }

  // ~2 failed scattered through the hour.
  for (const ageMin of [14, 41]) {
    events.push({
      at: new Date(nowMs - ageMin * 60_000).toISOString(),
      status: "failed",
    });
  }

  // ~25 done, evenly distributed but jittered.
  for (let i = 0; i < 25; i++) {
    const base = (i + 0.5) * (60 / 25); // ~2.4 min apart
    // Deterministic jitter — pseudo-random but stable across renders.
    const jitter = ((i * 31) % 17) / 17 - 0.5;
    const ageMin = Math.max(0.2, Math.min(59.8, base + jitter));
    events.push({
      at: new Date(nowMs - ageMin * 60_000).toISOString(),
      status: "done",
    });
  }

  return events;
}

export function RunsVista() {
  // Pin `now` to mount time so the strip is stable for the lifetime of
  // the page render (avoids new positions on every re-render).
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const nowMs = useMemo(() => new Date(nowIso).getTime(), [nowIso]);
  const events = useMemo(() => buildStubEvents(nowMs), [nowMs]);

  return (
    <VistaShell
      accent="gold"
      asOf={nowIso}
      backdrop={<ActivityStripBackdrop events={events} now={nowIso} />}
    >
      <KpiTile
        value={
          <>
            3<span className="delta up">+1</span>
          </>
        }
        label="active runs"
        sublabel="curator · daily-brief · vault-ingest"
      />
      <KpiTile
        value="2"
        label="failed today"
        sublabel="codex-rate-limit · vault-sync"
      />
      <KpiTile
        value={
          <>
            1m 47s
          </>
        }
        label="avg duration"
        sublabel="p50 · last 24h"
      />
      <KpiTile
        value={
          <>
            vault-ingest<span className="unit"> in 4m</span>
          </>
        }
        label="next scheduled"
        sublabel="cron · 0,15,30,45 * * * *"
      />
    </VistaShell>
  );
}

export default RunsVista;
