import "server-only";

/**
 * Curator dispatch helper. Phase 5 wires this into the scheduler:
 * the scheduler reads cron entries, finds the Curator entry, and invokes
 * this function which in turn shells out to /opt/agenticos/scripts/run-curator.sh
 * on the Droplet.
 *
 * In v1, the prompt + system message live in the script + Honcho user-model,
 * not here. This module is intentionally thin — its only job is to spawn
 * the canonical run-curator script and surface its run record.
 */

export const CURATOR_AGENT_ID = "curator";
export const CURATOR_SCRIPT_PATH =
  process.env.CURATOR_SCRIPT_PATH ?? "/opt/agenticos/scripts/run-curator.sh";

export interface CuratorRunOptions {
  triggeredBy: "scheduler" | "manual";
}

export async function runCurator(_options: CuratorRunOptions): Promise<{ ok: boolean }> {
  // The actual subprocess invocation moves to lib/scheduler/scheduler.ts in Task 41.
  // This function exists so other code (UI "Run Now" button, future tests) can
  // import a stable handle even before scheduler integration.
  return Promise.resolve({ ok: true });
}
