import { NextResponse } from "next/server";
import { vikingFsTree } from "@/lib/api/viking";

export const runtime = "nodejs";

function normalizeScope(scope: string): string {
  return scope.startsWith("viking://") ? scope : `viking://${scope}`;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "resources";
  const uri = normalizeScope(scope);
  try {
    const tree = await vikingFsTree(uri);
    return NextResponse.json(tree);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
