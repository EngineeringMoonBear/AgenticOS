/**
 * Process-level env. Read once at startup. No magic strings inside route
 * handlers — every reachable env var flows through here.
 */
export interface Config {
  /** TCP port the Fastify server listens on. */
  port: number;
  /** Filesystem path of the vault root inside the container. */
  vaultRoot: string;
  /**
   * Subdirectory under the vault root holding wiki pages (default `"wiki"`).
   * Set `WIKI_SUBDIR=""` when the paired Obsidian vault keeps pages at the
   * root (e.g. `farming/…`) rather than under a `wiki/` folder. Optional in
   * the type (test fixtures build partial Configs); `loadConfig` always
   * populates it and `getStore` falls back to the store's own `"wiki"` default.
   */
  wikiSubdir?: string;
  /** Optional Syncthing REST base URL; absent → recent-changes returns available:false. */
  syncthingUrl: string | undefined;
  /** Optional Syncthing REST API key. */
  syncthingApiKey: string | undefined;
  /**
   * Syncthing folder ID for the paired vault — must match the folder ID Syncthing
   * shares with the Mac (default "agenticos-vault"). recent-changes filters the
   * event stream to this folder; a mismatch silently yields zero changes.
   */
  syncthingFolderId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 7777);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, got ${env.PORT}`);
  }
  return {
    port,
    vaultRoot: env.VAULT_ROOT ?? "/app/vault",
    // `??` (not `||`) so an explicit empty string is honored — that's the
    // "vault root is the page root" mode. Unset falls back to "wiki".
    wikiSubdir: env.WIKI_SUBDIR ?? "wiki",
    syncthingUrl: env.SYNCTHING_URL || undefined,
    syncthingApiKey: env.SYNCTHING_API_KEY || undefined,
    syncthingFolderId: env.SYNCTHING_FOLDER_ID ?? "agenticos-vault",
  };
}
