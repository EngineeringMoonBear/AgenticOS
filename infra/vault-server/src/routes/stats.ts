import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerStatsRoute(app: FastifyInstance, config: Config): void {
  app.get("/stats", async () => {
    const store = getStore(config);
    // stats() reads the in-memory index directly; it reports pageCount 0 until
    // the index has been built at least once. Trigger a build (cheap +
    // TTL-cached) so the endpoint always returns real counts.
    await store.list();
    return await store.stats();
  });
}
