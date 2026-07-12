import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubClient } from "../src/github-client.js";

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("GitHubClient.createIssue", () => {
  it("POSTs to the repo issues endpoint with auth + body and parses the result", async () => {
    const fetchMock = mockFetch({
      number: 42,
      title: "Hello",
      body: "World",
      state: "open",
      html_url: "https://github.com/o/r/issues/42",
      labels: [{ name: "synced-from-paperclip" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.createIssue("r", {
      title: "Hello",
      body: "World",
      labels: ["synced-from-paperclip"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ number: 42, state: "open", labels: ["synced-from-paperclip"] });
    }

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Hello",
      body: "World",
      labels: ["synced-from-paperclip"],
    });
  });

  it("returns an error Result on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad creds" }, false, 401));
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.createIssue("r", { title: "x", body: "y" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Bad creds");
  });
});

describe("GitHubClient.updateIssue", () => {
  it("PATCHes only the provided fields", async () => {
    const fetchMock = mockFetch({
      number: 7,
      title: "T",
      body: "B",
      state: "closed",
      html_url: "https://github.com/o/r/issues/7",
      labels: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.updateIssue("r", 7, { state: "closed", title: "T" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.state).toBe("closed");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ state: "closed", title: "T" });
  });
});

describe("GitHubClient with a getToken provider (broker mode)", () => {
  it("resolves a per-repo token and sends it as the bearer", async () => {
    const fetchMock = mockFetch({
      number: 1,
      title: "T",
      body: "B",
      state: "open",
      html_url: "https://github.com/o/r/issues/1",
      labels: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const getToken = vi.fn(async (repo: string) => `tok-for-${repo}`);
    const client = new GitHubClient({ org: "o", getToken });
    await client.createIssue("r", { title: "T", body: "B" });

    expect(getToken).toHaveBeenCalledWith("r");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-for-r");
  });

  it("returns an error Result if the token provider throws", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = new GitHubClient({
      org: "o",
      getToken: async () => {
        throw new Error("token broker -> 404");
      },
    });
    const result = await client.getIssue("r", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token broker -> 404");
  });
});

describe("GitHubClient.listPullFiles", () => {
  it("returns filenames from a single page (not truncated)", async () => {
    const fetchMock = mockFetch([{ filename: "a.ts" }, { filename: "apps/dashboard/x.tsx" }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.listPullFiles("r", 12);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.files).toEqual(["a.ts", "apps/dashboard/x.tsx"]);
      expect(res.data.truncated).toBe(false);
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/pulls/12/files?per_page=100&page=1");
    // A short page stops pagination — exactly one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates an API error Result", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Not Found" }, false, 404));
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.listPullFiles("r", 12);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Not Found");
  });
});

describe("GitHubClient.createCheckRun", () => {
  it("POSTs a pending (in_progress) run when no conclusion is given", async () => {
    const fetchMock = mockFetch({ id: 999 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.createCheckRun("r", {
      name: "agent-review/alice",
      headSha: "sha1",
      title: "pending",
      summary: "waiting",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(999);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/check-runs");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ name: "agent-review/alice", head_sha: "sha1", status: "in_progress" });
    expect(body.conclusion).toBeUndefined();
  });

  it("POSTs a completed run with the conclusion when given", async () => {
    const fetchMock = mockFetch({ id: 1 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    await client.createCheckRun("r", { name: "agent-review/iris", headSha: "s", conclusion: "failure", title: "x", summary: "y" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.status).toBe("completed");
    expect(body.conclusion).toBe("failure");
    expect(typeof body.completed_at).toBe("string");
  });
});

describe("GitHubClient.createIssueComment", () => {
  it("POSTs the comment body to the issues comments endpoint", async () => {
    const fetchMock = mockFetch({ id: 5 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubClient({ token: "t", org: "o" });
    const res = await client.createIssueComment("r", 260, "changes requested: ...");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/260/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "changes requested: ..." });
  });
});

describe("GitHubClient.getIssue", () => {
  it("GETs the issue by number", async () => {
    const fetchMock = mockFetch({
      number: 5,
      title: "G",
      body: "",
      state: "open",
      html_url: "https://github.com/o/r/issues/5",
      labels: ["a", { name: "b" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.getIssue("r", 5);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.labels).toEqual(["a", "b"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/5");
    expect(init.method).toBe("GET");
  });
});

describe("GitHubClient.getPull (GOL-305)", () => {
  it("parses author login, head SHA, state and merged flag", async () => {
    const fetchMock = mockFetch({
      number: 42,
      title: "Fix worker",
      user: { login: "agenticos-developer[bot]" },
      head: { sha: "abc1234" },
      html_url: "https://github.com/o/r/pull/42",
      state: "open",
      draft: false,
      merged: false,
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.getPull("r", 42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        number: 42,
        title: "Fix worker",
        authorLogin: "agenticos-developer[bot]",
        headSha: "abc1234",
        htmlUrl: "https://github.com/o/r/pull/42",
        state: "open",
        draft: false,
        merged: false,
      });
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/pulls/42");
  });
});

describe("GitHubClient.listCommitCheckRuns (GOL-305)", () => {
  it("maps check_runs to name/status/conclusion + an output excerpt + details_url", async () => {
    const fetchMock = mockFetch({
      total_count: 2,
      check_runs: [
        { name: "build", status: "completed", conclusion: "failure", details_url: "https://x/logs", output: { summary: "boom" } },
        { name: "lint", status: "completed", conclusion: "success", output: { title: "ok" } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.listCommitCheckRuns("r", "deadbeef");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { name: "build", status: "completed", conclusion: "failure", detailsUrl: "https://x/logs", summary: "boom" },
        { name: "lint", status: "completed", conclusion: "success", summary: "ok" },
      ]);
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/commits/deadbeef/check-runs?per_page=100");
  });

  it("tolerates a missing check_runs array", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const client = new GitHubClient({ token: "t", org: "o" });
    const result = await client.listCommitCheckRuns("r", "sha");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});
