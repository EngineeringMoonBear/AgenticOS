import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config/config-io";
import { AgenticOSConfigSchema } from "@/lib/config/schema";

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to read config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    const message = err instanceof Error ? err.message : "Failed to write config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
