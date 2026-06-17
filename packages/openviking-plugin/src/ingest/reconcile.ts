export interface VaultFile {
  path: string;
  content: string;
  sha256: string;
}

export interface DiffResult {
  add: VaultFile[];
  update: VaultFile[];
  remove: string[];
}

/**
 * Pure diff: compare current vault files against a prior path→sha256 map.
 *
 * - New path (not in prior)          → add
 * - Same path, different sha256      → update
 * - Same path, same sha256           → omitted (unchanged)
 * - Path in prior but not in current → remove
 */
export function diff(
  current: VaultFile[],
  prior: Map<string, string>,
): DiffResult {
  const add: VaultFile[] = [];
  const update: VaultFile[] = [];
  const seen = new Set<string>();

  for (const file of current) {
    seen.add(file.path);
    const priorSha = prior.get(file.path);
    if (priorSha === undefined) {
      add.push(file);
    } else if (priorSha !== file.sha256) {
      update.push(file);
    }
    // unchanged → skip
  }

  const remove: string[] = [];
  for (const path of prior.keys()) {
    if (!seen.has(path)) {
      remove.push(path);
    }
  }

  return { add, update, remove };
}
