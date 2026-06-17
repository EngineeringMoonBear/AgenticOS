import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readVault } from "../src/ingest/vault-reader.js";

// Helper: compute expected sha256 of a content string (UTF-8 bytes)
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// Helper: build a minimal Response-like object
function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_URL = "http://vault-server:4010";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readVault", () => {
  it("calls /tree then /page for each included path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock
      .mockResolvedValueOnce(
        // First call: GET /tree
        mockResponse({
          tree: {},
          flatPaths: ["notes/hello.md", "farming/plan.md"],
        }),
      )
      .mockResolvedValueOnce(
        // Second call: GET /page?path=notes/hello.md
        mockResponse({
          path: "notes/hello.md",
          title: "Hello",
          content: "# Hello world",
          frontmatter: {},
        }),
      )
      .mockResolvedValueOnce(
        // Third call: GET /page?path=farming/plan.md
        mockResponse({
          path: "farming/plan.md",
          title: "Plan",
          content: "# Farming plan",
          frontmatter: {},
        }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);

    // Verify /tree was called
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tree`,
      expect.any(Object),
    );

    // Verify /page was called for each path
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/page?path=notes%2Fhello.md`,
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/page?path=farming%2Fplan.md`,
      expect.any(Object),
    );
  });

  it("computes stable SHA256 of page content", async () => {
    const content = "# Hello world\n\nSome text here.";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({ tree: {}, flatPaths: ["notes/hello.md"] }),
      )
      .mockResolvedValueOnce(
        mockResponse({ path: "notes/hello.md", title: "Hello", content, frontmatter: {} }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const file = result.data[0];
    expect(file?.sha256).toBe(sha256(content));
    expect(file?.sha256).toHaveLength(64);
  });

  it("excludes paths starting with inbox/", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          tree: {},
          flatPaths: [
            "notes/hello.md",
            "inbox/capture.md",
            "inbox/subdir/note.md",
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ path: "notes/hello.md", title: "Hello", content: "hi", frontmatter: {} }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.path).toBe("notes/hello.md");
  });

  it("excludes paths whose segments contain a dotfile prefix", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          tree: {},
          flatPaths: [
            "notes/hello.md",
            ".obsidian/settings.md",
            "farming/.summaries/overview.md",
            ".stfolder/file.md",
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ path: "notes/hello.md", title: "Hello", content: "hi", frontmatter: {} }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.path).toBe("notes/hello.md");
  });

  it("excludes non-.md paths", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          tree: {},
          flatPaths: ["notes/hello.md", "notes/image.png", "notes/data.json"],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ path: "notes/hello.md", title: "Hello", content: "hi", frontmatter: {} }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
  });

  it("returns ok:false when /tree fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockResponse({ error: "vault offline" }, 503),
    );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("503");
  });

  it("returns ok:false when vault-server is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns ok:false when a /page fetch fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({ tree: {}, flatPaths: ["notes/hello.md"] }),
      )
      .mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("404");
  });

  it("returns VaultFile with correct path and content fields", async () => {
    const content = "Farm notes";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({ tree: {}, flatPaths: ["farming/notes.md"] }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          path: "farming/notes.md",
          title: "Notes",
          content,
          frontmatter: {},
        }),
      );

    const result = await readVault(BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const file = result.data[0];
    expect(file?.path).toBe("farming/notes.md");
    expect(file?.content).toBe(content);
  });
});
