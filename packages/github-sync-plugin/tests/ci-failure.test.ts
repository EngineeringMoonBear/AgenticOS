import { describe, it, expect } from "vitest";
import {
  buildCiFixBody,
  buildCiFixOpenedPing,
  buildCiFixResolvedPing,
  buildCiFixTitle,
  buildCiFixUpdatedPing,
  buildCiReFailNote,
  buildCiResolvedNote,
  ciChecks,
  ciFixMarker,
  classifyCiState,
  decideCiFixAction,
  failingChecks,
  isAgentReviewCheck,
  isFailingCheck,
  parseCheckSuiteEvent,
  parseCiCompletionEvent,
  parseWorkflowRunEvent,
  renderFailedChecks,
  shortSha,
  type CheckRunSummary,
} from "../src/ci-failure.js";

const check = (over: Partial<CheckRunSummary> = {}): CheckRunSummary => ({
  name: "build",
  status: "completed",
  conclusion: "success",
  ...over,
});

const checkSuiteEvent = (over: Record<string, unknown> = {}, csOver: Record<string, unknown> = {}) => ({
  action: "completed",
  repository: { full_name: "Goldberry-Playground/AgenticOS" },
  check_suite: {
    head_sha: "abc1234def5678",
    conclusion: "failure",
    pull_requests: [{ number: 42 }],
    app: { name: "GitHub Actions" },
    ...csOver,
  },
  ...over,
});

const workflowRunEvent = (over: Record<string, unknown> = {}, wrOver: Record<string, unknown> = {}) => ({
  action: "completed",
  repository: { full_name: "Goldberry-Playground/AgenticOS" },
  workflow_run: {
    name: "CI",
    head_sha: "abc1234def5678",
    conclusion: "failure",
    pull_requests: [{ number: 42 }],
    html_url: "https://github.com/Goldberry-Playground/AgenticOS/actions/runs/99",
    ...wrOver,
  },
  ...over,
});

describe("parseCheckSuiteEvent", () => {
  it("maps a check_suite completed payload", () => {
    expect(parseCheckSuiteEvent(checkSuiteEvent())).toEqual({
      kind: "check_suite",
      action: "completed",
      repo: "Goldberry-Playground/AgenticOS",
      headSha: "abc1234def5678",
      conclusion: "failure",
      prNumbers: [42],
      name: "GitHub Actions",
      detailsUrl: "",
    });
  });

  it("dedupes PR numbers and drops non-positive", () => {
    const ev = parseCheckSuiteEvent(checkSuiteEvent({}, { pull_requests: [{ number: 42 }, { number: 42 }, { number: 0 }] }));
    expect(ev?.prNumbers).toEqual([42]);
  });

  it("returns null without repo or head sha", () => {
    expect(parseCheckSuiteEvent(checkSuiteEvent({ repository: {} }))).toBeNull();
    expect(parseCheckSuiteEvent(checkSuiteEvent({}, { head_sha: undefined }))).toBeNull();
  });

  it("defaults the run name to CI when the app name is absent", () => {
    expect(parseCheckSuiteEvent(checkSuiteEvent({}, { app: {} }))?.name).toBe("CI");
  });
});

describe("parseWorkflowRunEvent", () => {
  it("maps a workflow_run completed payload with its html_url + name", () => {
    expect(parseWorkflowRunEvent(workflowRunEvent())).toEqual({
      kind: "workflow_run",
      action: "completed",
      repo: "Goldberry-Playground/AgenticOS",
      headSha: "abc1234def5678",
      conclusion: "failure",
      prNumbers: [42],
      name: "CI",
      detailsUrl: "https://github.com/Goldberry-Playground/AgenticOS/actions/runs/99",
    });
  });

  it("returns empty prNumbers for a push-triggered run (no pull_requests)", () => {
    expect(parseWorkflowRunEvent(workflowRunEvent({}, { pull_requests: [] }))?.prNumbers).toEqual([]);
  });
});

describe("parseCiCompletionEvent dispatch", () => {
  it("routes by X-GitHub-Event header", () => {
    expect(parseCiCompletionEvent(checkSuiteEvent(), "check_suite")?.kind).toBe("check_suite");
    expect(parseCiCompletionEvent(workflowRunEvent(), "workflow_run")?.kind).toBe("workflow_run");
    expect(parseCiCompletionEvent(checkSuiteEvent(), "issues")).toBeNull();
  });
});

describe("check classification", () => {
  it("identifies agent-review checks and excludes them from CI", () => {
    expect(isAgentReviewCheck("agent-review/alice")).toBe(true);
    expect(isAgentReviewCheck("build")).toBe(false);
    const checks = [check({ name: "agent-review/alice", conclusion: "failure" }), check({ name: "test" })];
    expect(ciChecks(checks).map((c) => c.name)).toEqual(["test"]);
  });

  it("isFailingCheck covers the failing conclusion set only", () => {
    expect(isFailingCheck(check({ conclusion: "failure" }))).toBe(true);
    expect(isFailingCheck(check({ conclusion: "timed_out" }))).toBe(true);
    expect(isFailingCheck(check({ conclusion: "success" }))).toBe(false);
    expect(isFailingCheck(check({ conclusion: null, status: "in_progress" }))).toBe(false);
  });

  it("classifyCiState: failing beats pending", () => {
    const checks = [check({ name: "a", conclusion: "failure" }), check({ name: "b", status: "in_progress", conclusion: null })];
    expect(classifyCiState(checks)).toBe("failing");
  });

  it("classifyCiState: green only when all completed non-failing", () => {
    expect(classifyCiState([check({ name: "a" }), check({ name: "b", conclusion: "skipped" })])).toBe("green");
  });

  it("classifyCiState: pending when a check is still running and none failed", () => {
    expect(classifyCiState([check({ name: "a" }), check({ name: "b", status: "queued", conclusion: null })])).toBe("pending");
  });

  it("classifyCiState: none when only agent-review checks exist", () => {
    expect(classifyCiState([check({ name: "agent-review/alice", conclusion: "success" })])).toBe("none");
    expect(classifyCiState([])).toBe("none");
  });

  it("a failing agent-review check does NOT make CI failing", () => {
    expect(classifyCiState([check({ name: "agent-review/alice", conclusion: "failure" }), check({ name: "build" })])).toBe("green");
  });

  it("failingChecks returns only the failing real-CI checks", () => {
    const checks = [
      check({ name: "build", conclusion: "failure" }),
      check({ name: "lint", conclusion: "success" }),
      check({ name: "agent-review/alice", conclusion: "failure" }),
    ];
    expect(failingChecks(checks).map((c) => c.name)).toEqual(["build"]);
  });
});

describe("decideCiFixAction", () => {
  it("failing → create when no record or a previously-closed record", () => {
    expect(decideCiFixAction(null, "failing")).toBe("create");
    expect(decideCiFixAction({ status: "closed" }, "failing")).toBe("create");
  });
  it("failing → update when an open record exists", () => {
    expect(decideCiFixAction({ status: "open" }, "failing")).toBe("update");
  });
  it("green → close only an open record, else noop", () => {
    expect(decideCiFixAction({ status: "open" }, "green")).toBe("close");
    expect(decideCiFixAction({ status: "closed" }, "green")).toBe("noop");
    expect(decideCiFixAction(null, "green")).toBe("noop");
  });
  it("pending / none → noop regardless of record", () => {
    expect(decideCiFixAction({ status: "open" }, "pending")).toBe("noop");
    expect(decideCiFixAction({ status: "open" }, "none")).toBe("noop");
  });
});

describe("fix-issue rendering", () => {
  const ctx = {
    repo: "Goldberry-Playground/AgenticOS",
    prNumber: 42,
    prUrl: "https://github.com/Goldberry-Playground/AgenticOS/pull/42",
    prTitle: "Add widget",
    headSha: "abc1234def5678",
    ownerName: "Alice",
    runName: "CI",
    runUrl: "https://github.com/Goldberry-Playground/AgenticOS/actions/runs/99",
    failed: [check({ name: "build", conclusion: "failure", summary: "Type error in worker.ts", detailsUrl: "https://x/logs" })],
  };

  it("marker is stable and PR-keyed", () => {
    expect(ciFixMarker(ctx.repo, ctx.prNumber)).toBe("<!-- ci-fix: Goldberry-Playground/AgenticOS#42 -->");
  });

  it("title carries repo#pr and the PR title", () => {
    expect(buildCiFixTitle(ctx)).toBe("CI failing — Goldberry-Playground/AgenticOS#42 — Add widget");
    expect(buildCiFixTitle({ ...ctx, prTitle: "" })).toBe("CI failing — Goldberry-Playground/AgenticOS#42");
  });

  it("body embeds the marker, head SHA, owner, and failed checks", () => {
    const body = buildCiFixBody(ctx);
    expect(body).toContain(ciFixMarker(ctx.repo, ctx.prNumber));
    expect(body).toContain("`abc1234def5678`");
    expect(body).toContain("**Owner:** Alice");
    expect(body).toContain("`build`");
    expect(body).toContain("Type error in worker.ts");
    expect(body).toContain("([logs](https://x/logs))");
    expect(body).toContain("auto-closes");
  });

  it("renderFailedChecks truncates a long excerpt and caps the list", () => {
    const long = "x".repeat(400);
    const rendered = renderFailedChecks([check({ name: "build", conclusion: "failure", summary: long })]);
    expect(rendered).toContain("…");
    expect(rendered.length).toBeLessThan(long.length);

    const many = Array.from({ length: 25 }, (_, i) => check({ name: `job${i}`, conclusion: "failure" }));
    expect(renderFailedChecks(many)).toContain("…and 5 more");
  });

  it("renderFailedChecks handles an empty list", () => {
    expect(renderFailedChecks([])).toContain("no individual failing check");
  });

  it("re-fail + resolved notes reference the short head SHA", () => {
    expect(buildCiReFailNote(ctx)).toContain(shortSha(ctx.headSha));
    expect(buildCiReFailNote(ctx)).toContain("still failing");
    expect(buildCiResolvedNote(ctx.headSha)).toContain("auto-closing");
    expect(buildCiResolvedNote(ctx.headSha)).toContain(shortSha(ctx.headSha));
  });

  it("pings carry the transition + PR", () => {
    expect(buildCiFixOpenedPing(ctx)).toContain("CI failing");
    expect(buildCiFixOpenedPing(ctx)).toContain("Alice");
    expect(buildCiFixUpdatedPing(ctx)).toContain("still failing");
    expect(buildCiFixResolvedPing(ctx.repo, ctx.prNumber)).toContain("auto-closed");
  });
});
