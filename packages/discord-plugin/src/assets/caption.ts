/**
 * #assets caption parsing (GOL-92 / AgenticOS#251).
 *
 * A poster drops an image in the Discord `#assets` channel with a caption that
 * names the brand + asset class, e.g. `goldberry, hero, orchard at dusk`.
 * The caption is the whole contract for routing the upload:
 *   - `brand`       → which grove brand namespace (Spaces key prefix / @grove/brand set)
 *   - `assetClass`  → ADR-009 tier + routing (logo → Tier 4 @grove/brand PR; rest → Tier 3 CDN)
 *   - `description` → human label, becomes the slug in the CDN key / brand-entry name
 *
 * Keep this a pure function with no I/O so it is trivially unit-testable and so
 * the same taxonomy can be reconciled with `@grove/brand` when it lands on main.
 */

/** Brand namespaces this pipeline can route to. Mirrors the grove-sites tenants. */
export const KNOWN_BRANDS = ["goldberry", "ggg", "nursery", "gather"] as const;
export type Brand = (typeof KNOWN_BRANDS)[number];

/** Common brand aliases people will actually type in a caption. */
const BRAND_ALIASES: Record<string, Brand> = {
  goldberry: "goldberry",
  goldberrygrove: "goldberry",
  farm: "goldberry",
  ggg: "ggg",
  george: "ggg",
  woodworking: "ggg",
  woodworkinggeorge: "ggg",
  nursery: "nursery",
  atthegrove: "nursery",
  gather: "gather",
  hub: "gather",
  gathering: "gather",
  gatheringatthegrove: "gather",
};

/**
 * ADR-009 asset classes handled by the `#assets` lane (Tier 3 brand statics + Tier 4 logos).
 * Product photos (Tier 2 → Odoo) and editorial (Tier 1 → Ghost) are deliberately NOT here:
 * they have their own upload lanes and must not be routed to the CDN bucket.
 */
export const KNOWN_CLASSES = [
  "hero",
  "about",
  "founders",
  "banner",
  "gallery",
  "background",
  "video",
  "logo",
] as const;
export type AssetClass = (typeof KNOWN_CLASSES)[number];

/** The one class that routes to the Tier 4 `@grove/brand` PR path instead of a CDN reply. */
export const LOGO_CLASS: AssetClass = "logo";

export interface ParsedCaption {
  brand: Brand;
  assetClass: AssetClass;
  /** Free-text label, e.g. "orchard at dusk". May be "" if the poster gave none. */
  description: string;
}

export type CaptionResult =
  | { ok: true; value: ParsedCaption }
  | { ok: false; error: string };

function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** A short, poster-facing hint used in every rejection reply. */
export function captionHint(): string {
  return [
    'Caption format: `brand, class, description` — e.g. `goldberry, hero, orchard at dusk`.',
    `Brands: ${KNOWN_BRANDS.join(", ")}.`,
    `Classes: ${KNOWN_CLASSES.join(", ")}.`,
  ].join(" ");
}

/**
 * Parse a Discord message caption into a routed asset request.
 * Splits on commas: first field = brand, second = class, remainder = description.
 */
export function parseAssetCaption(content: string): CaptionResult {
  const fields = (content ?? "").split(",").map((f) => f.trim()).filter((f) => f.length > 0);
  if (fields.length < 2) {
    return { ok: false, error: `Caption needs at least a brand and a class. ${captionHint()}` };
  }

  const brand = BRAND_ALIASES[normalizeToken(fields[0]!)];
  if (!brand) {
    return { ok: false, error: `Unknown brand "${fields[0]}". ${captionHint()}` };
  }

  const classToken = normalizeToken(fields[1]!);
  const assetClass = (KNOWN_CLASSES as readonly string[]).includes(classToken)
    ? (classToken as AssetClass)
    : undefined;
  if (!assetClass) {
    return { ok: false, error: `Unknown class "${fields[1]}". ${captionHint()}` };
  }

  const description = fields.slice(2).join(", ");
  return { ok: true, value: { brand, assetClass, description } };
}

/** Whether a parsed asset routes to the `@grove/brand` PR path (Tier 4) vs a CDN reply (Tier 3). */
export function isLogoClass(assetClass: AssetClass): boolean {
  return assetClass === LOGO_CLASS;
}

/** Kebab slug for the description, used to name the CDN key / brand entry. Falls back to the class. */
export function descriptionSlug(parsed: ParsedCaption): string {
  const slug = parsed.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || parsed.assetClass;
}
