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

  /**
   * Upload file content as an OpenViking resource (two-step, ported from
   * HttpxVikingClient.add_resource in vault_ingest.py).
   *
   *   Step 1: POST /api/v1/resources/temp_upload  (multipart file=<content>)
   *           → {"result": {"temp_file_id": "..."}}  (envelope is unwrapped
   *             defensively; the OpenAPI schema omits the wrapper)
   *   Step 2: POST /api/v1/resources  (JSON {temp_file_id, to, create_parent})
   */
  async addResource(
    content: string,
    filename: string,
    vikingUri: string,
  ): Promise<Result<void>> {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/markdown" }), filename);

    const upload = await this.request<{
      result?: { temp_file_id?: string };
      temp_file_id?: string;
      id?: string;
    }>(
      "/api/v1/resources/temp_upload",
      { method: "POST", body: form },
      this.writeTimeoutMs,
    );
    if (!upload.ok) return upload;

    const tempFileId =
      upload.data.result?.temp_file_id ??
      upload.data.temp_file_id ??
      upload.data.id;
    if (!tempFileId) {
      return {
        ok: false,
        error: `temp_upload returned no temp_file_id: ${JSON.stringify(upload.data)}`,
      };
    }

    const create = await this.request<unknown>(
      "/api/v1/resources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          temp_file_id: tempFileId,
          to: vikingUri,
          create_parent: true,
        }),
      },
      this.writeTimeoutMs,
    );
    if (!create.ok) return create;
    return { ok: true, data: undefined };
  }

  /**
   * Remove a resource by viking:// URI (ported from HttpxVikingClient.rm).
   * DELETE /api/v1/fs?uri=<vikingUri>&recursive=true — recursive because
   * OpenViking stores each ingested file as a directory (file + .abstract.md /
   * .overview.md children), so a non-recursive delete fails with 412.
   * A 404 (already gone) is treated as success.
   */
  async rm(vikingUri: string): Promise<Result<void>> {
    const params = new URLSearchParams({ uri: vikingUri, recursive: "true" });
    const res = await this.request<unknown>(
      `/api/v1/fs?${params}`,
      { method: "DELETE" },
      this.writeTimeoutMs,
      { ok404: true },
    );
    if (!res.ok) return res;
    return { ok: true, data: undefined };
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
    opts?: { ok404?: boolean },
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${this.apiKey}`,
          // Resource/fs endpoints scope by account+user via headers (the
          // memory endpoints carry these in the JSON body instead).
          "X-OpenViking-Account": this.account,
          "X-OpenViking-User": this.user,
        },
        signal: controller.signal,
      });
      // A DELETE of an already-gone resource (404) is success for rm().
      if (opts?.ok404 && res.status === 404) {
        return { ok: true, data: undefined as T };
      }
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
