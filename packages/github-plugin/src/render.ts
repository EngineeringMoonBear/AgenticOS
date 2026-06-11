import { ATTENTION_BUCKETS, type Bucket } from "./classify.js";

export interface AssessedPr {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  htmlUrl: string;
  updatedAt: string;
  buckets: Bucket[];
}

function ageDays(updatedAt: string, now: Date): number {
  const t = Date.parse(updatedAt);
  return Number.isNaN(t) ? -1 : Math.floor((now.getTime() - t) / 86_400_000);
}

export function renderDigest(
  assessed: AssessedPr[],
  generatedAt: Date,
  errors: string[],
): string {
  const lines: string[] = [
    "---",
    `generated_at: ${generatedAt.toISOString()}`,
    "---",
    "",
    `# Dev PR Triage — ${generatedAt.toISOString().slice(0, 10)}`,
    "",
    "## 🔔 Needs your attention",
    "",
  ];

  const attention = assessed.filter((a) =>
    a.buckets.some((b) => ATTENTION_BUCKETS.includes(b)),
  );
  if (attention.length === 0) {
    lines.push("- Nothing flagged. 🎉");
  } else {
    const rank = (a: AssessedPr) => {
      for (let i = 0; i < ATTENTION_BUCKETS.length; i++) {
        if (a.buckets.includes(ATTENTION_BUCKETS[i]!)) return i;
      }
      return ATTENTION_BUCKETS.length;
    };
    for (const a of [...attention].sort((x, y) => rank(x) - rank(y))) {
      const tags = a.buckets.filter((b) => ATTENTION_BUCKETS.includes(b)).join(", ");
      lines.push(
        `- **[${a.repoFullName}#${a.number}](${a.htmlUrl})** ${a.title} — _${tags}_ (@${a.author})`,
      );
    }
  }

  lines.push("", "## All open PRs", "", "| Repo | PR | Author | Buckets | Age (d) |", "| --- | --- | --- | --- | --- |");
  for (const a of assessed) {
    const buckets = a.buckets.length ? a.buckets.join(", ") : "—";
    lines.push(
      `| ${a.repoFullName} | [#${a.number}](${a.htmlUrl}) | @${a.author} | ${buckets} | ${ageDays(a.updatedAt, generatedAt)} |`,
    );
  }

  if (errors.length) {
    lines.push("", "## ⚠️ Errors", "");
    for (const e of errors) lines.push(`- ${e}`);
  }
  lines.push("");
  return lines.join("\n");
}
