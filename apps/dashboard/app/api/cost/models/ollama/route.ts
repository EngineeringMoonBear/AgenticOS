import { NextResponse } from "next/server";

// TODO: wire to real Ollama metrics endpoint.

export const runtime = "nodejs";

export interface OllamaModelUsage {
  name: string;
  role: string;
  size: string;
  age: string;
  calls_today: number;
}

export interface OllamaData {
  endpoint: string;
  models: OllamaModelUsage[];
}

export async function GET(): Promise<Response> {
  const data: OllamaData = {
    endpoint: "localhost:11434",
    models: [
      { name: "nomic-embed-text", role: "embedding", size: "274 MB", age: "2m ago", calls_today: 8432 },
      { name: "qwen2.5:3b", role: "chat", size: "1.9 GB", age: "14m ago", calls_today: 312 },
    ],
  };
  return NextResponse.json(data);
}
