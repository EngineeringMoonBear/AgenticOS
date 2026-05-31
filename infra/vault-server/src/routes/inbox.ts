import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerInboxRoute(app: FastifyInstance, config: Config): void {
  app.get("/inbox", async () => {
    // listInbox() reads vaultRoot/inbox/; returns [] when the dir is absent.
    const notes = await getStore(config).listInbox();
    const items = notes.map((n) => ({
      path: n.path,
      title: n.title,
      capturedAt: n.capturedAt,
    }));
    return { items };
  });
}
