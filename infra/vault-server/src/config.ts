/**
 * Process-level env. Read once at startup. No magic strings inside route
 * handlers — every reachable env var flows through here.
 */
export interface Config {
  /** TCP port the Fastify server listens on. */
  port: number;
  /** Filesystem path of the vault root inside the container. */
  vaultRoot: string;
  /** Optional Syncthing REST base URL; absent → recent-changes returns available:false. */
  syncthingUrl: string | undefined;
  /** Optional Syncthing REST API key. */
  syncthingApiKey: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 7777);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, got ${env.PORT}`);
  }
  return {
    port,
    vaultRoot: env.VAULT_ROOT ?? "/app/vault",
    syncthingUrl: env.SYNCTHING_URL || undefined,
    syncthingApiKey: env.SYNCTHING_API_KEY || undefined,
  };
}
