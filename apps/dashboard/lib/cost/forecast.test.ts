import { describe, it, expect } from "vitest";
import { projectMonthEnd } from "./forecast";

describe("projectMonthEnd", () => {
  it("linearly extrapolates MTD to month-end", () => {
    // 10 days in, $5 spent → projected $15 for 30-day month
    const result = projectMonthEnd({
      mtd_cents: 500,
      days_elapsed: 10,
      days_in_month: 30,
    });
    expect(result).toBe(1500);
  });

  it("handles first-day-of-month edge case", () => {
    expect(
      projectMonthEnd({ mtd_cents: 0, days_elapsed: 0, days_in_month: 30 }),
    ).toBe(0);
  });

  it("returns MTD itself when days_elapsed === days_in_month", () => {
    expect(
      projectMonthEnd({ mtd_cents: 1234, days_elapsed: 30, days_in_month: 30 }),
    ).toBe(1234);
  });

  it("rounds to the nearest cent", () => {
    // 333 * (30 / 7) = 1427.142… → 1427
    expect(
      projectMonthEnd({ mtd_cents: 333, days_elapsed: 7, days_in_month: 30 }),
    ).toBe(1427);
  });
});
