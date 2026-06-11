import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubClient, rollupChecks, deriveReviewState } from "../src/github-client.js";

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
      total_count: 1,
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("paginates when total_count exceeds one page", async () => {
    const makeItem = (n: number) => ({
      number: n,
      title: `PR ${n}`,
      user: { login: "user" },
      draft: false,
      updated_at: "2026-06-01T00:00:00Z",
      html_url: `https://github.com/o/r/pull/${n}`,
      repository_url: "https://api.github.com/repos/o/r",
    });
    const page1Items = Array.from({ length: 100 }, (_, i) => makeItem(i + 1));
    const page2Items = Array.from({ length: 50 }, (_, i) => makeItem(i + 101));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 150, items: page1Items }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 150, items: page2Items }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(150);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error Result on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad creds" }, false, 401));
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();
    expect(result.ok).toBe(false);
  });
});

describe("rollupChecks", () => {
  it("classifies", () => {
    expect(rollupChecks([])).toBe("none");
    expect(rollupChecks([{ status: "completed", conclusion: "success" }])).toBe("success");
    expect(
      rollupChecks([
        { status: "completed", conclusion: "success" },
        { status: "in_progress", conclusion: null },
      ]),
    ).toBe("pending");
    expect(
      rollupChecks([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ]),
    ).toBe("failure");
  });
});

describe("deriveReviewState", () => {
  it("uses latest decisive review per author", () => {
    expect(deriveReviewState([])).toBe("none");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "APPROVED", submitted_at: "2026-06-01T00:00:00Z" },
      ]),
    ).toBe("approved");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "APPROVED", submitted_at: "2026-06-01T00:00:00Z" },
        { user: { login: "a" }, state: "CHANGES_REQUESTED", submitted_at: "2026-06-02T00:00:00Z" },
      ]),
    ).toBe("changes_requested");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "COMMENTED", submitted_at: "2026-06-01T00:00:00Z" },
      ]),
    ).toBe("none");
  });
});
