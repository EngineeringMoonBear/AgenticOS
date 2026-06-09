type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface VikingClientConfig {
  baseUrl: string;
  apiKey: string;
  account: string;
  user: string;
  readTimeoutMs: number;
  writeTimeoutMs: number;
}

export interface MemoryEntry {
  id: string;
  text: string;
  score?: number;
  path?: string;
  category?: string;
  created?: string;
}

export class VikingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly account: string;
  private readonly user: string;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(config: VikingClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.account = config.account;
    this.user = config.user;
    this.readTimeoutMs = config.readTimeoutMs;
    this.writeTimeoutMs = config.writeTimeoutMs;
  }

  async remember(
    text: string,
    metadata: Record<string, unknown>,
  ): Promise<Result<{ id: string; path: string; created: string }>> {
    return this.post(
      "/api/v1/memories",
      { text, account: this.account, user: this.user, ...metadata },
      this.writeTimeoutMs,
    );
  }

  async recall(
    query: string,
    opts?: { limit?: number; category?: string },
  ): Promise<Result<{ memories: MemoryEntry[] }>> {
    return this.post(
      "/api/v1/memories/search",
      {
        query,
        account: this.account,
        user: this.user,
        limit: opts?.limit,
        category: opts?.category,
      },
      this.readTimeoutMs,
    );
  }

  async find(path: string): Promise<Result<{ memories: MemoryEntry[] }>> {
    const params = new URLSearchParams({ path });
    return this.get(`/api/v1/memories?${params}`, this.readTimeoutMs);
  }

  async abstract(
    memoryIds: string[],
  ): Promise<Result<{ abstractId: string; summary: string; sourceCount: number }>> {
    return this.post(
      "/api/v1/memories/abstract",
      { memoryIds, account: this.account, user: this.user },
      this.writeTimeoutMs,
    );
  }

  async stats(): Promise<
    Result<{ total: number; byCategory: Record<string, number> }>
  > {
    return this.get("/api/v1/stats/memories", this.readTimeoutMs);
  }

  private async get<T>(path: string, timeoutMs: number): Promise<Result<T>> {
    return this.request<T>(path, { method: "GET" }, timeoutMs);
  }

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Result<T>> {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) {
        return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "OpenViking unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
