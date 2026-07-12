import { describe, it, expect, vi, afterEach } from "vitest";
import { GroveAssetsClient } from "../src/assets/client.js";

const OK = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const ERR = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

function client() {
  return new GroveAssetsClient({ baseUrl: "https://assets-svc.example/", token: "t0k" });
}

describe("GroveAssetsClient.optimizeAndUpload", () => {
  it("POSTs multipart to /optimize with bearer auth and returns cdnUrl/key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      OK({ cdnUrl: "https://cdn/x.webp", key: "goldberry/hero/x-abc-1920w.webp" }),
    );
    const out = await client().optimizeAndUpload({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "shot.jpg",
      brand: "goldberry",
      assetClass: "hero",
      slug: "orchard-at-dusk",
    });
    expect(out).toEqual({ cdnUrl: "https://cdn/x.webp", key: "goldberry/hero/x-abc-1920w.webp" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://assets-svc.example/optimize"); // trailing slash trimmed
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer t0k" });
    const form = (init as RequestInit).body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(form.get("meta") as string)).toMatchObject({ brand: "goldberry", slug: "orchard-at-dusk" });
    expect(form.get("file")).toBeInstanceOf(Blob); // raw bytes, not base64
  });

  it("throws with the server error message on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ERR(413, { error: "file too large" }));
    await expect(
      client().optimizeAndUpload({ bytes: new Uint8Array([1]), filename: "f", brand: "ggg", assetClass: "hero", slug: "s" }),
    ).rejects.toThrow(/optimize failed: file too large/);
  });

  it("throws when the response is missing cdnUrl/key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(OK({ key: "k" }));
    await expect(
      client().optimizeAndUpload({ bytes: new Uint8Array([1]), filename: "f", brand: "ggg", assetClass: "hero", slug: "s" }),
    ).rejects.toThrow(/no cdnUrl\/key/);
  });
});

describe("GroveAssetsClient.proposeBrandEntry", () => {
  it("POSTs to /brand-entry and returns the PR URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      OK({ prUrl: "https://github.com/Goldberry-Playground/grove-sites/pull/42" }),
    );
    const out = await client().proposeBrandEntry({
      brand: "ggg",
      slug: "main-mark",
      cdnUrl: "https://cdn/logo.webp",
      key: "ggg/logo/main-mark-abc-1920w.webp",
      caption: "ggg, logo, main mark",
    });
    expect(out.prUrl).toContain("/pull/42");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://assets-svc.example/brand-entry");
  });
});
