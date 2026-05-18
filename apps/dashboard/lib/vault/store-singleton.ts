import "server-only";
import os from "node:os";
import path from "node:path";
import { InMemoryVaultStore } from "@agenticos/vault-core/store";
import { readConfig } from "@/lib/config/config-io";

let cached: InMemoryVaultStore | null = null;

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function getVaultStore(): Promise<InMemoryVaultStore> {
  if (cached) return cached;
  const cfg = await readConfig();
  cached = new InMemoryVaultStore({
    vaultRoot: expandTilde(cfg.vaultPath),
    ttlMs: 30_000,
  });
  return cached;
}

export function __resetVaultStoreForTests(): void {
  cached = null;
}
