import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerInboxReadRoute(app: FastifyInstance, config: Config): void {
  app.get<{ Params: { "*": string } }>("/inbox/*", async (req, reply) => {
    const inboxPath = req.params["*"];
    try {
      const note = await getStore(config).readInbox(inboxPath);
      if (!note) return reply.code(404).send({ error: "inbox note not found" });
      return note;
    } catch (err) {
      const name = (err as Error).name;
      const msg = (err as Error).message ?? "";
      if (
        name === "VaultPathError" ||
        msg.includes("traversal") ||
        msg.includes("escapes base") ||
        msg.includes("Absolute path") ||
        msg.includes("null byte")
      ) {
        return reply.code(400).send({ error: msg });
      }
      throw err;
    }
  });
}
