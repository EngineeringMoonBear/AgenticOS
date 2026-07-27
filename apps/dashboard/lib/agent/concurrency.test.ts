import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  Semaphore,
  resolveMaxConcurrentRuns,
  getRunDispatchLimiter,
  __resetRunDispatchLimiterForTest,
  DEFAULT_MAX_CONCURRENT_RUNS,
} from "./concurrency";

/** Defer to the next macrotask so queued waiters get a chance to run. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Semaphore", () => {
  it("rejects a non-positive-integer limit", () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(-1)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it("allows up to `limit` holders without queuing", async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.stats).toEqual({ limit: 2, active: 2, queued: 0 });
  });

  it("queues the (limit+1)th acquire and fires the onQueue signal", async () => {
    const onQueue = vi.fn();
    const s = new Semaphore(1, onQueue);
    await s.acquire();

    let third = false;
    const pending = s.acquire().then(() => {
      third = true;
    });

    await tick();
    expect(third).toBe(false); // still queued, not dropped/errored
    expect(s.stats).toEqual({ limit: 1, active: 1, queued: 1 });
    expect(onQueue).toHaveBeenCalledWith({ limit: 1, active: 1, queued: 1 });

    s.release();
    await pending;
    expect(third).toBe(true);
    expect(s.stats).toEqual({ limit: 1, active: 1, queued: 0 });
  });

  it("never oversubscribes under a burst of concurrent acquires", async () => {
    const limit = 3;
    const s = new Semaphore(limit);
    let live = 0;
    let peak = 0;

    const work = async () => {
      await s.acquire();
      live += 1;
      peak = Math.max(peak, live);
      await tick();
      live -= 1;
      s.release();
    };

    await Promise.all(Array.from({ length: 20 }, work));
    expect(peak).toBe(limit);
    expect(s.stats).toEqual({ limit, active: 0, queued: 0 });
  });

  it("preserves FIFO ordering of queued waiters", async () => {
    const s = new Semaphore(1);
    const order: number[] = [];
    await s.acquire(); // hold the only slot

    const waiters = [1, 2, 3].map((n) =>
      s.acquire().then(() => {
        order.push(n);
      }),
    );

    // Release one slot per macrotask; each hands off to the next queued waiter.
    for (let i = 0; i < 3; i += 1) {
      await tick();
      s.release();
    }
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
  });

  it("withSlot releases the slot even when fn throws", async () => {
    const s = new Semaphore(1);
    await expect(s.withSlot(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(s.stats.active).toBe(0);
    // Slot is free again for the next caller.
    await s.acquire();
    expect(s.stats.active).toBe(1);
  });
});

describe("resolveMaxConcurrentRuns", () => {
  it("defaults when unset or blank", () => {
    expect(resolveMaxConcurrentRuns({})).toBe(DEFAULT_MAX_CONCURRENT_RUNS);
    expect(resolveMaxConcurrentRuns({ AGENTICOS_MAX_CONCURRENT_RUNS: "  " })).toBe(
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
  });

  it("parses a valid positive integer", () => {
    expect(resolveMaxConcurrentRuns({ AGENTICOS_MAX_CONCURRENT_RUNS: "12" })).toBe(12);
  });

  it("falls back (with a warning) on invalid values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMaxConcurrentRuns({ AGENTICOS_MAX_CONCURRENT_RUNS: "0" })).toBe(
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    expect(resolveMaxConcurrentRuns({ AGENTICOS_MAX_CONCURRENT_RUNS: "-5" })).toBe(
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    expect(resolveMaxConcurrentRuns({ AGENTICOS_MAX_CONCURRENT_RUNS: "abc" })).toBe(
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("getRunDispatchLimiter", () => {
  const prev = process.env.AGENTICOS_MAX_CONCURRENT_RUNS;
  beforeEach(() => __resetRunDispatchLimiterForTest());
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTICOS_MAX_CONCURRENT_RUNS;
    else process.env.AGENTICOS_MAX_CONCURRENT_RUNS = prev;
    __resetRunDispatchLimiterForTest();
  });

  it("is a memoized singleton configured from env", () => {
    process.env.AGENTICOS_MAX_CONCURRENT_RUNS = "4";
    const a = getRunDispatchLimiter();
    const b = getRunDispatchLimiter();
    expect(a).toBe(b);
    expect(a.stats.limit).toBe(4);
  });
});
