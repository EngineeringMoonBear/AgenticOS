import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getVaultStore } from "@/lib/vault/store-singleton";
import { getAnthropic, getSonnetModelId } from "@/lib/llm/anthropic";

type ContentBlock = Anthropic.Messages.ContentBlock;

const BODY_LIMIT = 64 * 1024; // 64 KiB

const RequestSchema = z.object({
  inboxPath: z.string().min(1),
});

/**
 * Destination path safety: relative, no ".." segments, no absolute paths.
 */
const PromoteResponseSchema = z.object({
  destination: z
    .string()
    .min(1)
    .refine((s) => !s.split(/[/\\]/).some((seg) => seg === ".."), {
      message: "no .. segments",
    })
    .refine((s) => !path.isAbsolute(s), {
      message: "must be relative",
    }),
  title: z.string().min(1).max(120),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(8),
  body: z.string().min(1).max(50_000),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});

export type PromoteProposal = z.infer<typeof PromoteResponseSchema>;

export async function POST(req: Request): Promise<NextResponse> {
  // 64 KiB body limit
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > BODY_LIMIT) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  if (rawBody.length > BODY_LIMIT) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = RequestSchema.safeParse(parsed);
  if (!input.success) {
    return NextResponse.json(
      { error: "Invalid request", details: input.error.issues },
      { status: 400 }
    );
  }

  const { inboxPath } = input.data;

  try {
    const store = await getVaultStore();

    // Read inbox note
    const note = await store.readInbox(inboxPath);
    if (!note) {
      return NextResponse.json({ error: "Inbox note not found" }, { status: 404 });
    }

    // Build flat index and tags from vault
    const { flat } = await store.list();
    const tags = await store.getAllTags();

    const flatIndex = flat.map((p) => `- ${p}`).join("\n");
    const allTags = tags.map((t) => `- ${t.id} (${t.count})`).join("\n");

    // Load prompt templates
    const promptsDir = path.join(process.cwd(), "lib/llm/prompts");
    const [systemPrompt, userTemplate] = await Promise.all([
      fs.readFile(path.join(promptsDir, "promote-system.txt"), "utf8"),
      fs.readFile(path.join(promptsDir, "promote-user.template.txt"), "utf8"),
    ]);

    // Substitute template variables
    const userPrompt = userTemplate
      .replace("{{inbox_body}}", note.body ?? "")
      .replace("{{flat_index}}", flatIndex)
      .replace("{{all_tags}}", allTags);

    // Call Anthropic
    let llmText: string;
    try {
      const anthropic = getAnthropic();
      const model = await getSonnetModelId();
      const response = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const textBlock = response.content.find((c: ContentBlock) => c.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return NextResponse.json(
          { error: "LLM returned no text content" },
          { status: 502 }
        );
      }
      llmText = textBlock.text;
    } catch (err) {
      console.error("[POST /api/vault/inbox/promote] LLM error:", err);
      return NextResponse.json(
        { error: "LLM service unavailable" },
        { status: 503 }
      );
    }

    // Parse and validate LLM response
    let llmJson: unknown;
    try {
      // Extract JSON from the response (LLM may wrap in markdown code blocks)
      const jsonMatch = llmText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in LLM response");
      }
      llmJson = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("[POST /api/vault/inbox/promote] LLM non-JSON response:", llmText.slice(0, 200));
      return NextResponse.json(
        { error: "LLM returned non-JSON response" },
        { status: 502 }
      );
    }

    const validated = PromoteResponseSchema.safeParse(llmJson);
    if (!validated.success) {
      console.error("[POST /api/vault/inbox/promote] LLM schema validation failed:", validated.error.issues);
      return NextResponse.json(
        { error: "LLM response failed schema validation" },
        { status: 502 }
      );
    }

    const { confidence, reasoning, ...proposed } = validated.data;

    return NextResponse.json({ proposed, confidence, reasoning });
  } catch (err) {
    console.error("[POST /api/vault/inbox/promote]", err);
    return NextResponse.json({ error: "Failed to promote inbox note" }, { status: 500 });
  }
}
