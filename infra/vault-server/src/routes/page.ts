import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  path?: string;
}

export function registerPageRoute(app: FastifyInstance, config: Config): void {
  app.get("/page", async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
    const pagePath = req.query.path;
    if (!pagePath) {
      reply.code(400);
      return { error: "Missing 'path' query parameter" };
    }
    const page = await getStore(config).read(pagePath);
    if (!page) {
      reply.code(404);
      return { error: "Page not found" };
    }
    return page;
  });
}
