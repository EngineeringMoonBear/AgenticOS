export interface PrFacts {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  htmlUrl: string;
  draft: boolean;
  updatedAt: string;
  mergeableState: string;
  checksState: "success" | "failure" | "pending" | "none";
  reviewState: "approved" | "changes_requested" | "none";
}

export type Bucket =
  | "draft"
  | "ci-failing"
  | "has-conflicts"
  | "needs-review"
  | "ready-to-merge"
  | "stale";

/** Buckets shown in the "needs attention" section, in priority order. */
export const ATTENTION_BUCKETS: Bucket[] = [
  "ci-failing",
  "has-conflicts",
  "needs-review",
  "ready-to-merge",
  "stale",
];

export function classifyPr(facts: PrFacts, now: Date, staleDays: number): Bucket[] {
  const buckets: Bucket[] = [];
  if (facts.draft) buckets.push("draft");
  if (facts.checksState === "failure") buckets.push("ci-failing");
  if (facts.mergeableState === "dirty") buckets.push("has-conflicts");
  if (facts.reviewState === "none" && !facts.draft) buckets.push("needs-review");
  if (
    facts.reviewState === "approved" &&
    facts.checksState === "success" &&
    (facts.mergeableState === "clean" || facts.mergeableState === "unstable")
  ) {
    buckets.push("ready-to-merge");
  }
  const updated = Date.parse(facts.updatedAt);
  if (!Number.isNaN(updated)) {
    const ageDays = (now.getTime() - updated) / 86_400_000;
    if (ageDays >= staleDays) buckets.push("stale");
  }
  return buckets;
}
