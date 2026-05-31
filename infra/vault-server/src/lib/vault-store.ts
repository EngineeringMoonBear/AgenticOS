import { InMemoryVaultStore } from "@agenticos/vault-core/store";
import type { Config } from "../config.js";

let cached: InMemoryVaultStore | null = null;

/**
 * Lazy singleton. Calling getStore() the first time reads the vault root from
 * disk; subsequent calls reuse the same store. The store has its own internal
 * TTL-based revalidation (30s) so we don't rebuild on every request.
 */
export function getStore(config: Config): InMemoryVaultStore {
  if (cached) return cached;
  cached = new InMemoryVaultStore({
    vaultRoot: config.vaultRoot,
    ttlMs: 30_000,
  });
  return cached;
}

/** Test helper — reset between test cases. */
export function resetStoreForTests(): void {
  cached = null;
}
