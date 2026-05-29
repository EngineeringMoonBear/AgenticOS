import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/viking", () => ({
  vikingDetail: vi.fn(),
}));

import { vikingDetail } from "@/lib/api/viking";
import { GET } from "./route";

const mock = vi.mocked(vikingDetail);

beforeEach(() => mock.mockReset());

describe("/api/memory/detail", () => {
  it("400 when uri missing", async () => {
    const res = await GET(new Request("http://localhost/api/memory/detail"));
    expect(res.status).toBe(400);
  });

  it("uses default offset=0, limit=8192", async () => {
    mock.mockResolvedValue({ uri: "viking://x", content: "..." });
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x"));
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledWith("viking://x", 0, 8192);
  });

  it("parses offset and limit", async () => {
    mock.mockResolvedValue({ uri: "viking://x", content: "..." });
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x&offset=10&limit=256"));
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledWith("viking://x", 10, 256);
  });

  it("400 on negative offset", async () => {
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x&offset=-1"));
    expect(res.status).toBe(400);
  });

  it("400 on non-integer offset", async () => {
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x&offset=abc"));
    expect(res.status).toBe(400);
  });

  it("400 on zero limit", async () => {
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x&limit=0"));
    expect(res.status).toBe(400);
  });

  it("400 on limit > 65536", async () => {
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x&limit=65537"));
    expect(res.status).toBe(400);
  });

  it("502 on viking failure", async () => {
    mock.mockImplementation(async (u: string) => {
      if (u) throw new Error("nope");
      return { uri: u };
    });
    const res = await GET(new Request("http://localhost/api/memory/detail?uri=viking://x"));
    expect(res.status).toBe(502);
  });
});
