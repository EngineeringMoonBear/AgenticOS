import type { GitHubClient } from "./github-client.js";
import type { VaultWriter } from "./vault-writer.js";
import { classifyPr, type Bucket, type PrFacts } from "./classify.js";
import { renderDigest, type AssessedPr } from "./render.js";

export interface PrTriageDeps {
  client: GitHubClient;
  writer: VaultWriter;
  now: Date;
  staleDays: number;
  vaultPath: string;
}

export interface PrTriageSummary {
  total: number;
  errored: number;
  buckets: Record<string, number>;
  errors: string[];
}

export async function runPrTriage(deps: PrTriageDeps): Promise<PrTriageSummary> {
  const { client, writer, now, staleDays, vaultPath } = deps;
  const errors: string[] = [];

  const search = await client.searchOpenPrs();
  if (!search.ok) {
    throw new Error(`searchOpenPrs failed: ${search.error}`);
  }

  const assessed: AssessedPr[] = [];
  for (const pr of search.data) {
    try {
      const detail = await client.prDetail(pr.repoFullName, pr.number);
      if (!detail.ok) throw new Error(detail.error);
      const checks = await client.prChecksState(pr.repoFullName, detail.data.headSha);
      if (!checks.ok) throw new Error(checks.error);
      const review = await client.prReviewState(pr.repoFullName, pr.number);
      if (!review.ok) throw new Error(review.error);

      const facts: PrFacts = {
        ...pr,
        mergeableState: detail.data.mergeableState,
        checksState: checks.data,
        reviewState: review.data,
      };
      assessed.push({ ...pr, buckets: classifyPr(facts, now, staleDays) });
    } catch (err) {
      errors.push(`${pr.repoFullName}#${pr.number}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const buckets: Record<string, number> = {};
  for (const a of assessed) for (const b of a.buckets) buckets[b] = (buckets[b] ?? 0) + 1;

  const digest = renderDigest(assessed, now, errors);
  const write = await writer.writePage(vaultPath, digest);
  if (!write.ok) throw new Error(`vault write failed: ${write.error}`);

  return { total: assessed.length, errored: errors.length, buckets, errors };
}

// Re-export for the worker's convenience.
export type { Bucket };
