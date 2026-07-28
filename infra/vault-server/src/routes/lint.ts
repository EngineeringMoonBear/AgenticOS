import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerLintRoute(app: FastifyInstance, config: Config): void {
  app.get("/lint", async () => {
    const store = getStore(config);
    // lint() calls ensureIndex() internally, so this both builds the index and
    // returns malformed-frontmatter issues recorded during that build.
    const issues = await store.lint();
    return { issues };
  });
}
