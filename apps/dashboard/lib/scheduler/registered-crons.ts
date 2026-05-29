/**
 * Dashboard-side mirror of the cron jobs that
 * `infra/scripts/register-cron-jobs.sh` installs into Hermes on every
 * fresh Droplet boot. Kept here so the Runs vista's "Next scheduled"
 * tile can show real upcoming runs without a network read against the
 * Droplet's `jobs.json` (which lives behind the VPC, on a different
 * container, with no Hermes-side stat API).
 *
 * **Single source of truth caveat:** the canonical list lives in the
 * shell script. When schedules change there, update this file too.
 * A future task could move the source of truth to JSON and have both
 * the script (via `jq`) and the dashboard read from it.
 */

export interface RegisteredCron {
  /** Hermes job name. Matches `--name` passed to `hermes cron create`. */
  name: string;
  /** Standard 5-field cron expression. UTC. */
  schedule: string;
  /** Short human-readable description for tooltips / sublabels. */
  description: string;
}

export const REGISTERED_CRONS: ReadonlyArray<RegisteredCron> = [
  {
    name: "vault-ingest",
    schedule: "0 * * * *",
    description: "OpenViking ingestion of recent vault changes",
  },
  {
    name: "daily-brief",
    schedule: "0 7 * * *",
    description: "Curator daily-brief generation",
  },
  {
    name: "cost-report",
    schedule: "0 23 * * *",
    description: "End-of-day cost rollup",
  },
];
