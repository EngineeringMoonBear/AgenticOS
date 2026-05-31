import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  path?: string;
}

export function registerBacklinksRoute(
  app: FastifyInstance,
  config: Config,
): void {
  app.get(
    "/backlinks",
    async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
      const pagePath = req.query.path;
      if (!pagePath) {
        reply.code(400);
        return { error: "Missing 'path' query parameter" };
      }
      // The store maintains a backlink index; getBacklinks() is O(1) lookup.
      const backlinks = await getStore(config).getBacklinks(pagePath);
      return { backlinks };
    },
  );
}
