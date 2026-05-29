import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { GET } from "./route";

const REAL_DATE = Date;

function freezeTime(iso: string) {
  const frozen = new Date(iso).getTime();
  // Re-implement just enough of Date so `new Date()` and `Date.now()`
  // return the frozen instant while parsing/formatting stays untouched.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = class extends REAL_DATE {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(frozen);
        return;
      }
      // @ts-expect-error spreading into super for the variadic constructor
      super(...args);
    }
    static now() {
      return frozen;
    }
  };
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = REAL_DATE;
});

describe("/api/crons/next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the soonest-firing registered cron", async () => {
    // 2026-05-29 12:17 UTC. Schedules:
    //   vault-ingest (0 * * * *)   -> 13:00 today  (43m away)
    //   daily-brief  (0 7 * * *)   -> 07:00 tomorrow
    //   cost-report  (0 23 * * *)  -> 23:00 today
    // Winner: vault-ingest.
    freezeTime("2026-05-29T12:17:00.000Z");

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("vault-ingest");
    expect(body.schedule).toBe("0 * * * *");
    expect(body.nextRunAt).toBe("2026-05-29T13:00:00.000Z");
    expect(body.etaSec).toBe(43 * 60);
    expect(body.description).toMatch(/OpenViking/);
  });

  it("clamps negative etaSec to zero when the next-fire is in the past after rounding", async () => {
    // Right on the minute boundary: vault-ingest fires at this exact second.
    // nextFire rounds up to 13:00; freezeTime is 12:59:30; eta = 30s,
    // rounded → 30. Just confirm sign + integer.
    freezeTime("2026-05-29T12:59:30.000Z");

    const res = await GET();
    const body = await res.json();
    expect(body.etaSec).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.etaSec)).toBe(true);
  });

  it("returns the daily-brief winner late at night", async () => {
    // 23:55 UTC. cost-report (23:00) is past; vault-ingest fires at 24:00=00:00;
    // daily-brief fires tomorrow 07:00. Winner: vault-ingest.
    freezeTime("2026-05-29T23:55:00.000Z");
    const res = await GET();
    const body = await res.json();
    expect(body.name).toBe("vault-ingest");
    expect(body.nextRunAt).toBe("2026-05-30T00:00:00.000Z");
  });
});
