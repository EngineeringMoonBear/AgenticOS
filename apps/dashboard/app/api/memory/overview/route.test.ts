import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/viking", () => ({
  vikingOverview: vi.fn(),
}));

import { vikingOverview } from "@/lib/api/viking";
import { GET } from "./route";

const mock = vi.mocked(vikingOverview);

beforeEach(() => mock.mockReset());

describe("/api/memory/overview", () => {
  it("400 when uri missing", async () => {
    const res = await GET(new Request("http://localhost/api/memory/overview"));
    expect(res.status).toBe(400);
  });

  it("proxies viking overview result", async () => {
    mock.mockResolvedValue({ uri: "viking://x", overview: "summary" });
    const res = await GET(new Request("http://localhost/api/memory/overview?uri=viking://x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overview).toBe("summary");
    expect(mock).toHaveBeenCalledWith("viking://x");
  });

  it("502 on viking failure", async () => {
    mock.mockImplementation(async (u: string) => {
      if (u) throw new Error("nope");
      return { uri: u };
    });
    const res = await GET(new Request("http://localhost/api/memory/overview?uri=viking://x"));
    expect(res.status).toBe(502);
  });
});
