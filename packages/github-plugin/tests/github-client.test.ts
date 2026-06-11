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

describe("GitHubClient.searchOpenPrs", () => {
  it("queries the Search API and parses items", async () => {
    const fetchMock = mockFetch({
      items: [
        {
          number: 7,
          title: "Fix thing",
          user: { login: "josh" },
          draft: false,
          updated_at: "2026-06-01T00:00:00Z",
          html_url: "https://github.com/o/r/pull/7",
          repository_url: "https://api.github.com/repos/o/r",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        repoFullName: "o/r",
        number: 7,
        author: "josh",
        draft: false,
      });
    }
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/search/issues");
    expect(String(url)).toContain("org%3Ao");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("returns an error Result on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad creds" }, false, 401));
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();
    expect(result.ok).toBe(false);
  });
});
