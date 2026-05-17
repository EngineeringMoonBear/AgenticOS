/**
 * Fix 4 (config route): body size cap + generic 500 error envelope.
 *
 * - Content-Length is checked BEFORE request.json() to avoid parsing a
 *   maliciously large body (DoS / memory exhaustion).
 * - 500-class error messages are replaced with a generic string; the real
 *   error is logged server-side so debugging still works without leaking
 *   filesystem paths or internal details to the client.
 * - 400-class validation errors still return structured Zod issue paths
 *   because those are useful for the UI to highlight the offending field.
 */
import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config/config-io";
import { AgenticOSConfigSchema } from "@/lib/config/schema";

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err: unknown) {
    console.error("[api/config GET]", err);
    return NextResponse.json({ error: "Failed to read config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Body size guard — checked before parsing to avoid memory exhaustion
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = AgenticOSConfigSchema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    }));
    return NextResponse.json(
      { error: "Validation failed", issues },
      { status: 400 }
    );
  }

  try {
    await writeConfig(result.data);
    return NextResponse.json(result.data);
  } catch (err: unknown) {
    console.error("[api/config POST]", err);
    return NextResponse.json(
      { error: "Failed to write config" },
      { status: 500 }
    );
  }
}
