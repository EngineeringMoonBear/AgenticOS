/**
 * Thin client over Syncthing's REST `/rest/events` endpoint. Topology-agnostic:
 * it just needs a base URL + API key. On the Droplet this points at the host
 * Syncthing (which receives vault changes from the Mac), so the events stream
 * surfaces real file activity as the paired vault syncs down.
 *
 * Always fails soft — any network/HTTP error yields { available: false },
 * never throws — so a missing or down Syncthing degrades the dashboard's
 * "recent changes" panel to an unavailable state rather than a 500.
 *
 * Bounded by design (2026-07-08 incident): `/rest/events` is a LONG-POLLING
 * endpoint — called with no `since`/`timeout` it can block up to Syncthing's
 * default 60s, and a firewalled/blackholed host hangs a bare fetch forever.
 * Both hung the `/recent-changes` route (and the dashboard panel showed
 * "Syncthing offline" while sync itself worked). So every request now:
 *   - passes `since` (default 0 = return buffered events immediately),
 *     `timeout=1` (tell Syncthing not to long-poll), and `limit`;
 *   - carries an AbortSignal so a dropped SYN degrades in FETCH_TIMEOUT_MS,
 *     not never. A status probe must fail fast, not hang its caller.
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

/** Hard cap on the whole HTTP round-trip — keeps /recent-changes snappy. */
const FETCH_TIMEOUT_MS = 3000;

/** Max events per poll; plenty for a "recent changes" panel. */
const EVENT_LIMIT = 100;

export class SyncthingClient {
  constructor(private readonly config: SyncthingConfig) {}

  async getEvents(opts: { since?: number } = {}): Promise<SyncthingResponse> {
    const qs = new URLSearchParams({
      since: String(opts.since ?? 0),
      timeout: "1",
      limit: String(EVENT_LIMIT),
    });
    try {
      const res = await fetch(`${this.config.baseUrl}/rest/events?${qs}`, {
        headers: { "X-API-Key": this.config.apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
