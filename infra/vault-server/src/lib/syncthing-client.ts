/**
 * Thin client over Syncthing's REST `/rest/events` endpoint. Topology-agnostic:
 * it just needs a base URL + API key. On the Droplet this points at the host
 * Syncthing (which receives vault changes from the Mac), so the events stream
 * surfaces real file activity as the paired vault syncs down.
 *
 * Always fails soft — any network/HTTP error yields { available: false },
 * never throws — so a missing or down Syncthing degrades the dashboard's
 * "recent changes" panel to an unavailable state rather than a 500.
 */
export interface SyncthingEvent {
  id: number;
  type: string;
  time: string;
  data: Record<string, unknown>;
}

export interface SyncthingResponse {
  available: boolean;
  events: SyncthingEvent[];
}

export interface SyncthingConfig {
  baseUrl: string;
  apiKey: string;
}

export class SyncthingClient {
  constructor(private readonly config: SyncthingConfig) {}

  async getEvents(opts: { since?: number } = {}): Promise<SyncthingResponse> {
    const qs = opts.since !== undefined ? `?since=${opts.since}` : "";
    try {
      const res = await fetch(`${this.config.baseUrl}/rest/events${qs}`, {
        headers: { "X-API-Key": this.config.apiKey },
      });
      if (!res.ok) {
        return { available: false, events: [] };
      }
      const events = (await res.json()) as SyncthingEvent[];
      return { available: true, events };
    } catch {
      return { available: false, events: [] };
    }
  }
}
