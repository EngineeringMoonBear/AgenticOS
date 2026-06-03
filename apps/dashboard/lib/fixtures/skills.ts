export type Skill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /**
   * Run metadata is optional: real vault-backed skills (from /api/vault/skills)
   * have no run history, so the card omits the meta row / lane badge for them.
   * The local fixtures still populate these for the command palette demo.
   */
  lastRunAt?: string; // ISO 8601
  successRate?: number; // 0–100
  lane?: "hermes" | "sandcastle";
};

export const SKILL_FIXTURES: Skill[] = [
  {
    id: "daily-marketing-scan",
    name: "Daily marketing scan",
    description:
      "Pulls Buffer analytics, Ahrefs rank changes, and Ghost traffic stats. Summarises into a daily digest note in the vault.",
    tags: ["goldberry", "marketing", "cowork"],
    lastRunAt: "2026-05-16T07:04:00Z",
    successRate: 92,
    lane: "hermes",
  },
  {
    id: "run-grove-sites-tests",
    name: "Run grove-sites tests",
    description:
      "Runs the full vitest suite for gather-at-the-grove, reports failures, and opens a worktree if any test is red.",
    tags: ["goldberry", "software", "code"],
    lastRunAt: "2026-05-15T14:22:00Z",
    successRate: 87,
    lane: "sandcastle",
  },
  {
    id: "process-asana-video-brief",
    name: "Process Asana video brief",
    description:
      "Reads the latest video brief task from Asana, extracts shot list and script notes, and stages a draft in Obsidian.",
    tags: ["goldberry", "video", "cowork"],
    lastRunAt: "2026-05-14T10:15:00Z",
    successRate: 100,
    lane: "hermes",
  },
  {
    id: "generate-weekly-farm-report",
    name: "Generate weekly farm report",
    description:
      "Aggregates farmOS sensor data, harvest logs, and bed journal entries into a formatted weekly report published to Ghost.",
    tags: ["goldberry", "farm", "cowork"],
    lastRunAt: "2026-05-12T06:00:00Z",
    successRate: 95,
    lane: "hermes",
  },
  {
    id: "lint-agentcos-wiki",
    name: "Lint AgenticOS wiki",
    description:
      "Scans the vault for broken wikilinks, orphan pages, and missing frontmatter tags. Outputs a lint report to /observability.",
    tags: ["personal", "cowork"],
    lastRunAt: "2026-05-09T00:01:00Z",
    successRate: 100,
    lane: "hermes",
  },
  {
    id: "triage-personal-inbox",
    name: "Triage personal inbox",
    description:
      "Reviews fleeting notes in inbox/, auto-tags each, and suggests a target wiki page for promotion. Leaves final approval to the user.",
    tags: ["personal", "cowork"],
    lastRunAt: "2026-05-15T08:30:00Z",
    successRate: 98,
    lane: "hermes",
  },
  {
    id: "instnt-investigate-flaky-ci",
    name: "Instnt: investigate flaky CI",
    description:
      "Pulls recent Instnt CI run logs, identifies the flaky test by error fingerprint, and opens a sandcastle branch with a candidate fix.",
    tags: ["instnt", "software", "code"],
    lastRunAt: "2026-05-16T03:45:00Z",
    successRate: 78,
    lane: "sandcastle",
  },
  {
    id: "draft-ghost-post-from-brief",
    name: "Draft Ghost post from brief",
    description:
      "Takes a marketing brief from Obsidian, generates a full Ghost CMS draft with SEO meta, and schedules a Buffer social caption.",
    tags: ["goldberry", "marketing", "cowork"],
    lastRunAt: "2026-05-13T11:00:00Z",
    successRate: 91,
    lane: "hermes",
  },
  {
    id: "render-syntropic-plot-diagram",
    name: "Render syntropic plot diagram",
    description:
      "Reads bed layout data from the vault, generates a layered planting diagram as SVG, and exports a video-ready frame sequence.",
    tags: ["goldberry", "farm", "video"],
    lastRunAt: "2026-05-10T09:20:00Z",
    successRate: 83,
    lane: "hermes",
  },
  {
    id: "refactor-odoo-client-types",
    name: "Refactor odoo-client types",
    description:
      "Regenerates TypeScript types from the Odoo OpenAPI spec, updates all call sites, and runs the test suite in an isolated worktree.",
    tags: ["goldberry", "software", "code"],
    lastRunAt: "2026-05-11T16:55:00Z",
    successRate: 90,
    lane: "sandcastle",
  },
];
