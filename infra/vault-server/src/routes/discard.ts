import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerDiscardRoute(app: FastifyInstance, config: Config): void {
  app.post("/discard", async (req, reply) => {
    const body = (req.body ?? {}) as { inboxPath?: unknown };
    if (typeof body.inboxPath !== "string" || body.inboxPath.length === 0) {
      return reply.code(400).send({ error: "inboxPath (string) is required" });
    }
    try {
      await getStore(config).discardInbox(body.inboxPath);
      return { archivedPath: `inbox/archived/${body.inboxPath}` };
    } catch (err) {
      // Path-traversal and ENOENT are client errors.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reply.code(404).send({ error: "inbox note not found" });
      // safeResolve throws a plain Error (or VaultPathError) on traversal attempts.
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
