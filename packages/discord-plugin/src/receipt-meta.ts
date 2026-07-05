import type { ReceiptMeta, ReceiptExtraction } from "./types.js";

export const META_MARKER = "<!-- receipt-meta v1 -->";
export const EXTRACTION_MARKER = "<!-- receipt-extraction v1 -->";

function renderBlock(marker: string, payload: unknown): string {
  return `${marker}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

function parseBlock<T>(marker: string, text: string): T | null {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const fenceStart = text.indexOf("```json", at);
  if (fenceStart === -1) return null;
  const jsonStart = fenceStart + "```json".length;
  const fenceEnd = text.indexOf("```", jsonStart);
  if (fenceEnd === -1) return null;
  try {
    return JSON.parse(text.slice(jsonStart, fenceEnd)) as T;
  } catch {
    return null;
  }
}

export function renderMetaBlock(meta: ReceiptMeta): string {
  return renderBlock(META_MARKER, meta);
}

export function parseMetaBlock(text: string): ReceiptMeta | null {
  return parseBlock<ReceiptMeta>(META_MARKER, text);
}

export function renderExtractionComment(x: ReceiptExtraction): string {
  const lines = [
    `**${x.vendor}** — $${x.total.toFixed(2)} on ${x.date}`,
    `Category: **${x.suggested_category}** · Paid by ${x.payment_method} · confidence ${x.confidence.toFixed(2)}`,
    x.flags.length ? `Flags: ${x.flags.join(", ")}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${renderBlock(EXTRACTION_MARKER, x)}`;
}

export function parseExtractionComment(text: string): ReceiptExtraction | null {
  return parseBlock<ReceiptExtraction>(EXTRACTION_MARKER, text);
}
