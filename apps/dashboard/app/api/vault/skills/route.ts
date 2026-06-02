import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  usedBy: string[];
  path: string;
}

export interface SkillsResponse {
  totalRegistered: number;
  skills: SkillEntry[];
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) {
    return NextResponse.json({ totalRegistered: 0, skills: [] });
  }

  try {
    const res = await fetch(`${baseUrl}/skills`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
