import "server-only";
import os from "node:os";
import path from "node:path";
import { InMemoryVaultStore } from "@agenticos/vault-core/store";
import type { VaultStore } from "@agenticos/vault-core";
import { RemoteVaultClient } from "./remote-client";
import { readConfig } from "@/lib/config/config-io";

let cached: VaultStore | null = null;

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Returns the vault store backing the `/api/vault/*` routes.
 *
 * Selection is env-based:
 *  - When `VAULT_SERVER_URL` is set (the App Platform deploy, which is remote
 *    from the vault), proxy reads to the vault-server HTTP API on the Droplet
 *    via `RemoteVaultClient`.
 *  - Otherwise (local dev), read the local filesystem with `InMemoryVaultStore`.
 */
export async function getVaultStore(): Promise<VaultStore> {
  if (cached) return cached;

  const vaultServerUrl = process.env.VAULT_SERVER_URL;
  if (vaultServerUrl) {
    cached = new RemoteVaultClient({ baseUrl: vaultServerUrl });
    return cached;
  }

  const cfg = await readConfig();
  cached = new InMemoryVaultStore({
    vaultRoot: expandTilde(cfg.vaultPath),
    ttlMs: 30_000,
  });
  return cached;
}

/**
 * Reset the singleton — for tests only.
 * Call in beforeEach/afterEach when you need a fresh store.
 */
export function __resetVaultStoreForTests(): void {
  cached = null;
}
