import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/viking", () => ({
  vikingFsLs: vi.fn(),
  vikingAbstract: vi.fn(),
}));

import { vikingFsLs, vikingAbstract } from "@/lib/api/viking";
import { GET } from "./route";

const lsMock = vi.mocked(vikingFsLs);
const absMock = vi.mocked(vikingAbstract);

beforeEach(() => {
  lsMock.mockReset();
  absMock.mockReset();
});

describe("/api/memory/abstracts", () => {
  it("returns 400 when uri is missing", async () => {
    const res = await GET(new Request("http://localhost/api/memory/abstracts"));
    expect(res.status).toBe(400);
  });

  it("returns abstracts for non-dir entries with parallelism", async () => {
    lsMock.mockResolvedValue({
      entries: [
        { name: "a.md", uri: "viking://x/a.md", is_dir: false },
        { name: "sub", uri: "viking://x/sub", is_dir: true },
        { name: "b.md", uri: "viking://x/b.md", is_dir: false },
      ],
    });
    absMock.mockImplementation(async (u: string) => ({ uri: u, abstract: `abs:${u}` }));

    const res = await GET(new Request("http://localhost/api/memory/abstracts?uri=viking://x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({ uri: "viking://x/a.md", name: "a.md", abstract: "abs:viking://x/a.md" });
    expect(body.items[1].uri).toBe("viking://x/b.md");
  });

  it("isolates per-file failure (abstract empty, batch ok)", async () => {
    lsMock.mockResolvedValue({
      entries: [
        { name: "a.md", uri: "viking://x/a.md", is_dir: false },
        { name: "b.md", uri: "viking://x/b.md", is_dir: false },
      ],
    });
    absMock.mockImplementation(async (u: string) => {
      if (u.endsWith("a.md")) throw new Error("fail");
      return { uri: u, abstract: "ok" };
    });

    const res = await GET(new Request("http://localhost/api/memory/abstracts?uri=viking://x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    const a = body.items.find((i: { uri: string }) => i.uri.endsWith("a.md"));
    const b = body.items.find((i: { uri: string }) => i.uri.endsWith("b.md"));
    expect(a.abstract).toBe("");
    expect(b.abstract).toBe("ok");
  });

  it("returns 502 on outer ls failure", async () => {
    lsMock.mockImplementation(async () => {
      throw new Error("ls down");
    });
    const res = await GET(new Request("http://localhost/api/memory/abstracts?uri=viking://x"));
    expect(res.status).toBe(502);
  });
});
