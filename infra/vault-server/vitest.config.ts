import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // @agenticos/vault-core's InMemoryVaultStore carries `import "server-only"`,
      // whose default export is a bare throw outside a react-server context.
      // Vitest runs in plain Node, so alias it to the same no-op shim the esbuild
      // bundle uses (see package.json `build` script + shims/server-only.js).
      "server-only": path.resolve(__dirname, "shims/server-only.js"),
    },
  },
  test: {
    globals: false,
    environment: "node",
  },
});
