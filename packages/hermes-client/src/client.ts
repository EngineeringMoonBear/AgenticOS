import "server-only";
import type {
  HermesCron,
  HermesEvent,
  HermesHealth,
  HermesRun,
  HermesTool,
  RunId,
  RunStatus,
  SkillId,
  CronId,
} from "./types";
import { HermesOfflineError, HermesRunNotFoundError, HermesTimeoutError } from "./errors";
import { parseSseStream } from "./sse";

interface HermesClientOptions {
  baseUrl:     string;
  timeoutMs?:  number;
}

export class HermesClient {
  private readonly baseUrl:   string;
  private readonly timeoutMs: number;

  constructor(opts: HermesClientOptions) {
    this.baseUrl   = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * Returns parsed JSON of type T, or null on 404.
   * Throws HermesOfflineError on network failure, HermesTimeoutError on abort.
   */
  private async request<T>(
    path: string,
    init: RequestInit = {},
    parseJson = true,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new HermesTimeoutError(path, this.timeoutMs);
      }
      throw new HermesOfflineError(path);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Hermes ${path} returned ${res.status}`);
    if (!parseJson) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  async getHealth(): Promise<HermesHealth> {
    const h = await this.request<HermesHealth>("/health");
    if (!h) throw new HermesOfflineError("/health");
    return h;
  }

  async listTools(): Promise<HermesTool[]> {
    return (await this.request<HermesTool[]>("/tools")) ?? [];
  }

  async dispatchRun(params: {
    skillId:      SkillId;
    model?:       string;
    budget?:      number;
    toolNames?:   string[];
    systemPrompt: string;
    userPrompt:   string;
  }): Promise<HermesRun> {
    const run = await this.request<HermesRun>("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!run) throw new Error("Hermes /runs returned null");
    return run;
  }

  async listRuns(opts?: {
    limit?:   number;
    status?:  RunStatus | RunStatus[];
    skillId?: SkillId;
    since?:   string;
  }): Promise<HermesRun[]> {
    const params = new URLSearchParams();
    if (opts?.limit)   params.set("limit",   String(opts.limit));
    if (opts?.skillId) params.set("skillId", opts.skillId);
    if (opts?.since)   params.set("since",   opts.since);
    if (opts?.status) {
      const v = Array.isArray(opts.status) ? opts.status.join(",") : opts.status;
      params.set("status", v);
    }
    const qs = params.toString();
    return (await this.request<HermesRun[]>(`/runs${qs ? `?${qs}` : ""}`)) ?? [];
  }

  async getRun(id: RunId): Promise<HermesRun | null> {
    return await this.request<HermesRun>(`/runs/${encodeURIComponent(id)}`);
  }

  async cancelRun(id: RunId, reason?: string): Promise<void> {
    const path = `/runs/${encodeURIComponent(id)}/cancel`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new HermesTimeoutError(path, this.timeoutMs);
      }
      throw new HermesOfflineError(path);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) throw new HermesRunNotFoundError(id);
    if (!res.ok) throw new Error(`Hermes ${path} returned ${res.status}`);
  }

  async *streamRunEvents(id: RunId): AsyncIterable<HermesEvent> {
    const res = await fetch(`${this.baseUrl}/runs/${encodeURIComponent(id)}/events`, {
      headers: { accept: "text/event-stream" },
    });
    if (res.status === 404) throw new HermesRunNotFoundError(id);
    if (!res.ok || !res.body) throw new Error(`Hermes SSE returned ${res.status}`);
    yield* parseSseStream(res.body);
  }

  async listCron(): Promise<HermesCron[]> {
    return (await this.request<HermesCron[]>("/cron")) ?? [];
  }

  async createCron(record: Omit<HermesCron, "nextRunAt">): Promise<HermesCron> {
    const c = await this.request<HermesCron>("/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!c) throw new Error("Hermes /cron returned null");
    return c;
  }

  async updateCron(id: CronId, patch: Partial<HermesCron>): Promise<HermesCron> {
    const c = await this.request<HermesCron>(`/cron/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!c) throw new Error(`Hermes /cron/${id} returned null`);
    return c;
  }

  async deleteCron(id: CronId): Promise<void> {
    await this.request(`/cron/${encodeURIComponent(id)}`, { method: "DELETE" }, false);
  }

  async triggerCron(id: CronId): Promise<HermesRun> {
    const run = await this.request<HermesRun>(`/cron/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
    if (!run) throw new HermesRunNotFoundError(id);
    return run;
  }
}
