import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  anyFrontendMatch,
  buildChangesRequestedPing,
  buildReReviewPing,
  buildReviewIssueBody,
  buildReviewIssuesCreatedPing,
  buildSignoffPing,
  CHECK_CONTEXT,
  decideReviewAction,
  DEFAULT_FRONTEND_PATHS,
  globToRegExp,
  isActionablePrAction,
  isNullBodyStatusError,
  parseGithubPrEvent,
  prReviewMarker,
  shortSha,
  type GithubPrEvent,
} from "../src/pr-review.js";
import { verifyGithubSignature } from "../src/inbound.js";

const prEvent = (over: Record<string, unknown> = {}, prOver: Record<string, unknown> = {}) => ({
  action: "opened",
  number: 260,
  repository: { full_name: "Goldberry-Playground/AgenticOS" },
  pull_request: {
    number: 260,
    title: "Add dashboard widget",
    draft: false,
    html_url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
    head: { sha: "abc1234def5678" },
    ...prOver,
  },
  ...over,
});

describe("parseGithubPrEvent", () => {
  it("maps a native pull_request payload", () => {
    const ev = parseGithubPrEvent(prEvent());
    expect(ev).toEqual({
      action: "opened",
      draft: false,
      repo: "Goldberry-Playground/AgenticOS",
      number: 260,
      title: "Add dashboard widget",
      headSha: "abc1234def5678",
      url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
    });
  });

  it("reads draft flag and tolerates a string number", () => {
    expect(parseGithubPrEvent(prEvent({}, { draft: true }))?.draft).toBe(true);
    expect(parseGithubPrEvent(prEvent({}, { number: "42" }))?.number).toBe(42);
  });

  it("returns null without repo, positive number, or head sha", () => {
    expect(parseGithubPrEvent(prEvent({ repository: {} }))).toBeNull();
    expect(parseGithubPrEvent(prEvent({}, { number: 0 }))).toBeNull();
    expect(parseGithubPrEvent(prEvent({}, { head: {} }))).toBeNull();
    expect(parseGithubPrEvent("nope")).toBeNull();
  });
});

describe("isActionablePrAction — PR action filtering", () => {
  it("acts on opened/reopened/ready_for_review/synchronize", () => {
    for (const a of ["opened", "reopened", "ready_for_review", "synchronize"]) {
      expect(isActionablePrAction(a)).toBe(true);
    }
  });
  it("ignores edited/closed/labeled/assigned/etc.", () => {
    for (const a of ["edited", "closed", "labeled", "assigned", "converted_to_draft", ""]) {
      expect(isActionablePrAction(a)).toBe(false);
    }
  });
});

describe("globToRegExp / anyFrontendMatch — frontendPaths matching", () => {
  it("**/*.tsx matches nested and top-level .tsx", () => {
    const re = globToRegExp("**/*.tsx");
    expect(re.test("apps/dashboard/components/Button.tsx")).toBe(true);
    expect(re.test("Button.tsx")).toBe(true);
    expect(re.test("apps/api/server.ts")).toBe(false);
  });

  it("apps/dashboard/** matches anything under the dir but not siblings", () => {
    const re = globToRegExp("apps/dashboard/**");
    expect(re.test("apps/dashboard/page.ts")).toBe(true);
    expect(re.test("apps/dashboard/nested/deep/x.json")).toBe(true);
    expect(re.test("apps/dashboardx/page.ts")).toBe(false);
    expect(re.test("apps/api/page.ts")).toBe(false);
  });

  it("single * stays within a path segment", () => {
    const re = globToRegExp("apps/*/index.ts");
    expect(re.test("apps/api/index.ts")).toBe(true);
    expect(re.test("apps/a/b/index.ts")).toBe(false);
  });

  it("anyFrontendMatch triggers Iris on a frontend change, not on a pure backend PR", () => {
    expect(anyFrontendMatch(["apps/api/server.ts", "apps/dashboard/App.tsx"], DEFAULT_FRONTEND_PATHS)).toBe(true);
    expect(anyFrontendMatch(["styles/theme.css"], DEFAULT_FRONTEND_PATHS)).toBe(true);
    expect(anyFrontendMatch(["packages/core/lib.ts", "README.md"], DEFAULT_FRONTEND_PATHS)).toBe(false);
    expect(anyFrontendMatch([], DEFAULT_FRONTEND_PATHS)).toBe(false);
  });
});

describe("decideReviewAction — idempotency per head SHA", () => {
  it("creates when the reviewer has never seen the PR", () => {
    expect(decideReviewAction(null, "sha-a")).toBe("create");
  });
  it("no-ops on a redelivery at the same head SHA", () => {
    expect(decideReviewAction("sha-a", "sha-a")).toBe("noop");
  });
  it("reopens when the head SHA changed (new commits / synchronize)", () => {
    expect(decideReviewAction("sha-a", "sha-b")).toBe("reopen");
  });
});

describe("HMAC verification (github-pr shares the appWebhookSecret path)", () => {
  const SECRET = "app-secret";
  const RAW = JSON.stringify(prEvent());
  const SIG = `sha256=${createHmac("sha256", SECRET).update(RAW, "utf8").digest("hex")}`;

  it("accepts a correctly-signed pull_request body and rejects tampering", () => {
    expect(verifyGithubSignature(RAW, SECRET, SIG)).toBe(true);
    expect(verifyGithubSignature(RAW + " ", SECRET, SIG)).toBe(false);
    expect(verifyGithubSignature(RAW, "wrong", SIG)).toBe(false);
    expect(verifyGithubSignature(RAW, SECRET, undefined)).toBe(false);
  });
});

describe("review issue + marker content", () => {
  const ev: GithubPrEvent = {
    action: "opened",
    draft: false,
    repo: "Goldberry-Playground/AgenticOS",
    number: 260,
    title: "Add widget",
    headSha: "abc1234def",
    url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
  };

  it("embeds the loop-prevention marker keyed on (repo, PR, head sha)", () => {
    const marker = prReviewMarker(ev.repo, ev.number, ev.headSha);
    expect(marker).toBe("<!-- pr-review: Goldberry-Playground/AgenticOS#260@abc1234def -->");
    expect(buildReviewIssueBody("ada", ev, ["a.ts"])).toContain(marker);
  });

  it("names the reviewer's check-run context in the body", () => {
    expect(buildReviewIssueBody("ada", ev, ["a.ts"])).toContain(CHECK_CONTEXT.ada);
    expect(buildReviewIssueBody("iris", ev, ["a.tsx"])).toContain(CHECK_CONTEXT.iris);
  });

  it("truncates a huge changed-file list with a summary line", () => {
    const files = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
    const body = buildReviewIssueBody("ada", ev, files);
    expect(body).toContain("Changed files (60)");
    expect(body).toContain("…and 10 more");
  });
});

describe("state-change pings", () => {
  const ev: GithubPrEvent = {
    action: "opened",
    draft: false,
    repo: "org/repo",
    number: 7,
    title: "t",
    headSha: "deadbeefcafe",
    url: "https://x/pull/7",
  };
  it("created ping lists reviewers", () => {
    expect(buildReviewIssuesCreatedPing(ev, ["ada", "iris"])).toContain("Ada + Iris");
    expect(buildReviewIssuesCreatedPing(ev, ["ada"])).toContain("org/repo#7");
  });
  it("re-review ping shows the short SHA", () => {
    const msg = buildReReviewPing(ev, ["ada"]);
    expect(msg).toContain(shortSha(ev.headSha));
    expect(msg).toContain("new commits");
  });
  it("sign-off + changes-requested pings name the context/reviewer", () => {
    expect(buildSignoffPing("ada", "org/repo", 7)).toContain("agent-review/ada");
    expect(buildChangesRequestedPing("iris", "org/repo", 7)).toContain("Iris requested changes");
  });
});

describe("isNullBodyStatusError (GOL-179 ops-ping 204 handling)", () => {
  it("treats a 204 No Content Response-constructor throw as success", () => {
    // The exact shape the SDK's http.fetch throws when Discord acks with 204.
    expect(isNullBodyStatusError(new Error("Response constructor: Invalid response status code 204"))).toBe(true);
  });
  it("also covers the other null-body statuses (205, 304)", () => {
    expect(isNullBodyStatusError(new Error("Invalid response status code 205"))).toBe(true);
    expect(isNullBodyStatusError(new Error("Invalid response status code 304"))).toBe(true);
  });
  it("does not swallow real failures", () => {
    expect(isNullBodyStatusError(new Error("fetch failed: ECONNREFUSED"))).toBe(false);
    expect(isNullBodyStatusError(new Error("Invalid response status code 500"))).toBe(false);
    expect(isNullBodyStatusError("timeout")).toBe(false);
  });
});
