import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory.
// ---------------------------------------------------------------------------

const { mockRoutines, mockCreatePaperclipClient } = vi.hoisted(() => {
  const mockRoutines = vi.fn();
  const mockCreatePaperclipClient = vi.fn(() => ({
    routines: mockRoutines,
  }));
  return { mockRoutines, mockCreatePaperclipClient };
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

// Import after mocks.
import { GET } from "./route";
import type { ScheduledJob } from "./route";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    companyId: "co-1",
    title: "Daily standup report",
    status: "active",
    priority: "normal",
    assigneeAgentId: null,
    concurrencyPolicy: "skip",
    catchUpPolicy: "skip_missed",
    lastTriggeredAt: null,
    lastEnqueuedAt: null,
    managedByPlugin: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-17T09:00:00.000Z",
    triggers: [
      {
        id: "t1",
        kind: "cron",
        label: "Daily 9am",
        enabled: true,
        cronExpression: "0 9 * * *",
        timezone: "America/New_York",
        nextRunAt: "2025-06-18T13:00:00.000Z",
        lastFiredAt: "2025-06-17T13:00:00.000Z",
        lastResult: "success",
      },
    ],
    lastRun: null,
    activeIssue: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — Hermes path (existing behaviour — must not regress)
// ---------------------------------------------------------------------------

describe("GET /api/tasks/scheduled — Hermes path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns the static Hermes job list", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("jobs");
    expect(Array.isArray(body.jobs)).toBe(true);
    // Hermes path returns the hard-coded stub; Paperclip client must not be touched.
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/tasks/scheduled — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreatePaperclipClient.mockReturnValue({ routines: mockRoutines });
    mockDataSource.mockReturnValue("paperclip");
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps routines to ScheduledJob shape", async () => {
    mockRoutines.mockResolvedValueOnce({
      ok: true,
      data: [makeRoutine()],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.jobs)).toBe(true);

    const job = body.jobs.find((j: ScheduledJob) => j.name === "Daily standup report");
    expect(job).toBeDefined();
    expect(job.cron).toBe("0 9 * * *");
    // next_in must be a string (relative)
    expect(typeof job.next_in).toBe("string");
  });

  it("includes static plugin-job crons (vault-ingest + pr-triage)", async () => {
    mockRoutines.mockResolvedValueOnce({
      ok: true,
      data: [],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    const names = body.jobs.map((j: ScheduledJob) => j.name);
    expect(names).toContain("vault-ingest");
    expect(names).toContain("pr-triage");
  });

  it("static plugin-job crons have correct schedules", async () => {
    mockRoutines.mockResolvedValueOnce({ ok: true, data: [] });

    const res = await GET();
    const body = await res.json();

    const vaultIngest = body.jobs.find((j: ScheduledJob) => j.name === "vault-ingest");
    expect(vaultIngest).toBeDefined();
    expect(vaultIngest.cron).toBe("0 * * * *");

    const prTriage = body.jobs.find((j: ScheduledJob) => j.name === "pr-triage");
    expect(prTriage).toBeDefined();
    expect(prTriage.cron).toBe("30 7 * * *");
  });

  it("static plugin-job crons have dash placeholders for runtime fields (no fabrication)", async () => {
    mockRoutines.mockResolvedValueOnce({ ok: true, data: [] });

    const res = await GET();
    const body = await res.json();

    const vaultIngest = body.jobs.find((j: ScheduledJob) => j.name === "vault-ingest");
    expect(vaultIngest.last_run_label).toBe("—");
    expect(vaultIngest.next_in).toBe("—");

    const prTriage = body.jobs.find((j: ScheduledJob) => j.name === "pr-triage");
    expect(prTriage.last_run_label).toBe("—");
    expect(prTriage.next_in).toBe("—");
  });

  it("routines without a cron trigger are excluded", async () => {
    mockRoutines.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRoutine({
          title: "Webhook routine",
          triggers: [
            {
              id: "t2",
              kind: "webhook",
              label: null,
              enabled: true,
              cronExpression: null,
              timezone: null,
              nextRunAt: null,
              lastFiredAt: null,
              lastResult: null,
            },
          ],
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    const found = body.jobs.find((j: ScheduledJob) => j.name === "Webhook routine");
    expect(found).toBeUndefined();
  });

  it("routine last_run_label uses trigger.lastFiredAt when lastRun is absent", async () => {
    mockRoutines.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRoutine({
          title: "Check routine",
          triggers: [
            {
              id: "t3",
              kind: "cron",
              label: null,
              enabled: true,
              cronExpression: "0 12 * * *",
              timezone: null,
              nextRunAt: "2026-06-18T12:00:00.000Z",
              lastFiredAt: "2026-06-17T12:00:00.000Z",
              lastResult: "success",
            },
          ],
          lastRun: null,
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    const job = body.jobs.find((j: ScheduledJob) => j.name === "Check routine");
    expect(job).toBeDefined();
    // Should produce some label (not dash) when lastFiredAt is present
    expect(job.last_run_label).not.toBe("—");
    expect(typeof job.last_run_label).toBe("string");
  });

  it("routine last_run_label is dash when no lastFiredAt and no lastRun", async () => {
    mockRoutines.mockResolvedValueOnce({
      ok: true,
      data: [
        makeRoutine({
          title: "New routine",
          triggers: [
            {
              id: "t4",
              kind: "cron",
              label: null,
              enabled: true,
              cronExpression: "0 6 * * *",
              timezone: null,
              nextRunAt: "2026-06-18T06:00:00.000Z",
              lastFiredAt: null,
              lastResult: null,
            },
          ],
          lastRun: null,
        }),
      ],
    });

    const res = await GET();
    const body = await res.json();
    const job = body.jobs.find((j: ScheduledJob) => j.name === "New routine");
    expect(job.last_run_label).toBe("—");
  });

  it("returns 503 with {error} when routines() fails", async () => {
    mockRoutines.mockResolvedValueOnce({ ok: false, error: "timeout" });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 503 when Paperclip env vars are missing", async () => {
    delete process.env.PAPERCLIP_API_URL;

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });

  it("does not call Hermes when on Paperclip path", async () => {
    mockRoutines.mockResolvedValueOnce({ ok: true, data: [] });

    const res = await GET();
    expect(res.status).toBe(200);
    // Just verifying no crash and Paperclip client was used
    expect(mockCreatePaperclipClient).toHaveBeenCalledOnce();
  });
});
