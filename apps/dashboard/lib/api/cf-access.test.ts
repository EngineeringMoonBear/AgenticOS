/**
 * Unit tests for Cloudflare Access JWT verification (security review
 * 2026-07-12, H1). A real RSA keypair is generated with WebCrypto and used to
 * sign tokens, so signature verification is exercised end-to-end — the JWKS
 * fetcher is injected, no network involved.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  verifyAccessJwt,
  teamDomainToIssuer,
  clearJwksCache,
} from "./cf-access";

const TEAM = "goldberrygrove";
const ISSUER = teamDomainToIssuer(TEAM); // https://goldberrygrove.cloudflareaccess.com
const AUD = "aud-tag-0123456789abcdef";
const KID = "test-key-1";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid?: string };

function b64url(bytes: Uint8Array | string): string {
  const bin =
    typeof bytes === "string"
      ? bytes
      : String.fromCharCode(...Array.from(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(
  payload: Record<string, unknown>,
  opts: { kid?: string; alg?: string } = {}
): Promise<string> {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? KID };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${h}.${p}`)
  );
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const now = Math.floor(Date.now() / 1000);
const validPayload = () => ({
  iss: ISSUER,
  aud: [AUD],
  email: "josh@goldberrygrove.farm",
  exp: now + 3600,
  nbf: now - 60,
  iat: now,
});

// Injected JWKS fetcher serving our generated public key.
const fetchJwks = async () => ({ keys: [publicJwk] });

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID };
});

beforeEach(() => clearJwksCache());

describe("teamDomainToIssuer", () => {
  it("expands a bare team name", () => {
    expect(teamDomainToIssuer("myteam")).toBe(
      "https://myteam.cloudflareaccess.com"
    );
  });
  it("accepts a full domain, with or without scheme/slash", () => {
    expect(teamDomainToIssuer("myteam.cloudflareaccess.com")).toBe(
      "https://myteam.cloudflareaccess.com"
    );
    expect(teamDomainToIssuer("https://myteam.cloudflareaccess.com/")).toBe(
      "https://myteam.cloudflareaccess.com"
    );
  });
});

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns the identity email", async () => {
    const token = await signJwt(validPayload());
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res).toEqual({ ok: true, email: "josh@goldberrygrove.farm" });
  });

  it("rejects a missing token", async () => {
    const res = await verifyAccessJwt(null, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing-token");
  });

  it("rejects a malformed token", async () => {
    const res = await verifyAccessJwt("not.a-jwt", { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("malformed-token");
  });

  it("rejects alg != RS256 (alg confusion)", async () => {
    const token = await signJwt(validPayload(), { alg: "HS256" });
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("bad-alg");
  });

  it("rejects a wrong issuer", async () => {
    const token = await signJwt({ ...validPayload(), iss: "https://evil.cloudflareaccess.com" });
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("bad-issuer");
  });

  it("rejects a wrong audience", async () => {
    const token = await signJwt({ ...validPayload(), aud: ["some-other-app"] });
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("bad-audience");
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ ...validPayload(), exp: now - 3600 });
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("expired");
  });

  it("rejects a token signed by a different key (bad signature)", async () => {
    const other = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );
    const saved = privateKey;
    privateKey = other.privateKey;
    const token = await signJwt(validPayload()); // signed w/ other key, JWKS has original
    privateKey = saved;
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("bad-signature");
  });

  it("rejects an unknown kid after one forced JWKS refetch", async () => {
    let fetches = 0;
    const counting = async () => {
      fetches++;
      return { keys: [publicJwk] };
    };
    const token = await signJwt(validPayload(), { kid: "rotated-away" });
    const res = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchJwks: counting });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unknown-kid");
    expect(fetches).toBe(2); // cache miss + forced rotation refetch
  });

  it("picks up a rotated key on refetch", async () => {
    const first = { keys: [{ ...publicJwk, kid: "old-key" }] };
    const second = { keys: [publicJwk] };
    let call = 0;
    const rotating = async () => (call++ === 0 ? first : second);
    // Prime the cache with the old key…
    await verifyAccessJwt(await signJwt(validPayload()), { teamDomain: TEAM, aud: AUD }, { fetchJwks: rotating });
    // …then a token under the new kid must succeed via forced refetch.
    const res = await verifyAccessJwt(await signJwt(validPayload()), { teamDomain: TEAM, aud: AUD }, { fetchJwks: rotating });
    expect(res.ok).toBe(true);
  });
});
