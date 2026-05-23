import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"]
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
