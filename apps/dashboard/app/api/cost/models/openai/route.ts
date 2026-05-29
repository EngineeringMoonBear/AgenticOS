import { NextResponse } from "next/server";

// TODO: wire to real OpenAI usage telemetry.

export const runtime = "nodejs";

export interface OpenAIModelUsage {
  name: string;
  role: string;
  calls: number;
  age: string;
  spend_usd: number;
}

export interface OpenAICodexData {
  endpoint: string;
  models: OpenAIModelUsage[];
}

export async function GET(): Promise<Response> {
  const data: OpenAICodexData = {
    endpoint: "api.openai.com",
    models: [
      { name: "gpt-5-codex", role: "reasoning", calls: 12, age: "6m ago", spend_usd: 1.84 },
      { name: "gpt-4o-mini", role: "orchestration", calls: 247, age: "28s ago", spend_usd: 0.57 },
    ],
  };
  return NextResponse.json(data);
}
