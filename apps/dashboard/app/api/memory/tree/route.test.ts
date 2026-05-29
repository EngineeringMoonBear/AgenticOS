import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/viking", () => ({
  vikingFsTree: vi.fn(),
}));

import { vikingFsTree } from "@/lib/api/viking";
import { GET } from "./route";

const vikingFsTreeMock = vi.mocked(vikingFsTree);

beforeEach(() => {
  vikingFsTreeMock.mockReset();
});

describe("/api/memory/tree", () => {
  it("normalizes plain scope to viking:// URI and returns tree", async () => {
    vikingFsTreeMock.mockResolvedValue({ name: "root" });
    const res = await GET(new Request("http://localhost/api/memory/tree?scope=resources"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: "root" });
    expect(vikingFsTreeMock).toHaveBeenCalledWith("viking://resources");
  });

  it("defaults scope to resources when missing", async () => {
    vikingFsTreeMock.mockResolvedValue({ name: "root" });
    const res = await GET(new Request("http://localhost/api/memory/tree"));
    expect(res.status).toBe(200);
    expect(vikingFsTreeMock).toHaveBeenCalledWith("viking://resources");
  });

  it("preserves scope already prefixed with viking://", async () => {
    vikingFsTreeMock.mockResolvedValue({ name: "x" });
    const res = await GET(new Request("http://localhost/api/memory/tree?scope=viking://skills"));
    expect(res.status).toBe(200);
    expect(vikingFsTreeMock).toHaveBeenCalledWith("viking://skills");
  });

  it("returns 502 on Viking failure", async () => {
    vikingFsTreeMock.mockImplementation(async (u: string) => {
      if (u) throw new Error("boom");
      return {};
    });
    const res = await GET(new Request("http://localhost/api/memory/tree?scope=resources"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("boom");
  });
});
