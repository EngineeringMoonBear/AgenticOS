// Throwaway spike. Runs a Codex agent in a local Docker sandbox to add a
// passing vitest test to the AgenticOS repo, on a named branch, and prints a
// structured result. See docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md.
import { run, codex, Output } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Monorepo root = two levels up from experiments/sandcastle-spike/.
const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BRANCH = `spike/sandcastle-${STAMP}`;

// Structured output schema — the agent must emit this inside <result>…</result>.
const RESULT_SCHEMA = z.object({
  completed: z.boolean(),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  testCommand: z.string(),
  testPassed: z.boolean(),
});

// The prompt MUST contain the opening <result> tag literal (Output.object
// requirement) and end by emitting the default completion signal.
const PROMPT = `You are working inside a checkout of the AgenticOS pnpm monorepo.

TASK: Find ONE small, currently-untested, exported PURE function in
apps/dashboard/lib/ (no I/O, no React, no database). Write a focused vitest test
in a sibling *.test.ts file covering its main behavior plus one edge case. Do
NOT modify the function itself. Then run it and confirm it PASSES:

    pnpm --filter dashboard exec vitest run <your-new-test-file>

When finished, emit EXACTLY one structured-output line inside this tag:
<result>{"completed": true, "summary": "<what you did>", "filesChanged": ["<paths>"], "testCommand": "<the vitest command you ran>", "testPassed": true}</result>
then emit the completion signal on its own line:
<promise>COMPLETE</promise>`;

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY not set — export it before running (see README.md).",
    );
  }

  const result = await run({
    agent: codex("gpt-5-codex", {
      effort: "medium",
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
    }),
    sandbox: docker(),
    cwd: REPO_ROOT,
    branchStrategy: { type: "branch", branch: BRANCH, baseBranch: "main" },
    prompt: PROMPT,
    output: Output.object({ tag: "result", schema: RESULT_SCHEMA }),
    idleTimeoutSeconds: 900,
    // Codex defaults to the ChatGPT-login websocket transport and 401s on a bare
    // API key. Run `codex login --with-api-key` inside the sandbox first (the
    // Hermes pattern) to write ~/.codex/auth.json and flip Codex into API-key mode.
    hooks: {
      sandbox: {
        onSandboxReady: [
          { command: "printenv OPENAI_API_KEY | codex login --with-api-key" },
        ],
      },
    },
  });

  console.log("=== SANDCASTLE SPIKE RESULT ===");
  console.log(
    JSON.stringify(
      {
        branch: result.branch,
        commits: result.commits,
        completionSignal: result.completionSignal,
        output: result.output,
      },
      null,
      2,
    ),
  );
  console.log("\n--- tail of agent stdout (last ~2 KB) ---");
  console.log(result.stdout.slice(-2000));
}

main().catch((err) => {
  console.error("spike failed:", err);
  process.exitCode = 1;
});
