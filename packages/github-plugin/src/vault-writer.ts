import type { Result } from "./github-client.js";

export interface VaultWriterConfig {
  baseUrl: string;
  timeoutMs: number;
}

export class VaultWriter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: VaultWriterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs;
  }

  async writePage(path: string, content: string): Promise<Result<{ path: string }>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/page`, {
        method: "PUT",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const json = (await res.json()) as { path?: string; error?: string };
      if (!res.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      return { ok: true, data: { path: json.path ?? path } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "vault-server unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
