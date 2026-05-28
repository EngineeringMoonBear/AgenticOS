import { NextResponse } from "next/server";

// TODO: wire to OpenViking scope-count endpoint.

export const runtime = "nodejs";

export interface ScopeEntry {
  name: string;
  scope: string;
  count: number;
  fill_percent: number;
}

export interface MemoryScopesData {
  total: number;
  scopes: ScopeEntry[];
}

export async function GET(): Promise<Response> {
  const data: MemoryScopesData = {
    total: 1652,
    scopes: [
      { name: "resources", scope: "viking://resources", count: 1204, fill_percent: 73 },
      { name: "user/memories", scope: "viking://user/*", count: 312, fill_percent: 19 },
      { name: "session/*", scope: "viking://session", count: 89, fill_percent: 5 },
      { name: "agent/skills", scope: "viking://agent", count: 47, fill_percent: 3 },
    ],
  };
  return NextResponse.json(data);
}
