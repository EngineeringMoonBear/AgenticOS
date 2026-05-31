import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerTreeRoute(app: FastifyInstance, config: Config): void {
  app.get("/tree", async () => {
    const store = getStore(config);
    const { tree, flat } = await store.list();
    return { tree, flatPaths: flat };
  });
}
