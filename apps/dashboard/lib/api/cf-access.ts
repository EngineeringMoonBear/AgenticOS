/**
 * Cloudflare Access JWT verification (security review 2026-07-12, finding H1).
 *
 * WHY THIS EXISTS: Cloudflare Access (Google SSO) fronts the custom domain,
 * but it is a *perimeter* — the App Platform default URL
 * (`agenticos-dashboard-*.ondigitalocean.app`) serves this same app directly,
 * never traversing Cloudflare. Host/Origin checks cannot close that path
 * because a direct client controls its own Host header. The only signal that
 * a request actually came through Access is the `Cf-Access-Jwt-Assertion`
 * header — an RS256 JWT signed by the team's Access keys — so we verify it
 * at the application layer and fail closed.
 *
 * Zero dependencies: WebCrypto (`crypto.subtle`) is available in both the
 * Node and Edge runtimes Next.js may use for proxy.ts.
 *
 * Key handling: JWKS is fetched from
 *   https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
 * and cached in module scope for JWKS_TTL_MS. An unknown `kid` triggers one
 * forced refetch (key rotation) before failing.
 */

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;

export interface CfAccessResult {
  ok: boolean;
  /** Machine-readable failure reason (never echoes token contents). */
  reason?: string;
  /** Authenticated identity (JWT `email` claim) when ok. */
  email?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultFetchJwks: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`jwks fetch -> ${res.status}`);
  return res.json();
};

/** Normalize the team domain env: accept `myteam` or `myteam.cloudflareaccess.com`. */
export function teamDomainToIssuer(teamDomain: string): string {
  const d = teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const full = d.includes(".") ? d : `${d}.cloudflareaccess.com`;
  return `https://${full}`;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(seg: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
  } catch {
    return null;
  }
}

// Module-scope JWKS cache: one entry per issuer.
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function getJwks(
  issuer: string,
  fetchJwks: JwksFetcher,
  force = false
): Promise<Jwk[]> {
  const cached = jwksCache.get(issuer);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const { keys } = await fetchJwks(`${issuer}/cdn-cgi/access/certs`);
  jwksCache.set(issuer, { keys: keys ?? [], fetchedAt: Date.now() });
  return keys ?? [];
}

/** Exposed for tests. */
export function clearJwksCache(): void {
  jwksCache.clear();
}

/**
 * Verify a Cloudflare Access application token.
 *
 * @param token   Raw value of the `Cf-Access-Jwt-Assertion` header.
 * @param opts.teamDomain  CF_ACCESS_TEAM_DOMAIN (team name or full domain).
 * @param opts.aud         CF_ACCESS_AUD — the Access application audience tag.
 * @param deps    Injectable for tests: JWKS fetcher + clock.
 */
export async function verifyAccessJwt(
  token: string | null | undefined,
  opts: { teamDomain: string; aud: string },
  deps: { fetchJwks?: JwksFetcher; nowMs?: () => number } = {}
): Promise<CfAccessResult> {
  const fetchJwks = deps.fetchJwks ?? defaultFetchJwks;
  const now = (deps.nowMs ?? Date.now)() / 1000;

  if (!token) return { ok: false, reason: "missing-token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed-token" };
  const [h, p, s] = parts;

  const header = decodeJsonSegment(h);
  const payload = decodeJsonSegment(p);
  if (!header || !payload) return { ok: false, reason: "malformed-token" };

  // Algorithm must be pinned — never trust `alg` beyond the one we support.
  if (header.alg !== "RS256") return { ok: false, reason: "bad-alg" };
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return { ok: false, reason: "missing-kid" };

  const issuer = teamDomainToIssuer(opts.teamDomain);
  if (payload.iss !== issuer) return { ok: false, reason: "bad-issuer" };

  const audClaim = payload.aud;
  const auds = Array.isArray(audClaim) ? audClaim : [audClaim];
  if (!auds.includes(opts.aud)) return { ok: false, reason: "bad-audience" };

  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp + CLOCK_SKEW_S < now) return { ok: false, reason: "expired" };
  const nbf = typeof payload.nbf === "number" ? payload.nbf : 0;
  if (nbf - CLOCK_SKEW_S > now) return { ok: false, reason: "not-yet-valid" };

  // Find the signing key; on kid miss, force one refetch (rotation).
  let jwk = (await getJwks(issuer, fetchJwks)).find((k) => k.kid === kid);
  if (!jwk) {
    jwk = (await getJwks(issuer, fetchJwks, true)).find((k) => k.kid === kid);
  }
  if (!jwk) return { ok: false, reason: "unknown-kid" };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return { ok: false, reason: "bad-key" };
  }

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) return { ok: false, reason: "bad-signature" };

  return {
    ok: true,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}
