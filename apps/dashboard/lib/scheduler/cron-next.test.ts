import { describe, expect, it } from "vitest";
import { nextFire, parseCron } from "./cron-next";

const UTC = (
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
): Date => new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

describe("parseCron", () => {
  it("accepts every Hermes-registered schedule we ship", () => {
    expect(() => parseCron("0 7 * * *")).not.toThrow();
    expect(() => parseCron("0 23 * * *")).not.toThrow();
    expect(() => parseCron("0 * * * *")).not.toThrow();
  });

  it("rejects expressions that aren't 5 fields", () => {
    expect(() => parseCron("0 * * *")).toThrow(/expected 5 cron fields/);
    expect(() => parseCron("0 0 * * * *")).toThrow(/expected 5 cron fields/);
  });

  it("rejects out-of-range numeric values per field", () => {
    expect(() => parseCron("60 * * * *")).toThrow(/minute/);
    expect(() => parseCron("0 24 * * *")).toThrow(/hour/);
    expect(() => parseCron("0 0 32 * *")).toThrow(/day-of-month/);
    expect(() => parseCron("0 0 1 13 *")).toThrow(/month/);
    expect(() => parseCron("0 0 1 1 7")).toThrow(/day-of-week/);
  });

  it("rejects negative or non-integer steps", () => {
    expect(() => parseCron("*/0 * * * *")).toThrow(/bad step/);
    expect(() => parseCron("*/-1 * * * *")).toThrow(/bad step/);
  });
});

describe("nextFire", () => {
  it("returns the next top-of-hour for '0 * * * *'", () => {
    // 2026-05-29 12:17 UTC -> next 13:00 UTC.
    const got = nextFire("0 * * * *", UTC(2026, 5, 29, 12, 17));
    expect(got?.toISOString()).toBe("2026-05-29T13:00:00.000Z");
  });

  it("rolls into tomorrow when today's daily slot is past", () => {
    // 2026-05-29 09:00 UTC, schedule fires at 07:00 daily -> next 2026-05-30 07:00.
    const got = nextFire("0 7 * * *", UTC(2026, 5, 29, 9, 0));
    expect(got?.toISOString()).toBe("2026-05-30T07:00:00.000Z");
  });

  it("returns today's slot when before today's fire time", () => {
    // 2026-05-29 06:30 UTC, daily 07:00 -> same day.
    const got = nextFire("0 7 * * *", UTC(2026, 5, 29, 6, 30));
    expect(got?.toISOString()).toBe("2026-05-29T07:00:00.000Z");
  });

  it("supports step + comma in the minute field", () => {
    // Every 15m at top, quarter, half, three-quarter past.
    const got = nextFire("*/15 * * * *", UTC(2026, 5, 29, 12, 7));
    expect(got?.toISOString()).toBe("2026-05-29T12:15:00.000Z");
  });

  it("applies OR semantics when both dom and dow are restricted", () => {
    // 1st of the month OR Mondays. Starting Wed 2026-05-29 12:00.
    // Next match should be Mon 2026-06-01 (which is also the 1st).
    const got = nextFire("0 0 1 * 1", UTC(2026, 5, 29, 12, 0));
    expect(got?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("respects dow=Friday only when dom is wildcard", () => {
    // 2026-05-29 12:00 UTC is itself a Friday — today's 00:00 slot has
    // passed, so the next "every Friday at midnight" fire is the next
    // Friday: 2026-06-05.
    const got = nextFire("0 0 * * 5", UTC(2026, 5, 29, 12, 0));
    expect(got?.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("rounds up to the next full minute when called mid-minute", () => {
    // Caller's `from` has 30s past the minute. The :17 minute is in the
    // past relative to that moment, so next is :18.
    const from = new Date(Date.UTC(2026, 4, 29, 12, 17, 30));
    const got = nextFire("* * * * *", from);
    expect(got?.toISOString()).toBe("2026-05-29T12:18:00.000Z");
  });

  it("returns null for an unsatisfiable expression (Feb 30th)", () => {
    expect(nextFire("0 0 30 2 *", UTC(2026, 1, 1, 0, 0))).toBeNull();
  });
});
