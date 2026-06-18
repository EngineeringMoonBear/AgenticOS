import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
// ---------------------------------------------------------------------------

const { mockOrg, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockOrg = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    org: mockOrg,
  }));
  return { mockOrg, mockCreatePaperclipClient };
});

vi.mock("@/lib/paperclip/client", () => ({
  createPaperclipClient: mockCreatePaperclipClient,
}));

// Mock the data-source flag.
const { mockDataSource } = vi.hoisted(() => {
  const mockDataSource = vi.fn(() => "hermes" as "hermes" | "paperclip");
  return { mockDataSource };
});

vi.mock("@/lib/config/data-source", () => ({
  dataSource: mockDataSource,
}));

// Import after mocks are registered.
import { GET } from "./route";
import type { OrgNode } from "./route";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeOrgNode(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    name: "Bob",
    role: "ceo",
    status: "active",
    reports: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — non-paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/org — non-paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns empty org without calling Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org: null };
    expect(body.org).toBeNull();
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/org — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("paperclip");
    mockCreatePaperclipClient.mockReturnValue({ org: mockOrg });
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("returns the recursive org tree preserving reports[] nesting", async () => {
    const tree: OrgNode[] = [
      makeOrgNode({
        id: "bob",
        name: "Bob",
        role: "ceo",
        status: "active",
        reports: [
          makeOrgNode({
            id: "alice",
            name: "Alice",
            role: "ic",
            status: "active",
            reports: [],
          }),
        ],
      }),
    ];
    mockOrg.mockResolvedValue({ ok: true, data: tree });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { org: OrgNode[] };
    expect(body.org).toHaveLength(1);
    expect(body.org[0].name).toBe("Bob");
    expect(body.org[0].role).toBe("ceo");
    expect(body.org[0].reports).toHaveLength(1);
    expect(body.org[0].reports[0].name).toBe("Alice");
    expect(body.org[0].reports[0].role).toBe("ic");
    expect(body.org[0].reports[0].reports).toEqual([]);
  });

  it("returns 503 with {error} when org() fails", async () => {
    mockOrg.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("passes the tree through as-is (no mutation of node fields)", async () => {
    const tree: OrgNode[] = [
      makeOrgNode({ id: "x1", name: "CEO", role: "ceo", status: "active", reports: [] }),
    ];
    mockOrg.mockResolvedValue({ ok: true, data: tree });

    const res = await GET();
    const body = (await res.json()) as { org: OrgNode[] };
    expect(body.org[0]).toMatchObject({
      id: "x1",
      name: "CEO",
      role: "ceo",
      status: "active",
      reports: [],
    });
  });
});
