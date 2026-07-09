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

  /**
   * List a PR's changed-file paths (GOL-158). Paginated at 100/page, capped at
   * MAX_FILE_PAGES to bound cost; the `truncated` flag says whether the cap was
   * hit so the caller can log it (frontendPaths matching stays correct — a match
   * in the first pages is enough; a giant PR that only touches frontend beyond
   * page N is the rare miss we accept for a bounded request budget).
   */
  async listPullFiles(
    repo: string,
    num: number,
  ): Promise<Result<{ files: string[]; truncated: boolean }>> {
    const MAX_FILE_PAGES = 10; // 10 * 100 = up to 1000 files
    const PER_PAGE = 100;
    const files: string[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const res = await this.request<Array<Record<string, any>>>(
        "GET",
        repo,
        `/repos/${this.org}/${repo}/pulls/${num}/files?per_page=${PER_PAGE}&page=${page}`,
      );
      if (!res.ok) return res;
      const batch = Array.isArray(res.data) ? res.data : [];
      for (const f of batch) {
        if (f && typeof f.filename === "string") files.push(f.filename);
      }
      if (batch.length < PER_PAGE) return { ok: true, data: { files, truncated: false } };
    }
    return { ok: true, data: { files, truncated: true } };
  }

  /**
   * Create a check-run on `headSha` (GOL-158 sign-off mechanism). Pass no
   * `conclusion` to seed/reset a pending run (`status: "in_progress"`); pass a
   * conclusion to complete it. Requires the App's `checks:write` permission.
   */
  async createCheckRun(
    repo: string,
    input: {
      name: string;
      headSha: string;
      conclusion?: "success" | "failure" | "neutral";
      title: string;
      summary: string;
      detailsUrl?: string;
    },
  ): Promise<Result<{ id: number }>> {
    const body: Record<string, unknown> = {
      name: input.name,
      head_sha: input.headSha,
      output: { title: input.title, summary: input.summary },
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    };
    if (input.conclusion) {
      body.status = "completed";
      body.conclusion = input.conclusion;
      body.completed_at = new Date().toISOString();
    } else {
      body.status = "in_progress";
    }
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/check-runs`,
      body,
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }

  /** Comment on an issue or PR (PRs share the issues comments endpoint). */
  async createIssueComment(repo: string, num: number, body: string): Promise<Result<{ id: number }>> {
    const res = await this.request<Record<string, any>>(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}/comments`,
      { body },
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }
}
