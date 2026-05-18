import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultStore } from "@/lib/vault/store-singleton";

const BODY_LIMIT = 64 * 1024; // 64 KiB

const PageSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((s) => !s.split(/[/\\]/).some((seg) => seg === ".."), {
      message: "no .. segments",
    })
    .refine((s) => !/^[/\\]/.test(s), {
      message: "must be relative",
    }),
  title: z.string().min(1).max(120),
  tags: z.array(z.string()),
  body: z.string().min(1),
  created: z.string().default(() => new Date().toISOString()),
  updated: z.string().default(() => new Date().toISOString()),
  sources: z.array(z.string()).default([]),
});

const RequestSchema = z.object({
  inboxPath: z.string().min(1),
  page: PageSchema,
});

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

  const { inboxPath, page } = input.data;

  try {
    const store = await getVaultStore();
    const written = await store.promoteInbox(inboxPath, page);
    return NextResponse.json({ written });
  } catch (err) {
    console.error("[POST /api/vault/inbox/commit]", err);
    return NextResponse.json({ error: "Failed to commit inbox note" }, { status: 500 });
  }
}
