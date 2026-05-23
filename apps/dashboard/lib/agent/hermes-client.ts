import "server-only";
import type { Task, CreateTaskInput } from "./types";

export class HermesClient {
  constructor(private baseUrl: string) {}

  async listTasks(opts?: { since?: Date; limit?: number }): Promise<Task[]> {
    const u = new URL("/api/tasks", this.baseUrl);
    if (opts?.since) u.searchParams.set("since", opts.since.toISOString());
    if (opts?.limit) u.searchParams.set("limit", String(opts.limit));
    return this.json<Task[]>("GET", u.toString());
  }

  async getTask(id: string): Promise<Task> {
    return this.json<Task>(
      "GET",
      `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`,
    );
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.json<Task>("POST", `${this.baseUrl}/api/tasks`, input);
  }

  private async json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // Server-side fetches; no caching of mutable Hermes state
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Hermes ${method} ${url} → ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return res.json();
  }
}

export function getHermesClient(): HermesClient {
  const base = process.env.HERMES_URL;
  if (!base) throw new Error("HERMES_URL not set");
  return new HermesClient(base);
}
