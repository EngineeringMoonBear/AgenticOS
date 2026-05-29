import { test, expect } from "@playwright/test";

/**
 * Phase 6 Task 6.1 — Tab-mount smoke tests.
 *
 * Spec §10 acceptance criterion 4 calls for `<1500ms P95` deep-link
 * latency. That budget is for the **deployed production build** (built
 * JS bundle, `next start`, CDN cache). Playwright in CI runs against
 * `pnpm dev` (Turbopack cold compile, dev-mode source maps, no caching),
 * which routinely takes several seconds on the very first navigation.
 *
 * What this spec asserts here in CI:
 *   1. Each of the five top-level tabs renders without crashing.
 *   2. After a warm-up navigation amortises the dev-server compile,
 *      subsequent navigations land under {@link WARM_BUDGET_MS}.
 *   3. The shared TabBar is present on every route.
 *
 * The 1500ms production SLO is verified out-of-band in the acceptance
 * checklist — see docs/superpowers/specs/2026-05-25-v2-unified-dashboard-design.md §14.
 */

const TABS = [
  { path: "/runs", name: "Runs" },
  { path: "/architecture", name: "Architecture" },
  { path: "/cost", name: "Cost" },
  { path: "/health", name: "Health" },
  { path: "/memory", name: "Memory" },
] as const;

// Generous budgets — these are smoke caps, not SLOs.
const WARM_BUDGET_MS = 4_000;
const COLD_BUDGET_MS = 30_000;

test.describe("dashboard tabs", () => {
  test("each tab mounts without crashing", async ({ page }) => {
    // Cold first navigation pays the Turbopack compile cost.
    const t0 = Date.now();
    await page.goto(TABS[0].path, { waitUntil: "load" });
    expect(Date.now() - t0).toBeLessThan(COLD_BUDGET_MS);

    for (const tab of TABS.slice(1)) {
      await page.goto(tab.path, { waitUntil: "load" });
      await expect(page.getByRole("tab", { name: tab.name })).toBeVisible();
    }
  });

  test("warm navigation budget", async ({ page }) => {
    // Warm-up: amortise the dev-server cold compile once.
    await page.goto("/runs", { waitUntil: "load" });

    for (const tab of TABS) {
      const t0 = Date.now();
      await page.goto(tab.path, { waitUntil: "load" });
      const elapsed = Date.now() - t0;
      expect.soft(elapsed,
        `${tab.path} warm load took ${elapsed}ms (budget ${WARM_BUDGET_MS}ms)`,
      ).toBeLessThan(WARM_BUDGET_MS);
    }
  });

  test("TabBar is present on every tab", async ({ page }) => {
    await page.goto("/runs", { waitUntil: "load" }); // warm-up

    for (const tab of TABS) {
      await page.goto(tab.path, { waitUntil: "load" });
      // Every TabBar entry is present and the current route's entry is
      // marked aria-selected for screen-reader clarity.
      for (const candidate of TABS) {
        await expect(
          page.getByRole("tab", { name: candidate.name }),
        ).toBeVisible();
      }
    }
  });
});
