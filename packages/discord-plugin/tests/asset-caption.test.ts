import { describe, it, expect } from "vitest";
import {
  parseAssetCaption,
  isLogoClass,
  descriptionSlug,
  KNOWN_BRANDS,
  KNOWN_CLASSES,
} from "../src/assets/caption.js";

describe("parseAssetCaption", () => {
  it("parses the canonical `brand, class, description` form", () => {
    const r = parseAssetCaption("goldberry, hero, orchard at dusk");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ brand: "goldberry", assetClass: "hero", description: "orchard at dusk" });
  });

  it("is case-insensitive and tolerant of extra whitespace", () => {
    const r = parseAssetCaption("  GGG ,  LOGO  , Main Mark ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ brand: "ggg", assetClass: "logo", description: "Main Mark" });
  });

  it("resolves brand aliases (hub → gather, farm → goldberry)", () => {
    expect(parseAssetCaption("hub, banner, welcome")).toMatchObject({ ok: true, value: { brand: "gather" } });
    expect(parseAssetCaption("farm, about, the falls")).toMatchObject({ ok: true, value: { brand: "goldberry" } });
  });

  it("keeps commas inside the description", () => {
    const r = parseAssetCaption("nursery, gallery, ferns, moss, and stone");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.description).toBe("ferns, moss, and stone");
  });

  it("allows an empty description", () => {
    const r = parseAssetCaption("goldberry, hero");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.description).toBe("");
  });

  it("rejects a caption with no class", () => {
    const r = parseAssetCaption("goldberry");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("brand and a class");
  });

  it("rejects an unknown brand with a helpful hint", () => {
    const r = parseAssetCaption("acme, hero, something");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Unknown brand "acme"');
    expect(r.error).toContain("goldberry");
  });

  it("rejects an unknown class (e.g. product photos belong in Odoo, not here)", () => {
    const r = parseAssetCaption("nursery, product, a fern in a pot");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Unknown class "product"');
  });

  it("rejects an empty caption", () => {
    expect(parseAssetCaption("").ok).toBe(false);
  });
});

describe("isLogoClass", () => {
  it("routes only logo to the brand-PR path", () => {
    expect(isLogoClass("logo")).toBe(true);
    expect(isLogoClass("hero")).toBe(false);
  });
});

describe("descriptionSlug", () => {
  it("kebab-slugs the description", () => {
    expect(descriptionSlug({ brand: "goldberry", assetClass: "hero", description: "Orchard at Dusk!" })).toBe(
      "orchard-at-dusk",
    );
  });

  it("falls back to the class when there is no description", () => {
    expect(descriptionSlug({ brand: "ggg", assetClass: "logo", description: "" })).toBe("logo");
  });
});

describe("taxonomy constants", () => {
  it("exposes the brand and class vocabularies for reconciliation with @grove/brand", () => {
    expect(KNOWN_BRANDS).toContain("goldberry");
    expect(KNOWN_CLASSES).toContain("logo");
  });
});
