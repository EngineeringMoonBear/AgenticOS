# Phase 3 Hermes Integration Implementation Plan

> **⚠️ SUPERSEDED — wrong Hermes wiring.** This plan assumes a live Hermes
> HTTP/SSE daemon on **port 7600**, a dashboard-resident **node-cron**
> scheduler, and an **MCP bridge on 7610**. None of that is how Hermes is
> actually run. The current runtime is Dockerized Hermes on the Droplet
> (orchestration + its own cron tick via hermes-gateway), OpenViking as the
> memory provider, and Codex-based cost telemetry — see
> [`spec1-orchestrator.md`](./spec1-orchestrator.md) and the
> [docs index](../README.md). Preserved for history.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect AgenticOS to a live Hermes daemon, ship a nightly Curator skill, and add rate-limit observability — replacing Phase 2's fixture RunCards with real Hermes data backed by SSE streaming, atomic cron persistence, and an MCP-to-vault bridge.

**Architecture:** A new workspace package `@agenticos/hermes-client` wraps the Hermes HTTP+SSE API (port 7600). A node-cron scheduler in `apps/dashboard/lib/scheduler/` owns schedules persisted at `~/.agenticos/cron.json` and dispatches to Hermes on fire. An MCP server at port 7610 lets Hermes call AgenticOS's existing `/api/vault/*` routes — no direct vault filesystem access from Hermes. Anthropic rate-limit headers are captured passively from SSE `usage_delta` events into `~/.agenticos/rate-limits.jsonl` and surfaced in a 3-view Observability sidebar panel.

**Tech Stack:** Next.js 16.2.6 (Turbopack, App Router) · TypeScript strict · pnpm 9.15.4 workspaces · TanStack Query v5 (already mounted) · nuqs v2 · Zustand · Vitest · Playwright · `node-cron` v3 · `@modelcontextprotocol/sdk` v1. Phase 1.5 security baseline (`proxy.ts` Host/Origin gate, 64 KiB body limit, generic error envelopes) applies automatically to all new `/api/hermes/*` routes.

---

## Dependency DAG

```
Wave 1: T1 hermes-client package                                 (solo, 1.5 hd)
            └──────────────────┬────────────────────┐
                               ↓                    ↓
Wave 2: T2 /api/hermes/* routes      T3 Scheduler                (parallel, 2.0 hd)
            └──────────────────┬────────────────────┘
                               ↓
Wave 3: T4 Observability migration + staleness + rate limits     (solo, 2.0 hd)
                               ↓
Wave 4: T5 Curator skill + MCP-to-vault binding                  (solo, 2.5 hd)
                               ↓
Wave 5: T6 Cron UI + "Run now"                                   (solo, 1.5 hd)
```

**Sequential constraint:** T1 must complete before T2 or T3. T2 and T3 must both complete before T4. T4 must complete before T5 (Curator needs the live run-card pipeline to debug against). T5 must complete before T6 (cron UI exercises Curator end-to-end).

**Estimated wall-clock:** ~9.5 half-days (~5 working days).

---

## Asana mapping

| Task | Asana GID | Section |
|------|-----------|---------|
| T1 hermes-client package | `1214851151551055` | Phase 3 — Hermes Integration |
| T2 /api/hermes/* routes | `1214851151848382` | Phase 3 — Hermes Integration |
| T3 Scheduler (cron.json + node-cron) | `1214851415574230` | Phase 3 — Hermes Integration |
| T4 Observability cards + rate limits | `1214851415668293` | Phase 3 — Hermes Integration |
| T5 Curator + MCP-to-vault | `1214851415576349` | Phase 3 — Hermes Integration |
| T6 (subsumed into T6 plan) | shares GID with T4 partly | Phase 3 — Hermes Integration |

Note: T1 (Install Hermes locally) GID `1214851415572928` is a prerequisite — user runs `hermes serve --port 7600` once; AgenticOS does not supervise. Mark complete when user has Hermes running.

---

## File Structure

### New files

```
packages/hermes-client/                                  NEW workspace package
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                                         Public API
│   ├── types.ts                                         HermesRun, HermesEvent, HermesCron,
│   │                                                    HermesHealth, HermesTool,
│   │                                                    RunVitalSigns, ScheduleRecord
│   ├── errors.ts                                        HermesOfflineError, HermesTimeoutError,
│   │                                                    HermesRunNotFoundError
│   ├── sse.ts                                           Server-only SSE parser
│   └── client.ts                                        Server-only HermesClient class
└── test/                                                Mirrors src/

apps/dashboard/
├── app/api/
│   ├── hermes/
│   │   ├── health/route.ts                              GET — daemon status (5s TTL)
│   │   ├── tools/route.ts                               GET — MCP tool list
│   │   ├── runs/route.ts                                POST (dispatch), GET (list)
│   │   ├── runs/[id]/route.ts                           GET (single run)
│   │   ├── runs/[id]/cancel/route.ts                    POST — cancel run
│   │   ├── runs/[id]/events/route.ts                    GET — SSE proxy
│   │   ├── cron/route.ts                                GET (list), POST (create)
│   │   ├── cron/[id]/route.ts                           PUT (update), DELETE
│   │   └── cron/[id]/run/route.ts                       POST — manual trigger
│   └── limits/route.ts                                  GET — rate-limit state
├── lib/
│   ├── hermes/
│   │   ├── client-singleton.ts                          Process-wide HermesClient
│   │   └── health-poll.ts                               5s background poll
│   ├── scheduler/
│   │   ├── cron-io.ts                                   Atomic ~/.agenticos/cron.json IO
│   │   ├── cron-io.test.ts                              Vitest
│   │   ├── scheduler.ts                                 node-cron loop + sanity-cancel
│   │   ├── scheduler.test.ts                            Vitest
│   │   └── types.ts                                     Re-export ScheduleRecord
│   ├── limits/
│   │   ├── reader.ts                                    readRateLimits()
│   │   ├── writer.ts                                    appendRateLimitSample()
│   │   ├── projection.ts                                willNextRunFit()
│   │   └── *.test.ts
│   ├── skills/
│   │   ├── curator.ts                                   Hardcoded Curator skill definition
│   │   ├── curator.test.ts                              Vitest
│   │   └── prompts/
│   │       └── curator-system.txt                       System prompt verbatim
│   └── mcp-vault/                                       MCP server (port 7610)
│       ├── server.ts                                    Server lifecycle + tool registry
│       ├── tools.ts                                     11 tool definitions
│       └── server.test.ts                               Vitest
└── components/observability/
    ├── HermesStatusChip.tsx                             Header chip — daemon up/down
    ├── RateLimitsPanel.tsx                              Sidebar panel (3 views)
    └── SparklineSvg.tsx                                 Pure SVG, 120x24, 24 buckets
```

### Modified files

```
apps/dashboard/package.json                              Add @agenticos/hermes-client,
                                                         @modelcontextprotocol/sdk, node-cron,
                                                         eventsource-parser
apps/dashboard/lib/config/schema.ts                      Add hermesUrl, mcpServerUrl,
                                                         schedulerEnabled to AgenticOSConfig
apps/dashboard/components/layout/Header.tsx              Mount <HermesStatusChip />
apps/dashboard/components/observability/RunFeed.tsx      Swap RUNS_FIXTURE for useRunFeed()
apps/dashboard/components/observability/RunCard.tsx      Wire to HermesRun + RunVitalSigns;
                                                         gold stripe on stale; status pills;
                                                         "Cancel & restart" kebab item
apps/dashboard/components/observability/LiveStrip.tsx    Use useRunFeed({ status: 'running' })
apps/dashboard/components/observability/SchedulesSidebar.tsx
                                                         Wire to useHermesCron()
apps/dashboard/components/observability/RunDetailDrawer.tsx
                                                         Logs tab → useRunEvents() SSE;
                                                         Usage tab → real token fields
apps/dashboard/components/observability/MetricsSidebar.tsx
                                                         Mount <RateLimitsPanel />
apps/dashboard/lib/fixtures/runs.ts                      DELETE (after migration)
```

---

## Task 1: `@agenticos/hermes-client` Package Foundation

**Files:**
- Create: `packages/hermes-client/package.json`
- Create: `packages/hermes-client/tsconfig.json`
- Create: `packages/hermes-client/vitest.config.ts`
- Create: `packages/hermes-client/src/index.ts`
- Create: `packages/hermes-client/src/types.ts`
- Create: `packages/hermes-client/src/errors.ts`
- Create: `packages/hermes-client/test/errors.test.ts`
- Create: `packages/hermes-client/src/sse.ts`
- Create: `packages/hermes-client/test/sse.test.ts`
- Create: `packages/hermes-client/src/client.ts`
- Create: `packages/hermes-client/test/client.test.ts`
- Modify: `apps/dashboard/package.json` — add `@agenticos/hermes-client: workspace:*`

- [ ] **Step 1: Scaffold the package directory**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
mkdir -p packages/hermes-client/src packages/hermes-client/test
```

Expected: directories created, no output.

- [ ] **Step 2: Write `packages/hermes-client/package.json`**

```json
{
  "name": "@agenticos/hermes-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./errors": "./src/errors.ts",
    "./sse": "./src/sse.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "eventsource-parser": "^3.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@agenticos/tsconfig": "workspace:*",
    "@types/node": "^25",
    "typescript": "^6",
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 3: Write `packages/hermes-client/tsconfig.json`**

```json
{
  "extends": "@agenticos/tsconfig/base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Write `packages/hermes-client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install dependencies**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm install
```

Expected: install completes; `packages/hermes-client/node_modules` populated; workspace symlinks resolve.

- [ ] **Step 6: Write `src/types.ts`** — copy verbatim from spec § 3.3

```ts
// ── Core run types ──────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type RunId     = string;
export type SkillId   = string;
export type CronId    = string;

export interface HermesRun {
  id:           RunId;
  skillId:      SkillId;
  status:       RunStatus;
  model:        string;
  startedAt:    string;
  completedAt?: string;
  durationMs?:  number;
  costUsd?:     number;
  inputTokens:  number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cancelReason?: string;
  tags:         string[];
}

export interface HermesEvent {
  runId:     RunId;
  seq:       number;
  ts:        string;
  kind:      "log" | "tool_call" | "tool_result" | "usage_delta" | "status_change";
  payload:   unknown;
}

export interface HermesCron {
  id:         CronId;
  skillId:    SkillId;
  schedule:   string;
  enabled:    boolean;
  lastRunAt?: string;
  lastRunId?: RunId;
  nextRunAt:  string;
}

export interface HermesHealth {
  status:     "ok" | "degraded" | "offline";
  version:    string;
  uptimeMs:   number;
  activeRuns: number;
}

export interface HermesTool {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Derived types for UI ────────────────────────────────────────────

export interface RunVitalSigns {
  runId:           RunId;
  state:           RunStatus;
  lastEventAt:     number;
  toolCallCount:   number;
  costUsd:         number;
  inputTokens:     number;
  outputTokens:    number;
  isStale:         boolean;
  throttledUntil?: string;
}

// ── Scheduler (cron.json on disk) ───────────────────────────────────

export interface ScheduleRecord {
  id:                    CronId;
  skillId:               SkillId;
  schedule:              string;
  enabled:               boolean;
  lastRunAt?:            string;
  lastRunId?:            RunId;
  nextRunAt?:            string;
  stalenessThresholdMs:  number;
}
```

- [ ] **Step 7: Write the errors test first (TDD)**

`packages/hermes-client/test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HermesOfflineError,
  HermesTimeoutError,
  HermesRunNotFoundError,
} from "../src/errors";

describe("HermesOfflineError", () => {
  it("carries 'offline' in message and is instanceof Error", () => {
    const err = new HermesOfflineError("/health");
    expect(err.message).toContain("offline");
    expect(err.message).toContain("/health");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HermesOfflineError");
  });
});

describe("HermesTimeoutError", () => {
  it("carries the timeout duration", () => {
    const err = new HermesTimeoutError("/runs", 5000);
    expect(err.message).toContain("5000");
    expect(err.name).toBe("HermesTimeoutError");
  });
});

describe("HermesRunNotFoundError", () => {
  it("carries the run id", () => {
    const err = new HermesRunNotFoundError("run_abc123");
    expect(err.message).toContain("run_abc123");
    expect(err.name).toBe("HermesRunNotFoundError");
  });
});
```

- [ ] **Step 8: Run errors test to verify it fails**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm --filter @agenticos/hermes-client test test/errors.test.ts
```

Expected: FAIL — `Cannot find module '../src/errors'`.

- [ ] **Step 9: Implement `src/errors.ts`**

```ts
export class HermesOfflineError extends Error {
  constructor(public readonly path: string) {
    super(`Hermes daemon is offline (attempting ${path})`);
    this.name = "HermesOfflineError";
  }
}

export class HermesTimeoutError extends Error {
  constructor(public readonly path: string, public readonly timeoutMs: number) {
    super(`Hermes request to ${path} timed out after ${timeoutMs}ms`);
    this.name = "HermesTimeoutError";
  }
}

export class HermesRunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Hermes run not found: ${runId}`);
    this.name = "HermesRunNotFoundError";
  }
}
```

- [ ] **Step 10: Run errors test to verify pass**

```bash
pnpm --filter @agenticos/hermes-client test test/errors.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 11: Write SSE parser test first (TDD)**

`packages/hermes-client/test/sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSseStream } from "../src/sse";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("parseSseStream", () => {
  it("parses a single data event", async () => {
    const stream = makeStream([
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"kind\":\"log\",\"payload\":\"hello\"}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runId: "r1", seq: 1, kind: "log" });
  });

  it("parses multiple events across chunk boundaries", async () => {
    const stream = makeStream([
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"2026\",\"kind\":\"log\",\"payload\":1}\n\n",
      "data: {\"runId\":\"r1\",\"seq\":2,\"ts\":\"2026\",\"kind",
      "\":\"log\",\"payload\":2}\n\nx",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("ignores comment lines and event-type fields", async () => {
    const stream = makeStream([
      ": keepalive\nevent: message\ndata: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"x\",\"kind\":\"log\",\"payload\":null}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
  });

  it("skips malformed JSON without crashing", async () => {
    const stream = makeStream([
      "data: not-json\n\n",
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"x\",\"kind\":\"log\",\"payload\":\"ok\"}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 12: Run SSE test to verify it fails**

```bash
pnpm --filter @agenticos/hermes-client test test/sse.test.ts
```

Expected: FAIL — `Cannot find module '../src/sse'`.

- [ ] **Step 13: Implement `src/sse.ts`**

```ts
import "server-only";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { HermesEvent } from "./types";

/**
 * Parse a ReadableStream of bytes as SSE and yield typed HermesEvents.
 * Malformed JSON payloads are silently dropped; the iterator continues.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<HermesEvent> {
  const queue: HermesEvent[] = [];
  const parser = createParser({
    onEvent(msg: EventSourceMessage) {
      if (!msg.data) return;
      try {
        const parsed = JSON.parse(msg.data) as HermesEvent;
        queue.push(parsed);
      } catch {
        // Skip malformed payloads
      }
    },
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (queue.length > 0) yield queue.shift()!;
  }
  while (queue.length > 0) yield queue.shift()!;
}
```

- [ ] **Step 14: Run SSE test to verify pass**

```bash
pnpm --filter @agenticos/hermes-client test test/sse.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 15: Write HermesClient test first (TDD)**

`packages/hermes-client/test/client.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { HermesClient } from "../src/client";
import { HermesOfflineError, HermesRunNotFoundError } from "../src/errors";

const BASE_URL = "http://127.0.0.1:7600";
const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(typeof input === "string" || input instanceof URL ? input.toString() : input.url, init);
    return handler(req);
  }) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("HermesClient.getHealth", () => {
  it("returns parsed health on 200", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.1.0", uptimeMs: 1000, activeRuns: 2 }), { status: 200 }),
    );
    const client = new HermesClient({ baseUrl: BASE_URL });
    const health = await client.getHealth();
    expect(health.status).toBe("ok");
    expect(health.activeRuns).toBe(2);
  });

  it("throws HermesOfflineError on network failure", async () => {
    mockFetch(async () => { throw new TypeError("fetch failed"); });
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.getHealth()).rejects.toBeInstanceOf(HermesOfflineError);
  });
});

describe("HermesClient.getRun", () => {
  it("returns the run on 200", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({
        id: "run_1", skillId: "curator", status: "running",
        model: "claude-sonnet-4-6", startedAt: "2026-01-01T00:00:00Z",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
      }), { status: 200 }),
    );
    const client = new HermesClient({ baseUrl: BASE_URL });
    const run = await client.getRun("run_1");
    expect(run?.id).toBe("run_1");
  });

  it("returns null on 404", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    expect(await client.getRun("missing")).toBeNull();
  });
});

describe("HermesClient.cancelRun", () => {
  it("throws HermesRunNotFoundError on 404", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.cancelRun("missing")).rejects.toBeInstanceOf(HermesRunNotFoundError);
  });

  it("succeeds on 200", async () => {
    mockFetch(async () => new Response("", { status: 200 }));
    const client = new HermesClient({ baseUrl: BASE_URL });
    await expect(client.cancelRun("run_1", "user")).resolves.toBeUndefined();
  });
});

describe("HermesClient.dispatchRun", () => {
  it("sends POST with skillId and prompts", async () => {
    let captured: Request | null = null;
    mockFetch(async (req) => {
      captured = req;
      return new Response(JSON.stringify({
        id: "run_new", skillId: "curator", status: "queued",
        model: "claude-sonnet-4-6", startedAt: "2026-01-01T00:00:00Z",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
      }), { status: 200 });
    });
    const client = new HermesClient({ baseUrl: BASE_URL });
    const run = await client.dispatchRun({
      skillId: "curator",
      systemPrompt: "you are X",
      userPrompt: "do Y",
    });
    expect(run.id).toBe("run_new");
    expect(captured!.method).toBe("POST");
  });
});
```

- [ ] **Step 16: Implement `src/client.ts`**

```ts
import "server-only";
import type {
  HermesCron,
  HermesEvent,
  HermesHealth,
  HermesRun,
  HermesTool,
  RunId,
  RunStatus,
  SkillId,
  CronId,
} from "./types";
import { HermesOfflineError, HermesRunNotFoundError, HermesTimeoutError } from "./errors";
import { parseSseStream } from "./sse";

interface HermesClientOptions {
  baseUrl:     string;
  timeoutMs?:  number;
}

export class HermesClient {
  private readonly baseUrl:   string;
  private readonly timeoutMs: number;

  constructor(opts: HermesClientOptions) {
    this.baseUrl   = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    parseJson = true,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new HermesTimeoutError(path, this.timeoutMs);
      }
      throw new HermesOfflineError(path);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Hermes ${path} returned ${res.status}`);
    if (!parseJson) return null;
    return (await res.json()) as T;
  }

  async getHealth(): Promise<HermesHealth> {
    const h = await this.request<HermesHealth>("/health");
    if (!h) throw new HermesOfflineError("/health");
    return h;
  }

  async listTools(): Promise<HermesTool[]> {
    return (await this.request<HermesTool[]>("/tools")) ?? [];
  }

  async dispatchRun(params: {
    skillId:      SkillId;
    model?:       string;
    budget?:      number;
    toolNames?:   string[];
    systemPrompt: string;
    userPrompt:   string;
  }): Promise<HermesRun> {
    const run = await this.request<HermesRun>("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!run) throw new Error("Hermes /runs returned null");
    return run;
  }

  async listRuns(opts?: {
    limit?:   number;
    status?:  RunStatus | RunStatus[];
    skillId?: SkillId;
    since?:   string;
  }): Promise<HermesRun[]> {
    const params = new URLSearchParams();
    if (opts?.limit)   params.set("limit",   String(opts.limit));
    if (opts?.skillId) params.set("skillId", opts.skillId);
    if (opts?.since)   params.set("since",   opts.since);
    if (opts?.status) {
      const v = Array.isArray(opts.status) ? opts.status.join(",") : opts.status;
      params.set("status", v);
    }
    const qs = params.toString();
    return (await this.request<HermesRun[]>(`/runs${qs ? `?${qs}` : ""}`)) ?? [];
  }

  async getRun(id: RunId): Promise<HermesRun | null> {
    return await this.request<HermesRun>(`/runs/${encodeURIComponent(id)}`);
  }

  async cancelRun(id: RunId, reason?: string): Promise<void> {
    const result = await this.request(
      `/runs/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      },
      false,
    );
    if (result === null) throw new HermesRunNotFoundError(id);
  }

  async *streamRunEvents(id: RunId): AsyncIterable<HermesEvent> {
    const res = await fetch(`${this.baseUrl}/runs/${encodeURIComponent(id)}/events`, {
      headers: { accept: "text/event-stream" },
    });
    if (res.status === 404) throw new HermesRunNotFoundError(id);
    if (!res.ok || !res.body) throw new Error(`Hermes SSE returned ${res.status}`);
    yield* parseSseStream(res.body);
  }

  async listCron(): Promise<HermesCron[]> {
    return (await this.request<HermesCron[]>("/cron")) ?? [];
  }

  async createCron(record: Omit<HermesCron, "nextRunAt">): Promise<HermesCron> {
    const c = await this.request<HermesCron>("/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!c) throw new Error("Hermes /cron returned null");
    return c;
  }

  async updateCron(id: CronId, patch: Partial<HermesCron>): Promise<HermesCron> {
    const c = await this.request<HermesCron>(`/cron/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!c) throw new Error(`Hermes /cron/${id} returned null`);
    return c;
  }

  async deleteCron(id: CronId): Promise<void> {
    await this.request(`/cron/${encodeURIComponent(id)}`, { method: "DELETE" }, false);
  }

  async triggerCron(id: CronId): Promise<HermesRun> {
    const run = await this.request<HermesRun>(`/cron/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
    if (!run) throw new HermesRunNotFoundError(id);
    return run;
  }
}
```

- [ ] **Step 17: Run client test to verify pass**

```bash
pnpm --filter @agenticos/hermes-client test test/client.test.ts
```

Expected: ~7 tests pass.

- [ ] **Step 18: Write `src/index.ts` (public API surface)**

```ts
export * from "./types";
export * from "./errors";
export { parseSseStream } from "./sse";
export { HermesClient } from "./client";
```

- [ ] **Step 19: Add workspace dep to dashboard**

Edit `apps/dashboard/package.json` — add to `dependencies`:

```json
"@agenticos/hermes-client": "workspace:*",
```

Also add transport deps (used in Wave 2):

```json
"eventsource-parser": "^3.0.0",
"node-cron": "^3.0.3",
"@modelcontextprotocol/sdk": "^1.0.0",
```

And dev type:

```json
"@types/node-cron": "^3.0.11",
```

Then:

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm install
```

Expected: lockfile updates; symlinks resolve.

- [ ] **Step 20: Run full hermes-client suite + typecheck**

```bash
pnpm --filter @agenticos/hermes-client typecheck
pnpm --filter @agenticos/hermes-client test
```

Expected: typecheck clean; ~14 tests pass.

- [ ] **Step 21: Commit Task 1**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git checkout -b feat/phase-3-task-1-hermes-client
git add packages/hermes-client apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(hermes-client): scaffold @agenticos/hermes-client package (Phase 3 T1)

Pure TypeScript workspace package wrapping the Hermes daemon HTTP+SSE API.

Modules:
- types.ts        HermesRun, HermesEvent, HermesCron, HermesHealth,
                  HermesTool, RunVitalSigns, ScheduleRecord
- errors.ts       HermesOfflineError, HermesTimeoutError,
                  HermesRunNotFoundError
- sse.ts          server-only SSE parser using eventsource-parser
- client.ts       HermesClient class (server-only); covers all 11
                  routes plus SSE streaming

~14 tests passing. Bundler resolution; bare specifiers."
git push -u origin feat/phase-3-task-1-hermes-client
```

---

## Task 2: `/api/hermes/*` Routes

**Wave 2 — runs in parallel with Task 3.** Both branch off T1's branch.

**Files:**
- Create: `apps/dashboard/lib/hermes/client-singleton.ts`
- Create: `apps/dashboard/app/api/hermes/health/route.ts`
- Create: `apps/dashboard/app/api/hermes/tools/route.ts`
- Create: `apps/dashboard/app/api/hermes/runs/route.ts`
- Create: `apps/dashboard/app/api/hermes/runs/[id]/route.ts`
- Create: `apps/dashboard/app/api/hermes/runs/[id]/cancel/route.ts`
- Create: `apps/dashboard/app/api/hermes/runs/[id]/events/route.ts`
- Create: `apps/dashboard/app/api/hermes/cron/route.ts`
- Create: `apps/dashboard/app/api/hermes/cron/[id]/route.ts`
- Create: `apps/dashboard/app/api/hermes/cron/[id]/run/route.ts`
- Create: `apps/dashboard/app/api/hermes/__tests__/integration.test.ts`
- Modify: `apps/dashboard/lib/config/schema.ts` — add `hermesUrl` field

- [ ] **Step 1: Branch off T1**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout feat/phase-3-task-1-hermes-client
git checkout -b feat/phase-3-task-2-hermes-routes
```

- [ ] **Step 2: Extend config schema for `hermesUrl`**

`apps/dashboard/lib/config/schema.ts` — add to `AgenticOSConfigSchema`:

```ts
hermesUrl: z.string().url().default("http://127.0.0.1:7600"),
```

And to `DEFAULT_CONFIG`:

```ts
hermesUrl: "http://127.0.0.1:7600",
```

- [ ] **Step 3: Write the client singleton**

`apps/dashboard/lib/hermes/client-singleton.ts`:

```ts
import "server-only";
import { HermesClient } from "@agenticos/hermes-client";
import { readConfig } from "@/lib/config/config-io";

let cached: HermesClient | null = null;

export async function getHermesClient(): Promise<HermesClient> {
  if (cached) return cached;
  const cfg = await readConfig();
  cached = new HermesClient({ baseUrl: cfg.hermesUrl });
  return cached;
}

// For tests only.
export function __resetHermesClientForTests(): void {
  cached = null;
}
```

- [ ] **Step 4: Implement `/api/hermes/health/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

let cached: { health: unknown; sampledAt: number } | null = null;
const TTL_MS = 5000;

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.sampledAt < TTL_MS) {
    return NextResponse.json(cached.health);
  }
  try {
    const client = await getHermesClient();
    const health = await client.getHealth();
    cached = { health, sampledAt: now };
    return NextResponse.json(health);
  } catch {
    const offline = { status: "offline", version: "unknown", uptimeMs: 0, activeRuns: 0 };
    cached = { health: offline, sampledAt: now };
    return NextResponse.json(offline);
  }
}
```

- [ ] **Step 5: Implement `/api/hermes/tools/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET() {
  try {
    const client = await getHermesClient();
    const tools = await client.listTools();
    return NextResponse.json({ tools });
  } catch (err) {
    console.error("/api/hermes/tools failed:", err);
    return NextResponse.json({ error: "Failed to list tools" }, { status: 503 });
  }
}
```

- [ ] **Step 6: Implement `/api/hermes/runs/route.ts` (GET + POST)**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getHermesClient } from "@/lib/hermes/client-singleton";

const DispatchSchema = z.object({
  skillId:      z.string().min(1).max(128),
  model:        z.string().optional(),
  budget:       z.number().positive().max(100).optional(),
  toolNames:    z.array(z.string()).max(50).optional(),
  systemPrompt: z.string().min(1).max(100_000),
  userPrompt:   z.string().min(1).max(100_000),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const client = await getHermesClient();
    const runs = await client.listRuns({
      limit:   url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      skillId: url.searchParams.get("skillId") ?? undefined,
      since:   url.searchParams.get("since") ?? undefined,
      status:  url.searchParams.get("status")?.split(",") as any,
    });
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("/api/hermes/runs GET failed:", err);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? "0") > 64 * 1024) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const client = await getHermesClient();
    const run = await client.dispatchRun(parsed.data);
    return NextResponse.json(run);
  } catch (err) {
    console.error("/api/hermes/runs POST failed:", err);
    return NextResponse.json({ error: "Failed to dispatch run" }, { status: 503 });
  }
}
```

- [ ] **Step 7: Implement single-run + cancel routes**

`apps/dashboard/app/api/hermes/runs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const client = await getHermesClient();
    const run = await client.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    console.error("/api/hermes/runs/[id] failed:", err);
    return NextResponse.json({ error: "Failed to read run" }, { status: 503 });
  }
}
```

`apps/dashboard/app/api/hermes/runs/[id]/cancel/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getHermesClient } from "@/lib/hermes/client-singleton";
import { HermesRunNotFoundError } from "@agenticos/hermes-client";

const CancelSchema = z.object({ reason: z.string().max(64).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown = {};
  try { body = (await req.text()) ? await req.json() : {}; } catch { /* empty body ok */ }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const client = await getHermesClient();
    await client.cancelRun(id, parsed.data.reason);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HermesRunNotFoundError) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    console.error("/api/hermes/runs/[id]/cancel failed:", err);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 503 });
  }
}
```

- [ ] **Step 8: Implement SSE proxy route**

`apps/dashboard/app/api/hermes/runs/[id]/events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const client = await getHermesClient();
    const iter = client.streamRunEvents(id);
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const evt of iter) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "error", payload: String(err) })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "content-type":   "text/event-stream",
        "cache-control":  "no-cache, no-transform",
        "connection":     "keep-alive",
      },
    });
  } catch (err) {
    console.error("/api/hermes/runs/[id]/events failed:", err);
    return NextResponse.json({ error: "Failed to open stream" }, { status: 503 });
  }
}
```

- [ ] **Step 9: Implement cron route stubs (T3 wires the real scheduler)**

`apps/dashboard/app/api/hermes/cron/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSchedules, writeSchedule } from "@/lib/scheduler/cron-io";

const CreateSchema = z.object({
  id:                    z.string().min(1).max(64),
  skillId:               z.string().min(1).max(64),
  schedule:              z.string().min(1).max(128),
  enabled:               z.boolean().default(true),
  stalenessThresholdMs:  z.number().int().positive().default(300_000),
});

export async function GET() {
  try {
    const schedules = await readSchedules();
    return NextResponse.json({ schedules });
  } catch (err) {
    console.error("/api/hermes/cron GET failed:", err);
    return NextResponse.json({ error: "Failed to read schedules" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const record = await writeSchedule(parsed.data);
    return NextResponse.json(record);
  } catch (err) {
    console.error("/api/hermes/cron POST failed:", err);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
```

`apps/dashboard/app/api/hermes/cron/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSchedule, updateSchedule } from "@/lib/scheduler/cron-io";

const PatchSchema = z.object({
  schedule:              z.string().min(1).max(128).optional(),
  enabled:               z.boolean().optional(),
  stalenessThresholdMs:  z.number().int().positive().optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const record = await updateSchedule(id, parsed.data);
    if (!record) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    console.error("/api/hermes/cron/[id] PUT failed:", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteSchedule(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("/api/hermes/cron/[id] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
```

`apps/dashboard/app/api/hermes/cron/[id]/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { triggerSchedule } from "@/lib/scheduler/scheduler";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const run = await triggerSchedule(id);
    return NextResponse.json(run);
  } catch (err) {
    if ((err as Error).message?.includes("not found")) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    console.error("/api/hermes/cron/[id]/run failed:", err);
    return NextResponse.json({ error: "Failed to trigger schedule" }, { status: 503 });
  }
}
```

- [ ] **Step 10: Write integration test using mkdtemp + a fake Hermes daemon**

`apps/dashboard/app/api/hermes/__tests__/integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetHermesClientForTests } from "@/lib/hermes/client-singleton";

vi.mock("server-only", () => ({}));

let fakeHermesUrl: string;
let fakeHermesHandler: (req: Request) => Response | Promise<Response>;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  fakeHermesUrl = "http://127.0.0.1:7600";
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.startsWith(fakeHermesUrl)) {
      const path = url.slice(fakeHermesUrl.length);
      const req = new Request(`http://test${path}`, init);
      return fakeHermesHandler(req);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  vi.doMock("@/lib/config/config-io", () => ({
    readConfig: async () => ({
      hermesUrl:     fakeHermesUrl,
      vaultPath:     "/tmp",
      projectRoots:  [],
      modelDefaults: { haiku: "x", sonnet: "y", opus: "z" },
      connectors:    [],
    }),
  }));
  __resetHermesClientForTests();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.resetModules();
});

describe("/api/hermes/health", () => {
  it("returns health when daemon is up", async () => {
    fakeHermesHandler = async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.1.0", uptimeMs: 100, activeRuns: 0 }), { status: 200 });
    const { GET } = await import("@/app/api/hermes/health/route");
    const res = await GET();
    expect((await res.json()).status).toBe("ok");
  });

  it("returns offline when daemon is unreachable", async () => {
    fakeHermesHandler = async () => { throw new TypeError("fetch failed"); };
    const { GET } = await import("@/app/api/hermes/health/route");
    const res = await GET();
    expect((await res.json()).status).toBe("offline");
  });
});

describe("/api/hermes/runs", () => {
  it("POST validates body with Zod (400 on missing fields)", async () => {
    const { POST } = await import("@/app/api/hermes/runs/route");
    const res = await POST(new Request("http://localhost/api/hermes/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId: "x" }),
    }));
    expect(res.status).toBe(400);
  });

  it("POST dispatches to Hermes on valid body", async () => {
    fakeHermesHandler = async (req) => {
      if (req.url.endsWith("/runs") && req.method === "POST") {
        return new Response(JSON.stringify({
          id: "run_1", skillId: "curator", status: "queued", model: "x",
          startedAt: "2026", inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const { POST } = await import("@/app/api/hermes/runs/route");
    const res = await POST(new Request("http://localhost/api/hermes/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId: "curator", systemPrompt: "x", userPrompt: "y" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("run_1");
  });
});
```

- [ ] **Step 11: Run gates + commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all pass; new tests included.

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add apps/dashboard/app/api/hermes apps/dashboard/lib/hermes apps/dashboard/lib/config/schema.ts
git commit -m "feat(api): /api/hermes/* routes (Phase 3 T2)

11 routes wrapping the HermesClient singleton:
- /health, /tools                        — daemon introspection
- /runs (GET, POST)                      — list + dispatch
- /runs/[id], /cancel, /events           — single run + SSE proxy
- /cron (GET, POST), /cron/[id] (PUT, DELETE), /cron/[id]/run
                                          — schedule CRUD + manual trigger

All inherit Phase 1.5 proxy.ts gate + 64 KiB body limit + Zod validation.
Health route has 5s server-side TTL cache; falls back to offline-shape
JSON when the daemon is unreachable so the UI's HermesStatusChip can
distinguish ok / degraded / offline."
git push -u origin feat/phase-3-task-2-hermes-routes
```

---

## Task 3: Scheduler (cron.json + node-cron + sanity-cancel)

**Wave 2 — runs in parallel with Task 2.** Branches off T1's branch. Disjoint file scope from T2 (T2 owns `app/api/hermes/`, T3 owns `lib/scheduler/`).

**Files:**
- Create: `apps/dashboard/lib/scheduler/cron-io.ts`
- Create: `apps/dashboard/lib/scheduler/cron-io.test.ts`
- Create: `apps/dashboard/lib/scheduler/scheduler.ts`
- Create: `apps/dashboard/lib/scheduler/scheduler.test.ts`
- Create: `apps/dashboard/lib/scheduler/types.ts`
- Create: `apps/dashboard/lib/scheduler/instrumentation.ts`
- Modify: `apps/dashboard/instrumentation.ts` (new top-level — boots scheduler on app start)

- [ ] **Step 1: Branch off T1**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout feat/phase-3-task-1-hermes-client
git checkout -b feat/phase-3-task-3-scheduler
```

- [ ] **Step 2: Write `lib/scheduler/types.ts`**

```ts
import type { ScheduleRecord } from "@agenticos/hermes-client";
export type { ScheduleRecord };

export interface CronFile {
  version: 1;
  schedules: ScheduleRecord[];
}
```

- [ ] **Step 3: Write cron-io test first (TDD)**

`apps/dashboard/lib/scheduler/cron-io.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), "cron-io-"));
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return { ...actual, homedir: () => homeDir };
  });
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("readSchedules", () => {
  it("returns empty array when file missing", async () => {
    const { readSchedules } = await import("./cron-io");
    expect(await readSchedules()).toEqual([]);
  });

  it("returns parsed schedules when file exists", async () => {
    await mkdir(path.join(homeDir, ".agenticos"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".agenticos", "cron.json"),
      JSON.stringify({ version: 1, schedules: [
        { id: "c1", skillId: "curator", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 },
      ]}),
    );
    const { readSchedules } = await import("./cron-io");
    const s = await readSchedules();
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe("c1");
  });
});

describe("writeSchedule", () => {
  it("creates the directory and writes the file atomically with 0600 perms", async () => {
    const { writeSchedule } = await import("./cron-io");
    await writeSchedule({
      id: "c1", skillId: "curator", schedule: "0 3 * * *",
      enabled: true, stalenessThresholdMs: 300_000,
    });
    const filePath = path.join(homeDir, ".agenticos", "cron.json");
    const s = await stat(filePath);
    // chmod 0600 — owner read/write only
    expect((s.mode & 0o777)).toBe(0o600);
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.schedules).toHaveLength(1);
  });

  it("updates existing schedule by id", async () => {
    const { writeSchedule } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "curator", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 });
    await writeSchedule({ id: "c1", skillId: "curator", schedule: "0 4 * * *", enabled: false, stalenessThresholdMs: 300_000 });
    const { readSchedules } = await import("./cron-io");
    const s = await readSchedules();
    expect(s).toHaveLength(1);
    expect(s[0].schedule).toBe("0 4 * * *");
    expect(s[0].enabled).toBe(false);
  });
});

describe("deleteSchedule", () => {
  it("removes the schedule by id", async () => {
    const { writeSchedule, deleteSchedule, readSchedules } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "x", schedule: "* * * * *", enabled: true, stalenessThresholdMs: 30_000 });
    await deleteSchedule("c1");
    expect(await readSchedules()).toEqual([]);
  });
});

describe("updateSchedule", () => {
  it("patches an existing record", async () => {
    const { writeSchedule, updateSchedule } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "x", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 });
    const updated = await updateSchedule("c1", { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(updated?.schedule).toBe("0 3 * * *");
  });

  it("returns null for non-existent id", async () => {
    const { updateSchedule } = await import("./cron-io");
    expect(await updateSchedule("missing", { enabled: false })).toBeNull();
  });
});
```

- [ ] **Step 4: Implement `lib/scheduler/cron-io.ts`**

```ts
import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CronFile, ScheduleRecord } from "./types";

function configDir(): string { return path.join(os.homedir(), ".agenticos"); }
function configFile(): string { return path.join(configDir(), "cron.json"); }

async function readFile(): Promise<CronFile> {
  try {
    const raw = await fs.readFile(configFile(), "utf-8");
    const parsed = JSON.parse(raw) as CronFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) {
      return { version: 1, schedules: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, schedules: [] };
    }
    throw err;
  }
}

async function writeFile(data: CronFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  const tmp = configFile() + ".tmp";
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmp, configFile());
  await fs.chmod(configFile(), 0o600);
}

export async function readSchedules(): Promise<ScheduleRecord[]> {
  return (await readFile()).schedules;
}

export async function writeSchedule(record: ScheduleRecord): Promise<ScheduleRecord> {
  const data = await readFile();
  const idx = data.schedules.findIndex((s) => s.id === record.id);
  if (idx >= 0) data.schedules[idx] = { ...data.schedules[idx], ...record };
  else data.schedules.push(record);
  await writeFile(data);
  return record;
}

export async function updateSchedule(
  id: string,
  patch: Partial<ScheduleRecord>,
): Promise<ScheduleRecord | null> {
  const data = await readFile();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  data.schedules[idx] = { ...data.schedules[idx], ...patch };
  await writeFile(data);
  return data.schedules[idx];
}

export async function deleteSchedule(id: string): Promise<void> {
  const data = await readFile();
  const next = data.schedules.filter((s) => s.id !== id);
  if (next.length === data.schedules.length) return;
  await writeFile({ ...data, schedules: next });
}
```

- [ ] **Step 5: Run cron-io tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test lib/scheduler/cron-io.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 6: Write scheduler test (covers sanity-cancel logic)**

`apps/dashboard/lib/scheduler/scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let listRunsCalls = 0;
let cancelRunCalls: Array<{ id: string; reason?: string }> = [];

beforeEach(() => {
  listRunsCalls = 0;
  cancelRunCalls = [];
  vi.doMock("@/lib/hermes/client-singleton", () => ({
    getHermesClient: async () => ({
      listRuns: vi.fn(async () => {
        listRunsCalls++;
        return [];
      }),
      cancelRun: vi.fn(async (id: string, reason?: string) => {
        cancelRunCalls.push({ id, reason });
      }),
      dispatchRun: vi.fn(async () => ({
        id: "run_new", skillId: "curator", status: "queued", model: "x",
        startedAt: "2026", inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
      })),
    }),
  }));
});

afterEach(() => {
  vi.resetModules();
});

describe("sanityCancelStaleRuns", () => {
  it("does nothing when no runs are active", async () => {
    const { sanityCancelStaleRuns } = await import("./scheduler");
    await sanityCancelStaleRuns("curator");
    expect(cancelRunCalls).toHaveLength(0);
  });

  it("cancels runs silent > 30 minutes", async () => {
    const oldTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    vi.doMock("@/lib/hermes/client-singleton", () => ({
      getHermesClient: async () => ({
        listRuns: vi.fn(async () => [
          { id: "run_stale", skillId: "curator", status: "running",
            startedAt: oldTs, model: "x", inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0, tags: [] },
        ]),
        cancelRun: vi.fn(async (id: string, reason?: string) => {
          cancelRunCalls.push({ id, reason });
        }),
      }),
    }));
    const { sanityCancelStaleRuns } = await import("./scheduler");
    await sanityCancelStaleRuns("curator");
    expect(cancelRunCalls).toEqual([{ id: "run_stale", reason: "stale-sanity" }]);
  });
});
```

- [ ] **Step 7: Implement `lib/scheduler/scheduler.ts`**

```ts
import "server-only";
import cron from "node-cron";
import { getHermesClient } from "@/lib/hermes/client-singleton";
import { readSchedules, updateSchedule } from "./cron-io";
import type { HermesRun, ScheduleRecord } from "@agenticos/hermes-client";

const SANITY_CANCEL_THRESHOLD_MS = 30 * 60 * 1000;
const registered = new Map<string, cron.ScheduledTask>();

export async function bootScheduler(): Promise<void> {
  const schedules = await readSchedules();
  for (const s of schedules) if (s.enabled) registerSchedule(s);
}

export function registerSchedule(record: ScheduleRecord): void {
  if (registered.has(record.id)) {
    registered.get(record.id)!.stop();
    registered.delete(record.id);
  }
  const task = cron.schedule(record.schedule, () => {
    void fireSchedule(record.id).catch((err) => {
      console.error(`Scheduler fire ${record.id} failed:`, err);
    });
  });
  registered.set(record.id, task);
}

export function unregisterSchedule(id: string): void {
  registered.get(id)?.stop();
  registered.delete(id);
}

export async function sanityCancelStaleRuns(skillId: string): Promise<void> {
  const client = await getHermesClient();
  const runs = await client.listRuns({ skillId, status: "running" });
  const cutoff = Date.now() - SANITY_CANCEL_THRESHOLD_MS;
  for (const run of runs) {
    const startedMs = new Date(run.startedAt).getTime();
    if (startedMs < cutoff) {
      await client.cancelRun(run.id, "stale-sanity");
    }
  }
}

async function fireSchedule(id: string): Promise<HermesRun | null> {
  const schedules = await readSchedules();
  const record = schedules.find((s) => s.id === id);
  if (!record || !record.enabled) return null;
  await sanityCancelStaleRuns(record.skillId);
  const client = await getHermesClient();
  // Skill metadata is hardcoded in Phase 3 — see lib/skills/curator.ts (Task 5)
  const { resolveSkill } = await import("@/lib/skills");
  const skill = await resolveSkill(record.skillId);
  const run = await client.dispatchRun({
    skillId:      skill.id,
    model:        skill.model,
    budget:       skill.budget,
    toolNames:    skill.toolNames,
    systemPrompt: skill.systemPrompt,
    userPrompt:   skill.userPrompt({ todayIso: new Date().toISOString().slice(0, 10), lastRunIso: record.lastRunAt ?? "never", budget: skill.budget ?? 1.0 }),
  });
  await updateSchedule(id, { lastRunAt: new Date().toISOString(), lastRunId: run.id });
  return run;
}

export async function triggerSchedule(id: string): Promise<HermesRun> {
  const run = await fireSchedule(id);
  if (!run) throw new Error(`Schedule not found or disabled: ${id}`);
  return run;
}
```

- [ ] **Step 8: Add `instrumentation.ts` to boot the scheduler on Next start**

`apps/dashboard/instrumentation.ts` (new top-level file):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootScheduler } = await import("@/lib/scheduler/scheduler");
    await bootScheduler();
  }
}
```

Next.js automatically calls `register()` on server boot when this file exists.

- [ ] **Step 9: Run scheduler tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test lib/scheduler/
```

Expected: ~8 tests pass.

- [ ] **Step 10: Commit Task 3**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add apps/dashboard/lib/scheduler apps/dashboard/instrumentation.ts
git commit -m "feat(scheduler): cron.json IO + node-cron loop + sanity-cancel (Phase 3 T3)

AgenticOS owns schedule definitions in ~/.agenticos/cron.json (atomic
tmp+rename+chmod 0600, version: 1). The scheduler boots from
instrumentation.ts when Next starts the server runtime, registers
node-cron tasks for each enabled record, and on each fire:

1. Calls sanityCancelStaleRuns() — cancels any running run of the same
   skillId that has been silent > 30 minutes (prevents duplicate
   accumulation across app restarts).
2. Resolves the skill from lib/skills/ (hardcoded; Curator only in Phase 3).
3. Dispatches via HermesClient.dispatchRun().
4. Writes back lastRunAt + lastRunId atomically.

Disjoint from T2 — no overlap with /api/hermes/ routes. Tests: 6 cron-io
+ 2 scheduler = 8."
git push -u origin feat/phase-3-task-3-scheduler
```

---

## Task 4: Observability Migration + Staleness + Rate Limits

**Wave 3 — solo.** Branches off the integration of T1+T2+T3 (or directly off T2 after T3 lands). Single largest task — combines three concerns the spec groups together (§ 5.2, § 5.3, § 6).

**Files:**
- Create: `apps/dashboard/lib/limits/types.ts`
- Create: `apps/dashboard/lib/limits/writer.ts`
- Create: `apps/dashboard/lib/limits/reader.ts`
- Create: `apps/dashboard/lib/limits/projection.ts`
- Create: `apps/dashboard/lib/limits/__tests__/limits.test.ts`
- Create: `apps/dashboard/app/api/limits/route.ts`
- Create: `apps/dashboard/lib/hooks/use-run-feed.ts`
- Create: `apps/dashboard/lib/hooks/use-run-events.ts`
- Create: `apps/dashboard/lib/hooks/use-run-vital-signs.ts`
- Create: `apps/dashboard/lib/hooks/use-hermes-cron.ts`
- Create: `apps/dashboard/lib/hooks/use-hermes-health.ts`
- Create: `apps/dashboard/lib/hooks/use-limits.ts`
- Create: `apps/dashboard/components/observability/HermesStatusChip.tsx`
- Create: `apps/dashboard/components/observability/RateLimitsPanel.tsx`
- Create: `apps/dashboard/components/observability/SparklineSvg.tsx`
- Modify: `apps/dashboard/components/layout/Header.tsx` — mount `<HermesStatusChip />`
- Modify: `apps/dashboard/components/observability/RunFeed.tsx`
- Modify: `apps/dashboard/components/observability/RunCard.tsx`
- Modify: `apps/dashboard/components/observability/LiveStrip.tsx`
- Modify: `apps/dashboard/components/observability/SchedulesSidebar.tsx`
- Modify: `apps/dashboard/components/observability/RunDetailDrawer.tsx`
- Modify: `apps/dashboard/components/observability/MetricsSidebar.tsx`
- Delete: `apps/dashboard/lib/fixtures/runs.ts`

- [ ] **Step 1: Branch off T2 (T2 and T3 will be merged into integration first)**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout main && git pull --ff-only
# After T2 + T3 merge to main, branch off main
git checkout -b feat/phase-3-task-4-observability
```

- [ ] **Step 2: Write `lib/limits/types.ts`**

```ts
import "server-only";

export interface RateLimitSample {
  ts:                  string;
  runId:               string;
  limitRequests:       number;
  remainingRequests:   number;
  resetRequestsAt:     string;
  limitTokens:         number;
  remainingTokens:     number;
  resetTokensAt:       string;
  retryAfter?:         number;
}

export interface RateLimitsResponse {
  current: {
    requests:  { limit: number; remaining: number; resetAt: string };
    tokens:    { limit: number; remaining: number; resetAt: string };
    sampledAt: string;
  } | null;
  history: RateLimitSample[];
}

export interface ProjectionResult {
  fits:    boolean;
  reason:  string;
}
```

- [ ] **Step 3: Write the limits tests first (TDD)**

`apps/dashboard/lib/limits/__tests__/limits.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), "limits-"));
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return { ...actual, homedir: () => homeDir };
  });
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("appendRateLimitSample", () => {
  it("creates the file with one line per sample (JSONL)", async () => {
    const { appendRateLimitSample } = await import("../writer");
    await appendRateLimitSample({
      ts: "2026-05-19T00:00:00Z", runId: "r1",
      limitRequests: 5000, remainingRequests: 4500, resetRequestsAt: "2026-05-19T01:00:00Z",
      limitTokens: 100_000, remainingTokens: 80_000, resetTokensAt: "2026-05-19T01:00:00Z",
    });
    const raw = await readFile(path.join(homeDir, ".agenticos", "rate-limits.jsonl"), "utf-8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(raw.split("\n")[0]).runId).toBe("r1");
  });
});

describe("readRateLimits", () => {
  it("returns empty when file missing", async () => {
    const { readRateLimits } = await import("../reader");
    expect(await readRateLimits()).toEqual([]);
  });

  it("filters out samples older than 30 days", async () => {
    const { appendRateLimitSample } = await import("../writer");
    const { readRateLimits } = await import("../reader");
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    await appendRateLimitSample({
      ts: old, runId: "old", limitRequests: 1, remainingRequests: 1,
      resetRequestsAt: old, limitTokens: 1, remainingTokens: 1, resetTokensAt: old,
    });
    await appendRateLimitSample({
      ts: recent, runId: "new", limitRequests: 1, remainingRequests: 1,
      resetRequestsAt: recent, limitTokens: 1, remainingTokens: 1, resetTokensAt: recent,
    });
    const all = await readRateLimits();
    expect(all.map((s) => s.runId)).toEqual(["new"]);
  });
});

describe("willNextRunFit", () => {
  it("returns fits=true when remaining headroom is comfortable", async () => {
    const { willNextRunFit } = await import("../projection");
    const result = willNextRunFit({
      requests: { limit: 5000, remaining: 4500, resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      tokens:   { limit: 100_000, remaining: 90_000, resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    expect(result.fits).toBe(true);
  });

  it("returns fits=false when tokens remaining < 5%", async () => {
    const { willNextRunFit } = await import("../projection");
    const result = willNextRunFit({
      requests: { limit: 5000, remaining: 4500, resetAt: "2099-01-01" },
      tokens:   { limit: 100_000, remaining: 2000, resetAt: "2099-01-01" },
    });
    expect(result.fits).toBe(false);
    expect(result.reason).toContain("tokens");
  });
});
```

- [ ] **Step 4: Implement `lib/limits/writer.ts`**

```ts
import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RateLimitSample } from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function jsonlPath(): string {
  return path.join(os.homedir(), ".agenticos", "rate-limits.jsonl");
}

export async function appendRateLimitSample(sample: RateLimitSample): Promise<void> {
  const dir = path.dirname(jsonlPath());
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(sample) + "\n";
  // Append; prune happens lazily on next read or on every 1000th write.
  await fs.appendFile(jsonlPath(), line, { encoding: "utf-8", mode: 0o600 });
}

/** Lazy prune: rewrite the file dropping samples older than 30 days. */
export async function pruneRateLimitsIfNeeded(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath(), "utf-8");
  } catch { return; }
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const lines = raw.split("\n").filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    try {
      const sample = JSON.parse(line) as RateLimitSample;
      if (new Date(sample.ts).getTime() >= cutoff) kept.push(line);
    } catch { /* drop malformed */ }
  }
  if (kept.length === lines.length) return;
  const tmp = jsonlPath() + ".tmp";
  await fs.writeFile(tmp, kept.join("\n") + "\n", { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmp, jsonlPath());
  await fs.chmod(jsonlPath(), 0o600);
}
```

- [ ] **Step 5: Implement `lib/limits/reader.ts`**

```ts
import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RateLimitSample } from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function jsonlPath(): string {
  return path.join(os.homedir(), ".agenticos", "rate-limits.jsonl");
}

export async function readRateLimits(since?: string): Promise<RateLimitSample[]> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const cutoff = since ? new Date(since).getTime() : Date.now() - THIRTY_DAYS_MS;
  const out: RateLimitSample[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const sample = JSON.parse(line) as RateLimitSample;
      if (new Date(sample.ts).getTime() >= cutoff) out.push(sample);
    } catch { /* drop malformed */ }
  }
  return out;
}
```

- [ ] **Step 6: Implement `lib/limits/projection.ts`**

```ts
import "server-only";
import type { ProjectionResult } from "./types";

export function willNextRunFit(state: {
  requests: { limit: number; remaining: number; resetAt: string };
  tokens:   { limit: number; remaining: number; resetAt: string };
}): ProjectionResult {
  const tokenFraction = state.tokens.remaining / state.tokens.limit;
  if (tokenFraction < 0.05) {
    return { fits: false, reason: `tokens at ${(tokenFraction * 100).toFixed(0)}%` };
  }
  const reqFraction = state.requests.remaining / state.requests.limit;
  if (reqFraction < 0.05) {
    return { fits: false, reason: `requests at ${(reqFraction * 100).toFixed(0)}%` };
  }
  return { fits: true, reason: "headroom available" };
}
```

- [ ] **Step 7: Implement `/api/limits/route.ts`**

```ts
import { NextResponse } from "next/server";
import { readRateLimits } from "@/lib/limits/reader";
import type { RateLimitsResponse } from "@/lib/limits/types";

export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const history = await readRateLimits(since);
    const latest = history[history.length - 1];
    const response: RateLimitsResponse = {
      current: latest
        ? {
            requests:  { limit: latest.limitRequests, remaining: latest.remainingRequests, resetAt: latest.resetRequestsAt },
            tokens:    { limit: latest.limitTokens,   remaining: latest.remainingTokens,   resetAt: latest.resetTokensAt },
            sampledAt: latest.ts,
          }
        : null,
      history,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/limits failed:", err);
    return NextResponse.json({ error: "Failed to read rate limits" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run limits tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test lib/limits/
```

Expected: 5 tests pass.

- [ ] **Step 9: Write the data hooks**

`apps/dashboard/lib/hooks/use-hermes-health.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { HermesHealth } from "@agenticos/hermes-client";

export function useHermesHealth() {
  return useQuery({
    queryKey:  ["hermes", "health"],
    refetchInterval: 5000,
    queryFn:   async (): Promise<HermesHealth> => {
      const res = await fetch("/api/hermes/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
  });
}
```

`apps/dashboard/lib/hooks/use-run-feed.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { HermesRun, RunStatus } from "@agenticos/hermes-client";

export function useRunFeed(opts?: { status?: RunStatus | RunStatus[]; limit?: number }) {
  return useQuery({
    queryKey: ["hermes", "runs", opts],
    staleTime: 10_000,
    gcTime:    30_000,
    queryFn: async (): Promise<HermesRun[]> => {
      const params = new URLSearchParams();
      if (opts?.limit)  params.set("limit", String(opts.limit));
      if (opts?.status) {
        params.set("status", Array.isArray(opts.status) ? opts.status.join(",") : opts.status);
      }
      const res = await fetch(`/api/hermes/runs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch runs");
      const json = await res.json();
      return json.runs;
    },
  });
}
```

`apps/dashboard/lib/hooks/use-run-events.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import type { HermesEvent } from "@agenticos/hermes-client";

export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<HermesEvent[]>([]);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    const es = new EventSource(`/api/hermes/runs/${encodeURIComponent(runId)}/events`);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as HermesEvent;
        setEvents((prev) => [...prev, evt]);
      } catch { /* drop malformed */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  return events;
}
```

`apps/dashboard/lib/hooks/use-run-vital-signs.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import type { HermesRun, RunVitalSigns } from "@agenticos/hermes-client";
import { useRunEvents } from "./use-run-events";

const DEFAULT_STALE_MS = 30_000;
const CURATOR_STALE_MS = 300_000;

export function useRunVitalSigns(run: HermesRun | null): RunVitalSigns | null {
  const events = useRunEvents(run?.id ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [run]);

  if (!run) return null;

  const threshold = run.skillId === "curator" ? CURATOR_STALE_MS : DEFAULT_STALE_MS;
  const lastEventAt = events.length > 0
    ? new Date(events[events.length - 1].ts).getTime()
    : new Date(run.startedAt).getTime();

  let throttledUntil: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "tool_result") {
      const payload = e.payload as { retryAfter?: number } | null;
      if (payload?.retryAfter) {
        throttledUntil = new Date(lastEventAt + payload.retryAfter * 1000).toISOString();
        break;
      }
    }
  }

  return {
    runId:           run.id,
    state:           run.status,
    lastEventAt,
    toolCallCount:   events.filter((e) => e.kind === "tool_call").length,
    costUsd:         run.costUsd ?? 0,
    inputTokens:     run.inputTokens,
    outputTokens:    run.outputTokens,
    isStale:         run.status === "running" && now - lastEventAt > threshold,
    throttledUntil,
  };
}
```

`apps/dashboard/lib/hooks/use-hermes-cron.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { ScheduleRecord } from "@agenticos/hermes-client";

export function useHermesCron() {
  return useQuery({
    queryKey:  ["hermes", "cron"],
    staleTime: 30_000,
    queryFn: async (): Promise<ScheduleRecord[]> => {
      const res = await fetch("/api/hermes/cron");
      if (!res.ok) throw new Error("Failed to fetch cron");
      const json = await res.json();
      return json.schedules;
    },
  });
}
```

`apps/dashboard/lib/hooks/use-limits.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { RateLimitsResponse } from "@/lib/limits/types";

export function useLimits() {
  return useQuery({
    queryKey:  ["limits"],
    staleTime: 60_000,
    queryFn: async (): Promise<RateLimitsResponse> => {
      const res = await fetch("/api/limits");
      if (!res.ok) throw new Error("Failed to fetch limits");
      return res.json();
    },
  });
}
```

- [ ] **Step 10: Write `HermesStatusChip.tsx`**

`apps/dashboard/components/observability/HermesStatusChip.tsx`:

```tsx
"use client";
import { useHermesHealth } from "@/lib/hooks/use-hermes-health";

export function HermesStatusChip() {
  const { data } = useHermesHealth();
  const online = data?.status === "ok" || data?.status === "degraded";
  const dotColor = online ? "var(--lane-hermes, #4db6ac)" : "var(--text-muted, #6b6157)";
  const label = online
    ? `Hermes v${data!.version} · ${data!.activeRuns} active`
    : "Hermes offline — run `hermes serve` to start";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-sm"
      title={label}
      style={{ color: "var(--text-muted)" }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: dotColor }}
        aria-hidden
      />
      HERMES
    </span>
  );
}
```

- [ ] **Step 11: Mount the chip in `Header.tsx`**

Modify `apps/dashboard/components/layout/Header.tsx` — add `<HermesStatusChip />` between the view tabs (`HeaderTabs`) and the filter chip / settings. Example position:

```tsx
<div className="flex items-center gap-3">
  <HeaderTabs />
  <HermesStatusChip />
  <FilterChip />
  <PaletteTrigger />
  {/* settings link */}
</div>
```

- [ ] **Step 12: Write `SparklineSvg.tsx`** (pure SVG, no chart library)

```tsx
"use client";
import type { RateLimitSample } from "@/lib/limits/types";

export function SparklineSvg({
  history,
  width = 120,
  height = 24,
  field = "remainingTokens",
  limitField = "limitTokens",
}: {
  history: RateLimitSample[];
  width?: number;
  height?: number;
  field?: "remainingTokens" | "remainingRequests";
  limitField?: "limitTokens" | "limitRequests";
}) {
  if (history.length === 0) {
    return <svg width={width} height={height} aria-hidden />;
  }
  // 24 hourly buckets, latest on the right.
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const cutoffStart = Date.now() - (24 - i) * 60 * 60 * 1000;
    const cutoffEnd   = Date.now() - (23 - i) * 60 * 60 * 1000;
    const samples = history.filter((s) => {
      const t = new Date(s.ts).getTime();
      return t >= cutoffStart && t < cutoffEnd;
    });
    if (samples.length === 0) return null;
    const last = samples[samples.length - 1];
    return (last[field] as number) / (last[limitField] as number);
  });
  const barWidth = width / 24;
  return (
    <svg width={width} height={height} aria-label="24h rate limit history">
      {buckets.map((frac, i) => {
        if (frac === null) return null;
        const h = Math.max(1, frac * height);
        const color = frac < 0.2 ? "var(--accent-gold-400, #c9a227)" : "var(--lane-hermes, #4db6ac)";
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={height - h}
            width={Math.max(1, barWidth - 1)}
            height={h}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 13: Write `RateLimitsPanel.tsx`**

`apps/dashboard/components/observability/RateLimitsPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useLimits } from "@/lib/hooks/use-limits";
import { SparklineSvg } from "./SparklineSvg";

function minutesUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function barColor(fraction: number): string {
  if (fraction > 0.95) return "var(--error, #f87171)";
  if (fraction > 0.80) return "var(--accent-gold-400, #c9a227)";
  return "var(--lane-hermes, #4db6ac)";
}

export function RateLimitsPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useLimits();

  if (isLoading) {
    return <div className="text-xs text-muted">Loading rate limits…</div>;
  }
  if (!data?.current) {
    return (
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        No data yet — headers not available from this Hermes version.
      </div>
    );
  }

  const { requests, tokens } = data.current;
  const requestsUsed = 1 - requests.remaining / requests.limit;
  const tokensUsed   = 1 - tokens.remaining / tokens.limit;

  return (
    <section className="space-y-2">
      <header className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Rate Limits
      </header>
      <div className="space-y-1.5">
        <Row label="Requests" used={requestsUsed} resetIn={minutesUntil(requests.resetAt)} />
        {expanded && <SparklineSvg history={data.history} field="remainingRequests" limitField="limitRequests" />}
        <Row label="Tokens"   used={tokensUsed}   resetIn={minutesUntil(tokens.resetAt)} />
        {expanded && <SparklineSvg history={data.history} field="remainingTokens" limitField="limitTokens" />}
      </div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        {expanded ? "Hide history" : "Show history"}
      </button>
    </section>
  );
}

function Row({ label, used, resetIn }: { label: string; used: number; resetIn: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20" style={{ color: "var(--text-muted)" }}>{label}</span>
      <div className="flex-1 h-2 rounded-sm" style={{ background: "var(--surface, #1a1714)" }}>
        <div
          className="h-2 rounded-sm"
          style={{ width: `${used * 100}%`, background: barColor(used) }}
        />
      </div>
      <span className="w-12 text-right" style={{ color: "var(--text-muted)" }}>
        {(used * 100).toFixed(0)}%
      </span>
      <span className="w-16" style={{ color: "var(--text-muted)" }}>{resetIn}</span>
    </div>
  );
}
```

- [ ] **Step 14: Mount `<RateLimitsPanel />` in `MetricsSidebar.tsx`**

In `apps/dashboard/components/observability/MetricsSidebar.tsx`, add below the existing SCHEDULES section:

```tsx
import { RateLimitsPanel } from "./RateLimitsPanel";

// ... inside the component's return ...
<div className="mt-6">
  <RateLimitsPanel />
</div>
```

- [ ] **Step 15: Migrate `RunFeed.tsx` — swap fixture for `useRunFeed()`**

Replace the static `RUNS_FIXTURE` import + iteration with `useRunFeed()`. Example:

```tsx
"use client";
import { useRunFeed } from "@/lib/hooks/use-run-feed";
import { RunCard } from "./RunCard";

export function RunFeed() {
  const { data: runs, isLoading } = useRunFeed({ limit: 50 });
  if (isLoading) return <div className="text-xs">Loading runs…</div>;
  if (!runs?.length) {
    return (
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
        No runs yet. Dispatch a skill from /architecture to see it here.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {runs.map((run) => <li key={run.id}><RunCard run={run} /></li>)}
    </ul>
  );
}
```

- [ ] **Step 16: Migrate `RunCard.tsx` — wire to `HermesRun` + vital signs**

Major rewrite. Replace fixture props with `{ run: HermesRun }`. Use `useRunVitalSigns()` for live state. Gold stripe on stale. STALE / THROTTLED chip variants.

```tsx
"use client";
import type { HermesRun } from "@agenticos/hermes-client";
import { useRunVitalSigns } from "@/lib/hooks/use-run-vital-signs";

export function RunCard({ run }: { run: HermesRun }) {
  const vitals = useRunVitalSigns(run);
  const stale = vitals?.isStale ?? false;
  const throttled = !!vitals?.throttledUntil;
  const stripeColor = stale || throttled
    ? "var(--accent-gold-400, #c9a227)"
    : "var(--lane-hermes, #4db6ac)";
  const pulseDuration = stale || throttled ? "4s" : "2s";

  return (
    <article
      className="relative pl-3 py-2 pr-3 rounded-md"
      style={{ background: "var(--surface, #1a1714)" }}
    >
      {run.status === "running" && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-md"
          style={{
            background: stripeColor,
            animation: `pulse ${pulseDuration} ease-in-out infinite`,
          }}
        />
      )}
      <header className="flex items-center justify-between text-xs">
        <span className="font-medium">{run.skillId}</span>
        <StatusChip run={run} vitals={vitals} />
      </header>
      <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {run.model} · ${run.costUsd?.toFixed(2) ?? "—"} · {run.inputTokens + run.outputTokens} tok
      </div>
    </article>
  );
}

function StatusChip({ run, vitals }: { run: HermesRun; vitals: ReturnType<typeof useRunVitalSigns> }) {
  if (vitals?.throttledUntil) {
    const mins = Math.max(0, Math.floor((new Date(vitals.throttledUntil).getTime() - Date.now()) / 60_000));
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-sm"
        style={{ background: "var(--warning-bg, #3a2e1c)", color: "var(--accent-gold-400, #c9a227)" }}>
        THROTTLED · {mins}m
      </span>
    );
  }
  if (vitals?.isStale) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-sm"
        style={{ background: "var(--warning-bg, #3a2e1c)", color: "var(--accent-gold-400, #c9a227)" }}>
        STALE
      </span>
    );
  }
  const label = run.status.toUpperCase();
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-sm"
      style={{ background: "var(--info-bg, #1c2a3a)", color: "var(--info, #4db6ac)" }}>
      {label}
    </span>
  );
}
```

- [ ] **Step 17: Migrate `LiveStrip.tsx`, `SchedulesSidebar.tsx`, `RunDetailDrawer.tsx`**

`LiveStrip.tsx` — swap fixture for `useRunFeed({ status: "running" })`. Filter list of `<RunCard>` instances.

`SchedulesSidebar.tsx` — swap fixture for `useHermesCron()`. Render `<ul>` of schedule names + `nextRunAt`.

`RunDetailDrawer.tsx` Logs tab — replace static text with `useRunEvents(runId)` rendered as a scrolling list. Each event row: `[seq] kind · ts · payload preview`.

`RunDetailDrawer.tsx` Usage tab — bind to `run.inputTokens`, `run.outputTokens`, `run.cacheReadTokens`, `run.cacheWriteTokens`, `run.costUsd`.

- [ ] **Step 18: Delete `apps/dashboard/lib/fixtures/runs.ts`**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
rm apps/dashboard/lib/fixtures/runs.ts
```

Then run typecheck — any remaining import will surface as a TS error to fix.

- [ ] **Step 19: Run all gates**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all pass; typecheck reveals no remaining fixture import.

- [ ] **Step 20: Commit Task 4**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add apps/dashboard
git commit -m "feat(observability): migrate to real Hermes data + staleness + rate limits (Phase 3 T4)

Three concerns combined per spec § 5.2, 5.3, 6:

OBSERVABILITY MIGRATION
- New hooks: useRunFeed, useRunEvents, useRunVitalSigns,
  useHermesCron, useHermesHealth, useLimits
- RunFeed, LiveStrip, SchedulesSidebar, RunDetailDrawer all wired
  to /api/hermes/* via TanStack Query
- HermesStatusChip in the global header (teal dot = up, muted = down)
- lib/fixtures/runs.ts deleted

STALENESS DETECTION (per-skill threshold)
- Curator: 5 min; generic short skill: 30 s
- Client-side useRunVitalSigns runs a 1s ticker only when status=running
- Lane stripe shifts var(--lane-hermes) → var(--accent-gold-400);
  pulse keyframe slows 2s → 4s
- STALE / THROTTLED chips in RunCard header

RATE-LIMIT OBSERVABILITY
- lib/limits/ — JSONL writer (append + lazy 30-day prune), reader,
  willNextRunFit projection
- /api/limits returns { current, history } for the panel
- RateLimitsPanel in MetricsSidebar: compact bars + expandable
  24h sparklines (pure SVG, no chart library)
- Coupled with staleness: 429 retryAfter from SSE → throttledUntil
  → THROTTLED chip + countdown"
git push -u origin feat/phase-3-task-4-observability
```

---

## Task 5: Curator Skill + MCP-to-Vault Server

**Wave 4 — solo.** Branches off T4. Largest task by half-days (2.5).

**Files:**
- Create: `apps/dashboard/lib/skills/index.ts`
- Create: `apps/dashboard/lib/skills/types.ts`
- Create: `apps/dashboard/lib/skills/curator.ts`
- Create: `apps/dashboard/lib/skills/curator.test.ts`
- Create: `apps/dashboard/lib/skills/prompts/curator-system.txt`
- Create: `apps/dashboard/lib/mcp-vault/types.ts`
- Create: `apps/dashboard/lib/mcp-vault/tools.ts`
- Create: `apps/dashboard/lib/mcp-vault/server.ts`
- Create: `apps/dashboard/lib/mcp-vault/server.test.ts`
- Modify: `apps/dashboard/instrumentation.ts` — boot MCP server alongside scheduler
- Modify: `apps/dashboard/lib/config/schema.ts` — add `mcpServerUrl` field

- [ ] **Step 1: Branch off T4**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout main && git pull --ff-only
git checkout -b feat/phase-3-task-5-curator-mcp
```

- [ ] **Step 2: Add MCP SDK + extend config**

In `apps/dashboard/package.json` dependencies — already added in T1 step 19; verify present:

```json
"@modelcontextprotocol/sdk": "^1.0.0",
```

Extend `apps/dashboard/lib/config/schema.ts`:

```ts
mcpServerUrl: z.string().url().default("http://127.0.0.1:7610"),
```

And `DEFAULT_CONFIG`:

```ts
mcpServerUrl: "http://127.0.0.1:7610",
```

- [ ] **Step 3: Write `lib/skills/types.ts`**

```ts
export interface SkillDefinition {
  id:                    string;
  name:                  string;
  description:           string;
  model?:                string;
  budget?:               number;
  toolNames:             string[];
  systemPrompt:          string;
  userPrompt(ctx:        { todayIso: string; lastRunIso: string; budget: number }): string;
  stalenessThresholdMs:  number;
}
```

- [ ] **Step 4: Write the Curator system prompt file**

`apps/dashboard/lib/skills/prompts/curator-system.txt` — copy verbatim from spec § 5.1 (the multi-paragraph prompt starting with "You are the Curator, an autonomous knowledge-management agent..."). The file ends with the log entry format block. No template substitution in this file — template lives in `userPrompt()`.

- [ ] **Step 5: Write the Curator test first (TDD)**

`apps/dashboard/lib/skills/curator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { curator } from "./curator";

describe("curator skill", () => {
  it("has the expected id and budget", () => {
    expect(curator.id).toBe("curator");
    expect(curator.budget).toBe(1.0);
    expect(curator.stalenessThresholdMs).toBe(300_000);
  });

  it("exposes the 9-tool whitelist", () => {
    expect(curator.toolNames).toEqual([
      "vault.page.read",
      "vault.tree.list",
      "vault.search",
      "vault.backlinks",
      "vault.inbox.list",
      "vault.inbox.item",
      "vault.inbox.commit",
      "vault.inbox.discard",
      "lint.run",
    ]);
  });

  it("does NOT expose vault.inbox.promote (Curator is the proposer)", () => {
    expect(curator.toolNames).not.toContain("vault.inbox.promote");
  });

  it("substitutes today, last-run, budget into user prompt", () => {
    const prompt = curator.userPrompt({
      todayIso:   "2026-05-19",
      lastRunIso: "2026-05-18",
      budget:     1.0,
    });
    expect(prompt).toContain("2026-05-19");
    expect(prompt).toContain("2026-05-18");
    expect(prompt).toContain("$1");
  });

  it("loads the system prompt from disk", () => {
    expect(curator.systemPrompt).toContain("You are the Curator");
    expect(curator.systemPrompt).toContain("vault.inbox.commit");
  });
});
```

- [ ] **Step 6: Implement `lib/skills/curator.ts`**

```ts
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SkillDefinition } from "./types";

const SYSTEM_PROMPT = readFileSync(
  path.join(process.cwd(), "lib/skills/prompts/curator-system.txt"),
  "utf-8",
);

export const curator: SkillDefinition = {
  id:           "curator",
  name:         "Vault Curator",
  description:  "Nightly: promotes inbox items > 7 days old; runs lint; writes curator-log.md.",
  budget:       1.0,
  toolNames: [
    "vault.page.read",
    "vault.tree.list",
    "vault.search",
    "vault.backlinks",
    "vault.inbox.list",
    "vault.inbox.item",
    "vault.inbox.commit",
    "vault.inbox.discard",
    "lint.run",
  ],
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: (ctx) =>
    `Today's date: ${ctx.todayIso}\n` +
    `Last curator run: ${ctx.lastRunIso}\n` +
    `Budget cap: $${ctx.budget}\n\n` +
    `Begin the curator workflow now.`,
  stalenessThresholdMs: 300_000,
};
```

- [ ] **Step 7: Implement `lib/skills/index.ts` (registry)**

```ts
import "server-only";
import type { SkillDefinition } from "./types";
import { curator } from "./curator";

const REGISTRY: Record<string, SkillDefinition> = {
  curator,
};

export async function resolveSkill(id: string): Promise<SkillDefinition> {
  const skill = REGISTRY[id];
  if (!skill) throw new Error(`Skill not registered: ${id}`);
  return skill;
}

export function listSkills(): SkillDefinition[] {
  return Object.values(REGISTRY);
}
```

- [ ] **Step 8: Run Curator tests**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test lib/skills/curator.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 9: Write `lib/mcp-vault/types.ts`**

```ts
export interface McpToolDef {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
  proxyTo:     {
    method:  "GET" | "POST";
    path:    string;
    query?:  string[];
  };
}
```

- [ ] **Step 10: Write `lib/mcp-vault/tools.ts` — 11 tool definitions**

```ts
import type { McpToolDef } from "./types";

export const MCP_VAULT_TOOLS: McpToolDef[] = [
  {
    name:        "vault.page.read",
    description: "Read a wiki page by path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/page", query: ["path"] },
  },
  {
    name:        "vault.tree.list",
    description: "List the wiki folder tree.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/vault/tree" },
  },
  {
    name:        "vault.search",
    description: "Full-text search across the vault.",
    inputSchema: {
      type: "object",
      properties: {
        q:     { type: "string" },
        tags:  { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["q"],
    },
    proxyTo: { method: "GET", path: "/api/vault/search", query: ["q", "tags", "limit"] },
  },
  {
    name:        "vault.backlinks",
    description: "List wiki pages that link to the given path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/backlinks", query: ["path"] },
  },
  {
    name:        "vault.inbox.list",
    description: "List inbox items.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/vault/inbox" },
  },
  {
    name:        "vault.inbox.item",
    description: "Read a single inbox item.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/inbox/item", query: ["path"] },
  },
  {
    name:        "vault.inbox.promote",
    description: "Get an LLM-generated proposal for promoting an inbox item.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "POST", path: "/api/vault/inbox/promote" },
  },
  {
    name:        "vault.inbox.commit",
    description: "Atomically write a wiki page (or curator-log) and clear/archive the inbox item.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string" },
        title:       { type: "string" },
        tags:        { type: "array", items: { type: "string" } },
        body:        { type: "string" },
        inboxPath:   { type: "string" },
      },
      required: ["destination", "title", "body"],
    },
    proxyTo: { method: "POST", path: "/api/vault/inbox/commit" },
  },
  {
    name:        "vault.inbox.discard",
    description: "Move an inbox item to archived/.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "POST", path: "/api/vault/inbox/discard" },
  },
  {
    name:        "lint.run",
    description: "Run vault lint and return all issues.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/lint" },
  },
  {
    name:        "taxonomy.list",
    description: "List the canonical tag taxonomy.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/taxonomy" },
  },
];
```

- [ ] **Step 11: Implement `lib/mcp-vault/server.ts`**

```ts
import "server-only";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MCP_VAULT_TOOLS } from "./tools";
import type { McpToolDef } from "./types";

const PORT = 7610;
const DASHBOARD_BASE = process.env.AGENTICOS_DASHBOARD_BASE ?? "http://127.0.0.1:3000";

let started = false;

export async function bootMcpServer(): Promise<void> {
  if (started) return;
  started = true;
  const server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`MCP vault server listening on 127.0.0.1:${PORT}`);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/tools" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tools: MCP_VAULT_TOOLS.map(serializeTool) }));
    return;
  }
  if (req.url === "/invoke" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> };
      const tool = MCP_VAULT_TOOLS.find((t) => t.name === name);
      if (!tool) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
        return;
      }
      const result = await invokeProxy(tool, args);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
}

function serializeTool(tool: McpToolDef) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

async function invokeProxy(tool: McpToolDef, args: Record<string, unknown>): Promise<unknown> {
  const { method, path: routePath, query } = tool.proxyTo;
  const url = new URL(routePath, DASHBOARD_BASE);
  if (query && method === "GET") {
    for (const key of query) {
      const v = args[key];
      if (v === undefined || v === null) continue;
      url.searchParams.set(key, Array.isArray(v) ? v.join(",") : String(v));
    }
  }
  const init: RequestInit = { method };
  if (method === "POST") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(args);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Proxy ${routePath} returned ${res.status}`);
  return await res.json();
}
```

- [ ] **Step 12: Write MCP server test**

`apps/dashboard/lib/mcp-vault/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MCP_VAULT_TOOLS } from "./tools";

describe("MCP vault tool registry", () => {
  it("contains exactly 11 tools", () => {
    expect(MCP_VAULT_TOOLS).toHaveLength(11);
  });

  it("each tool has a unique name", () => {
    const names = MCP_VAULT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has a valid proxy target", () => {
    for (const tool of MCP_VAULT_TOOLS) {
      expect(["GET", "POST"]).toContain(tool.proxyTo.method);
      expect(tool.proxyTo.path).toMatch(/^\/api\//);
    }
  });

  it("the 9 Curator-whitelisted tools are all present", () => {
    const allowed = [
      "vault.page.read", "vault.tree.list", "vault.search", "vault.backlinks",
      "vault.inbox.list", "vault.inbox.item", "vault.inbox.commit",
      "vault.inbox.discard", "lint.run",
    ];
    for (const name of allowed) {
      expect(MCP_VAULT_TOOLS.find((t) => t.name === name)).toBeDefined();
    }
  });
});
```

- [ ] **Step 13: Update `instrumentation.ts` to boot MCP server alongside scheduler**

`apps/dashboard/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootScheduler } = await import("@/lib/scheduler/scheduler");
    const { bootMcpServer } = await import("@/lib/mcp-vault/server");
    await Promise.all([bootScheduler(), bootMcpServer()]);
  }
}
```

- [ ] **Step 14: Run MCP tests + commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm test lib/skills lib/mcp-vault
pnpm typecheck
pnpm lint
```

Expected: ~9 new tests pass.

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add apps/dashboard/lib/skills apps/dashboard/lib/mcp-vault apps/dashboard/lib/config/schema.ts apps/dashboard/instrumentation.ts
git commit -m "feat(curator): Curator skill + MCP-to-vault server (Phase 3 T5)

CURATOR SKILL (apps/dashboard/lib/skills/)
- types.ts        SkillDefinition shape (Phase 4 will generalize)
- curator.ts      Hardcoded curator skill: 9-tool whitelist,
                  budget \$1.00, stalenessThresholdMs 300_000
- index.ts        Skill registry (only Curator in Phase 3)
- prompts/curator-system.txt  System prompt verbatim from spec § 5.1

MCP-TO-VAULT SERVER (apps/dashboard/lib/mcp-vault/)
- Standalone HTTP server on 127.0.0.1:7610
- Booted by instrumentation.ts alongside the scheduler
- 11 tool definitions; each proxies to an existing /api/vault/*,
  /api/lint, or /api/taxonomy route
- vault.inbox.promote excluded from Curator allowlist (Curator is
  the proposer); taxonomy.list also excluded as unnecessary
- Path-safety enforcement inherits from the underlying API routes;
  no new business logic in the MCP layer"
git push -u origin feat/phase-3-task-5-curator-mcp
```

---

## Task 6: Cron UI + "Run Now"

**Wave 5 — solo.** Branches off T5. Smallest task by half-days (1.5).

**Files:**
- Create: `apps/dashboard/app/observability/schedules/page.tsx`
- Create: `apps/dashboard/components/observability/ScheduleEditDrawer.tsx`
- Create: `apps/dashboard/components/observability/RunNowButton.tsx`
- Modify: `apps/dashboard/components/observability/SchedulesSidebar.tsx`

- [ ] **Step 1: Branch off T5**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout main && git pull --ff-only
git checkout -b feat/phase-3-task-6-cron-ui
```

- [ ] **Step 2: Implement `app/observability/schedules/page.tsx`** — full schedules table

```tsx
"use client";
import { useState } from "react";
import { useHermesCron } from "@/lib/hooks/use-hermes-cron";
import { RunNowButton } from "@/components/observability/RunNowButton";
import { ScheduleEditDrawer } from "@/components/observability/ScheduleEditDrawer";
import type { ScheduleRecord } from "@agenticos/hermes-client";

export default function SchedulesPage() {
  const { data: schedules, isLoading, refetch } = useHermesCron();
  const [editing, setEditing] = useState<ScheduleRecord | "new" | null>(null);

  return (
    <main className="p-6 max-w-4xl">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-medium">Schedules</h1>
        <button
          onClick={() => setEditing("new")}
          className="text-sm px-3 py-1.5 rounded-md"
          style={{ background: "var(--accent-plum-400)", color: "var(--text-inverse, white)" }}
        >
          + Add Schedule
        </button>
      </header>
      {isLoading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}
      {schedules && schedules.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No schedules yet. Add one to dispatch a skill on a cron.
        </p>
      )}
      <ul className="space-y-2">
        {schedules?.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 p-3 rounded-md"
            style={{ background: "var(--surface, #1a1714)" }}
          >
            <div className="flex-1">
              <div className="text-sm font-medium">{s.id}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {s.skillId} · {s.schedule} · {s.enabled ? "enabled" : "disabled"}
              </div>
              {s.lastRunAt && (
                <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  last run {new Date(s.lastRunAt).toLocaleString()}
                </div>
              )}
            </div>
            <RunNowButton scheduleId={s.id} onDispatch={() => refetch()} />
            <button
              onClick={() => setEditing(s)}
              className="text-xs px-2 py-1 underline"
              style={{ color: "var(--text-muted)" }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <ScheduleEditDrawer
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refetch(); }}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Implement `RunNowButton.tsx`**

```tsx
"use client";
import { useState } from "react";

export function RunNowButton({ scheduleId, onDispatch }: { scheduleId: string; onDispatch: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hermes/cron/${encodeURIComponent(scheduleId)}/run`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(json.error ?? "Failed");
        return;
      }
      onDispatch();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={handleClick}
        disabled={pending}
        className="text-xs px-3 py-1 rounded-md"
        style={{
          background: pending ? "var(--surface-muted)" : "var(--lane-hermes, #4db6ac)",
          color: "var(--text-inverse, white)",
        }}
      >
        {pending ? "Dispatching…" : "Run now"}
      </button>
      {error && <span className="text-[10px] mt-1" style={{ color: "var(--error, #f87171)" }}>{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `ScheduleEditDrawer.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { ScheduleRecord } from "@agenticos/hermes-client";

export function ScheduleEditDrawer({
  record,
  onClose,
  onSaved,
}: {
  record: ScheduleRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = record === null;
  const [id, setId] = useState(record?.id ?? "");
  const [skillId, setSkillId] = useState(record?.skillId ?? "curator");
  const [schedule, setSchedule] = useState(record?.schedule ?? "0 3 * * *");
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [threshold, setThreshold] = useState(record?.stalenessThresholdMs ?? 300_000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const url = isNew
        ? "/api/hermes/cron"
        : `/api/hermes/cron/${encodeURIComponent(record!.id)}`;
      const method = isNew ? "POST" : "PUT";
      const body = isNew
        ? { id, skillId, schedule, enabled, stalenessThresholdMs: threshold }
        : { schedule, enabled, stalenessThresholdMs: threshold };
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Save failed" }));
        setError(json.error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!record) return;
    if (!confirm(`Delete schedule "${record.id}"?`)) return;
    setSaving(true);
    try {
      await fetch(`/api/hermes/cron/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 w-96 p-6 border-l"
      style={{ background: "var(--surface, #1a1714)", borderColor: "var(--border-subtle)" }}
    >
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">{isNew ? "New schedule" : `Edit ${record!.id}`}</h2>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--text-muted)" }}>×</button>
      </header>
      <div className="space-y-3 text-sm">
        {isNew && (
          <Field label="ID">
            <input value={id} onChange={(e) => setId(e.target.value)} className="w-full px-2 py-1 rounded-sm" />
          </Field>
        )}
        {isNew && (
          <Field label="Skill">
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className="w-full px-2 py-1 rounded-sm">
              <option value="curator">curator</option>
            </select>
          </Field>
        )}
        <Field label="Cron expression">
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="w-full px-2 py-1 rounded-sm font-mono text-xs" />
        </Field>
        <Field label="Enabled">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </Field>
        <Field label="Staleness threshold (ms)">
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full px-2 py-1 rounded-sm"
          />
        </Field>
        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>
      <footer className="flex items-center justify-between mt-6">
        {!isNew && (
          <button onClick={handleDelete} className="text-xs underline" style={{ color: "var(--error)" }}>
            Delete
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-md ml-auto"
          style={{ background: "var(--accent-plum-400)", color: "var(--text-inverse, white)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 5: Update `SchedulesSidebar.tsx`** — link to the new schedules page

In the existing component, add a "View all" link to `/observability/schedules` and replace any static schedule rows with `useHermesCron()` (if not already done in T4).

- [ ] **Step 6: Run gates + commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
pnpm typecheck
pnpm test
pnpm lint
```

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add apps/dashboard/app/observability/schedules apps/dashboard/components/observability
git commit -m "feat(observability): cron UI + Run Now button (Phase 3 T6)

- New route /observability/schedules with a table of all schedules
- ScheduleEditDrawer (create new / edit existing / delete)
- RunNowButton: POST /api/hermes/cron/[id]/run; refreshes feed
- SchedulesSidebar 'View all' link to the new page

End of Phase 3. Demo: visit /observability/schedules, click 'Run now'
on the curator schedule, watch a RunCard appear in the feed with
live SSE stream. Wait or set the cron to fire in 1 minute to verify
the scheduled path."
git push -u origin feat/phase-3-task-6-cron-ui
```

---

## Final Integration

After T5 and T6 land, create the Phase 3 integration branch and merge in order:

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git fetch origin
git checkout main && git pull --ff-only
git checkout -b feat/phase-3-integration

git merge --no-ff origin/feat/phase-3-task-1-hermes-client \
  -m "merge: Phase 3 T1 (hermes-client package) into integration"
git merge --no-ff origin/feat/phase-3-task-2-hermes-routes \
  -m "merge: Phase 3 T2 (/api/hermes/* routes) into integration"
git merge --no-ff origin/feat/phase-3-task-3-scheduler \
  -m "merge: Phase 3 T3 (scheduler) into integration"
git merge --no-ff origin/feat/phase-3-task-4-observability \
  -m "merge: Phase 3 T4 (observability + rate limits) into integration"
git merge --no-ff origin/feat/phase-3-task-5-curator-mcp \
  -m "merge: Phase 3 T5 (Curator + MCP-to-vault) into integration"
git merge --no-ff origin/feat/phase-3-task-6-cron-ui \
  -m "merge: Phase 3 T6 (cron UI + Run Now) into integration"
```

Resolve any conflicts. Expected hotspots based on Phase 2 patterns:

- `apps/dashboard/components/layout/Header.tsx` — T4 adds `<HermesStatusChip />`; verify no other phase touched.
- `apps/dashboard/instrumentation.ts` — T3 boots scheduler, T5 also boots MCP server. The T5 edit is the canonical final shape.
- `apps/dashboard/lib/config/schema.ts` — T2 adds `hermesUrl`, T5 adds `mcpServerUrl`. Both should be present in final.
- `apps/dashboard/package.json` — multiple tasks add deps. Run `pnpm install` after merge to regenerate the lockfile cleanly.

Quality gates on the integration branch:

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
pnpm install
cd apps/dashboard
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Target: ~190 tests (current 83 from Phase 2 + ~107 new). All gates clean.

Smoke test with a live Hermes daemon:

```bash
# Terminal 1
hermes serve --port 7600

# Terminal 2
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/apps/dashboard"
ANTHROPIC_API_KEY=sk-ant-... pnpm dev
```

Open `http://localhost:3000`:
- Header chip: "HERMES ●" (teal) — verify online
- `/observability` — empty feed initially
- `/observability/schedules` — empty table; click "+ Add Schedule"; fill in `id=curator-nightly`, `skillId=curator`, `schedule=0 3 * * *`; Save
- Click "Run now" on the new schedule
- Switch to `/observability` — RunCard appears, lane stripe pulses teal
- Open the run drawer — Logs tab shows SSE events live
- Wait for run to complete; check `vault/wiki/_meta/curator-log.md` exists with one entry

Push integration + open PR:

```bash
git push -u origin feat/phase-3-integration
gh pr create --base main --head feat/phase-3-integration \
  --title "feat(phase-3): Hermes integration (Tasks 1-6) — ~190 tests, full integration" \
  --body "Phase 3 end-to-end: live Hermes daemon integration, nightly Curator skill, MCP-to-vault binding, observability migration off fixtures, staleness detection, rate-limit observability with 24h sparklines, cron UI with Run Now."
```

---

## Self-Review Verification

Applied during plan authorship:

1. **Spec coverage (§ 1–9 of `docs/phase-3-hermes-integration.md`)** — every section maps to at least one task:
   - § 3.1 Process topology → T1 (HermesClient), T3 (scheduler), T5 (MCP server)
   - § 3.2–3.4 hermes-client + types → T1
   - § 3.5 MCP-to-vault → T5
   - § 3.6 Daemon lifecycle / status chip → T4 (HermesStatusChip)
   - § 4 API surface → T2 (all 11 routes)
   - § 5.1 Curator skill → T5
   - § 5.2 Staleness detection → T4 (useRunVitalSigns + RunCard rewrite)
   - § 5.3 Rate-limit observability → T4 (lib/limits + RateLimitsPanel + SparklineSvg)
   - § 6 Migration → T4 (fixture deletion)
   - § 7 Sequencing → reflected in DAG + Asana mapping
   - § 8 Testing → tests inline per task
   - § 9 Risks → addressed by sanity-cancel (T3), atomic writes (T3, T4), graceful fallback in /api/hermes/health (T2), pruneRateLimitsIfNeeded (T4)

2. **Placeholder scan** — no `TBD`, `FIXME`, `implement later` in plan text. The only `TODO`-ish patterns are in test fixture content (intentional — see Curator skill's `wiki/_meta/curator-log.md` example output, which legitimately includes "todos" as a lint category name).

3. **Type consistency** — `HermesRun`, `HermesEvent`, `HermesCron`, `HermesHealth`, `ScheduleRecord`, `RunVitalSigns`, `RateLimitSample`, `SkillDefinition` all defined once in T1 (or T4 for limits, T5 for skills) and re-imported by all consumers via `@agenticos/hermes-client`, `@/lib/limits/types`, `@/lib/skills/types`. Method signatures on `HermesClient` match the spec § 3.4 contract.

4. **Sequencing** — 5 waves match spec § 7 DAG. Wave 2 (T2 + T3) genuinely runs in parallel: T2 owns `app/api/hermes/`, T3 owns `lib/scheduler/`, only shared touchpoint is the `client-singleton` import (which T2 creates, T3 imports — T3 should branch off T2 if dependency strictness matters; for parallel dispatch, T3 can stub the singleton temporarily).

---

**Plan complete and saved to `docs/plans/phase-3-hermes-integration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task; review between tasks; fast iteration. Matches the Phase 1 and Phase 2 patterns that produced 144 passing tests across 15 tasks in ~7 sessions.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`; batch execution with checkpoints.

**Which approach?**
