/**
 * API request gate — two layers, both fail-closed in production:
 *
 * 1. DNS-rebinding / host allowlist (VibeSec finding H1, original fix):
 *    reject /api/* requests whose Host (or Origin on state-changing methods)
 *    is not allowlisted.
 *
 * 2. Cloudflare Access JWT (security review 2026-07-12, finding H1):
 *    Cloudflare Access (Google SSO) fronts the custom domain, but the App
 *    Platform default URL (`*.ondigitalocean.app`) reaches this app directly,
 *    never traversing Cloudflare — and a direct client controls its own Host
 *    header, so host checks alone cannot close that path. Every /api/*
 *    request from a non-local host must therefore carry a VALID
 *    `Cf-Access-Jwt-Assertion` (RS256, team-issuer + audience checked,
 *    signature verified against the team JWKS — see lib/api/cf-access.ts).
 *
 *    Config: CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (wired by Terraform from
 *    the Access application resource). In production, MISSING config blocks
 *    /api/* with 503 — unconfigured is exactly the vulnerable state, so it
 *    fails closed rather than silently open. Local dev (localhost hosts) is
 *    exempt: no Cloudflare sits in front of `pnpm dev`.
 *
 * NOTE the old `APP_PLATFORM_HOST_RE` wave-through is intentionally GONE:
 * requests on the default App Platform hostname are exactly the ones that
 * bypassed Access. They now fail both layers.
 *
 * This file uses the Next.js 16 "proxy" convention (formerly "middleware").
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessJwt } from "./lib/api/cf-access";

/** Local-dev hosts: always allowed, and exempt from the Access-JWT layer. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost:3000",
  "127.0.0.1:3000",
]);

/** Production hosts come from ALLOWED_HOSTS (comma-separated env). This
 * should list ONLY the Cloudflare-fronted custom domain — never the
 * *.ondigitalocean.app default URL. */
const ENV_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  ...LOCAL_HOSTS,
  ...ENV_HOSTS,
]);

function isHostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host);
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Pure helper — exported so unit tests can exercise the logic without a full
 * Next.js request cycle. Covers layer 1 (host/origin) only; the async Access
 * JWT check lives in `proxy()` / `checkAccessJwt()` below.
 */
export function isAllowedRequest(req: Request): {
  allowed: boolean;
  reason?: string;
} {
  // --- Host check (all methods) ---
  const host = req.headers.get("host") ?? "";
  if (!isHostAllowed(host)) {
    return { allowed: false, reason: "Forbidden host" };
  }

  // --- Origin check (state-changing methods only) ---
  if (STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    const origin = req.headers.get("origin");
    if (origin !== null) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        // Malformed Origin header — treat as forbidden.
        return { allowed: false, reason: "Forbidden origin" };
      }
      if (!isHostAllowed(originHost)) {
        return { allowed: false, reason: "Forbidden origin" };
      }
    }
    // Missing Origin is acceptable for same-origin requests.
  }

  return { allowed: true };
}

/**
 * Layer 2: Cloudflare Access JWT. Exported for tests (deps injectable via
 * the cf-access module). Local hosts skip; unconfigured production blocks.
 */
export async function checkAccessJwt(req: Request): Promise<{
  allowed: boolean;
  status?: number;
  reason?: string;
}> {
  const host = req.headers.get("host") ?? "";
  if (LOCAL_HOSTS.has(host)) return { allowed: true }; // pnpm dev — no CF in front

  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN ?? "";
  const aud = process.env.CF_ACCESS_AUD ?? "";
  if (!teamDomain || !aud) {
    // Unconfigured = the vulnerable state. Fail closed with an actionable
    // error instead of silently serving unauthenticated data.
    return {
      allowed: false,
      status: 503,
      reason:
        "Access auth not configured (set CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD)",
    };
  }

  const token = req.headers.get("cf-access-jwt-assertion");
  const result = await verifyAccessJwt(token, { teamDomain, aud });
  if (!result.ok) {
    return { allowed: false, status: 401, reason: "Unauthorized" };
  }
  return { allowed: true };
}

export async function proxy(
  request: NextRequest
): Promise<NextResponse | Response> {
  const check = isAllowedRequest(request);
  if (!check.allowed) {
    return Response.json(
      { error: check.reason ?? "Forbidden" },
      { status: 403 }
    );
  }

  const access = await checkAccessJwt(request);
  if (!access.allowed) {
    return Response.json(
      { error: access.reason ?? "Unauthorized" },
      { status: access.status ?? 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
