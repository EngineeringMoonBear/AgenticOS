import { describe, it, expect, vi } from "vitest";

// pg's Pool tries to open a connection on import in some configurations;
// mock it so this surface-check test can run without a database.
vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({ query: vi.fn() })),
}));

// db.ts is integration-tested through the API route tests; here we just smoke
// that the module loads and exports the expected surface.
import * as db from "./db";

describe("cost/db exports", () => {
  it("exports the expected functions", () => {
    expect(typeof db.getPool).toBe("function");
    expect(typeof db.getCostSummary).toBe("function");
    expect(typeof db.getTodayTasks).toBe("function");
    expect(typeof db.getMonthByDay).toBe("function");
    expect(typeof db.getMonthByKind).toBe("function");
    expect(typeof db.getBudget).toBe("function");
    expect(typeof db.updateBudget).toBe("function");
  });
});
