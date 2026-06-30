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
