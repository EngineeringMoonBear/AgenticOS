type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface VaultClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface PageData {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface TreeData {
  tree: { name: string; children: unknown[] };
  flatPaths: string[];
}

export interface StatsData {
  pageCount: number;
  categories: string[];
}

export interface InboxItem {
  path: string;
  title: string;
  capturedAt: string;
}

export interface DiscardResult {
  archivedPath: string;
}

export class VaultClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: VaultClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs;
  }

  async search(
    query: string,
    opts?: { limit?: number; tags?: string[] },
  ): Promise<Result<{ results: SearchResult[]; total: number }>> {
    const params = new URLSearchParams({ q: query });
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.tags?.length) params.set("tags", opts.tags.join(","));
    return this.get(`/search?${params}`);
  }

  async getPage(path: string): Promise<Result<PageData>> {
    const params = new URLSearchParams({ path });
    return this.get(`/page?${params}`);
  }

  async listPages(): Promise<Result<TreeData>> {
    return this.get("/tree");
  }

  async getStats(): Promise<Result<StatsData>> {
    return this.get("/stats");
  }

  async getInbox(): Promise<Result<{ items: InboxItem[] }>> {
    return this.get("/inbox");
  }

  async discardInboxItem(inboxPath: string): Promise<Result<DiscardResult>> {
    if (inboxPath.includes("..") || inboxPath.startsWith("/")) {
      return { ok: false, error: "Path traversal not allowed" };
    }
    return this.post("/discard", { inboxPath });
  }

  private async get<T>(path: string): Promise<Result<T>> {
    return this.request<T>(path, { method: "GET" });
  }

  private async post<T>(path: string, body: unknown): Promise<Result<T>> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) {
        return {
          ok: false,
          error: json.error ?? `HTTP ${res.status}`,
        };
      }
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "vault-server unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
