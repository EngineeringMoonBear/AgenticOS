# Penny Receipt Pipeline (Discord → FarmRaise) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Family posts receipt photos in Discord `#receipts`; a new `@agenticos/discord-plugin` ingests them into Paperclip issues assigned to Penny (CFO agent), who vision-extracts and categorizes them; Josh reviews in Vista and does a weekly FarmRaise attach pass from a Sunday Discord DM digest.

**Architecture:** A Paperclip plugin (modeled on `@agenticos/openviking-plugin`'s scheduled-job pattern and `@agenticos/github-plugin`'s external-REST-client pattern) polls Discord on a cron job, archives images to DO Spaces at ingest time (Discord CDN URLs expire ~24h), and creates one issue per receipt with `originId` dedup. Penny processes issues via plugin-registered tools that atomically record her extraction (Spaces sidecar + issue comment + Discord thread reply + status change). A second cron job DMs Josh the weekly digest of `in_review` receipts. Approved spec: `~/AgenticOS-Vault/sources/2026-07-04-penny-receipt-pipeline-design.md`.

**Tech Stack:** TypeScript (strict, ES2022, ESM), `@paperclipai/plugin-sdk@2026.626.0`, esbuild bundle (node22), vitest, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Discord REST API v10, pnpm workspace + turbo.

## Global Constraints

- Node `22.x`, pnpm `9.15.4` (pinned in root package.json). New package joins `pnpm-workspace.yaml` automatically via the `packages/*` glob — do not edit that file.
- Plugin SDK dependency exactly `"@paperclipai/plugin-sdk": "2026.626.0"` (matches vault-plugin).
- Build = esbuild bundle, `--platform=node --format=esm --target=node22`, outputs `dist/worker.js` + `dist/manifest.js` (paperclip-server loads only `dist/`).
- TypeScript: extend `@agenticos/tsconfig/base.json`; `strict`, `noUncheckedIndexedAccess`, `module: ESNext`, `moduleResolution: Bundler`. Local imports use `.js` extensions (ESM).
- Tests: vitest, `"test": "vitest run"`. Mock via domain interfaces + fakes (openviking `ingest-job.test.ts` pattern), NOT by mocking the full `PluginContext`.
- Do NOT use `ctx.secrets.resolve()` — disabled in this Paperclip version. Sensitive values live in plugin config, set via `scripts/sync-paperclip-secrets.sh`, read with `ctx.config.get()`. Never commit a token.
- Commit convention: `feat(discord-plugin): ...`, `fix(discord-plugin): ...`, `docs(runbook): ...`, `infra(compose): ...`.
- Plugin id: `agenticos.discord-plugin`. Issue `originKind`: `"plugin:agenticos.discord-plugin"`. Issue `originId`: `"<discordMessageId>:<attachmentId>"`.
- Issue status flow: `todo` (awaiting Penny) → `in_progress` (Penny working) → `in_review` (extraction staged, awaiting Josh) → `done` (Josh attached in FarmRaise, closed in Vista). `blocked` = waiting on retake. `cancelled` = dismissed non-receipt.
- Phase 3 (Playwright `farmraise_attach`) is explicitly OUT OF SCOPE.

## File Structure

```
packages/discord-plugin/
  package.json
  tsconfig.json
  src/
    manifest.ts          # PaperclipPluginManifestV1: capabilities, jobs, config schema
    worker.ts            # definePlugin: wire config → clients → jobs + tools
    types.ts             # Result<T>, ReceiptMeta, ReceiptExtraction, domain interfaces
    discord-client.ts    # Discord REST v10: poll, reply, react, DM, download
    spaces.ts            # ReceiptArchive: put/presign, key naming
    receipt-meta.ts      # Serialize/parse <!-- receipt-meta v1 --> and extraction comment blocks
    ingest/job.ts        # runIngest: poll → dedup → archive → create issue → cursor
    digest/job.ts        # runDigest: list in_review → parse extractions → DM Josh
    tools/record-extraction.ts   # receipt_record_extraction handler
    tools/request-retake.ts      # receipt_request_retake handler
    tools/dismiss.ts             # receipt_dismiss handler
    tools/reply.ts               # discord_reply handler
  tests/
    discord-client.test.ts
    spaces.test.ts
    receipt-meta.test.ts
    ingest-job.test.ts
    digest-job.test.ts
    tools.test.ts
docs/personas/penny-receipt-clerk.md   # Duty block Josh applies to Penny
docs/runbooks/discord-receipts.md      # Bot setup, Spaces bucket, config sync, smoke test
scripts/sync-paperclip-secrets.sh      # MODIFY: add discord-plugin block
docker-compose.yml                     # MODIFY: mount packages/discord-plugin
```

---

### Task 1: Package scaffold, types, and manifest

**Files:**
- Create: `packages/discord-plugin/package.json`
- Create: `packages/discord-plugin/tsconfig.json`
- Create: `packages/discord-plugin/src/types.ts`
- Create: `packages/discord-plugin/src/manifest.ts`
- Create: `packages/discord-plugin/src/worker.ts` (minimal stub, completed in Task 8)

**Interfaces:**
- Produces: `Result<T>`, `ReceiptMeta`, `ReceiptExtraction`, `DiscordPluginConfig` (all in `src/types.ts`) — every later task imports these.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agenticos/discord-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/worker.js",
  "paperclipPlugin": {
    "manifest": "dist/manifest.js",
    "worker": "dist/worker.js"
  },
  "scripts": {
    "build": "esbuild src/worker.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/worker.js --external:react && esbuild src/manifest.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/manifest.js --external:react",
    "dev": "esbuild src/worker.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/worker.js --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "@paperclipai/plugin-sdk": "2026.626.0"
  },
  "devDependencies": {
    "@agenticos/tsconfig": "workspace:*",
    "@types/node": "^26",
    "esbuild": "^0.28.1",
    "typescript": "^6",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (copy of vault-plugin's shape)

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
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create src/types.ts**

```typescript
/** Shared result shape, matching github-plugin's convention. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Plugin instance config (mirrors manifest instanceConfigSchema). */
export interface DiscordPluginConfig {
  discordBotToken: string;
  receiptsChannelId: string;
  companyId: string;
  pennyAgentId: string;
  joshDiscordUserId: string;
  spacesKey: string;
  spacesSecret: string;
  spacesBucket: string;
  spacesRegion: string;
  spacesEndpoint: string;
  presignExpirySeconds: number;
}

/** Machine-readable metadata embedded in every receipt issue description. */
export interface ReceiptMeta {
  v: 1;
  spacesKey: string;
  discordChannelId: string;
  discordMessageId: string;
  discordAttachmentId: string;
  poster: string;
  postedAt: string; // ISO 8601 from the Discord message timestamp
  caption: string;  // message content, may be ""
}

/** Penny's extraction payload — the contract for receipt_record_extraction. */
export interface ReceiptExtraction {
  v: 1;
  vendor: string;
  date: string;            // YYYY-MM-DD as printed on the receipt
  total: number;           // dollars, e.g. 84.12
  payment_method: "card" | "cash" | "check" | "unknown";
  line_items: Array<{ description: string; amount: number }>;
  suggested_category: string; // Schedule F or custom category name
  confidence: number;         // 0..1
  flags: string[];            // e.g. ["possible-duplicate", "looks-personal"]
}
```

- [ ] **Step 4: Create src/manifest.ts**

```typescript
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.discord-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Discord Receipts",
  description:
    "Polls #receipts for receipt photos, archives them to Spaces, files issues for Penny (CFO), and DMs the weekly attach digest.",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: [
    "jobs.schedule",
    "http.outbound",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
  ],
  jobs: [
    {
      jobKey: "receipt-ingest",
      displayName: "Receipt Ingest",
      description: "Poll #receipts for new images, archive to Spaces, file issues for Penny",
      schedule: "*/10 * * * *",
    },
    {
      jobKey: "weekly-digest",
      displayName: "Weekly Attach Digest",
      description: "DM Josh the in_review receipts ready for the FarmRaise attach pass",
      schedule: "0 22 * * 0", // Sunday 22:00 UTC = 6pm ET (DST). Server runs UTC.
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      discordBotToken: {
        type: "string",
        title: "Discord Bot Token",
        description: "Bot token. Set via scripts/sync-paperclip-secrets.sh, not by hand.",
      },
      receiptsChannelId: { type: "string", title: "#receipts Channel ID" },
      companyId: { type: "string", title: "Paperclip Company ID (Goldberry Grove)" },
      pennyAgentId: { type: "string", title: "Penny's Agent ID" },
      joshDiscordUserId: { type: "string", title: "Josh's Discord User ID (digest DM target)" },
      spacesKey: { type: "string", title: "DO Spaces Access Key" },
      spacesSecret: { type: "string", title: "DO Spaces Secret" },
      spacesBucket: { type: "string", title: "Spaces Bucket", default: "agenticos-receipts" },
      spacesRegion: { type: "string", title: "Spaces Region", default: "nyc3" },
      spacesEndpoint: {
        type: "string",
        title: "Spaces Endpoint",
        default: "https://nyc3.digitaloceanspaces.com",
      },
      presignExpirySeconds: {
        type: "number",
        title: "Presigned URL expiry (seconds)",
        default: 604800,
      },
    },
    required: [
      "discordBotToken",
      "receiptsChannelId",
      "companyId",
      "pennyAgentId",
      "joshDiscordUserId",
      "spacesKey",
      "spacesSecret",
    ],
  },
  entrypoints: { worker: "./dist/worker.js" },
};

export default manifest;
```

- [ ] **Step 5: Create minimal src/worker.ts stub** (so the build passes; full wiring is Task 8)

```typescript
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("discord-plugin setup (stub)");
  },
  async onHealth() {
    return { status: "ok" };
  },
});

runWorker(plugin);
```

Note: confirm `runWorker` is what vault-plugin's worker.ts calls at the bottom of the file (`/packages/vault-plugin/src/worker.ts`); if it uses a different bootstrap call, copy that exact call.

- [ ] **Step 6: Install and verify build + typecheck**

Run: `cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS" && pnpm install && pnpm --filter @agenticos/discord-plugin build && pnpm --filter @agenticos/discord-plugin typecheck`
Expected: `dist/worker.js` and `dist/manifest.js` exist; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/discord-plugin
git commit -m "feat(discord-plugin): scaffold package, manifest, shared types"
```

---

### Task 2: Discord REST client (TDD)

**Files:**
- Create: `packages/discord-plugin/src/discord-client.ts`
- Test: `packages/discord-plugin/tests/discord-client.test.ts`

**Interfaces:**
- Consumes: `Result<T>` from `src/types.ts`.
- Produces (used by ingest job, digest job, and all four tools):

```typescript
export interface DiscordAttachment { id: string; filename: string; content_type?: string; size: number; url: string; }
export interface DiscordMessage {
  id: string; channel_id: string;
  author: { id: string; username: string; bot?: boolean };
  content: string; timestamp: string;
  attachments: DiscordAttachment[];
}
export class DiscordClient {
  constructor(cfg: { token: string; timeoutMs?: number; baseUrl?: string });
  fetchMessagesAfter(channelId: string, afterId: string | null, limit?: number): Promise<Result<DiscordMessage[]>>; // ascending order
  replyToMessage(channelId: string, messageId: string, content: string): Promise<Result<DiscordMessage>>;
  react(channelId: string, messageId: string, emoji: string): Promise<Result<void>>;
  dmUser(userId: string, content: string): Promise<Result<DiscordMessage>>;
  downloadAttachment(url: string): Promise<Result<Uint8Array>>;
}
```

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { DiscordClient } from "../src/discord-client.js";

const BASE = "https://discord.test/api/v10";

function client() {
  return new DiscordClient({ token: "tok", baseUrl: BASE, timeoutMs: 1000 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("DiscordClient", () => {
  it("fetches messages after a cursor, returns ascending order, sends Bot auth", async () => {
    // Discord returns newest-first; client must reverse to ascending.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([{ id: "3", channel_id: "c", author: { id: "u", username: "j" }, content: "", timestamp: "t", attachments: [] },
                    { id: "2", channel_id: "c", author: { id: "u", username: "j" }, content: "", timestamp: "t", attachments: [] }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().fetchMessagesAfter("c", "1");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/channels/c/messages?limit=50&after=1`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bot tok" }) }),
    );
    expect(res).toEqual({ ok: true, data: [expect.objectContaining({ id: "2" }), expect.objectContaining({ id: "3" })] });
  });

  it("omits after param when cursor is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await client().fetchMessagesAfter("c", null);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/channels/c/messages?limit=50`, expect.anything());
  });

  it("replies with message_reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "9" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().replyToMessage("c", "m1", "hello");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ content: "hello", message_reference: { message_id: "m1" } });
    expect(res.ok).toBe(true);
  });

  it("retries once on 429 honoring retry_after", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ retry_after: 0.01 }, 429))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().fetchMessagesAfter("c", null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
  });

  it("dmUser opens a DM channel then posts to it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "dm-chan" }))
      .mockResolvedValueOnce(jsonResponse({ id: "msg-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await client().dmUser("user-1", "digest text");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/users/@me/channels`);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ recipient_id: "user-1" });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/channels/dm-chan/messages`);
    expect(res.ok).toBe(true);
  });

  it("returns error result on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Missing Access" }, 403)));
    const res = await client().fetchMessagesAfter("c", null);
    expect(res).toEqual({ ok: false, error: "Missing Access" });
  });

  it("downloadAttachment returns bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    const res = await client().downloadAttachment("https://cdn.test/x.jpg");
    expect(res.ok).toBe(true);
    if (res.ok) expect([...res.data]).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: FAIL — cannot resolve `../src/discord-client.js`.

- [ ] **Step 3: Implement src/discord-client.ts**

```typescript
import type { Result } from "./types.js";

const API_BASE = "https://discord.com/api/v10";

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: { id: string; username: string; bot?: boolean };
  content: string;
  timestamp: string;
  attachments: DiscordAttachment[];
}

export class DiscordClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: { token: string; timeoutMs?: number; baseUrl?: string }) {
    this.token = cfg.token;
    this.baseUrl = (cfg.baseUrl ?? API_BASE).replace(/\/$/, "");
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bot ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && !retried) {
        const payload = (await res.json()) as { retry_after?: number };
        const waitMs = Math.ceil((payload.retry_after ?? 1) * 1000);
        await new Promise((r) => setTimeout(r, waitMs));
        return this.request<T>(method, path, body, true);
      }
      if (res.status === 204) return { ok: true, data: undefined as T };
      const json = (await res.json()) as T & { message?: string };
      if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` };
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "discord unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Messages strictly after `afterId` (null = latest page), returned oldest-first. */
  async fetchMessagesAfter(
    channelId: string,
    afterId: string | null,
    limit = 50,
  ): Promise<Result<DiscordMessage[]>> {
    const after = afterId ? `&after=${afterId}` : "";
    const res = await this.request<DiscordMessage[]>(
      "GET",
      `/channels/${channelId}/messages?limit=${limit}${after}`,
    );
    if (!res.ok) return res;
    return { ok: true, data: [...res.data].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)) };
  }

  async replyToMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<Result<DiscordMessage>> {
    return this.request("POST", `/channels/${channelId}/messages`, {
      content,
      message_reference: { message_id: messageId },
    });
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<Result<void>> {
    return this.request(
      "PUT",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    );
  }

  async dmUser(userId: string, content: string): Promise<Result<DiscordMessage>> {
    const chan = await this.request<{ id: string }>("POST", "/users/@me/channels", {
      recipient_id: userId,
    });
    if (!chan.ok) return chan;
    return this.request("POST", `/channels/${chan.data.id}/messages`, { content });
  }

  /** Plain download — attachment URLs are pre-signed by Discord, no bot auth header. */
  async downloadAttachment(url: string): Promise<Result<Uint8Array>> {
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, data: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "download failed" };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/discord-plugin/src/discord-client.ts packages/discord-plugin/tests/discord-client.test.ts
git commit -m "feat(discord-plugin): discord REST client with 429 retry and DM support"
```

---

### Task 3: Spaces archive + receipt-meta serialization (TDD)

**Files:**
- Create: `packages/discord-plugin/src/spaces.ts`
- Create: `packages/discord-plugin/src/receipt-meta.ts`
- Test: `packages/discord-plugin/tests/spaces.test.ts`
- Test: `packages/discord-plugin/tests/receipt-meta.test.ts`

**Interfaces:**
- Consumes: `ReceiptMeta`, `ReceiptExtraction` from `src/types.ts`.
- Produces:

```typescript
// spaces.ts
export function receiptKeyFor(postedAtIso: string, messageId: string, attachmentId: string, filename: string): string;
export class ReceiptArchive {
  constructor(s3: S3ClientLike, bucket: string);
  static fromConfig(cfg: { spacesKey: string; spacesSecret: string; spacesBucket: string; spacesRegion: string; spacesEndpoint: string }): ReceiptArchive;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}
export interface S3ClientLike { send(command: unknown): Promise<unknown> } // enables fake in tests

// receipt-meta.ts
export const META_MARKER = "<!-- receipt-meta v1 -->";
export const EXTRACTION_MARKER = "<!-- receipt-extraction v1 -->";
export function renderMetaBlock(meta: ReceiptMeta): string;          // marker + fenced JSON
export function parseMetaBlock(text: string): ReceiptMeta | null;    // from issue description
export function renderExtractionComment(x: ReceiptExtraction): string;
export function parseExtractionComment(text: string): ReceiptExtraction | null;
```

- [ ] **Step 1: Write failing tests**

`tests/receipt-meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  renderMetaBlock, parseMetaBlock,
  renderExtractionComment, parseExtractionComment,
} from "../src/receipt-meta.js";
import type { ReceiptMeta, ReceiptExtraction } from "../src/types.js";

const meta: ReceiptMeta = {
  v: 1, spacesKey: "receipts/2026/07/x.jpg", discordChannelId: "c1",
  discordMessageId: "m1", discordAttachmentId: "a1",
  poster: "josh", postedAt: "2026-07-02T15:04:05Z", caption: "cash",
};

const extraction: ReceiptExtraction = {
  v: 1, vendor: "Tractor Supply", date: "2026-07-02", total: 84.12,
  payment_method: "card",
  line_items: [{ description: "fence wire", amount: 84.12 }],
  suggested_category: "Repairs & Maintenance", confidence: 0.95, flags: [],
};

describe("receipt-meta round trips", () => {
  it("meta block round-trips through issue description text", () => {
    const desc = `Receipt from josh.\n\n${renderMetaBlock(meta)}\n\nMore prose.`;
    expect(parseMetaBlock(desc)).toEqual(meta);
  });
  it("returns null when marker absent", () => {
    expect(parseMetaBlock("no marker here")).toBeNull();
  });
  it("extraction comment round-trips", () => {
    const comment = renderExtractionComment(extraction);
    expect(comment).toContain("Tractor Supply");           // human-readable part
    expect(parseExtractionComment(comment)).toEqual(extraction);
  });
  it("extraction parse tolerates surrounding prose", () => {
    const body = `Here you go.\n${renderExtractionComment(extraction)}\nthanks`;
    expect(parseExtractionComment(body)).toEqual(extraction);
  });
});
```

`tests/spaces.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ReceiptArchive, receiptKeyFor } from "../src/spaces.js";

describe("ReceiptArchive", () => {
  it("builds date-partitioned keys with message and attachment ids", () => {
    expect(
      receiptKeyFor("2026-07-02T15:04:05Z", "111", "222", "IMG 001.jpg"),
    ).toBe("receipts/2026/07/2026-07-02_111_222_IMG_001.jpg");
  });

  it("put sends a PutObjectCommand with bucket, key, body, content type", async () => {
    const sent: unknown[] = [];
    const archive = new ReceiptArchive({ send: async (c) => void sent.push(c) }, "bkt");
    await archive.put("k", new Uint8Array([1]), "image/jpeg");
    const input = (sent[0] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ Bucket: "bkt", Key: "k", ContentType: "image/jpeg" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement src/receipt-meta.ts**

```typescript
import type { ReceiptMeta, ReceiptExtraction } from "./types.js";

export const META_MARKER = "<!-- receipt-meta v1 -->";
export const EXTRACTION_MARKER = "<!-- receipt-extraction v1 -->";

function renderBlock(marker: string, payload: unknown): string {
  return `${marker}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

function parseBlock<T>(marker: string, text: string): T | null {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const fenceStart = text.indexOf("```json", at);
  if (fenceStart === -1) return null;
  const jsonStart = fenceStart + "```json".length;
  const fenceEnd = text.indexOf("```", jsonStart);
  if (fenceEnd === -1) return null;
  try {
    return JSON.parse(text.slice(jsonStart, fenceEnd)) as T;
  } catch {
    return null;
  }
}

export function renderMetaBlock(meta: ReceiptMeta): string {
  return renderBlock(META_MARKER, meta);
}

export function parseMetaBlock(text: string): ReceiptMeta | null {
  return parseBlock<ReceiptMeta>(META_MARKER, text);
}

export function renderExtractionComment(x: ReceiptExtraction): string {
  const lines = [
    `**${x.vendor}** — $${x.total.toFixed(2)} on ${x.date}`,
    `Category: **${x.suggested_category}** · Paid by ${x.payment_method} · confidence ${x.confidence.toFixed(2)}`,
    x.flags.length ? `Flags: ${x.flags.join(", ")}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${renderBlock(EXTRACTION_MARKER, x)}`;
}

export function parseExtractionComment(text: string): ReceiptExtraction | null {
  return parseBlock<ReceiptExtraction>(EXTRACTION_MARKER, text);
}
```

- [ ] **Step 4: Implement src/spaces.ts**

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

/** receipts/YYYY/MM/YYYY-MM-DD_<msgId>_<attId>_<safe-filename> — the single source of key naming. */
export function receiptKeyFor(
  postedAtIso: string,
  messageId: string,
  attachmentId: string,
  filename: string,
): string {
  const day = postedAtIso.slice(0, 10);
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `receipts/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}_${messageId}_${attachmentId}_${safe}`;
}

export class ReceiptArchive {
  constructor(
    private readonly s3: S3ClientLike,
    private readonly bucket: string,
  ) {}

  static fromConfig(cfg: {
    spacesKey: string;
    spacesSecret: string;
    spacesBucket: string;
    spacesRegion: string;
    spacesEndpoint: string;
  }): ReceiptArchive {
    const s3 = new S3Client({
      region: cfg.spacesRegion,
      endpoint: cfg.spacesEndpoint,
      credentials: { accessKeyId: cfg.spacesKey, secretAccessKey: cfg.spacesSecret },
    });
    return new ReceiptArchive(s3, cfg.spacesBucket);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.s3 as S3Client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/discord-plugin/src/spaces.ts packages/discord-plugin/src/receipt-meta.ts packages/discord-plugin/tests
git commit -m "feat(discord-plugin): spaces archive and receipt meta/extraction serialization"
```

---

### Task 4: Ingest job (TDD)

**Files:**
- Create: `packages/discord-plugin/src/ingest/job.ts`
- Test: `packages/discord-plugin/tests/ingest-job.test.ts`

**Interfaces:**
- Consumes: `DiscordClient` shape (Task 2), `ReceiptArchive` (Task 3), `renderMetaBlock` (Task 3), `ReceiptMeta`, `DiscordPluginConfig`.
- Produces `runIngest(deps): Promise<IngestSummary>` plus the narrow domain interfaces the worker adapts `ctx` into (openviking DI pattern — tests fake these, worker implements them with real `ctx`):

```typescript
export interface IngestDiscord {
  fetchMessagesAfter(channelId: string, afterId: string | null): Promise<Result<DiscordMessage[]>>;
  downloadAttachment(url: string): Promise<Result<Uint8Array>>;
}
export interface IngestArchive {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}
export interface IngestIssues {
  existsByOrigin(originId: string): Promise<boolean>;   // wraps ctx.issues.list({originKind, originId})
  createReceiptIssue(input: { title: string; description: string }): Promise<{ id: string }>;
}
export interface IngestState {
  getCursor(): Promise<string | null>;                  // wraps ctx.state instance-scope "cursor"
  setCursor(messageId: string): Promise<void>;
}
export interface IngestSummary { scanned: number; created: number; skippedDuplicates: number; skippedNonImages: number; failed: number; }
```

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { runIngest } from "../src/ingest/job.js";
import type { DiscordMessage } from "../src/discord-client.js";

const CFG = {
  receiptsChannelId: "chan",
  presignExpirySeconds: 604800,
} as const;

function msg(id: string, attachments: Array<{ id: string; filename: string; content_type?: string }>): DiscordMessage {
  return {
    id, channel_id: "chan",
    author: { id: "u1", username: "hannah" },
    content: "", timestamp: "2026-07-02T15:04:05Z",
    attachments: attachments.map((a) => ({ ...a, size: 10, url: `https://cdn/${a.id}` })),
  };
}

function makeFakes(messages: DiscordMessage[]) {
  const created: Array<{ title: string; description: string }> = [];
  const existing = new Set<string>();
  let cursor: string | null = null;
  const deps = {
    discord: {
      fetchMessagesAfter: async () => ({ ok: true as const, data: messages }),
      downloadAttachment: async () => ({ ok: true as const, data: new Uint8Array([1]) }),
    },
    archive: {
      put: async () => undefined,
      presignGet: async (key: string) => `https://signed/${key}`,
    },
    issues: {
      existsByOrigin: async (originId: string) => existing.has(originId),
      createReceiptIssue: async (input: { title: string; description: string }) => {
        created.push(input);
        return { id: `issue-${created.length}` };
      },
    },
    state: {
      getCursor: async () => cursor,
      setCursor: async (id: string) => void (cursor = id),
    },
    config: CFG,
    log: () => undefined,
  };
  return { deps, created, existing, cursorRef: () => cursor };
}

describe("runIngest", () => {
  it("creates one issue per image attachment and advances the cursor", async () => {
    const { deps, created, cursorRef } = makeFakes([
      msg("10", [{ id: "a", filename: "r1.jpg", content_type: "image/jpeg" }]),
      msg("11", [
        { id: "b", filename: "r2.jpg", content_type: "image/jpeg" },
        { id: "c", filename: "r3.pdf", content_type: "application/pdf" },
      ]),
    ]);
    const summary = await runIngest(deps);
    expect(summary).toMatchObject({ created: 3, failed: 0 });
    expect(created[0]!.description).toContain("receipt-meta v1");
    expect(created[0]!.description).toContain("https://signed/");
    expect(cursorRef()).toBe("11");
  });

  it("skips already-ingested attachments via originId", async () => {
    const { deps, existing, created } = makeFakes([msg("10", [{ id: "a", filename: "r.jpg", content_type: "image/jpeg" }])]);
    existing.add("10:a");
    const summary = await runIngest(deps);
    expect(summary.skippedDuplicates).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("ignores non-image, non-pdf attachments", async () => {
    const { deps, created } = makeFakes([msg("10", [{ id: "a", filename: "notes.txt", content_type: "text/plain" }])]);
    const summary = await runIngest(deps);
    expect(summary.skippedNonImages).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("does NOT advance cursor past a message whose issue creation failed", async () => {
    const { deps, cursorRef } = makeFakes([
      msg("10", [{ id: "a", filename: "r1.jpg", content_type: "image/jpeg" }]),
      msg("11", [{ id: "b", filename: "r2.jpg", content_type: "image/jpeg" }]),
    ]);
    deps.issues.createReceiptIssue = async (input: { title: string }) => {
      if (input.title.includes("11")) throw new Error("db down");
      return { id: "issue-1" };
    };
    const summary = await runIngest(deps);
    expect(summary.failed).toBe(1);
    expect(cursorRef()).toBe("10"); // stopped before the failing message
  });

  it("skips bot-authored messages (its own replies)", async () => {
    const m = msg("10", [{ id: "a", filename: "r.jpg", content_type: "image/jpeg" }]);
    m.author.bot = true;
    const { deps, created, cursorRef } = makeFakes([m]);
    await runIngest(deps);
    expect(created).toHaveLength(0);
    expect(cursorRef()).toBe("10"); // still consume it
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: FAIL — `runIngest` not found.

- [ ] **Step 3: Implement src/ingest/job.ts**

```typescript
import type { Result } from "../types.js";
import type { DiscordMessage } from "../discord-client.js";
import { renderMetaBlock } from "../receipt-meta.js";
import { receiptKeyFor } from "../spaces.js";

export interface IngestDiscord {
  fetchMessagesAfter(channelId: string, afterId: string | null): Promise<Result<DiscordMessage[]>>;
  downloadAttachment(url: string): Promise<Result<Uint8Array>>;
}

export interface IngestArchive {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}

export interface IngestIssues {
  existsByOrigin(originId: string): Promise<boolean>;
  createReceiptIssue(input: { title: string; description: string }): Promise<{ id: string }>;
}

export interface IngestState {
  getCursor(): Promise<string | null>;
  setCursor(messageId: string): Promise<void>;
}

export interface IngestSummary {
  scanned: number;
  created: number;
  skippedDuplicates: number;
  skippedNonImages: number;
  failed: number;
}

const RECEIPT_CONTENT_TYPES = /^(image\/|application\/pdf)/;

export async function runIngest(deps: {
  discord: IngestDiscord;
  archive: IngestArchive;
  issues: IngestIssues;
  state: IngestState;
  config: { receiptsChannelId: string; presignExpirySeconds: number };
  log: (msg: string) => void;
}): Promise<IngestSummary> {
  const summary: IngestSummary = { scanned: 0, created: 0, skippedDuplicates: 0, skippedNonImages: 0, failed: 0 };
  const cursor = await deps.state.getCursor();
  const fetched = await deps.discord.fetchMessagesAfter(deps.config.receiptsChannelId, cursor);
  if (!fetched.ok) {
    deps.log(`ingest: discord fetch failed: ${fetched.error}`);
    summary.failed += 1;
    return summary;
  }

  for (const message of fetched.data) {
    summary.scanned += 1;
    if (message.author.bot) {
      await deps.state.setCursor(message.id);
      continue;
    }
    try {
      for (const att of message.attachments) {
        if (!RECEIPT_CONTENT_TYPES.test(att.content_type ?? "")) {
          summary.skippedNonImages += 1;
          continue;
        }
        const originId = `${message.id}:${att.id}`;
        if (await deps.issues.existsByOrigin(originId)) {
          summary.skippedDuplicates += 1;
          continue;
        }
        const bytes = await deps.discord.downloadAttachment(att.url);
        if (!bytes.ok) throw new Error(`download ${att.filename}: ${bytes.error}`);
        const key = receiptKeyFor(message.timestamp, message.id, att.id, att.filename);
        await deps.archive.put(key, bytes.data, att.content_type ?? "application/octet-stream");
        const imageUrl = await deps.archive.presignGet(key, deps.config.presignExpirySeconds);
        const meta = {
          v: 1 as const,
          spacesKey: key,
          discordChannelId: message.channel_id,
          discordMessageId: message.id,
          discordAttachmentId: att.id,
          poster: message.author.username,
          postedAt: message.timestamp,
          caption: message.content,
        };
        const description = [
          `Receipt photo posted by **${message.author.username}** in #receipts on ${message.timestamp.slice(0, 10)}.`,
          message.content ? `Caption: "${message.content}"` : "",
          "",
          `Image (presigned, expires in ${Math.round(deps.config.presignExpirySeconds / 86400)}d): ${imageUrl}`,
          "",
          renderMetaBlock(meta),
        ]
          .filter((line) => line !== "")
          .join("\n");
        await deps.issues.createReceiptIssue({
          title: `RCPT ${message.timestamp.slice(0, 10)} from ${message.author.username} (${message.id}/${att.id})`,
          description,
        });
        summary.created += 1;
      }
      await deps.state.setCursor(message.id);
    } catch (err) {
      summary.failed += 1;
      deps.log(`ingest: stopping at message ${message.id}: ${err instanceof Error ? err.message : String(err)}`);
      break; // do not advance cursor; next run retries (originId dedup makes it safe)
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discord-plugin/src/ingest packages/discord-plugin/tests/ingest-job.test.ts
git commit -m "feat(discord-plugin): ingest job — poll, dedup by originId, archive, file issues"
```

---

### Task 5: Penny's tools (TDD)

**Files:**
- Create: `packages/discord-plugin/src/tools/record-extraction.ts`
- Create: `packages/discord-plugin/src/tools/request-retake.ts`
- Create: `packages/discord-plugin/src/tools/dismiss.ts`
- Create: `packages/discord-plugin/src/tools/reply.ts`
- Test: `packages/discord-plugin/tests/tools.test.ts`

**Interfaces:**
- Consumes: `parseMetaBlock`, `renderExtractionComment` (Task 3), `ReceiptExtraction`.
- Produces four handler functions the worker registers via `ctx.tools.register` (Task 8). All share this dependency shape:

```typescript
export interface ToolDeps {
  issues: {
    getDescription(issueId: string): Promise<string | null>;      // wraps ctx.issues.get(...).description
    createComment(issueId: string, body: string): Promise<void>;  // authorAgentId = Penny, set by worker
    setStatus(issueId: string, status: "in_review" | "blocked" | "cancelled"): Promise<void>;
  };
  discord: {
    replyToMessage(channelId: string, messageId: string, content: string): Promise<Result<unknown>>;
    react(channelId: string, messageId: string, emoji: string): Promise<Result<void>>;
  };
  archive: { putJson(key: string, value: unknown): Promise<void> };  // sidecar; worker adapts ReceiptArchive.put
  log: (msg: string) => void;
}
// Handlers (each returns a plain object the worker maps with toToolResult):
export async function handleRecordExtraction(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>>;
export async function handleRequestRetake(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>>;
export async function handleDismiss(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>>;
export async function handleReply(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>>;
```

Tool parameter contracts (also used verbatim in Task 8's `parametersSchema`):
- `receipt_record_extraction`: `{ issueId: string, extraction: ReceiptExtraction }` — validates extraction, writes sidecar JSON to Spaces at `<spacesKey>.json`, posts extraction comment, replies in the Discord thread, sets status `in_review`.
- `receipt_request_retake`: `{ issueId: string, reason: string }` — replies in-thread asking for a better photo, sets status `blocked`.
- `receipt_dismiss`: `{ issueId: string, reason: string }` — reacts 🤷 on the source message, sets status `cancelled`.
- `discord_reply`: `{ issueId: string, message: string }` — free-form in-thread reply (poster Q&A).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { handleRecordExtraction, handleRequestRetake, handleDismiss, handleReply } from "../src/tools/index.js";
import { renderMetaBlock } from "../src/receipt-meta.js";
import type { ReceiptMeta } from "../src/types.js";

const meta: ReceiptMeta = {
  v: 1, spacesKey: "receipts/2026/07/x.jpg", discordChannelId: "c1",
  discordMessageId: "m1", discordAttachmentId: "a1",
  poster: "hannah", postedAt: "2026-07-02T15:04:05Z", caption: "",
};

const extraction = {
  v: 1, vendor: "Tractor Supply", date: "2026-07-02", total: 84.12,
  payment_method: "card", line_items: [], suggested_category: "Repairs & Maintenance",
  confidence: 0.95, flags: [],
};

function makeDeps(description: string | null = `intro\n${renderMetaBlock(meta)}`) {
  const calls = {
    comments: [] as string[], statuses: [] as string[],
    replies: [] as string[], reacts: [] as string[], sidecars: [] as Array<{ key: string; value: unknown }>,
  };
  const deps = {
    issues: {
      getDescription: async () => description,
      createComment: async (_id: string, body: string) => void calls.comments.push(body),
      setStatus: async (_id: string, s: string) => void calls.statuses.push(s),
    },
    discord: {
      replyToMessage: async (_c: string, _m: string, content: string) => {
        calls.replies.push(content);
        return { ok: true as const, data: {} };
      },
      react: async (_c: string, _m: string, emoji: string) => {
        calls.reacts.push(emoji);
        return { ok: true as const, data: undefined };
      },
    },
    archive: { putJson: async (key: string, value: unknown) => void calls.sidecars.push({ key, value }) },
    log: () => undefined,
  };
  return { deps, calls };
}

describe("receipt_record_extraction", () => {
  it("writes sidecar, comments, replies in thread, sets in_review", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction });
    expect(out.error).toBeUndefined();
    expect(calls.sidecars[0]).toMatchObject({ key: "receipts/2026/07/x.jpg.json" });
    expect(calls.comments[0]).toContain("receipt-extraction v1");
    expect(calls.replies[0]).toContain("Tractor Supply");
    expect(calls.statuses).toEqual(["in_review"]);
  });

  it("rejects malformed extraction without side effects", async () => {
    const { deps, calls } = makeDeps();
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction: { vendor: 42 } });
    expect(typeof out.error).toBe("string");
    expect(calls.statuses).toHaveLength(0);
    expect(calls.sidecars).toHaveLength(0);
  });

  it("errors when issue has no receipt-meta block", async () => {
    const { deps } = makeDeps("plain description");
    const out = await handleRecordExtraction(deps, { issueId: "i1", extraction });
    expect(out.error).toContain("receipt-meta");
  });
});

describe("receipt_request_retake", () => {
  it("replies with reason and blocks the issue", async () => {
    const { deps, calls } = makeDeps();
    await handleRequestRetake(deps, { issueId: "i1", reason: "total is cut off" });
    expect(calls.replies[0]).toContain("total is cut off");
    expect(calls.statuses).toEqual(["blocked"]);
  });
});

describe("receipt_dismiss", () => {
  it("reacts 🤷 and cancels", async () => {
    const { deps, calls } = makeDeps();
    await handleDismiss(deps, { issueId: "i1", reason: "not a receipt" });
    expect(calls.reacts).toEqual(["🤷"]);
    expect(calls.statuses).toEqual(["cancelled"]);
  });
});

describe("discord_reply", () => {
  it("posts a free-form thread reply", async () => {
    const { deps, calls } = makeDeps();
    await handleReply(deps, { issueId: "i1", message: "which card was this on?" });
    expect(calls.replies).toEqual(["which card was this on?"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: FAIL — `../src/tools/index.js` not found.

- [ ] **Step 3: Implement the tools**

`src/tools/index.ts`:

```typescript
export { handleRecordExtraction, type ToolDeps } from "./record-extraction.js";
export { handleRequestRetake } from "./request-retake.js";
export { handleDismiss } from "./dismiss.js";
export { handleReply } from "./reply.js";
```

`src/tools/record-extraction.ts`:

```typescript
import type { Result, ReceiptExtraction, ReceiptMeta } from "../types.js";
import { parseMetaBlock, renderExtractionComment } from "../receipt-meta.js";

export interface ToolDeps {
  issues: {
    getDescription(issueId: string): Promise<string | null>;
    createComment(issueId: string, body: string): Promise<void>;
    setStatus(issueId: string, status: "in_review" | "blocked" | "cancelled"): Promise<void>;
  };
  discord: {
    replyToMessage(channelId: string, messageId: string, content: string): Promise<Result<unknown>>;
    react(channelId: string, messageId: string, emoji: string): Promise<Result<void>>;
  };
  archive: { putJson(key: string, value: unknown): Promise<void> };
  log: (msg: string) => void;
}

export async function resolveMeta(deps: ToolDeps, issueId: string): Promise<ReceiptMeta | null> {
  const description = await deps.issues.getDescription(issueId);
  return description ? parseMetaBlock(description) : null;
}

function validateExtraction(raw: unknown): ReceiptExtraction | string {
  if (typeof raw !== "object" || raw === null) return "extraction must be an object";
  const x = raw as Record<string, unknown>;
  if (typeof x.vendor !== "string" || x.vendor.length === 0) return "vendor must be a non-empty string";
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return "date must be YYYY-MM-DD";
  if (typeof x.total !== "number" || !(x.total > 0)) return "total must be a positive number";
  if (!["card", "cash", "check", "unknown"].includes(x.payment_method as string)) return "invalid payment_method";
  if (typeof x.suggested_category !== "string" || x.suggested_category.length === 0) return "suggested_category required";
  if (typeof x.confidence !== "number" || x.confidence < 0 || x.confidence > 1) return "confidence must be 0..1";
  if (!Array.isArray(x.flags)) return "flags must be an array";
  if (!Array.isArray(x.line_items)) return "line_items must be an array";
  return { ...(x as unknown as ReceiptExtraction), v: 1 };
}

export async function handleRecordExtraction(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, extraction: raw } = (params ?? {}) as { issueId?: string; extraction?: unknown };
  if (!issueId) return { error: "issueId is required" };
  const validated = validateExtraction(raw);
  if (typeof validated === "string") return { error: `invalid extraction: ${validated}` };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block — is this a receipt issue?" };

  await deps.archive.putJson(`${meta.spacesKey}.json`, validated);
  await deps.issues.createComment(issueId, renderExtractionComment(validated));
  const cashNote = validated.payment_method === "cash" ? " (cash — will need Quick Add, not just attach)" : "";
  const reply = await deps.discord.replyToMessage(
    meta.discordChannelId,
    meta.discordMessageId,
    `✅ ${validated.vendor} — $${validated.total.toFixed(2)} on ${validated.date} → **${validated.suggested_category}**${cashNote}. Pending Josh's review.`,
  );
  if (!reply.ok) deps.log(`record-extraction: discord reply failed: ${reply.error}`);
  await deps.issues.setStatus(issueId, "in_review");
  return { recorded: true, sidecar: `${meta.spacesKey}.json` };
}
```

`src/tools/request-retake.ts`:

```typescript
import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleRequestRetake(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, reason } = (params ?? {}) as { issueId?: string; reason?: string };
  if (!issueId || !reason) return { error: "issueId and reason are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const reply = await deps.discord.replyToMessage(
    meta.discordChannelId,
    meta.discordMessageId,
    `📷 I couldn't read this receipt — ${reason}. Mind posting another shot (flat, all four corners visible)?`,
  );
  if (!reply.ok) return { error: `discord reply failed: ${reply.error}` };
  await deps.issues.setStatus(issueId, "blocked");
  return { requested: true };
}
```

`src/tools/dismiss.ts`:

```typescript
import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleDismiss(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, reason } = (params ?? {}) as { issueId?: string; reason?: string };
  if (!issueId || !reason) return { error: "issueId and reason are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const react = await deps.discord.react(meta.discordChannelId, meta.discordMessageId, "🤷");
  if (!react.ok) deps.log(`dismiss: react failed: ${react.error}`);
  await deps.issues.setStatus(issueId, "cancelled");
  return { dismissed: true, reason };
}
```

`src/tools/reply.ts`:

```typescript
import type { ToolDeps } from "./record-extraction.js";
import { resolveMeta } from "./record-extraction.js";

export async function handleReply(deps: ToolDeps, params: unknown): Promise<Record<string, unknown>> {
  const { issueId, message } = (params ?? {}) as { issueId?: string; message?: string };
  if (!issueId || !message) return { error: "issueId and message are required" };
  const meta = await resolveMeta(deps, issueId);
  if (!meta) return { error: "issue has no receipt-meta block" };
  const reply = await deps.discord.replyToMessage(meta.discordChannelId, meta.discordMessageId, message);
  if (!reply.ok) return { error: `discord reply failed: ${reply.error}` };
  return { sent: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discord-plugin/src/tools packages/discord-plugin/tests/tools.test.ts
git commit -m "feat(discord-plugin): penny tools — record extraction, retake, dismiss, reply"
```

---

### Task 6: Weekly digest job (TDD)

**Files:**
- Create: `packages/discord-plugin/src/digest/job.ts`
- Test: `packages/discord-plugin/tests/digest-job.test.ts`

**Interfaces:**
- Consumes: `parseMetaBlock`, `parseExtractionComment` (Task 3).
- Produces:

```typescript
export interface DigestIssues {
  listInReview(): Promise<Array<{ id: string; title: string; description: string }>>; // wraps ctx.issues.list({status:"in_review", originKindPrefix:"plugin:agenticos.discord-plugin"})
  listComments(issueId: string): Promise<string[]>; // comment bodies, oldest first
}
export interface DigestDiscord { dmUser(userId: string, content: string): Promise<Result<unknown>> }
export interface DigestArchive { presignGet(key: string, expiresInSeconds: number): Promise<string> }
export async function runDigest(deps: {
  issues: DigestIssues; discord: DigestDiscord; archive: DigestArchive;
  config: { joshDiscordUserId: string; presignExpirySeconds: number };
  log: (msg: string) => void;
}): Promise<{ receipts: number; sent: boolean }>;
```

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { runDigest } from "../src/digest/job.js";
import { renderMetaBlock, renderExtractionComment } from "../src/receipt-meta.js";
import type { ReceiptMeta, ReceiptExtraction } from "../src/types.js";

function receipt(n: number, payment: "card" | "cash"): { meta: ReceiptMeta; extraction: ReceiptExtraction } {
  return {
    meta: {
      v: 1, spacesKey: `receipts/2026/07/r${n}.jpg`, discordChannelId: "c",
      discordMessageId: `m${n}`, discordAttachmentId: `a${n}`,
      poster: "hannah", postedAt: "2026-07-02T15:04:05Z", caption: "",
    },
    extraction: {
      v: 1, vendor: `Vendor${n}`, date: "2026-07-02", total: 10 * n,
      payment_method: payment, line_items: [], suggested_category: "Supplies",
      confidence: 0.9, flags: [],
    },
  };
}

function makeDeps(items: Array<ReturnType<typeof receipt>>) {
  const dms: string[] = [];
  const deps = {
    issues: {
      listInReview: async () =>
        items.map((it, i) => ({ id: `i${i}`, title: `RCPT ${i}`, description: renderMetaBlock(it.meta) })),
      listComments: async (issueId: string) => {
        const idx = Number(issueId.slice(1));
        return ["some chatter", renderExtractionComment(items[idx]!.extraction)];
      },
    },
    discord: { dmUser: async (_u: string, content: string) => { dms.push(content); return { ok: true as const, data: {} }; } },
    archive: { presignGet: async (key: string) => `https://signed/${key}` },
    config: { joshDiscordUserId: "josh", presignExpirySeconds: 604800 },
    log: () => undefined,
  };
  return { deps, dms };
}

describe("runDigest", () => {
  it("sends one DM listing every in_review receipt with fresh links", async () => {
    const { deps, dms } = makeDeps([receipt(1, "card"), receipt(2, "cash")]);
    const out = await runDigest(deps);
    expect(out).toEqual({ receipts: 2, sent: true });
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain("Vendor1");
    expect(dms[0]).toContain("https://signed/receipts/2026/07/r1.jpg");
    expect(dms[0]).toContain("Quick Add"); // cash receipt marked
  });

  it("sends nothing when queue is empty", async () => {
    const { deps, dms } = makeDeps([]);
    const out = await runDigest(deps);
    expect(out).toEqual({ receipts: 0, sent: false });
    expect(dms).toHaveLength(0);
  });

  it("includes issues whose extraction comment is missing as needs-attention", async () => {
    const { deps, dms } = makeDeps([receipt(1, "card")]);
    deps.issues.listComments = async () => ["no extraction here"];
    const out = await runDigest(deps);
    expect(out.receipts).toBe(1);
    expect(dms[0]).toContain("needs attention");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: FAIL — `runDigest` not found.

- [ ] **Step 3: Implement src/digest/job.ts**

```typescript
import type { Result } from "../types.js";
import { parseMetaBlock, parseExtractionComment } from "../receipt-meta.js";

export interface DigestIssues {
  listInReview(): Promise<Array<{ id: string; title: string; description: string }>>;
  listComments(issueId: string): Promise<string[]>;
}

export interface DigestDiscord {
  dmUser(userId: string, content: string): Promise<Result<unknown>>;
}

export interface DigestArchive {
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
}

export async function runDigest(deps: {
  issues: DigestIssues;
  discord: DigestDiscord;
  archive: DigestArchive;
  config: { joshDiscordUserId: string; presignExpirySeconds: number };
  log: (msg: string) => void;
}): Promise<{ receipts: number; sent: boolean }> {
  const pending = await deps.issues.listInReview();
  if (pending.length === 0) return { receipts: 0, sent: false };

  const lines: string[] = [`**🧾 Receipt attach pass — ${pending.length} ready**`, ""];
  for (const issue of pending) {
    const meta = parseMetaBlock(issue.description);
    const comments = await deps.issues.listComments(issue.id);
    const extraction = comments.map(parseExtractionComment).filter((x) => x !== null).at(-1) ?? null;
    if (!meta || !extraction) {
      lines.push(`- ⚠️ ${issue.title} — needs attention (missing metadata or extraction)`);
      continue;
    }
    const link = await deps.archive.presignGet(meta.spacesKey, deps.config.presignExpirySeconds);
    const cash = extraction.payment_method === "cash" ? " · **cash — create via Quick Add**" : "";
    const flags = extraction.flags.length ? ` · flags: ${extraction.flags.join(", ")}` : "";
    lines.push(
      `- **${extraction.vendor}** $${extraction.total.toFixed(2)} (${extraction.date}) → ${extraction.suggested_category}${cash}${flags} · [image](${link})`,
    );
  }
  lines.push("", "After attaching in FarmRaise, close each issue in Vista (drag to Done). Skipped items roll into next week.");

  const sent = await deps.discord.dmUser(deps.config.joshDiscordUserId, lines.join("\n"));
  if (!sent.ok) {
    deps.log(`digest: DM failed: ${sent.error}`);
    return { receipts: pending.length, sent: false };
  }
  return { receipts: pending.length, sent: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agenticos/discord-plugin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discord-plugin/src/digest packages/discord-plugin/tests/digest-job.test.ts
git commit -m "feat(discord-plugin): sunday digest job — DM the in_review attach list"
```

---

### Task 7: Worker wiring

**Files:**
- Modify: `packages/discord-plugin/src/worker.ts` (replace the Task 1 stub)

**Interfaces:**
- Consumes: everything produced by Tasks 2–6. Adapts real `ctx.*` clients into the narrow domain interfaces.
- Produces: registered jobs `receipt-ingest`, `weekly-digest`; registered tools `receipt_record_extraction`, `receipt_request_retake`, `receipt_dismiss`, `discord_reply`; data provider `discord-health`.

- [ ] **Step 1: Implement the full worker**

```typescript
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { DiscordPluginConfig } from "./types.js";
import { DiscordClient } from "./discord-client.js";
import { ReceiptArchive } from "./spaces.js";
import { runIngest } from "./ingest/job.js";
import { runDigest } from "./digest/job.js";
import {
  handleRecordExtraction,
  handleRequestRetake,
  handleDismiss,
  handleReply,
  type ToolDeps,
} from "./tools/index.js";

const ORIGIN_KIND = "plugin:agenticos.discord-plugin" as const;

/** Map a handler's domain result onto the SDK ToolResult contract. */
function toToolResult(out: Record<string, unknown>): ToolResult {
  if (typeof out.error === "string") return { error: out.error };
  return { data: out };
}

function readConfig(raw: Record<string, unknown>): DiscordPluginConfig {
  const required = [
    "discordBotToken", "receiptsChannelId", "companyId",
    "pennyAgentId", "joshDiscordUserId", "spacesKey", "spacesSecret",
  ] as const;
  for (const key of required) {
    if (typeof raw[key] !== "string" || raw[key] === "") throw new Error(`discord-plugin config missing: ${key}`);
  }
  return {
    discordBotToken: String(raw.discordBotToken),
    receiptsChannelId: String(raw.receiptsChannelId),
    companyId: String(raw.companyId),
    pennyAgentId: String(raw.pennyAgentId),
    joshDiscordUserId: String(raw.joshDiscordUserId),
    spacesKey: String(raw.spacesKey),
    spacesSecret: String(raw.spacesSecret),
    spacesBucket: String(raw.spacesBucket ?? "agenticos-receipts"),
    spacesRegion: String(raw.spacesRegion ?? "nyc3"),
    spacesEndpoint: String(raw.spacesEndpoint ?? "https://nyc3.digitaloceanspaces.com"),
    presignExpirySeconds: Number(raw.presignExpirySeconds ?? 604800),
  };
}

function buildToolDeps(ctx: PluginContext, cfg: DiscordPluginConfig, discord: DiscordClient, archive: ReceiptArchive): ToolDeps {
  return {
    issues: {
      getDescription: async (issueId) => (await ctx.issues.get(issueId, cfg.companyId))?.description ?? null,
      createComment: async (issueId, body) => {
        await ctx.issues.createComment(issueId, body, cfg.companyId, { authorAgentId: cfg.pennyAgentId });
      },
      setStatus: async (issueId, status) => {
        await ctx.issues.update(issueId, { status }, cfg.companyId);
      },
    },
    discord: {
      replyToMessage: (c, m, text) => discord.replyToMessage(c, m, text),
      react: (c, m, e) => discord.react(c, m, e),
    },
    archive: {
      putJson: (key, value) =>
        archive.put(key, new TextEncoder().encode(JSON.stringify(value, null, 2)), "application/json"),
    },
    log: (msg) => ctx.logger.info(msg),
  };
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    issueId: { type: "string", description: "The receipt issue id you are working on" },
    extraction: {
      type: "object",
      properties: {
        vendor: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD as printed on the receipt" },
        total: { type: "number" },
        payment_method: { type: "string", enum: ["card", "cash", "check", "unknown"] },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: { description: { type: "string" }, amount: { type: "number" } },
            required: ["description", "amount"],
          },
        },
        suggested_category: { type: "string", description: "Schedule F or custom category" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        flags: { type: "array", items: { type: "string" } },
      },
      required: ["vendor", "date", "total", "payment_method", "suggested_category", "confidence", "flags", "line_items"],
    },
  },
  required: ["issueId", "extraction"],
} as const;

const plugin = definePlugin({
  async setup(ctx) {
    const cfg = readConfig(await ctx.config.get());
    const discord = new DiscordClient({ token: cfg.discordBotToken });
    const archive = ReceiptArchive.fromConfig(cfg);
    const toolDeps = buildToolDeps(ctx, cfg, discord, archive);
    const cursorKey = { scopeKind: "instance" as const, stateKey: "receipts-cursor" };

    ctx.jobs.register("receipt-ingest", async () => {
      const summary = await runIngest({
        discord,
        archive,
        issues: {
          existsByOrigin: async (originId) => {
            const hits = await ctx.issues.list({
              companyId: cfg.companyId,
              originKind: ORIGIN_KIND,
              originId,
              limit: 1,
            });
            return hits.length > 0;
          },
          createReceiptIssue: async ({ title, description }) => {
            const issue = await ctx.issues.create({
              companyId: cfg.companyId,
              title,
              description,
              status: "todo",
              priority: "medium",
              assigneeAgentId: cfg.pennyAgentId,
              originKind: ORIGIN_KIND,
              originId: /\((\S+)\)$/.exec(title)?.[1]?.replace("/", ":") ?? null,
            });
            return { id: issue.id };
          },
        },
        state: {
          getCursor: async () => (await ctx.state.get(cursorKey)) as string | null,
          setCursor: (id) => ctx.state.set(cursorKey, id),
        },
        config: cfg,
        log: (msg) => ctx.logger.info(msg),
      });
      ctx.logger.info("receipt-ingest complete", summary);
    });

    ctx.jobs.register("weekly-digest", async () => {
      const summary = await runDigest({
        issues: {
          listInReview: async () => {
            const issues = await ctx.issues.list({
              companyId: cfg.companyId,
              originKindPrefix: "plugin:agenticos.discord-plugin",
              status: "in_review",
              limit: 100,
            });
            return issues.map((i) => ({ id: i.id, title: i.title, description: i.description ?? "" }));
          },
          listComments: async (issueId) =>
            (await ctx.issues.listComments(issueId, cfg.companyId)).map((c) => c.body),
        },
        discord,
        archive,
        config: cfg,
        log: (msg) => ctx.logger.info(msg),
      });
      ctx.logger.info("weekly-digest complete", summary);
    });

    ctx.tools.register(
      "receipt_record_extraction",
      {
        displayName: "Record receipt extraction",
        description:
          "Record your extraction for a receipt issue: writes the Spaces sidecar, posts the extraction comment, replies in the Discord thread, and stages the issue for Josh's review (in_review). Call exactly once per receipt after reading the image.",
        parametersSchema: EXTRACTION_SCHEMA,
      },
      async (params) => toToolResult(await handleRecordExtraction(toolDeps, params)),
    );

    ctx.tools.register(
      "receipt_request_retake",
      {
        displayName: "Request receipt retake",
        description: "Ask the poster for a better photo when the receipt is unreadable (confidence < 0.7). Blocks the issue.",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, reason: { type: "string" } },
          required: ["issueId", "reason"],
        },
      },
      async (params) => toToolResult(await handleRequestRetake(toolDeps, params)),
    );

    ctx.tools.register(
      "receipt_dismiss",
      {
        displayName: "Dismiss non-receipt",
        description: "Dismiss an image that is not a receipt (reacts 🤷 on Discord, cancels the issue).",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, reason: { type: "string" } },
          required: ["issueId", "reason"],
        },
      },
      async (params) => toToolResult(await handleDismiss(toolDeps, params)),
    );

    ctx.tools.register(
      "discord_reply",
      {
        displayName: "Reply in receipt thread",
        description: "Free-form reply in the Discord thread of a receipt issue (e.g. to ask the poster a question).",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, message: { type: "string" } },
          required: ["issueId", "message"],
        },
      },
      async (params) => toToolResult(await handleReply(toolDeps, params)),
    );

    ctx.data.register("discord-health", async () => ({ status: "ok", channel: cfg.receiptsChannelId }));
  },
  async onHealth() {
    return { status: "ok" };
  },
});

runWorker(plugin);
```

Note on `originId` in `createReceiptIssue`: the regex re-derives `<msgId>:<attId>` from the title suffix `(msgId/attId)` produced by the ingest job. If reviewers prefer, thread `originId` through `IngestIssues.createReceiptIssue` as an explicit third field instead — that is the cleaner change; keep the ingest test in sync.

- [ ] **Step 2: Build, typecheck, full test suite**

Run: `pnpm --filter @agenticos/discord-plugin build && pnpm --filter @agenticos/discord-plugin typecheck && pnpm --filter @agenticos/discord-plugin test`
Expected: all green. Fix any drift between the SDK's actual types and the adapter code here (the SDK signatures were verified against `vendor/paperclip/packages/plugins/sdk/src/types.ts` on 2026-07-04).

- [ ] **Step 3: Commit**

```bash
git add packages/discord-plugin/src/worker.ts
git commit -m "feat(discord-plugin): wire jobs, tools, and health provider in worker"
```

---

### Task 8: Deploy wiring — compose mount, secret sync, runbook

**Files:**
- Modify: `docker-compose.yml` (plugin mounts block, near lines 299–302)
- Modify: `scripts/sync-paperclip-secrets.sh`
- Create: `docs/runbooks/discord-receipts.md`

- [ ] **Step 1: Add the compose mount** — in `docker-compose.yml`, extend the existing plugin volumes block on the paperclip-server service:

```yaml
      - ./packages/vault-plugin:/paperclip/plugins/vault-plugin:ro
      - ./packages/openviking-plugin:/paperclip/plugins/openviking-plugin:ro
      - ./packages/github-plugin:/paperclip/plugins/github-plugin:ro
      - ./packages/github-sync-plugin:/paperclip/plugins/github-sync-plugin:ro
      - ./packages/discord-plugin:/paperclip/plugins/discord-plugin:ro   # ADD THIS LINE
```

- [ ] **Step 2: Extend scripts/sync-paperclip-secrets.sh** — add a discord-plugin block following the script's existing `op_read` + `jq -nc` + `api POST` helpers exactly (match the github block's shape; read the script first and mirror its variable naming and guards):

```bash
# --- discord-plugin (receipts) -------------------------------------------
if [[ -n "${DISCORD_PLUGIN_ID:-}" ]]; then
  discord_token="$(op_read discord-bot-token)"
  spaces_key="$(op_read spaces-receipts-key)"
  spaces_secret="$(op_read spaces-receipts-secret)"
  cfg="$(jq -nc \
    --arg t "$discord_token" \
    --arg chan "${DISCORD_RECEIPTS_CHANNEL_ID:?set DISCORD_RECEIPTS_CHANNEL_ID}" \
    --arg co "${PAPERCLIP_COMPANY_ID:?set PAPERCLIP_COMPANY_ID}" \
    --arg penny "${PENNY_AGENT_ID:?set PENNY_AGENT_ID}" \
    --arg josh "${JOSH_DISCORD_USER_ID:?set JOSH_DISCORD_USER_ID}" \
    --arg sk "$spaces_key" --arg ss "$spaces_secret" \
    '{configJson:{discordBotToken:$t, receiptsChannelId:$chan, companyId:$co,
      pennyAgentId:$penny, joshDiscordUserId:$josh,
      spacesKey:$sk, spacesSecret:$ss,
      spacesBucket:"agenticos-receipts", spacesRegion:"nyc3",
      spacesEndpoint:"https://nyc3.digitaloceanspaces.com",
      presignExpirySeconds:604800}}')"
  api POST "/api/plugins/${DISCORD_PLUGIN_ID}/config" "$cfg" >/dev/null
  echo "synced discord-plugin config"
fi
```

Add the three new 1Password fields (`discord-bot-token`, `spaces-receipts-key`, `spaces-receipts-secret`) to the same 1Password item the script already reads (`OP_VAULT`/`OP_ITEM` at the top of the script).

- [ ] **Step 3: Write docs/runbooks/discord-receipts.md** with this content:

```markdown
# Discord Receipts Pipeline — Setup & Operations

Spec: ~/AgenticOS-Vault/sources/2026-07-04-penny-receipt-pipeline-design.md
Plugin: packages/discord-plugin (`agenticos.discord-plugin`)

## One-time setup

1. **Discord bot**: discord.com/developers → New Application "Grove Receipts" →
   Bot tab → copy token into 1Password (`discord-bot-token`). No privileged
   intents needed (REST polling only, MESSAGE CONTENT via bot scope on small guilds).
   OAuth2 URL generator: scope `bot`, permissions: View Channel, Send Messages,
   Read Message History, Add Reactions. Invite to the family server.
2. **Channel**: create `#receipts`; right-click → Copy Channel ID (enable
   Developer Mode in Discord settings if the option is missing). For Phase 0,
   create `#receipts-test` and use ITS id first.
3. **Spaces**: DO console → Spaces → create bucket `agenticos-receipts` (nyc3,
   private). Generate a Spaces access key pair scoped to this bucket; store as
   `spaces-receipts-key` / `spaces-receipts-secret` in 1Password.
4. **IDs**:
   - Company: `docker exec -it agenticos-db psql -U paperclip -c "SELECT id, name FROM companies;"`
   - Penny:   `docker exec -it agenticos-db psql -U paperclip -c "SELECT id, name FROM agents WHERE name ILIKE '%penny%';"`
   - Josh's Discord user id: right-click avatar → Copy User ID.
5. **Sync config**: on the droplet,
   `DISCORD_PLUGIN_ID=agenticos.discord-plugin DISCORD_RECEIPTS_CHANNEL_ID=... PAPERCLIP_COMPANY_ID=... PENNY_AGENT_ID=... JOSH_DISCORD_USER_ID=... ./scripts/sync-paperclip-secrets.sh`
6. **Deploy**: rebuild + restart paperclip-server (`docker compose up -d --build paperclip-server`).
   Verify plugin loaded: server logs show `discord-plugin setup` and the two jobs
   appear in the board's plugin/jobs view.

## Phase 0 smoke test (in #receipts-test)

- [ ] Post a clear receipt photo → within 10 min an issue `RCPT ...` exists, assigned to Penny.
- [ ] Spaces bucket has `receipts/YYYY/MM/...` object; presigned link in the issue description opens.
- [ ] Penny processes it: extraction comment on the issue, ✅ reply in the thread, status `in_review`, sidecar `.json` next to the image in Spaces.
- [ ] Post the SAME photo again → no duplicate issue (originId dedup).
- [ ] Post a meme → Penny dismisses: 🤷 react, issue cancelled.
- [ ] Post a deliberately blurry receipt → Penny asks for a retake, issue `blocked`.
- [ ] Trigger `weekly-digest` manually from the board (Jobs → Run) → Josh gets the DM with working image links.

## Phase 1 → 2 rollout

- Phase 1 (shadow week): repoint `receiptsChannelId` to the real `#receipts` via the
  sync script; family keeps existing habits in parallel. Success = zero dropped
  receipts, acceptable categories, one clean Sunday digest.
- Phase 2 (live): pin Penny's how-to message in `#receipts`; announce.

## Operations

- **Weekly**: Sunday digest DM → attach pass in FarmRaise → close issues in Vista
  (drag to Done). Cash receipts: create via Quick Add in FarmRaise, then close.
- **Corrections**: fix the category directly in FarmRaise; leave a one-line comment
  on the issue before closing (Penny reviews corrections weekly and viking_remembers them).
- **Cursor reset** (reprocess history): delete plugin state key `receipts-cursor`
  via the board's plugin state view, or set it to a message id to resume from.
- **Presigned links expire after 7 days**; the digest always re-signs, so use the
  newest digest's links.

## Failure modes

- Bot token revoked → ingest job logs `discord fetch failed: 401`; re-run sync script with new token.
- Spaces outage → ingest halts (cursor does not advance); recovers on next run.
- Penny miscategorizing repeatedly → tighten the category list in her duty block
  (docs/personas/penny-receipt-clerk.md) and re-apply.
```

- [ ] **Step 4: Validate compose file**

Run: `docker compose -f docker-compose.yml config --quiet && echo OK`
Expected: `OK` (run locally; it validates YAML without needing the droplet).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml scripts/sync-paperclip-secrets.sh docs/runbooks/discord-receipts.md
git commit -m "infra(compose): mount discord-plugin; sync script + receipts runbook"
```

---

### Task 9: Penny's receipt-clerk duty block

**Files:**
- Create: `docs/personas/penny-receipt-clerk.md` (applied to Penny's instructions via the board UI — manual step, flagged below)

- [ ] **Step 1: Write the duty block** — create the file with exactly this content:

```markdown
# Duty: Receipt Clerk (Discord → FarmRaise pipeline)

You process receipt issues created by the Discord plugin (issues titled `RCPT ...`,
assigned to you). For each one:

1. **Get the image.** The issue description contains a presigned image URL.
   Download it to a temp file and read it:
   `curl -sL -o /tmp/receipt.jpg "<url>"` then view /tmp/receipt.jpg.
2. **Classify first.** If it is not a purchase receipt/invoice (meme, random photo,
   screenshot of something else), call `receipt_dismiss` with a short reason. Stop.
3. **Extract.** Read vendor, date (as printed), total, payment method, and line
   items. The poster's caption is a hint (e.g. "cash", "for the nursery").
4. **Categorize** using this list (Schedule F unless noted):
   - Chemicals · Conservation expenses · Custom hire · Depreciation-eligible
     equipment (flag it) · Feed · Fertilizers and lime · Freight and trucking ·
     Gasoline, fuel, oil · Insurance · Mortgage interest · Other interest ·
     Labor hired · Rent (equipment) · Rent (land) · Repairs & Maintenance ·
     Seeds and plants · Storage and warehousing · Supplies · Taxes · Utilities ·
     Veterinary/breeding/medicine · Other (say what)
   Custom categories: Nursery stock (At The Grove) · Woodshop materials (GGG) ·
   Market fees & booth costs.
5. **Sanity checks** — add to `flags` when true:
   - `possible-duplicate`: you have seen the same vendor+date+total in another issue.
   - `looks-personal`: groceries, restaurants, entertainment — anything not plausibly
     farm/nursery/woodshop business.
   - `depreciation-candidate`: single item over $2,500.
6. **Record.** If confidence ≥ 0.7: call `receipt_record_extraction` once with the
   full extraction JSON. If confidence < 0.7 (blurry, cut off, unreadable total):
   call `receipt_request_retake` with what you need instead. Never guess a total.
7. **Never finalize.** You stage for Josh's review (`in_review`); you do not mark
   receipts done, and you do not touch FarmRaise.

**Weekly self-calibration:** when Josh closes receipt issues, check for correction
comments (a different category than you suggested). For each correction, call
`viking_remember` with vendor → corrected category so you improve. Apply known
corrections to future receipts from the same vendor.

**Questions:** if you genuinely need info only the poster has (e.g. which business
a generic purchase was for), use `discord_reply` — one concise question, then
proceed when answered on the next heartbeat.
```

- [ ] **Step 2: Apply to Penny (manual, Josh)** — in the board UI (paperclip.gatheringatthegrove.com) open Penny → instructions/runtime config → append the duty block. Flag this as a human step in the task handoff; do not attempt to write Penny's DB row directly.

- [ ] **Step 3: Commit**

```bash
git add docs/personas/penny-receipt-clerk.md
git commit -m "docs(persona): penny receipt-clerk duty block"
```

---

### Task 10: Extraction regression fixtures

**Files:**
- Create: `packages/discord-plugin/fixtures/README.md`
- Create: `packages/discord-plugin/fixtures/expected/` (one JSON per fixture image, added as images are collected)

- [ ] **Step 1: Create fixtures/README.md**

```markdown
# Receipt extraction regression fixtures

Real (or receipt-creator-generated) receipt images with known-good extractions.
When Penny's duty block or model changes, re-run her against these and diff.

Layout:
  fixtures/images/<name>.jpg          — the receipt photo
  fixtures/expected/<name>.json       — the expected ReceiptExtraction (src/types.ts)

Populate during Phase 0/1 from real family receipts (min: 1 clean thermal receipt,
1 crumpled/photographed-at-angle, 1 handwritten market receipt, 1 multi-page invoice
PDF, 1 cash-marked receipt). Keep totals/vendors REAL — that is the point.
No automation yet (YAGNI until the set stabilizes); compare by hand or with jq diff.
```

- [ ] **Step 2: Commit**

```bash
git add packages/discord-plugin/fixtures
git commit -m "docs(discord-plugin): extraction regression fixture scaffold"
```

---

## Deviations from spec (agreed rationale)

1. **Paperclip's formal approvals API is not used** — approval types are hardcoded server-side (`hire_agent`, etc.) and not plugin-extensible. The review gate is the `in_review` issue status + Vista close, which matches the spec's intent (Josh reviews before tax records) with zero new machinery.
2. **Spaces key naming** is `date_msgId_attId_filename` (not `date_vendor_amount`) because vendor/amount are unknown at ingest time; the sidecar JSON carries vendor/amount for the archive's audit trail.
3. **Penny writes the sidecar via the `receipt_record_extraction` tool** (she has no Spaces credentials) — the tool also posts the comment, Discord reply, and status change atomically, which is more reliable than persona-orchestrated multi-step behavior.
```
