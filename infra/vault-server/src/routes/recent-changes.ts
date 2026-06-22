import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { SyncthingClient, type SyncthingEvent } from "../lib/syncthing-client.js";

interface Change {
  path: string;
  kind: "created" | "updated" | "deleted";
  occurredAt: string;
}

/**
 * GET /recent-changes — surfaces recent vault file activity from Syncthing's
 * event stream. Returns { available: false } (not an error) when Syncthing
 * isn't configured or is unreachable, so the dashboard panel degrades cleanly.
 */
export function registerRecentChangesRoute(
  app: FastifyInstance,
  config: Config,
): void {
  app.get("/recent-changes", async () => {
    if (!config.syncthingUrl || !config.syncthingApiKey) {
      return { available: false, changes: [] };
    }

    const client = new SyncthingClient({
      baseUrl: config.syncthingUrl,
      apiKey: config.syncthingApiKey,
    });

    const { available, events } = await client.getEvents();
    if (!available) return { available: false, changes: [] };

    const changes: Change[] = events
      .filter((ev) => ev.type === "ItemFinished")
      .map((ev) => mapEvent(ev, config.syncthingFolderId))
      .filter((c): c is Change => c !== null);

    return { available: true, changes };
  });
}

function mapEvent(ev: SyncthingEvent, folderId: string): Change | null {
  const data = ev.data as { folder?: string; item?: string; action?: string };
  if (!data.folder || data.folder !== folderId) return null;
  if (!data.item) return null;
  let kind: Change["kind"] = "updated";
  if (data.action === "update") kind = "updated";
  else if (data.action === "delete") kind = "deleted";
  else if (data.action === "create") kind = "created";
  return { path: data.item, kind, occurredAt: ev.time };
}
