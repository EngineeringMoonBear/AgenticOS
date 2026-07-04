import type { Result } from "./types.js";

const API_BASE = "https://discord.com/api/v10";

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: { id: string; username: string; bot?: boolean };
  content: string;
  timestamp: string;
  attachments: DiscordAttachment[];
}

export class DiscordClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: { token: string; timeoutMs?: number; baseUrl?: string }) {
    this.token = cfg.token;
    this.baseUrl = (cfg.baseUrl ?? API_BASE).replace(/\/$/, "");
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bot ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && !retried) {
        const payload = (await res.json()) as { retry_after?: number };
        const waitMs = Math.ceil((payload.retry_after ?? 1) * 1000);
        await new Promise((r) => setTimeout(r, waitMs));
        return this.request<T>(method, path, body, true);
      }
      if (res.status === 204) return { ok: true, data: undefined as T };
      const json = (await res.json()) as T & { message?: string };
      if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` };
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "discord unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Messages strictly after `afterId` (null = latest page), returned oldest-first. */
  async fetchMessagesAfter(
    channelId: string,
    afterId: string | null,
    limit = 50,
  ): Promise<Result<DiscordMessage[]>> {
    const after = afterId ? `&after=${afterId}` : "";
    const res = await this.request<DiscordMessage[]>(
      "GET",
      `/channels/${channelId}/messages?limit=${limit}${after}`,
    );
    if (!res.ok) return res;
    return { ok: true, data: [...res.data].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)) };
  }

  async replyToMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<Result<DiscordMessage>> {
    return this.request("POST", `/channels/${channelId}/messages`, {
      content,
      message_reference: { message_id: messageId },
    });
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<Result<void>> {
    return this.request(
      "PUT",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    );
  }

  async dmUser(userId: string, content: string): Promise<Result<DiscordMessage>> {
    const chan = await this.request<{ id: string }>("POST", "/users/@me/channels", {
      recipient_id: userId,
    });
    if (!chan.ok) return chan;
    return this.request("POST", `/channels/${chan.data.id}/messages`, { content });
  }

  /** Plain download — attachment URLs are pre-signed by Discord, no bot auth header. */
  async downloadAttachment(url: string): Promise<Result<Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, data: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "download failed" };
    } finally {
      clearTimeout(timer);
    }
  }
}
