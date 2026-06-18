import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
// ---------------------------------------------------------------------------

const { mockApprovals, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockApprovals = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    approvals: mockApprovals,
  }));
  return { mockApprovals, mockCreatePaperclipClient };
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
import type { ApprovalRow } from "./route";
import type { Approval } from "@/lib/paperclip/client";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "appr-0001-0000-0000-000000000000",
    companyId: "11111111-1111-1111-1111-111111111111",
    type: "budget_override_required",
    requestedByAgentId: "agent-abc",
    requestedByUserId: null,
    status: "pending",
    payload: "[redacted]",
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: "2025-06-17T06:00:00.000Z",
    updatedAt: "2025-06-17T06:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — non-paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/approvals — non-paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns empty approvals list without calling Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals).toEqual([]);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/approvals — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("paperclip");
    mockCreatePaperclipClient.mockReturnValue({ approvals: mockApprovals });
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps pending approvals to ApprovalRow[] with correct field mapping", async () => {
    mockApprovals.mockResolvedValue({
      ok: true,
      data: [
        makeApproval({
          id: "appr-1",
          type: "budget_override_required",
          requestedByAgentId: "agent-abc",
          requestedByUserId: null,
          status: "pending",
        }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]).toMatchObject({
      id: "appr-1",
      type: "budget_override_required",
      requestedBy: "agent-abc",
      status: "pending",
    });
  });

  it("filters out non-pending approvals", async () => {
    mockApprovals.mockResolvedValue({
      ok: true,
      data: [
        makeApproval({ id: "appr-pending", status: "pending" }),
        makeApproval({ id: "appr-approved", status: "approved" }),
        makeApproval({ id: "appr-rejected", status: "rejected" }),
        makeApproval({ id: "appr-cancelled", status: "cancelled" }),
        makeApproval({ id: "appr-revision", status: "revision_requested" }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0].id).toBe("appr-pending");
  });

  it("uses requestedByUserId when requestedByAgentId is null", async () => {
    mockApprovals.mockResolvedValue({
      ok: true,
      data: [
        makeApproval({
          id: "appr-user",
          requestedByAgentId: null,
          requestedByUserId: "user-123",
          status: "pending",
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals[0].requestedBy).toBe("user-123");
  });

  it("sets requestedBy to null when both requester fields are null", async () => {
    mockApprovals.mockResolvedValue({
      ok: true,
      data: [
        makeApproval({
          id: "appr-no-requester",
          requestedByAgentId: null,
          requestedByUserId: null,
          status: "pending",
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals[0].requestedBy).toBeNull();
  });

  it("returns empty list when all approvals are non-pending", async () => {
    mockApprovals.mockResolvedValue({
      ok: true,
      data: [
        makeApproval({ id: "appr-1", status: "approved" }),
        makeApproval({ id: "appr-2", status: "rejected" }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: ApprovalRow[] };
    expect(body.approvals).toEqual([]);
  });

  it("returns 503 with {error} when approvals() fails", async () => {
    mockApprovals.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });

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

  it("calls approvals() with status=pending param", async () => {
    mockApprovals.mockResolvedValue({ ok: true, data: [] });

    await GET();

    expect(mockApprovals).toHaveBeenCalledWith({ status: "pending" });
  });
});
