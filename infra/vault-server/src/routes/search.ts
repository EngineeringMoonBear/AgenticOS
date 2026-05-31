import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  q?: string;
  tags?: string;
  limit?: string;
}

export function registerSearchRoute(app: FastifyInstance, config: Config): void {
  app.get(
    "/search",
    async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
      const q = req.query.q;
      if (q === undefined) {
        reply.code(400);
        return { error: "Missing 'q' query parameter" };
      }
      const tags = req.query.tags
        ? req.query.tags.split(",").filter(Boolean)
        : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      // store.search(query, { tags?, limit? }) — positional query string.
      const results = await getStore(config).search(q, { tags, limit });
      return { results, total: results.length };
    },
  );
}
