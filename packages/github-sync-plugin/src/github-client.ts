import type { TokenProvider } from "./broker.js";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface GitHubClientConfig {
  org: string;
  /** Static bearer token. Provide this OR `getToken`. */
  token?: string;
  /** Per-repo token provider (e.g. the gh-token-broker). Takes precedence over `token`. */
  getToken?: TokenProvider;
  timeoutMs?: number;
  baseUrl?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  htmlUrl: string;
  labels: string[];
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
}

const API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Small write-capable GitHub REST client. Mirrors github-plugin's
 * `Result<T>` discriminated-union contract and 8s request timeout.
 */
export class GitHubClient {
  private readonly getToken: TokenProvider;
  private readonly org: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig) {
    if (config.getToken) {
      this.getToken = config.getToken;
    } else if (config.token != null) {
      const t = config.token;
      this.getToken = async () => t;
    } else {
      throw new Error("GitHubClient requires either `token` or `getToken`");
    }
    this.org = config.org;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = (config.baseUrl ?? API_BASE).replace(/\/$/, "");
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    repo: string,
    pathAndQuery: string,
    body?: unknown,
  ): Promise<Result<T>> {
    let token: string;
    try {
      token = await this.getToken(repo);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "token unavailable",
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const json = (await res.json()) as T & { message?: string };
      if (!res.ok) {
        return { ok: false, error: json.message ?? `HTTP ${res.status}` };
      }
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "github unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseIssue(raw: Record<string, any>): GitHubIssue {
    return {
      number: Number(raw.number),
      title: String(raw.title ?? ""),
      body: typeof raw.body === "string" ? raw.body : "",
      state: raw.state === "closed" ? "closed" : "open",
      htmlUrl: String(raw.html_url ?? ""),
      labels: Array.isArray(raw.labels)
        ? raw.labels.map((l: any) => (typeof l === "string" ? l : String(l?.name ?? ""))).filter(Boolean)
        : [],
    };
  }

  /** Create a new issue in `<org>/<repo>`. */
  async createIssue(repo: string, input: CreateIssueInput): Promise<Result<GitHubIssue>> {
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues`,
      {
        title: input.title,
        body: input.body,
        ...(input.labels ? { labels: input.labels } : {}),
      },
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }

  /** Update an existing issue (title/body/state/labels) by number. */
  async updateIssue(
    repo: string,
    num: number,
    input: UpdateIssueInput,
  ): Promise<Result<GitHubIssue>> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.body !== undefined) patch.body = input.body;
    if (input.state !== undefined) patch.state = input.state;
    if (input.labels !== undefined) patch.labels = input.labels;

    const res = await this.request<Record<string, any>>(
      "PATCH",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`,
      patch,
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }

  /** Fetch a single issue by number. */
  async getIssue(repo: string, num: number): Promise<Result<GitHubIssue>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`,
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }
}
