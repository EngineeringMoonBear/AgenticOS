import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mock `server-only` so Vitest doesn't throw in a Node environment.
      // In production, Next.js replaces this with a runtime error for client bundles.
      "server-only": path.resolve(__dirname, "test/__mocks__/server-only.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
