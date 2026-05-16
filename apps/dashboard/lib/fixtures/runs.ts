// Fixture data for /observability — 15 runs, no live data wiring.
// Phase 3 will replace this with SSE-driven real run records.

export type RunStatus = "running" | "done" | "failed" | "awaiting-approval";
export type RunLane = "hermes" | "sandcastle";
export type RunModel = "haiku" | "sonnet" | "opus";

export interface Run {
  id: string;
  title: string;
  lane: RunLane;
  tags: string[];
  status: RunStatus;
  /** ISO 8601 */
  startedAt: string;
  /** Seconds elapsed (for running: still counting; for others: final) */
  durationSeconds: number;
  model: RunModel;
  /** USD */
  cost: number;
}

const now = new Date("2026-05-16T09:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

export const RUN_FIXTURES: Run[] = [
  // ── RUNNING (3) ──────────────────────────────────────────────────────────
  {
    id: "run-001",
    title: "Daily marketing scan",
    lane: "hermes",
    tags: ["goldberry", "marketing", "cowork"],
    status: "running",
    startedAt: ago(3 * 60 * 1000 + 12 * 1000), // 3m 12s ago
    durationSeconds: 192,
    model: "sonnet",
    cost: 0.34,
  },
  {
    id: "run-002",
    title: "Refactor odoo-client types in worktree",
    lane: "sandcastle",
    tags: ["goldberry", "software", "code"],
    status: "running",
    startedAt: ago(1 * 60 * 1000 + 4 * 1000), // 1m 4s ago
    durationSeconds: 64,
    model: "sonnet",
    cost: 0.12,
  },
  {
    id: "run-003",
    title: "Farm morning brief",
    lane: "hermes",
    tags: ["farm", "marketing"],
    status: "running",
    startedAt: ago(45 * 1000), // 45s ago
    durationSeconds: 45,
    model: "sonnet",
    cost: 0.08,
  },

  // ── DONE (8) ─────────────────────────────────────────────────────────────
  {
    id: "run-004",
    title: "Weekly CSA newsletter draft",
    lane: "hermes",
    tags: ["farm", "marketing"],
    status: "done",
    startedAt: ago(1.5 * 60 * 60 * 1000),
    durationSeconds: 252,
    model: "haiku",
    cost: 0.03,
  },
  {
    id: "run-005",
    title: "Render plot diagram for bed 3",
    lane: "hermes",
    tags: ["farm"],
    status: "done",
    startedAt: ago(2 * 60 * 60 * 1000),
    durationSeconds: 38,
    model: "haiku",
    cost: 0.01,
  },
  {
    id: "run-006",
    title: "Instnt Slack triage — Monday queue",
    lane: "hermes",
    tags: ["instnt", "cowork"],
    status: "done",
    startedAt: ago(3 * 60 * 60 * 1000),
    durationSeconds: 120,
    model: "haiku",
    cost: 0.02,
  },
  {
    id: "run-007",
    title: "Scaffold gather-at-the-grove auth module",
    lane: "sandcastle",
    tags: ["goldberry", "software", "code"],
    status: "done",
    startedAt: ago(4 * 60 * 60 * 1000),
    durationSeconds: 720,
    model: "sonnet",
    cost: 0.88,
  },
  {
    id: "run-008",
    title: "Harvest reel video pipeline",
    lane: "hermes",
    tags: ["farm", "video"],
    status: "done",
    startedAt: ago(5 * 60 * 60 * 1000),
    durationSeconds: 480,
    model: "sonnet",
    cost: 0.62,
  },
  {
    id: "run-009",
    title: "Personal finance digest — May W2",
    lane: "hermes",
    tags: ["personal"],
    status: "done",
    startedAt: ago(6 * 60 * 60 * 1000),
    durationSeconds: 95,
    model: "haiku",
    cost: 0.04,
  },
  {
    id: "run-010",
    title: "Instnt onboarding flow code review",
    lane: "sandcastle",
    tags: ["instnt", "software", "code"],
    status: "done",
    startedAt: ago(8 * 60 * 60 * 1000),
    durationSeconds: 340,
    model: "sonnet",
    cost: 0.45,
  },
  {
    id: "run-011",
    title: "Update Ghost CMS plugin metadata",
    lane: "sandcastle",
    tags: ["goldberry", "software", "code"],
    status: "done",
    startedAt: ago(10 * 60 * 60 * 1000),
    durationSeconds: 88,
    model: "haiku",
    cost: 0.02,
  },

  // ── FAILED (2) ───────────────────────────────────────────────────────────
  {
    id: "run-012",
    title: "Soil report analysis — farmOS pull",
    lane: "hermes",
    tags: ["farm"],
    status: "failed",
    startedAt: ago(7 * 60 * 60 * 1000),
    durationSeconds: 43,
    model: "haiku",
    cost: 0.01,
  },
  {
    id: "run-013",
    title: "Deploy instnt-web to staging",
    lane: "sandcastle",
    tags: ["instnt", "software", "code"],
    status: "failed",
    startedAt: ago(9 * 60 * 60 * 1000),
    durationSeconds: 210,
    model: "sonnet",
    cost: 0.29,
  },

  // ── AWAITING APPROVAL (2) ─────────────────────────────────────────────────
  {
    id: "run-014",
    title: "Publish harvest reel to YouTube + Ghost",
    lane: "hermes",
    tags: ["farm", "video", "marketing"],
    status: "awaiting-approval",
    startedAt: ago(30 * 60 * 1000),
    durationSeconds: 310,
    model: "opus",
    cost: 2.40,
  },
  {
    id: "run-015",
    title: "Merge odoo-client refactor to main",
    lane: "sandcastle",
    tags: ["goldberry", "software", "code"],
    status: "awaiting-approval",
    startedAt: ago(25 * 60 * 1000),
    durationSeconds: 540,
    model: "opus",
    cost: 3.80,
  },
];
