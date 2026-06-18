import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory (vi.hoisted so factory is available at
// vi.mock() call time).
// ---------------------------------------------------------------------------

const { mockIssues, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockIssues = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    issues: mockIssues,
  }));
  return { mockIssues, mockCreatePaperclipClient };
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
import type { IssueRow } from "./route";

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    companyId: "11111111-1111-1111-1111-111111111111",
    title: "Implement user authentication",
    status: "in_progress",
    priority: "high",
    assigneeAgentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    assigneeUserId: null,
    identifier: "DEMO-1",
    issueNumber: 1,
    workMode: "normal",
    successfulRunHandoff: null,
    activeRecoveryAction: null,
    createdAt: "2025-06-16T10:00:00.000Z",
    updatedAt: "2025-06-17T08:12:34.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — non-paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/issues — non-paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns an empty issues list without calling Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issues: IssueRow[] };
    expect(body.issues).toEqual([]);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/issues — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("paperclip");
    mockCreatePaperclipClient.mockReturnValue({ issues: mockIssues });
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps Issue[] to IssueRow[] with correct field mapping", async () => {
    mockIssues.mockResolvedValue({
      ok: true,
      data: [
        makeIssue({
          id: "issue-1",
          title: "Fix auth bug",
          status: "in_progress",
          priority: "high",
          assigneeAgentId: "agent-123",
          assigneeUserId: null,
        }),
        makeIssue({
          id: "issue-2",
          title: "Update docs",
          status: "todo",
          priority: "low",
          assigneeAgentId: null,
          assigneeUserId: "user-456",
        }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { issues: IssueRow[] };
    expect(body.issues).toHaveLength(2);

    expect(body.issues[0]).toMatchObject({
      id: "issue-1",
      title: "Fix auth bug",
      status: "in_progress",
      priority: "high",
      assignee: "agent-123",
    });

    expect(body.issues[1]).toMatchObject({
      id: "issue-2",
      title: "Update docs",
      status: "todo",
      priority: "low",
      assignee: "user-456",
    });
  });

  it("derives assignee as assigneeAgentId when both are present", async () => {
    mockIssues.mockResolvedValue({
      ok: true,
      data: [
        makeIssue({
          assigneeAgentId: "agent-wins",
          assigneeUserId: "user-loses",
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { issues: IssueRow[] };
    expect(body.issues[0].assignee).toBe("agent-wins");
  });

  it("sets assignee to null when both assigneeAgentId and assigneeUserId are null", async () => {
    mockIssues.mockResolvedValue({
      ok: true,
      data: [
        makeIssue({
          assigneeAgentId: null,
          assigneeUserId: null,
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { issues: IssueRow[] };
    expect(body.issues[0].assignee).toBeNull();
  });

  it("sets priority to null when priority field is null", async () => {
    mockIssues.mockResolvedValue({
      ok: true,
      data: [makeIssue({ priority: null })],
    });

    const res = await GET();
    const body = (await res.json()) as { issues: IssueRow[] };
    expect(body.issues[0].priority).toBeNull();
  });

  it("returns 503 with {error} when issues() fails", async () => {
    mockIssues.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });

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
});
