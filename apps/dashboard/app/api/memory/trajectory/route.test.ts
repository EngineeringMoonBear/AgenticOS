import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/viking", () => ({
  vikingRetrieval: vi.fn(),
}));

import { vikingRetrieval } from "@/lib/api/viking";
import { GET } from "./route";

const mock = vi.mocked(vikingRetrieval);

beforeEach(() => mock.mockReset());

describe("/api/memory/trajectory", () => {
  it("400 when uri missing", async () => {
    const res = await GET(new Request("http://localhost/api/memory/trajectory"));
    expect(res.status).toBe(400);
  });

  it("aggregates events into nodes and links", async () => {
    mock.mockResolvedValue({
      events: [
        { uri: "viking://x/a.md", session_id: "s1abc123", at: "2026-05-20T00:00:00Z", relevant: [1, 2] },
        { uri: "viking://x/a.md", session_id: "s1abc123", at: "2026-05-21T00:00:00Z", relevant: [1] },
        { uri: "viking://x/a.md", session_id: "s2def456", at: "2026-05-22T00:00:00Z", relevant: [] },
        { uri: "viking://other.md", session_id: "s3", at: "2026-05-22T00:00:00Z" },
      ],
    });
    const res = await GET(
      new Request(
        "http://localhost/api/memory/trajectory?uri=viking://x/a.md&since=2026-05-01T00:00:00Z",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const uriNode = body.nodes.find((n: { kind: string }) => n.kind === "uri");
    expect(uriNode).toBeDefined();
    expect(uriNode.label).toBe("a.md");
    expect(uriNode.size).toBe(3); // sum of relevant lengths 2+1+0

    const sessionNodes = body.nodes.filter((n: { kind: string }) => n.kind === "session");
    expect(sessionNodes).toHaveLength(2);
    const s1 = sessionNodes.find((n: { label: string }) => n.label === "s1abc123".slice(0, 8));
    expect(s1.size).toBe(2);

    expect(body.links).toHaveLength(3);
    expect(body.links[0]).toMatchObject({ source: "s1abc123", target: "viking://x/a.md", weight: 1 });
  });

  it("filters events older than `since`", async () => {
    mock.mockResolvedValue({
      events: [
        { uri: "viking://x", session_id: "old", at: "2026-01-01T00:00:00Z" },
        { uri: "viking://x", session_id: "new", at: "2026-05-25T00:00:00Z" },
      ],
    });
    const res = await GET(
      new Request("http://localhost/api/memory/trajectory?uri=viking://x&since=2026-05-01T00:00:00Z"),
    );
    const body = await res.json();
    expect(body.links).toHaveLength(1);
    expect(body.links[0].source).toBe("new");
  });

  it("503 when viking unreachable", async () => {
    // Resolve to a value that the route handler treats as a failure
    // shape: missing events array still walks, but we test the catch
    // path by returning a non-object that triggers a TypeError when
    // the route reads `.events`.
    mock.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof vikingRetrieval>>);
    const res = await GET(new Request("http://localhost/api/memory/trajectory?uri=viking://x"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.available).toBe(false);
  });
});
