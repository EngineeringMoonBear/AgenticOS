type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface GitHubClientConfig {
  token: string;
  org: string;
  timeoutMs: number;
  baseUrl?: string;
}

export interface OpenPr {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  htmlUrl: string;
}

const API_BASE = "https://api.github.com";

export class GitHubClient {
  private readonly token: string;
  private readonly org: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig) {
    this.token = config.token;
    this.org = config.org;
    this.timeoutMs = config.timeoutMs;
    this.baseUrl = (config.baseUrl ?? API_BASE).replace(/\/$/, "");
  }

  private async get<T>(pathAndQuery: string): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
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

  /** All open (non-archived) PRs across the org via the Search API. */
  async searchOpenPrs(): Promise<Result<OpenPr[]>> {
    const q = encodeURIComponent(
      `org:${this.org} is:pr is:open archived:false`,
    );
    const res = await this.get<{ items?: unknown[] }>(
      `/search/issues?q=${q}&per_page=100`,
    );
    if (!res.ok) return res;
    const items = (res.data.items ?? []) as Array<Record<string, any>>;
    const prs: OpenPr[] = items.map((it) => {
      const repoUrl = String(it.repository_url ?? "");
      return {
        repoFullName: repoUrl.split("/repos/")[1] ?? "",
        number: Number(it.number),
        title: String(it.title ?? ""),
        author: String(it.user?.login ?? ""),
        draft: Boolean(it.draft),
        updatedAt: String(it.updated_at ?? ""),
        htmlUrl: String(it.html_url ?? ""),
      };
    });
    return { ok: true, data: prs };
  }

  async prDetail(
    repoFullName: string,
    num: number,
  ): Promise<Result<{ mergeableState: string; headSha: string }>> {
    const res = await this.get<Record<string, any>>(
      `/repos/${repoFullName}/pulls/${num}`,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        mergeableState: String(res.data.mergeable_state ?? "unknown"),
        headSha: String(res.data.head?.sha ?? ""),
      },
    };
  }

  async prChecksState(
    repoFullName: string,
    headSha: string,
  ): Promise<Result<"success" | "failure" | "pending" | "none">> {
    if (!headSha) return { ok: true, data: "none" };
    const res = await this.get<{ check_runs?: unknown[] }>(
      `/repos/${repoFullName}/commits/${headSha}/check-runs`,
    );
    if (!res.ok) return res;
    return { ok: true, data: rollupChecks((res.data.check_runs ?? []) as any) };
  }

  async prReviewState(
    repoFullName: string,
    num: number,
  ): Promise<Result<"approved" | "changes_requested" | "none">> {
    const res = await this.get<unknown[]>(
      `/repos/${repoFullName}/pulls/${num}/reviews`,
    );
    if (!res.ok) return res;
    return { ok: true, data: deriveReviewState((res.data ?? []) as any) };
  }
}

const BAD_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

export function rollupChecks(
  runs: Array<{ status?: string; conclusion?: string | null }>,
): "success" | "failure" | "pending" | "none" {
  if (runs.length === 0) return "none";
  const completed = runs.filter((r) => r.status === "completed");
  if (completed.length < runs.length) return "pending";
  if (completed.some((r) => r.conclusion && BAD_CONCLUSIONS.has(r.conclusion))) {
    return "failure";
  }
  return "success";
}

export function deriveReviewState(
  reviews: Array<{ user?: { login?: string }; state?: string; submitted_at?: string }>,
): "approved" | "changes_requested" | "none" {
  const latest = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) =>
    (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""),
  );
  for (const r of sorted) {
    if (r.state && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) {
      latest.set(r.user?.login ?? "?", r.state);
    }
  }
  const states = new Set(latest.values());
  if (states.has("CHANGES_REQUESTED")) return "changes_requested";
  if (states.has("APPROVED")) return "approved";
  return "none";
}
