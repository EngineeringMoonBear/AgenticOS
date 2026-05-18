/**
 * Integration tests for /api/vault/inbox/promote, /commit, /discard routes.
 *
 * Strategy:
 * - Create a real tmpdir vault on disk for each test.
 * - Mock "server-only" (vi.mock at module level).
 * - Mock @/lib/config/config-io via vi.doMock per test.
 * - Mock @/lib/llm/anthropic to avoid real API calls.
 * - Call __resetVaultStoreForTests() in beforeEach/afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let tmpDir: string;

async function writeMd(
  vaultDir: string,
  relPath: string,
  content: string
): Promise<void> {
  const abs = path.join(vaultDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body);
  return new Request("http://localhost/api/vault/inbox/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
  });
}

describe("/api/vault/inbox/promote|commit|discard integration", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-inbox-test-"));
    await fs.mkdir(path.join(tmpDir, "wiki"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "inbox"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  // --- promote 404 ---
  it("POST /promote → 404 when inbox note is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    vi.doMock("@/lib/llm/anthropic", () => ({
      getAnthropic: () => ({}),
      getSonnetModelId: async () => "claude-sonnet-4-7",
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/promote/route");
    const req = makeRequest({ inboxPath: "nonexistent.md" });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  // --- promote 502 non-JSON ---
  it("POST /promote → 502 when mock model returns non-JSON", async () => {
    await writeMd(tmpDir, "inbox/idea.md", "# Big Idea\nThis is a note about something important");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({
        vaultPath: tmpDir,
        modelDefaults: { sonnet: "claude-sonnet-4-7", haiku: "h", opus: "o" },
      }),
    }));
    vi.doMock("@/lib/llm/anthropic", () => ({
      getAnthropic: () => ({
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "This is not JSON at all!" }],
          }),
        },
      }),
      getSonnetModelId: async () => "claude-sonnet-4-7",
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/promote/route");
    const req = makeRequest({ inboxPath: "idea.md" });
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/non-JSON/i);
  });

  // --- promote 502 Zod failure ---
  it("POST /promote → 502 when mock model returns JSON that fails Zod", async () => {
    await writeMd(tmpDir, "inbox/idea.md", "# Big Idea\nThis is a note about something important");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({
        vaultPath: tmpDir,
        modelDefaults: { sonnet: "claude-sonnet-4-7", haiku: "h", opus: "o" },
      }),
    }));
    // Returns JSON but missing required fields
    vi.doMock("@/lib/llm/anthropic", () => ({
      getAnthropic: () => ({
        messages: {
          create: async () => ({
            content: [
              {
                type: "text",
                text: JSON.stringify({ destination: "", title: "", tags: [] }),
              },
            ],
          }),
        },
      }),
      getSonnetModelId: async () => "claude-sonnet-4-7",
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/promote/route");
    const req = makeRequest({ inboxPath: "idea.md" });
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/schema validation/i);
  });

  // --- promote 200 valid ---
  it("POST /promote → 200 with proposed page on valid mock response", async () => {
    await writeMd(tmpDir, "inbox/idea.md", "# Big Idea\nThis is a note about something important");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({
        vaultPath: tmpDir,
        modelDefaults: { sonnet: "claude-sonnet-4-7", haiku: "h", opus: "o" },
      }),
    }));
    const validProposal = {
      destination: "Farm/BigIdea",
      title: "Big Idea",
      tags: ["farm"],
      body: "This is a refined note about something important.",
      confidence: 0.85,
      reasoning: "Clearly a substantive note about farm operations.",
    };
    vi.doMock("@/lib/llm/anthropic", () => ({
      getAnthropic: () => ({
        messages: {
          create: async () => ({
            content: [{ type: "text", text: JSON.stringify(validProposal) }],
          }),
        },
      }),
      getSonnetModelId: async () => "claude-sonnet-4-7",
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/promote/route");
    const req = makeRequest({ inboxPath: "idea.md" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { proposed: typeof validProposal; confidence: number; reasoning: string };
    expect(body).toHaveProperty("proposed");
    expect(body).toHaveProperty("confidence");
    expect(body).toHaveProperty("reasoning");
    expect(body.proposed.destination).toBe("Farm/BigIdea");
    expect(body.proposed.title).toBe("Big Idea");
    expect(body.confidence).toBeCloseTo(0.85);
  });

  // --- commit 200 ---
  it("POST /commit → writes file + 200 response with written shape", async () => {
    await writeMd(tmpDir, "inbox/idea.md", "# Big Idea\nThis is the content");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/commit/route");
    const now = new Date().toISOString();
    const req = new Request("http://localhost/api/vault/inbox/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inboxPath: "idea.md",
        page: {
          path: "Farm/BigIdea",
          title: "Big Idea",
          tags: ["farm"],
          body: "This is the content",
          created: now,
          updated: now,
          sources: [],
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { written: { path: string } };
    expect(body).toHaveProperty("written");
    expect(body.written.path).toBe("Farm/BigIdea");

    // Verify file was written
    const written = await fs.readFile(
      path.join(tmpDir, "wiki", "Farm", "BigIdea.md"),
      "utf8"
    );
    expect(written).toContain("Big Idea");

    // Verify inbox file was deleted
    const inboxGone = await fs
      .access(path.join(tmpDir, "inbox", "idea.md"))
      .then(() => false)
      .catch(() => true);
    expect(inboxGone).toBe(true);
  });

  // --- discard 204 ---
  it("POST /discard → 204 + inbox file gone", async () => {
    await writeMd(tmpDir, "inbox/fleeting.md", "# Fleeting\nJust a thought");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/inbox/discard/route");
    const req = new Request("http://localhost/api/vault/inbox/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboxPath: "fleeting.md" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);

    const gone = await fs
      .access(path.join(tmpDir, "inbox", "fleeting.md"))
      .then(() => false)
      .catch(() => true);
    expect(gone).toBe(true);
  });
});
