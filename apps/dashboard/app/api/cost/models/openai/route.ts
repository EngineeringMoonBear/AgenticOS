/**
 * GET /api/cost/models/openai
 *
 * Returns per-model spend and token usage for OpenAI models.
 *
 * Response shape (OpenAICodexData):
 *   {
 *     endpoint: string,
 *     models: OpenAIModelUsage[],
 *   }
 *
 * OpenAIModelUsage (reshaped from real Paperclip data — old stub fields
 * `role`, `age`, and `calls` are removed because they have no real source):
 *   {
 *     name: string,          // model name (e.g. "gpt-4o")
 *     spend_usd: number,     // costCents / 100
 *     inputTokens: number,
 *     cachedInputTokens: number,
 *     outputTokens: number,
 *   }
 *
 * Paperclip path: costByAgentModel() filtered to provider="openai",
 *   aggregated by model (summed across agents), sorted spend descending.
 *   Fail-closed: upstream error → 503 { error }.
 *   Missing config → 503 { error }.
 *
 * Hermes path (dataSource() !== "paperclip"):
 *   Returns stub rows mapped into the reshaped fields (no role/age/calls).
 *   Placeholder until D-phase deletion.
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Shared shape
// ---------------------------------------------------------------------------

export interface OpenAIModelUsage {
  name: string;
  spend_usd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface OpenAICodexData {
  endpoint: string;
  models: OpenAIModelUsage[];
}

// ---------------------------------------------------------------------------
// Paperclip path
// ---------------------------------------------------------------------------

const OPENAI_PROVIDERS = new Set(["openai"]);

async function getPaperclipOpenAIModels(): Promise<Response> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip is not configured. Set PAPERCLIP_API_URL, PAPERCLIP_BOARD_KEY, and PAPERCLIP_COMPANY_ID.",
      },
      { status: 503 },
    );
  }

  const { createPaperclipClient } = await import("@/lib/paperclip/client");
  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  const result = await client.costByAgentModel({});

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip costByAgentModel failed: ${result.error}` },
      { status: 503 },
    );
  }

  // Filter to OpenAI rows only, then aggregate by model (sum across agents).
  const byModel = new Map<
    string,
    { costCents: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }
  >();

  for (const row of result.data) {
    if (!OPENAI_PROVIDERS.has(row.provider)) continue;

    const existing = byModel.get(row.model);
    if (existing) {
      existing.costCents += row.costCents;
      existing.inputTokens += row.inputTokens;
      existing.cachedInputTokens += row.cachedInputTokens;
      existing.outputTokens += row.outputTokens;
    } else {
      byModel.set(row.model, {
        costCents: row.costCents,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
      });
    }
  }

  const models: OpenAIModelUsage[] = Array.from(byModel.entries())
    .map(([model, agg]) => ({
      name: model,
      spend_usd: agg.costCents / 100,
      inputTokens: agg.inputTokens,
      cachedInputTokens: agg.cachedInputTokens,
      outputTokens: agg.outputTokens,
    }))
    .sort((a, b) => b.spend_usd - a.spend_usd);

  const data: OpenAICodexData = {
    endpoint: "api.openai.com",
    models,
  };

  return NextResponse.json(data);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipOpenAIModels();
  }

  // ── Hermes stub path ─────────────────────────────────────────────────────
  // Stub rows mapped into the reshaped OpenAIModelUsage fields.
  // role/age/calls dropped — they had no real source.
  // Remains in place until D-phase wires or deletes this path.
  const data: OpenAICodexData = {
    endpoint: "api.openai.com",
    models: [
      {
        name: "gpt-5-codex",
        spend_usd: 1.84,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      },
      {
        name: "gpt-4o-mini",
        spend_usd: 0.57,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      },
    ],
  };
  return NextResponse.json(data);
}
