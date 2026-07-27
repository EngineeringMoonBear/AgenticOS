import "server-only";

/**
 * Global run-dispatch concurrency cap (GOL-819).
 *
 * Defense-in-depth on top of the idempotent-create guard (GOL-638) and the
 * droplet vertical bump (GOL-657). Any run this app dispatches — the Phase-5
 * scheduler/curator wiring, a manual "Run Now", or a future fan-out — passes
 * through a single FIFO semaphore so the total number of *concurrent* agent
 * subprocesses this app spawns can never oversubscribe the box's practical
 * ceiling (~8-10 runs post-resize per GOL-520). Excess demand **queues** (FIFO)
 * rather than being dropped or errored, and crossing the cap emits an
 * observable ops log line.
 *
 * Scope note: this bounds the *AgenticOS app's own* dispatch path. The primary
 * live agent-run dispatcher is `paperclip-server` (see
 * docs/runbooks/agenticos-oom-mitigation.md); a cap at that layer is a
 * Paperclip-platform concern, not editable in this repo.
 */

export interface SemaphoreStats {
  /** Configured maximum concurrent holders. */
  limit: number;
  /** Slots currently held. */
  active: number;
  /** Callers waiting for a slot. */
  queued: number;
}

/**
 * A minimal FIFO counting semaphore. Not oversubscription-prone: `active` is
 * only ever incremented on the synchronous fast path, and a released slot is
 * handed directly to the next waiter (the counter is never transiently lowered
 * in a way that lets a racing `acquire()` slip past the cap). Node's
 * single-threaded event loop guarantees the synchronous sections don't
 * interleave.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly onQueue?: (stats: SemaphoreStats) => void,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, got ${limit}`);
    }
  }

  get stats(): SemaphoreStats {
    return { limit: this.limit, active: this.active, queued: this.waiters.length };
  }

  /** Resolves once a slot is held. Callers MUST pair with exactly one release(). */
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    // At capacity — queue rather than oversubscribe the box.
    this.onQueue?.({ limit: this.limit, active: this.active, queued: this.waiters.length + 1 });
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // A releasing holder handed its slot to us; `active` already accounts for it.
  }

  /** Frees a slot, waking the oldest waiter (which inherits this slot). */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }

  /** Runs `fn` while holding a slot; the slot is always released afterward. */
  async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Default ceiling — ~box practical capacity post-resize (GOL-657). Env-tunable. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 8;

/**
 * Resolve the configured cap from `AGENTICOS_MAX_CONCURRENT_RUNS`. Falls back to
 * {@link DEFAULT_MAX_CONCURRENT_RUNS} when unset/blank, and warns (then falls
 * back) on a non-positive-integer value so a typo can't silently disable the cap.
 */
export function resolveMaxConcurrentRuns(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AGENTICOS_MAX_CONCURRENT_RUNS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_CONCURRENT_RUNS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    console.warn(
      `[run-dispatch] invalid AGENTICOS_MAX_CONCURRENT_RUNS=${JSON.stringify(raw)}; ` +
        `falling back to ${DEFAULT_MAX_CONCURRENT_RUNS}`,
    );
    return DEFAULT_MAX_CONCURRENT_RUNS;
  }
  return n;
}

let limiter: Semaphore | null = null;

/**
 * The process-wide run-dispatch limiter. Lazily constructed from env on first
 * use so tests can override the env and reset via
 * {@link __resetRunDispatchLimiterForTest}.
 */
export function getRunDispatchLimiter(): Semaphore {
  if (!limiter) {
    limiter = new Semaphore(resolveMaxConcurrentRuns(), (stats) => {
      // Observable ops signal — a Discord ops bridge can key off this prefix.
      console.warn(
        `[run-dispatch] concurrency cap reached: ${stats.active}/${stats.limit} runs active, ` +
          `${stats.queued} queued — dispatch queued rather than oversubscribing the box (GOL-819)`,
      );
    });
  }
  return limiter;
}

/** Test-only: drop the memoized limiter so the next getter re-reads env. */
export function __resetRunDispatchLimiterForTest(): void {
  limiter = null;
}
