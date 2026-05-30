import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Playwright specs live under e2e/ and use @playwright/test, which
    // calls test.describe() in a way Vitest's runner rejects. Keep them
    // out of the unit run — the E2E workflow picks them up via the
    // dedicated `playwright test` invocation instead.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws when imported outside Next.js's react-server
      // export condition (which vitest doesn't honor). Alias to an empty
      // module so server-side libs (lib/agent/*, lib/cost/db) load in tests.
      // See test-helpers/server-only-shim.ts for the full explanation.
      "server-only": path.resolve(__dirname, "./test-helpers/server-only-shim.ts")
    }
  }
});
