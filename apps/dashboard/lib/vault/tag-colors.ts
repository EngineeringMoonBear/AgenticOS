export const TAG_COLORS: Record<string, string> = {
  farm: "#7fae5c",
  software: "#8c6bce",
  marketing: "#c9a227",
  video: "#d97c3f",
  concepts: "#8aa0c4",
  personal: "#c47fae",
};

const DEFAULT_COLOR = "#6b6157";

export function colorForTag(tag: string | undefined): string {
  if (!tag) return DEFAULT_COLOR;
  return TAG_COLORS[tag.toLowerCase()] ?? DEFAULT_COLOR;
}
