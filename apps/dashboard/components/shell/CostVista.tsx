"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { BurndownProjectionBackdrop } from "./backdrops/BurndownProjectionBackdrop";

/**
 * Cost tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link BurndownProjectionBackdrop} burndown chart and the four Cost-
 * specific KPI tiles. Stub data lives here until a later dispatch wires
 * it to the live cost query.
 */

function buildStubBurndown(): {
  actualByDay: number[];
  todayIndex: number;
} {
  // 31 days. "Today" is day 28 (0-indexed). Climb toward ~$46.18 today.
  // Small daily increments with occasional spikes feels like real burn.
  // Deterministic — no Math.random in render path so SSR/CSR match.
  const daily: number[] = [];
  // Pseudo-random but seeded by index for stability.
  const noise = (i: number) => ((i * 1103515245 + 12345) >>> 0) % 1000 / 1000;
  for (let d = 0; d < 31; d++) {
    const n = noise(d);
    // Most days: $0.50 – $2.00. Occasional spike: $3 – $5.5.
    let delta: number;
    if (n > 0.85) delta = 3 + n * 2.5;
    else if (n > 0.6) delta = 1.5 + n * 0.8;
    else delta = 0.4 + n * 1.4;
    // Slow start (first two days quiet).
    if (d < 2) delta *= 0.3;
    daily.push(delta);
  }
  // Build cumulative through day 28 (today). Day 29, 30 are unknown — but
  // backdrop only draws actual up to todayIndex, so cumulative beyond doesn't
  // matter. Fill them anyway so the array has length 31.
  const actualByDay: number[] = [];
  let acc = 0;
  for (let d = 0; d <= 28; d++) {
    acc += daily[d];
    actualByDay.push(acc);
  }
  // Scale so day-28 lands very close to $46.18.
  const target = 46.18;
  const scale = target / acc;
  for (let i = 0; i < actualByDay.length; i++) actualByDay[i] *= scale;
  // Pad future days (unused by backdrop but keeps length consistent).
  while (actualByDay.length < 31) {
    actualByDay.push(actualByDay[actualByDay.length - 1]);
  }
  return { actualByDay, todayIndex: 28 };
}

export function CostVista() {
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const { actualByDay, todayIndex } = useMemo(() => buildStubBurndown(), []);

  return (
    <VistaShell
      accent="amber"
      asOf={nowIso}
      backdrop={
        <BurndownProjectionBackdrop
          actualByDay={actualByDay}
          todayIndex={todayIndex}
          projectedEom={47.74}
          cap={200}
        />
      }
    >
      <KpiTile
        value={
          <>
            <span className="unit">$</span>2.41
            <span className="delta down">−18%</span>
          </>
        }
        label="today's spend"
        sublabel="vs yesterday"
      />
      <KpiTile
        value={
          <>
            <span className="unit">$</span>46.18
          </>
        }
        label="MTD spend"
        sublabel="of $200 cap"
      />
      <KpiTile
        value={
          <>
            <span className="unit">$</span>47.74
          </>
        }
        label="month-end projection"
        sublabel="at current burn rate"
      />
      <KpiTile
        value="24%"
        label="% of cap"
        sublabel="82% headroom"
      />
    </VistaShell>
  );
}

export default CostVista;
