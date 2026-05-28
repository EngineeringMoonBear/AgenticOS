import { NextResponse } from "next/server";

// TODO: wire to skill registry.

export const runtime = "nodejs";

export interface SkillEntry {
  name: string;
  used_by: string;
  invocations: number;
}

export interface SkillsCatalogData {
  total_registered: number;
  skills: SkillEntry[];
}

export async function GET(): Promise<Response> {
  const data: SkillsCatalogData = {
    total_registered: 11,
    skills: [
      { name: "farm-task-triage", used_by: "used by curator · daily-brief", invocations: 12 },
      { name: "code-review", used_by: "used by curator", invocations: 8 },
      { name: "daily-summary", used_by: "used by daily-brief", invocations: 3 },
      { name: "expense-categorize", used_by: "used by cost-report", invocations: 2 },
    ],
  };
  return NextResponse.json(data);
}
