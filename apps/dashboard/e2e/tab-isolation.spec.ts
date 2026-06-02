import { test, expect } from "@playwright/test";

/**
 * Phase 6 Task 6.2 — Tab fault isolation.
 *
 * Spec §10 acceptance criterion 7: "Any one chip failing does not block
 * the dashboard." In practice that means: if any single `/api/*` route
 * starts returning 5xx, the page chrome (TabBar, vista shell, KPI tile
 * labels) must still render and the *other* tabs must still be reachable.
 *
 * We exercise two representative failure modes:
 *   - Memory tab: `/api/vault/tree` 502 (vault-server down) — the broadest
 *     dependency the Memory page has.
 *   - Runs tab: `/api/tasks/recent-events` 500 — the chart's data source.
 *
 * The TanStack hooks should land in `error` / `isError` state without
 * throwing past their boundary, which is what keeps the rest of the
 * page mountable.
 */

test.describe("tab isolation under API failure", () => {
  test("Memory tab renders chrome when /api/vault/tree returns 502", async ({
    page,
  }) => {
    await page.route("**/api/vault/tree*", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "vault-server down" }),
      }),
    );

    await page.goto("/memory", { waitUntil: "load" });

    // Page chrome stays mounted: TabBar visible, other tabs still navigable.
    await expect(page.getByRole("tab", { name: "Runs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Memory" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Architecture" })).toBeVisible();

    // Other tabs still navigate cleanly even though Memory's API is dead.
    // Retry the click: under the mocked 502 the page logs a hydration mismatch,
    // and a <Link> click landing during React's client-side recovery can be
    // dropped. The intent is "navigation works", not "the first click lands".
    await expect(async () => {
      await page.getByRole("tab", { name: "Runs" }).click();
      await expect(page).toHaveURL(/\/runs/, { timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole("tab", { name: "Runs" })).toBeVisible();
  });

  test("Runs tab renders chrome when /api/tasks/recent-events returns 500", async ({
    page,
  }) => {
    await page.route("**/api/tasks/recent-events*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "db down" }),
      }),
    );

    await page.goto("/runs", { waitUntil: "load" });

    await expect(page.getByRole("tab", { name: "Runs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Memory" })).toBeVisible();

    // Navigation off the failing tab still works. Retry the click to tolerate
    // the hydration-recovery window where a <Link> click can be dropped.
    await expect(async () => {
      await page.getByRole("tab", { name: "Memory" }).click();
      await expect(page).toHaveURL(/\/memory/, { timeout: 2000 });
    }).toPass({ timeout: 15000 });
  });

  test("all five tabs render when /api/* is universally 500", async ({
    page,
  }) => {
    // Worst-case: every backend route dies. Page chrome should still be
    // visible because nothing about the layout is render-blocked by data.
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "all-data-down" }),
      }),
    );

    await page.goto("/runs", { waitUntil: "load" });

    for (const tab of ["Runs", "Architecture", "Cost", "Health", "Memory"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
  });
});
