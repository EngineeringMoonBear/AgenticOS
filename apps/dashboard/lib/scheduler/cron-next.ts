/**
 * Minimal zero-dep next-fire computer for 5-field cron expressions.
 *
 * Supported syntax (mirrors what Hermes' cron registers accept):
 *   minute   0-59
 *   hour     0-23
 *   dom      1-31
 *   month    1-12
 *   dow      0-6  (0 = Sunday)
 *
 * Within each field:
 *   *               — every value in the field's range
 *   N               — exactly N
 *   N,M,...         — any of N, M, ...
 *   A-B             — every value from A to B inclusive
 *   *​/S             — every Sth value starting at the field's min
 *   A-B/S           — every Sth value in [A, B]
 *
 * Day-of-month + day-of-week interplay follows the standard rule: when
 * BOTH dom and dow are restricted (neither is `*`), the cron fires when
 * EITHER matches. When one is `*`, only the other is considered.
 *
 * Hand-rolled rather than adding `cron-parser` because the supported
 * subset covers every entry the AgenticOS infra ships today and dodges
 * a 30 KB transitive dep. If we ever need seconds, '@hourly' aliases,
 * 'L'/'#' specifiers, or non-UTC timezone math beyond what `Date` does,
 * swap in `cron-parser` here.
 */

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dom
  [1, 12], // month
  [0, 6], // dow
];

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"];

function parseField(raw: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    if (!part.length) {
      throw new Error(`empty subexpression in "${raw}"`);
    }
    let [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`bad step "${stepRaw}" in "${raw}"`);
    }

    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`bad range "${range}" in "${raw}"`);
      }
      lo = a;
      hi = b;
    } else {
      const v = Number(range);
      if (!Number.isInteger(v)) {
        throw new Error(`bad value "${range}" in "${raw}"`);
      }
      lo = v;
      hi = v;
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(`value out of bounds in "${raw}" (expected ${min}-${max})`);
    }

    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `expected 5 cron fields, got ${parts.length} in "${expression}"`,
    );
  }
  const [min, hour, dom, month, dow] = parts.map((part, i) => {
    try {
      return parseField(part, FIELD_RANGES[i][0], FIELD_RANGES[i][1]);
    } catch (err) {
      throw new Error(
        `bad ${FIELD_NAMES[i]} field: ${(err as Error).message}`,
      );
    }
  });
  return {
    minute: min,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

function matches(date: Date, fields: CronFields): boolean {
  if (!fields.minute.has(date.getUTCMinutes())) return false;
  if (!fields.hour.has(date.getUTCHours())) return false;
  if (!fields.month.has(date.getUTCMonth() + 1)) return false;

  const dom = date.getUTCDate();
  const dow = date.getUTCDay();
  const domMatch = fields.dom.has(dom);
  const dowMatch = fields.dow.has(dow);

  if (fields.domRestricted && fields.dowRestricted) {
    // Standard cron OR semantics when both are restricted.
    return domMatch || dowMatch;
  }
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/**
 * Returns the next moment at or after `from` (default: now) at which
 * the cron expression fires. All time math is in UTC — the caller is
 * responsible for any timezone interpretation.
 *
 * Returns null if no fire is found within 366 days, which can only
 * happen for an unsatisfiable expression like "0 0 30 2 *" (Feb 30th).
 */
export function nextFire(expression: string, from: Date = new Date()): Date | null {
  const fields = parseCron(expression);

  // Round up to the next whole minute — cron has minute resolution.
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  const horizonMs = 366 * 24 * 60 * 60 * 1000;
  const deadline = from.getTime() + horizonMs;

  while (candidate.getTime() <= deadline) {
    if (matches(candidate, fields)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}
