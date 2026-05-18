/**
 * Fix 3: Security headers (VibeSec)
 *
 * Trade-off notes:
 *
 * - `unsafe-inline` in script-src / style-src: Required for Next.js hydration
 *   and the CSS-first Tailwind v4 @theme inline styles used in Base UI / Nova
 *   components. The proper long-term fix is nonce-based CSP (Phase 2, when SSE
 *   streaming will likely also need revisiting). Until nonces are wired through
 *   the App Router layout, removing unsafe-inline breaks hydration in prod.
 *
 * - `data:` in img-src / font-src: Needed for the inline SVG logo and
 *   next/font subsetted bundles that are inlined as data URIs.
 *
 * - HSTS on localhost: Technically a no-op in dev (browsers ignore HSTS for
 *   localhost), but the directive is present so it ships in any staging/prod
 *   deployment without a config change.
 */
import type { NextConfig } from "next";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  // unsafe-inline required for Next.js hydration; replace with nonces in Phase 2
  "script-src 'self' 'unsafe-inline'",
  // unsafe-inline required for Tailwind v4 CSS-first @theme inline styles
  "style-src 'self' 'unsafe-inline'",
  // data: for inline SVG logo
  "img-src 'self' data:",
  // data: for next/font subsetted bundles
  "font-src 'self' data:",
  // lock down fetch destinations to same-origin
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // vault-core is a local workspace package with "type": "module" and raw TS
  // exports. transpilePackages handles the TypeScript transpilation; Turbopack
  // (the Next 16 default) infers the .js → .ts resolution from this without
  // additional config. The webpack block below is only consulted when building
  // with --webpack (kept as a fallback for environments where Turbopack hangs).
  transpilePackages: ["@agenticos/vault-core"],
  // Empty turbopack block: silences Next 16's validator, which errors when a
  // webpack block is present without an accompanying turbopack block. The
  // builder doesn't actually need any options — defaults work.
  turbopack: {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
        ],
      },
    ];
  },
};

export default nextConfig;
