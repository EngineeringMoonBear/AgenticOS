import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Paperclip client factory (vi.hoisted so factory is available at
// vi.mock() call time).
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

// Import after mocks are registered.
import { GET } from "./route";
import type { RoutineRow } from "./route";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    companyId: "11111111-1111-1111-1111-111111111111",
    title: "Daily standup report",
    status: "active",
    priority: "normal",
    assigneeAgentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    concurrencyPolicy: "skip",
    catchUpPolicy: "skip_missed",
    lastTriggeredAt: "2025-06-17T09:00:00.000Z",
    lastEnqueuedAt: "2025-06-17T09:00:00.000Z",
    managedByPlugin: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-17T09:00:00.000Z",
    triggers: [
      {
        id: "tttttttt-tttt-tttt-tttt-tttttttttttt",
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

function makeManagedByPlugin() {
  return {
    id: "mbp-0001-0000-0000-000000000000",
    pluginId: "plugin-pr-triage",
    pluginKey: "pr-triage",
    pluginDisplayName: "PR Triage Plugin",
    resourceKind: "routine",
    resourceKey: "pr-triage-routine",
    defaultsJson: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests — non-paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/routines — non-paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("hermes");
  });

  it("returns an empty routines list without calling Paperclip", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines).toEqual([]);
    expect(mockCreatePaperclipClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Paperclip path
// ---------------------------------------------------------------------------

describe("GET /api/routines — Paperclip path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDataSource.mockReturnValue("paperclip");
    mockCreatePaperclipClient.mockReturnValue({ routines: mockRoutines });
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    process.env.PAPERCLIP_BOARD_KEY = "test-board-key";
    process.env.PAPERCLIP_COMPANY_ID = "co-test";
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_BOARD_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
  });

  it("maps Routine[] to RoutineRow[] with correct field mapping", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [
        makeRoutine({
          id: "routine-1",
          title: "Daily standup report",
          status: "active",
          triggers: [
            {
              id: "trigger-1",
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
          managedByPlugin: null,
        }),
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines).toHaveLength(1);

    expect(body.routines[0]).toMatchObject({
      id: "routine-1",
      name: "Daily standup report",
      enabled: true,
      cron: "0 9 * * *",
      lastResult: "success",
      managedByPlugin: null,
    });
  });

  it("maps managedByPlugin.pluginDisplayName when present", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [
        makeRoutine({
          id: "routine-2",
          title: "PR triage",
          status: "active",
          triggers: [],
          managedByPlugin: makeManagedByPlugin(),
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines[0].managedByPlugin).toBe("PR Triage Plugin");
  });

  it("sets cron to null when triggers array is empty", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [makeRoutine({ triggers: [] })],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines[0].cron).toBeNull();
  });

  it("sets lastResult to null when triggers array is empty", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [makeRoutine({ triggers: [] })],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines[0].lastResult).toBeNull();
  });

  it("sets cron from first trigger cronExpression even when null", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [
        makeRoutine({
          triggers: [
            {
              id: "trigger-webhook",
              kind: "webhook",
              label: null,
              enabled: true,
              cronExpression: null,
              timezone: null,
              nextRunAt: null,
              lastFiredAt: null,
              lastResult: "error",
            },
          ],
        }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines[0].cron).toBeNull();
    expect(body.routines[0].lastResult).toBe("error");
  });

  it("maps status field to enabled (active → true, other → false)", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [
        makeRoutine({ id: "r-active", status: "active" }),
        makeRoutine({ id: "r-paused", status: "paused" }),
        makeRoutine({ id: "r-disabled", status: "disabled" }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines[0].enabled).toBe(true);
    expect(body.routines[1].enabled).toBe(false);
    expect(body.routines[2].enabled).toBe(false);
  });

  it("returns 503 with {error} when routines() fails", async () => {
    mockRoutines.mockResolvedValue({ ok: false, error: "HTTP 502 Bad Gateway" });

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

  it("returns multiple routines in order", async () => {
    mockRoutines.mockResolvedValue({
      ok: true,
      data: [
        makeRoutine({ id: "r-1", title: "Alpha" }),
        makeRoutine({ id: "r-2", title: "Beta" }),
      ],
    });

    const res = await GET();
    const body = (await res.json()) as { routines: RoutineRow[] };
    expect(body.routines).toHaveLength(2);
    expect(body.routines[0].id).toBe("r-1");
    expect(body.routines[1].id).toBe("r-2");
  });
});
