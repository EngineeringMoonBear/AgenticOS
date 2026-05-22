/**
 * Fix 1: DNS Rebinding Protection (VibeSec finding H1)
 *
 * Threat model: DNS rebinding lets an attacker swap a domain's DNS record to
 * 127.0.0.1 after the browser has cached the original address. The browser then
 * sends same-origin requests to localhost with the attacker's domain in the
 * Host header. Without host validation, the server cannot distinguish these
 * requests from legitimate localhost requests.
 *
 * Mitigation:
 *   - All /api/* requests: reject if Host is not in ALLOWED_HOSTS.
 *   - State-changing methods (POST/PUT/PATCH/DELETE) on /api/*: additionally
 *     reject if Origin header is present and its host is not in ALLOWED_HOSTS.
 *     Missing Origin is allowed (same-origin requests from browser address bar,
 *     curl, etc. do not send Origin).
 *
 * This file uses the Next.js 16 "proxy" convention (formerly "middleware").
 * The function must be named `proxy` (default export also accepted).
 * Runtime defaults to Node.js in Next.js 16; no Edge-only restriction.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Allowlist of host values considered local/trusted.
 *
 * Local-dev hosts are always permitted. Production hosts come from the
 * ALLOWED_HOSTS env var (comma-separated). In App Platform we set this to
 * include the Cloudflare-fronted custom domain AND the App Platform
 * default URL pattern, so both Cloudflare-routed traffic and direct
 * App-Platform-URL traffic pass the gate.
 *
 * Examples:
 *   ALLOWED_HOSTS="agenticos.gatheringatthegrove.com"
 *   ALLOWED_HOSTS="agenticos.gatheringatthegrove.com,agenticos-dashboard-w2i7d.ondigitalocean.app"
 */
const ENV_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "localhost:3000",
  "127.0.0.1:3000",
  ...ENV_HOSTS,
]);

/** Match any host on App Platform's default-URL pattern.
 * App Platform URLs look like `agenticos-dashboard-w2i7d.ondigitalocean.app`
 * where the suffix is random per app instance. Matching the family avoids
 * needing to update ALLOWED_HOSTS every time the app is recreated. */
const APP_PLATFORM_HOST_RE = /^[a-z0-9-]+\.ondigitalocean\.app$/;

function isHostAllowed(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true;
  if (APP_PLATFORM_HOST_RE.test(host)) return true;
  return false;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Pure helper — exported so unit tests can exercise the logic without a full
 * Next.js request object.
 *
 * Returns `{ allowed: true }` when the request should proceed, or
 * `{ allowed: false, reason: string }` when it should be blocked.
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

export function proxy(request: NextRequest): NextResponse | Response {
  const check = isAllowedRequest(request);

  if (!check.allowed) {
    return Response.json(
      { error: check.reason ?? "Forbidden" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
